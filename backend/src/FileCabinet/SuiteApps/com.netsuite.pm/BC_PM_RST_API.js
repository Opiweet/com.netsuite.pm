/**
 * Project Management Portal RESTlet
 * - Read Projects/Jobs
 * - CRUD Users, Jobs and Internal Requisitions (IRs)
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define([
  'N/runtime',
  './lib/helper',
  './lib/restlet_handler',
  './lib/errors',
  './lib/validators',
  './lib/authz',
  './services/project_service',
  './services/job_service',
  './services/ir_service',
  './services/user_mngt_service',
  './services/supporting_data_service',
  './services/log_service'
], (runtime, H, restletHandler, errors, V, authz, projects, jobs, irs, userMngt, supportingData, logService) => {

  const ok = (data) => ({ ok: true, data });

  // High risk means we enforce server-side sid validation instead of relying on cached middleware sid
  const HIGH_RISK_ACTIONS = {
    jobs: ['create'],
    irs: ['create', 'update', 'delete'],
    users: ['logout', 'create-access']
  };
  const WRITE_ACTIONS = {
    jobs: ['create'],
    irs: ['create', 'update', 'delete'],
    users: ['create-access', 'logout']
  };

  const writesEnabled = () => {
    const v = runtime.getCurrentScript().getParameter({ name: 'custscript_pm_enable_writes' });
    return v === true || v === 'T';
  }

  const isWriteAction = (resource, action) => {
    const actions = WRITE_ACTIONS[resource] || [];
    return actions.includes(action);
  }

  const isHighRiskAction = (method, resource, action) => {
    if (method !== 'POST') return false;
    const actions = HIGH_RISK_ACTIONS[resource] || [];
    return actions.includes(action);
  }
  const shouldRequireSid = ({ method, resource, action, context }) => {
    if (isHighRiskAction(method, resource, action)) return true;
    return H.asBool(context && context.requireSid);
  }

  /**
   * POST supports:
   *  Send JSON body with resource/action, for example:
   *  - { resource: 'projects', action: 'list', page, pageSize, site, department, status, uid, sid, requireSid, timestamp, signature }
   *  - { resource: 'projects', action: 'get', id: 123, uid, sid, requireSid, timestamp, signature }
   *  - { resource: 'jobs', action: 'list', projectId: 123, page, pageSize, uid, sid, requireSid, timestamp, signature }
   *  - { resource: 'jobs', action: 'get', id: 456, uid, sid, requireSid, timestamp, signature }
   *  - { resource: 'irs', action: 'get', id: 789, uid, sid, requireSid, timestamp, signature }
   *  - { resource: 'supporting-data', uid, timestamp, signature }
   *  - { resource: 'users', action: 'authenticate', uid, sid, timestamp, signature }
   *  - { resource: 'users', action: 'login', username, password, timestamp, signature }
   *  - { resource: 'jobs', action: 'create', projectId: 123, site: 10, name: 'JOB00001', status: 1, uid, timestamp, signature }
   *  - { resource: 'irs', action: 'create', jobId: 456, projectId: 123, uid, requestorEmail, total, timestamp, signature }
   *  - { resource: 'irs', action: 'update', id: 789, uid, ...fields, timestamp, signature }
   *  - { resource: 'irs', action: 'delete', id: 789, uid, timestamp, signature }
   */
  const post = (context) => {
    const handle = restletHandler.createHandler({ errors, logService });

    return handle('POST', context, (actionLog) => {
      const resource = V.validateResource(context.resource);
      const action = String(context && context.action ? context.action : '');

      if (isWriteAction(resource, action) && !writesEnabled()) {
        actionLog.warn('WRITE_KILL_SWITCH_BLOCKED', {
          status: 'FAIL',
          errorCode: 'WRITES_DISABLED',
          errorMessage: 'Write operations are temporarily disabled by server configuration'
        });
        throw errors.serverError('WRITES_DISABLED', 'Write operations are temporarily disabled');
      }

      if (resource === 'projects') {
        const action = V.oneOf(String(context.action || (context.id ? 'get' : 'list')), 'action', ['list', 'get']);
        const principal = authz.getPrincipal(context, {
          requireSid: shouldRequireSid({ method: 'POST', resource, action, context })
        });

        if (action === 'get') {
          const id = V.asInt(context.id, 'id');
          const p = projects.getProject(id);
          if (!authz.canReadProject(principal, p)) throw errors.forbidden('NO_ACCESS', 'Not allowed');
          return ok(p);
        }

        const { page, pageSize } = V.pageParams(context);
        const list = projects.listProjects({
          site: context.site ? String(context.site) : principal.site,
          department: context.department ? String(context.department) : principal.department,
          status: context.status ? String(context.status) : null,
          page, pageSize
        });
        const filtered = list.filter(p => authz.canReadProject(principal, p));
        return ok({ page, pageSize, results: filtered });
      }

      if (resource === 'supporting-data') {
        const principal = authz.getPrincipal(context, {
          requireSid: shouldRequireSid({ method: 'POST', resource, action: null, context })
        });
        if (!authz.canPerform(principal, 'SUPPORTING_DATA.READ'))
          throw errors.forbidden('NO_ACCESS', 'Not allowed');
        return ok(supportingData.getSupportingData(principal));
      }

      if (resource === 'users') {
        const action = V.oneOf(String(context.action || ''), 'action', ['authenticate', 'login', 'logout', 'verify-signup', 'create-access']);

        if (action === 'authenticate') {
          authz.verifySignature(context);
          const uid = V.asString(String(context.uid || ''), 'uid', { min: 1, max: 30 });
          const sid = V.asString(String(context.sid || ''), 'sid', { min: 10, max: 256 });
          return ok(userMngt.authenticateUser(uid, sid));
        }

        if (action === 'login') {
          authz.verifySignature(context);
          const username = V.asString(String(context.username || ''), 'username', { min: 1, max: 254 });
          const password = V.asString(String(context.password || ''), 'password', { min: 1, max: 200 });
          return ok(userMngt.validateLogin(username, password));
        }

        if (action === 'logout') {
          const principal = authz.getPrincipal(context, {
            requireSid: shouldRequireSid({ method: 'POST', resource: 'users', action, context })
          });
          const uid = V.asString(String(context.uid || ''), 'uid', { min: 1, max: 30 });
          if (String(principal.uid) !== String(uid))
            throw errors.forbidden('NO_ACCESS', 'Not allowed');
          return ok(userMngt.clearSessionRecord(uid));
        }

        if (action === 'verify-signup') {
          authz.verifySignature(context);
          const email = V.asString(String(context.email || ''), 'email', { min: 3, max: 254 });
          const username = V.asString(String(context.username || ''), 'username', { min: 1, max: 254 });
          return ok(userMngt.verifyEmailOnSignUp(email, username));
        }

        if (action === 'create-access') {
          const principal = authz.getPrincipal(context, {
            requireSid: shouldRequireSid({ method: 'POST', resource: 'users', action, context })
          });
          if (!authz.canPerform(principal, 'USER.CREATE_ACCESS'))
            throw errors.forbidden('NO_ACCESS', 'Not allowed');
          if (!context || typeof context !== 'object')
            throw errors.badRequest('INVALID_BODY', 'Body must be JSON object');
          return ok(userMngt.createPortalAccess(context));
        }

        throw errors.badRequest('UNSUPPORTED', 'Unsupported user action');
      }

      if (resource === 'jobs') {
        const action = V.oneOf(String(context.action || (context.id ? 'get' : (context.projectId ? 'list' : 'create'))), 'action', ['list', 'get', 'create']);
        const principal = authz.getPrincipal(context, {
          requireSid: shouldRequireSid({ method: 'POST', resource: 'jobs', action, context })
        });

        if (action === 'get') {
          const id = V.asInt(context.id, 'id');
          const j = jobs.getJob(id);
          const p = projects.getProject(V.asInt(j.projectId, 'projectId'));
          if (!authz.canReadProject(principal, p)) throw errors.forbidden('NO_ACCESS', 'Not allowed');
          return ok(j);
        }

        if (action === 'list') {
          const projectId = V.asInt(context.projectId, 'projectId');
          const p = projects.getProject(projectId);
          if (!authz.canReadProject(principal, p)) throw errors.forbidden('NO_ACCESS', 'Not allowed');
          const { page, pageSize } = V.pageParams(context);
          const list = jobs.listJobsByProject(projectId, { page, pageSize });
          return ok({ page, pageSize, results: list });
        }

        if (action === 'create') {
          if (!authz.canPerform(principal, 'JOB.CREATE'))
            throw errors.forbidden('NO_ACCESS', 'Not allowed');
          const projectId = V.asInt(context.projectId, 'projectId');
          const p = projects.getProject(projectId);
          if (!authz.canReadProject(principal, p)) throw errors.forbidden('NO_ACCESS', 'Not allowed');

          const payload = V.validateJobCreate(context);
          const created = jobs.createJob({ projectId, payload });
          return ok(created);
        }

        throw errors.badRequest('UNSUPPORTED', 'Unsupported job action');
      }
      
      if (resource === 'irs') {
        const action = V.oneOf(String(context.action || (context.id ? 'get' : 'create')), 'action', ['get', 'create', 'update', 'delete']);
        const principal = authz.getPrincipal(context, {
          requireSid: shouldRequireSid({ method: 'POST', resource: 'irs', action, context })
        });

        if (action === 'get') {
          const irId = V.asInt(context.id, 'id');
          const ir = irs.getIr(irId);
          const p = projects.getProject(V.asInt(ir.projectId, 'projectId'));
          const j = jobs.getJob(V.asInt(ir.jobId, 'jobId'));
          if (!authz.canWriteIr(principal, j, p)) throw errors.forbidden('NO_ACCESS', 'Not allowed');
          return ok(ir);
        }

        if (action === 'create') {
          if (!authz.canPerform(principal, 'IR.CREATE'))
            throw errors.forbidden('NO_ACCESS', 'Not allowed');
          const jobId = V.asInt(context.jobId, 'jobId');
          const projectId = V.asInt(context.projectId, 'projectId');
  
          const p = projects.getProject(projectId);
          if (!authz.canReadProject(principal, p)) throw errors.forbidden('NO_ACCESS', 'Not allowed');
  
          const j = jobs.getJob(jobId);
          if (String(j.projectId) !== String(projectId)) {
            actionLog.warn('IR_JOB_PROJECT_MISMATCH', {
              status: 'FAIL',
              errorCode: 'JOB_PROJECT_MISMATCH',
              errorMessage: 'Job does not belong to project'
            });
            throw errors.badRequest('JOB_PROJECT_MISMATCH', 'Job does not belong to project');
          }
  
          const payload = V.validateIrCreate(context);
          const created = irs.createIr({ jobId, projectId, payload });
          return ok(created);
        }
  
        if (action === 'update') {
          if (!authz.canPerform(principal, 'IR.UPDATE'))
            throw errors.forbidden('NO_ACCESS', 'Not allowed');
          const irId = V.asInt(context.id, 'id');
          const existing = irs.getIr(irId);
  
          const p = projects.getProject(V.asInt(existing.projectId, 'projectId'));
          const j = jobs.getJob(V.asInt(existing.jobId, 'jobId'));
          if (!authz.canWriteIr(principal, j, p)) throw errors.forbidden('NO_ACCESS', 'Not allowed');
  
          const payload = V.validateIrUpdate(context);
          const updated = irs.updateIr({ irId, payload });
          return ok(updated);
        }
  
        if (action === 'delete') {
          if (!authz.canPerform(principal, 'IR.DELETE'))
            throw errors.forbidden('NO_ACCESS', 'Not allowed');
          const irId = V.asInt(context.id, 'id');
          const existing = irs.getIr(irId);
  
          const p = projects.getProject(V.asInt(existing.projectId, 'projectId'));
          const j = jobs.getJob(V.asInt(existing.jobId, 'jobId'));
          if (!authz.canWriteIr(principal, j, p)) throw errors.forbidden('NO_ACCESS', 'Not allowed');
  
          return ok(irs.softDeleteIr({ irId }));
        }

        throw errors.badRequest('UNSUPPORTED', 'Unsupported IR action');
      }

      throw errors.badRequest('UNSUPPORTED', 'POST does not support this resource');

    });
  }

  return { post };
});
