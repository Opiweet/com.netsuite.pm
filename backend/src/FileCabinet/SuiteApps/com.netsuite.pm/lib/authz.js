/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/runtime', 'N/crypto', 'N/encode', 'N/search', './errors'], (runtime, crypto, encode, search, errors) => {

  const MAX_REQUEST_AGE_MS = 5 * 60 * 1000; // 5 minutes
  const ENFORCE_PERMISSION_CHECKS = false; // turn on to have PBAC

  const selectId = (fieldValue) => {
    if (Array.isArray(fieldValue)) {
      return fieldValue[0] && fieldValue[0].value != null ? String(fieldValue[0].value) : null;
    }
    if (fieldValue && typeof fieldValue === 'object' && fieldValue.value != null) {
      return String(fieldValue.value);
    }
    if (fieldValue != null && fieldValue !== '') return String(fieldValue);
    return null;
  }

  const toMultiSelectIds = (fieldValue) => {
    if (!Array.isArray(fieldValue)) return [];
    return fieldValue
      .map((x) => (x && x.value != null ? String(x.value) : ''))
      .filter(Boolean);
  }

  const toMultiSelectText = (fieldValue) => {
    if (!Array.isArray(fieldValue)) return [];
    return fieldValue
      .map((x) => (x && x.text != null ? String(x.text).trim() : ''))
      .filter(Boolean);
  }

  const resolvePermissionCodes = (roleIds) => {
    if (!Array.isArray(roleIds) || roleIds.length === 0) return [];

    const allCodes = new Set();

    roleIds.forEach((roleId) => {
      try {
        const roleData = search.lookupFields({
          type: 'customrecord_pm_roles',
          id: String(roleId),
          columns: ['custrecord_role_perms']
        });

        const codes = toMultiSelectText(roleData && roleData.custrecord_role_perms);
        codes.forEach((code) => allCodes.add(code));
      } catch (_) {
        // Ignore broken/missing role records to keep auth flow resilient.
      }
    });

    return Array.from(allCodes);
  }

  const resolveHmacKey = (secret) => {
    const s = String(secret || '').trim();
    return crypto.createSecretKey({
      secret: s,
      encoding: encode.Encoding.BASE_64
    });
  }

  /**
   * Constant-time comparison to prevent timing attacks
   */
  const safeCompare = (a, b) => {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Verify HMAC signature + timestamp
   */
  const verifySignature = (context) => {
    const receivedSignature = context.signature;
    const timestamp = context.timestamp;
    const now = Date.now();

    if (!receivedSignature) {
      throw errors.unauthorized('NO_SIGNATURE', 'Missing signature');
    }

    if (!timestamp || isNaN(Number(timestamp))) {
      throw errors.unauthorized('NO_TIMESTAMP', 'Missing or invalid timestamp');
    }

    const ageMs = Math.abs(now - Number(timestamp));
    if (ageMs > MAX_REQUEST_AGE_MS) {
      throw errors.unauthorized('EXPIRED', 'Request expired');
    }

    const secretRaw = runtime.getCurrentScript()
      .getParameter({ name: 'custscript_pm_shared_secret' });
    const secret = secretRaw == null ? '' : String(secretRaw).trim();
    if (!secret)
      throw errors.serverError('NO_SECRET', 'Signature secret not configured');

    // Remove signature before hashing
    const { signature, ...unsignedPayload } = context;
    let bodyString = '';
    try {
      bodyString = JSON.stringify(unsignedPayload);
    } catch (e) {
      throw errors.serverError('BAD_PAYLOAD', 'Failed to serialize signed payload');
    }

    let computedSignature;
    try {
      const key = resolveHmacKey(secret);

      const hmac = crypto.createHmac({
        algorithm: crypto.HashAlg.SHA256,
        key
      });

      hmac.update({
        input: bodyString,
        inputEncoding: encode.Encoding.UTF_8
      });

      computedSignature = hmac.digest({
        outputEncoding: encode.Encoding.HEX
      });
    } catch (e) {
      throw errors.serverError('HMAC_INIT_FAILED', 'HMAC configuration invalid');
    }

    const computedNormalized = String(computedSignature || '').toLowerCase();
    const receivedNormalized = String(receivedSignature || '').toLowerCase();

    if (!safeCompare(computedNormalized, receivedNormalized)) {
      throw errors.unauthorized('BAD_SIGNATURE', 'Invalid signature');
    }
  }

  /**
   * Determine who the requestor is.
   * Expected valid signed payload from middleware:
   * {
   *  "resource": "projects|jobs|irs",
   *  "uid": "1001",
   *  "timestamp": 1739870000000,
   *  "signature": "..."
   * }
   */
  const getPrincipal = (context, options) => {
    verifySignature(context);
    const requireSid = !!(options && options.requireSid);

    const uid = context && context.uid;
    if (!uid)
      throw errors.unauthorized('NO_UID', 'Missing uid');

    const user = search.lookupFields({
      type: 'customrecord_pm_usermanagement',
      id: String(uid),
      columns: [
        'custrecord_pm_usermngt_email',
        'custrecord_pm_usermngt_access',
        'custrecord_pm_usermngt_lock',
        'custrecord_pm_usermngt_session',
        'custrecord_pm_usermngt_subsidiary',
        'custrecord_pm_usermngt_roles',
        'custrecord_pm_usermngt_sites',
        'custrecord_pm_usermngt_depts'
      ]
    });

    const hasAccess = user.custrecord_pm_usermngt_access === true || user.custrecord_pm_usermngt_access === 'T';
    const isLocked = user.custrecord_pm_usermngt_lock === true || user.custrecord_pm_usermngt_lock === 'T';
    if (!hasAccess || isLocked)
      throw errors.forbidden('USER_DISABLED', 'User has no access');

    if (requireSid) {
      const sid = context && context.sid ? String(context.sid) : '';
      if (!sid)
        throw errors.unauthorized('NO_SID', 'Missing sid');
      const sessionHash = String(user.custrecord_pm_usermngt_session || '');
      if (!sessionHash || sessionHash !== sid)
        throw errors.unauthorized('BAD_SESSION', 'Invalid session');
    }

    const email = user.custrecord_pm_usermngt_email ? String(user.custrecord_pm_usermngt_email).toLowerCase() : null;
    if (!email)
      throw errors.unauthorized('BAD_PRINCIPAL', 'User missing email');

    const sites = toMultiSelectIds(user.custrecord_pm_usermngt_sites);
    const departments = toMultiSelectIds(user.custrecord_pm_usermngt_depts);
    const roles = toMultiSelectIds(user.custrecord_pm_usermngt_roles);
    const permissionCodes = resolvePermissionCodes(roles);
    const subsidiary = selectId(user.custrecord_pm_usermngt_subsidiary);

    return {
      uid: String(uid),
      email,
      subsidiary,
      site: sites[0] || null,
      department: departments[0] || null,
      sites,
      departments,
      roles,
      permissionCodes
    };
  }

  const canReadProject = (principal, project) => {
    const projectSite = project && project.site != null ? String(project.site) : null;
    const projectDept = project && project.department != null ? String(project.department) : null;

    const sites = Array.isArray(principal.sites) && principal.sites.length
      ? principal.sites.map(String)
      : (principal.site ? [String(principal.site)] : []);
    const departments = Array.isArray(principal.departments) && principal.departments.length
      ? principal.departments.map(String)
      : (principal.department ? [String(principal.department)] : []);

    if (!projectSite || !projectDept || !sites.length || !departments.length) return false;
    return sites.includes(projectSite) && departments.includes(projectDept);
  }

  const canWriteIr = (principal, job, project) => {
    return canReadProject(principal, project);
  }

  /**
   * Centralized action policy hook.
   *
   * Expected shape:
   * principal.permissionCodes = ['JOB.CREATE', 'IR.UPDATE', ...]
   */
  const canPerform = (principal, actionKey) => {
    if (!ENFORCE_PERMISSION_CHECKS) return true;

    const codes = Array.isArray(principal && principal.permissionCodes)
      ? principal.permissionCodes.map(String)
      : [];
    if (codes.includes('ACCESS.ADMIN')) return true;
    if (!codes.length) return false;

    const POLICY = {
      'SUPPORTING_DATA.READ': ['SUPPORTING_DATA.READ', 'JOB.CREATE', 'JOB.UPDATE', 'IR.CREATE', 'IR.UPDATE'],
      'JOB.CREATE': ['JOB.CREATE'],
      'IR.CREATE': ['IR.CREATE'],
      'IR.UPDATE': ['IR.UPDATE'],
      'IR.DELETE': ['IR.DELETE'],
      'USER.CREATE_ACCESS': ['USER.CREATE_ACCESS', 'ACCESS.ADMIN']
    };

    const allowed = POLICY[actionKey] || [];
    return allowed.some(code => codes.includes(code));
  }

  return { verifySignature, getPrincipal, canReadProject, canWriteIr, canPerform };
});
