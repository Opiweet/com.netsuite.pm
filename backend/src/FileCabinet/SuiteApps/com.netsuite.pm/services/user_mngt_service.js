/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(
    ['N/query', 'N/search', 'N/record', 'N/crypto', 'N/encode', '../lib/helper', '../lib/constants'],
    (query, search, record, crypto, encode, H, C) => {

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

  const run = (queryText, params) => {
    return query.runSuiteQL({ query: queryText, params: params || [] }).asMappedResults() || [];
  }

  const getUserByLogin = (login) => {
    const key = H.normalize(login);
    if (!key) return null;

    const rows = run(`
      SELECT
        id,
        custrecord_pm_usermngt_email AS email,
        custrecord_pm_usermngt_username AS username,
        custrecord_pm_usermngt_access AS access,
        custrecord_pm_usermngt_lock AS lockflag,
        custrecord_pm_usermngt_attempt AS attempt
      FROM customrecord_pm_usermanagement
      WHERE isinactive = 'F'
        AND custrecord_pm_usermngt_access = 'T'
        AND (custrecord_pm_usermngt_email = ? OR custrecord_pm_usermngt_username = ?)
      ORDER BY id
      FETCH FIRST 1 ROWS ONLY
    `, [key, key]);

    const r = rows[0];
    if (!r) return null;

    return {
      id: String(r.id),
      email: String(r.email || '').toLowerCase(),
      username: String(r.username || '').toLowerCase(),
      access: H.toBoolean(r.access),
      lock: H.toBoolean(r.lockflag),
      attemptsLeft: H.toInt(r.attempt, C.MAX_LOGIN_ATTEMPTS)
    };
  }

  const decrementAttemptOrLock = (userId) => {
    const current = search.lookupFields({
      type: 'customrecord_pm_usermanagement',
      id: userId,
      columns: ['custrecord_pm_usermngt_attempt']
    });

    const attempts = H.toInt(current.custrecord_pm_usermngt_attempt, C.MAX_LOGIN_ATTEMPTS);
    const next = attempts > 0 ? attempts - 1 : 0;
    const shouldLock = next === 0;

    const values = { custrecord_pm_usermngt_attempt: next };
    if (shouldLock) values.custrecord_pm_usermngt_lock = true;

    record.submitFields({
      type: 'customrecord_pm_usermanagement',
      id: userId,
      values
    });

    return { isPasswordValid: false, attemptLeft: next, locked: shouldLock };
  }

  const generateSessionId = (userId) => {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).slice(2, 10);
    const uniqueId = `${timestamp}${randomString}`;

    const hashObj = crypto.createHash({ algorithm: crypto.HashAlg.SHA256 });
    hashObj.update({
      input: `PM_SESSION:${userId}:${uniqueId}`,
      inputEncoding: encode.Encoding.UTF_8
    });

    const sessionHash = hashObj.digest({ outputEncoding: encode.Encoding.HEX });

    record.submitFields({
      type: 'customrecord_pm_usermanagement',
      id: userId,
      values: { custrecord_pm_usermngt_session: sessionHash }
    });

    return sessionHash;
  }

  const getRolesPermissions = (roleIds) => {
    const out = {};
    const allPermissionCodes = new Set();

    (roleIds || []).forEach(roleId => {
      const roleData = search.lookupFields({
        type: 'customrecord_pm_roles',
        id: roleId,
        columns: ['name', 'custrecord_role_perms']
      });

      const permRefs = roleData.custrecord_role_perms || [];
      const permissionIds = H.toMultiSelectIds(permRefs);
      const permissionCodes = H.toMultiSelectText(permRefs);

      permissionCodes.forEach(code => allPermissionCodes.add(code));

      out[String(roleId)] = {
        name: roleData.name || null,
        permissions: permissionIds,
        permissionCodes
      };
    });

    return {
      rolesPermissions: out,
      permissionCodes: Array.from(allPermissionCodes)
    };
  }

  const services = {
    validateLogin(dataUsername, dataPassword) {
      const loginRes = {
        isUsernameValid: false,
        entityType: null,
        uid: null,
        isPasswordValid: false,
        attemptLeft: null,
        sid: null,
        locked: false
      };

      const user = getUserByLogin(dataUsername);
      if (!user) return loginRes;

      loginRes.isUsernameValid = true;
      loginRes.uid = user.id;

      if (user.lock) {
        loginRes.locked = true;
        loginRes.attemptLeft = 0;
        return loginRes;
      }

      const isPasswordValid = crypto.checkPasswordField({
        recordType: 'customrecord_pm_usermanagement',
        recordId: parseInt(user.id, 10),
        fieldId: 'custrecord_pm_usermngt_password',
        value: String(dataPassword || '')
      });

      if (isPasswordValid && user.attemptsLeft > 0) {
        if (user.attemptsLeft < C.MAX_LOGIN_ATTEMPTS) {
          record.submitFields({
            type: 'customrecord_pm_usermanagement',
            id: user.id,
            values: { custrecord_pm_usermngt_attempt: C.MAX_LOGIN_ATTEMPTS }
          });
        }

        loginRes.isPasswordValid = true;
        loginRes.attemptLeft = C.MAX_LOGIN_ATTEMPTS;
        loginRes.sid = generateSessionId(user.id);
        return loginRes;
      }

      const attemptRes = decrementAttemptOrLock(user.id);
      loginRes.isPasswordValid = false;
      loginRes.attemptLeft = attemptRes.attemptLeft;
      loginRes.locked = attemptRes.locked;
      return loginRes;
    },

    lockAccount(uid) {
      if (!uid) return { userId: null };

      record.submitFields({
        type: 'customrecord_pm_usermanagement',
        id: uid,
        values: { custrecord_pm_usermngt_lock: true }
      });

      return { userId: String(uid) };
    },

    clearSessionRecord(uid) {
      if (!uid) return { isSessionCleared: false };

      record.submitFields({
        type: 'customrecord_pm_usermanagement',
        id: uid,
        values: { custrecord_pm_usermngt_session: '' }
      });

      return { isSessionCleared: true };
    },

    verifyEmailOnSignUp(dataEmail, dataUsername) {
      const email = H.normalize(dataEmail);
      const username = H.normalize(dataUsername);

      const result = { emailExist: false, usernameExist: false };
      if (!email && !username) return result;

      const rows = run(`
        SELECT
          custrecord_pm_usermngt_email AS email,
          custrecord_pm_usermngt_username AS username
        FROM customrecord_pm_usermanagement
        WHERE isinactive = 'F'
          AND custrecord_pm_usermngt_access = 'T'
          AND (custrecord_pm_usermngt_email = ? OR custrecord_pm_usermngt_username = ?)
        FETCH FIRST 50 ROWS ONLY
      `, [email, username]);

      rows.forEach(r => {
        const recEmail = H.normalize(r.email);
        const recUsername = H.normalize(r.username);
        if (recEmail && recEmail === email) result.emailExist = true;
        if (recUsername && recUsername === username) result.usernameExist = true;
      });

      return result;
    },

    /**
     * Supports either object input or legacy positional input.
     */
    createPortalAccess(...args) {
      let payload;
      if (typeof args[0] === 'object' && args[0] !== null) {
        payload = args[0];
      } else {
        payload = {
          firstname: args[2],
          lastname: args[3],
          username: args[4],
          email: args[5],
          password: args[6],
          roleIds: args[9] || []
        };
      }

      const {
        firstname,
        lastname,
        username,
        email,
        password,
        subsidiaryId = null,
        roleIds = [],
        siteIds = [],
        departmentIds = [],
        access = true
      } = payload;

      if (!Array.isArray(roleIds) || roleIds.length === 0) {
        throw new Error('At least one role is required to create portal access.');
      }

      const rec = record.create({ type: 'customrecord_pm_usermanagement', isDynamic: true });
      if (firstname) rec.setValue({ fieldId: 'custrecord_pm_usermngt_firstname', value: String(firstname).trim() });
      if (lastname) rec.setValue({ fieldId: 'custrecord_pm_usermngt_lastname', value: String(lastname).trim() });
      if (username) rec.setValue({ fieldId: 'custrecord_pm_usermngt_username', value: H.normalize(username) });
      if (email) rec.setValue({ fieldId: 'custrecord_pm_usermngt_email', value: H.normalize(email) });
      if (password) rec.setValue({ fieldId: 'custrecord_pm_usermngt_password', value: String(password) });

      rec.setValue({ fieldId: 'custrecord_pm_usermngt_access', value: !!access });
      rec.setValue({ fieldId: 'custrecord_pm_usermngt_lock', value: false });
      rec.setValue({ fieldId: 'custrecord_pm_usermngt_attempt', value: C.MAX_LOGIN_ATTEMPTS });
      rec.setValue({ fieldId: 'custrecord_pm_usermngt_roles', value: roleIds.map(String) });
      if (subsidiaryId != null && String(subsidiaryId).trim() !== '') {
        rec.setValue({ fieldId: 'custrecord_pm_usermngt_subsidiary', value: String(subsidiaryId) });
      }

      if (Array.isArray(siteIds) && siteIds.length) {
        rec.setValue({ fieldId: 'custrecord_pm_usermngt_sites', value: siteIds.map(String) });
      }
      if (Array.isArray(departmentIds) && departmentIds.length) {
        rec.setValue({ fieldId: 'custrecord_pm_usermngt_depts', value: departmentIds.map(String) });
      }

      const userId = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
      return {
        accessCreated: true,
        userId: String(userId)
      };
    },

    authenticateUser(uid, sid) {
      const authenticationRes = {
        isAuth: false,
        type: null,
        rolesPermissions: {},
        permissionCodes: [],
        principal: null
      };

      if (!uid || !sid) return authenticationRes;

      const userData = search.lookupFields({
        type: 'customrecord_pm_usermanagement',
        id: uid,
        columns: [
          'custrecord_pm_usermngt_email',
          'custrecord_pm_usermngt_firstname',
          'custrecord_pm_usermngt_lastname',
          'custrecord_pm_usermngt_access',
          'custrecord_pm_usermngt_lock',
          'custrecord_pm_usermngt_session',
          'custrecord_pm_usermngt_subsidiary',
          'custrecord_pm_usermngt_roles',
          'custrecord_pm_usermngt_sites',
          'custrecord_pm_usermngt_depts'
        ]
      });

      const access = H.toBoolean(userData.custrecord_pm_usermngt_access);
      const locked = H.toBoolean(userData.custrecord_pm_usermngt_lock);
      const sessionHash = String(userData.custrecord_pm_usermngt_session || '');

      if (!access || locked || !sessionHash || sessionHash !== String(sid)) {
        return authenticationRes;
      }

      const roleIds = H.toMultiSelectIds(userData.custrecord_pm_usermngt_roles);
      const roleInfo = getRolesPermissions(roleIds);

      authenticationRes.isAuth = true;
      authenticationRes.rolesPermissions = roleInfo.rolesPermissions;
      authenticationRes.permissionCodes = roleInfo.permissionCodes;
      authenticationRes.principal = {
        userId: String(uid),
        email: H.normalize(userData.custrecord_pm_usermngt_email),
        firstname: String(userData.custrecord_pm_usermngt_firstname || ''),
        lastname: String(userData.custrecord_pm_usermngt_lastname || ''),
        subsidiary: selectId(userData.custrecord_pm_usermngt_subsidiary),
        roles: roleIds,
        sites: H.toMultiSelectIds(userData.custrecord_pm_usermngt_sites),
        departments: H.toMultiSelectIds(userData.custrecord_pm_usermngt_depts)
      };

      return authenticationRes;
    }
  };

  return services;
});
