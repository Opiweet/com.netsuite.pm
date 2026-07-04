/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  'N/log',
  'N/url',
  'N/runtime',
  'N/task',
  '../pm_config',
  './modules/init_data_mod',
  './modules/list_mod',
  './modules/project_phase_mod',
  './modules/project_financials_mod',
  './modules/rev_plan_mod',
  './modules/rev_rec_mod',
  './modules/project_mod',
  './modules/project_documents_mod',
  './modules/project_notes_mod',
  './modules/rbac_admin_mod',
  './core/rbac',
], (
  log,
  url,
  runtime,
  task,
  pmConfig,
  init_data_mod,
  list_mod,
  project_phase_mod,
  project_financials_mod,
  rev_plan_mod,
  rev_rec_mod,
  project_mod,
  project_documents_mod,
  project_notes_mod,
  rbac_admin_mod,
  rbac,
) => {
  const currDomain = (() => {
    try {
      const options = { hostType: url.HostType.APPLICATION };
      if (runtime?.accountId) options.accountId = runtime.accountId;
      return url.resolveDomain(options) || '';
    } catch (e) {
      if (console) console.log('Unable to resolve current domain', e);
      return '';
    }
  })();

  function getOrigin(request) {
    return request?.headers?.origin || '';
  }

  const WHITELIST = (() => {
    const values = ['http://localhost:5173', 'http://127.0.0.1:5173'];

    if (currDomain) values.push(`https://${currDomain}`);

    // Best-effort support for NetSuite forms/external domains if available in this account.
    try {
      if (url?.HostType?.FORMS) {
        const options = { hostType: url.HostType.FORMS };
        if (runtime?.accountId) options.accountId = runtime.accountId;
        const formsDomain = url.resolveDomain(options);
        if (formsDomain) values.push(`https://${formsDomain}`);
      }
    } catch (e) {
      // ignore
    }

    return new Set(values);
  })();

  function isWhitelisted(origin) {
    if (!origin) return false;
    return WHITELIST.has(origin);
  }

  // CORS handling intentionally mirrors the previously working Suitelet pattern.
  function handleCors(context) {
    const requestOrigin = getOrigin(context.request);
    const addHeader = (name, value) => {
      if (typeof context.response.addHeader === 'function') {
        context.response.addHeader({ name, value });
        return;
      }
      context.response.setHeader({ name, value });
    };

    if (context.request.method === 'OPTIONS') {
      log.audit({
        title: 'CORS_PRELIGHT',
        details: {
          origin: requestOrigin,
          headers: context.request?.headers || {},
        },
      });
      if (isWhitelisted(requestOrigin)) {
        // Mirrors the working pattern you shared: send permissive preflight headers when origin is allowed.
        addHeader('Access-Control-Allow-Origin', '*');
        addHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        addHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, User-Agent',
        );
        addHeader('Access-Control-Max-Age', '3600');
        addHeader('Content-Type', 'text/plain');
      }

      context.response.status = 204;
      context.response.write('OK');
      return true;
    }

    if (isWhitelisted(requestOrigin)) {
      addHeader('Access-Control-Allow-Origin', requestOrigin);
      addHeader('Access-Control-Allow-Methods', 'GET, POST');
      addHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    return false;
  }

  function writeJson(response, status, payload) {
    response.setHeader({
      name: 'Content-Type',
      value: 'application/json; charset=utf-8',
    });
    if (status) response.statusCode = status;
    response.write(JSON.stringify(payload));
  }

  function parseBody(request) {
    const body = request?.body;
    if (!body) return {};
    try {
      return JSON.parse(body);
    } catch (e) {
      return {};
    }
  }

  function denyForbidden(response, { action, authz, projectId = null } = {}) {
    const reasonCode = authz?.reasonCode || 'FORBIDDEN';
    const reason =
      authz?.reason ||
      `You do not have permission to perform action "${String(action || '')}".`;
    log.audit({
      title: 'RBAC_FORBIDDEN',
      details: {
        action: String(action || ''),
        projectId: projectId != null ? String(projectId) : null,
        reasonCode,
        principal: authz?.principal || null,
        capability: authz?.capability || null,
      },
    });
    writeJson(response, 403, {
      success: false,
      action: String(action || ''),
      error: {
        name: 'FORBIDDEN',
        message: reason,
        details: {
          action: String(action || ''),
          reasonCode,
        },
      },
    });
  }

  function requireActionAuthorization({
    response,
    action,
    projectId = null,
    capability = null,
  } = {}) {
    // Convention: all mutating actions must pass through this centralized RBAC gate.
    const authz = rbac.authorize({ action, capability, projectId });
    if (authz.allowed) return true;
    denyForbidden(response, { action, authz, projectId });
    return false;
  }

  function getProjectFrozenError({
    projectId,
    actionLabel,
    allowCompleted = false,
  } = {}) {
    const pid = projectId != null ? String(projectId).trim() : '';
    if (!pid) return null;
    return project_mod.ensureProjectMutable({
      projectId: pid,
      actionLabel,
      allowCompleted,
    });
  }

  /**
   * Endpoint entrypoint.
   * Frontend should call with:
   * - POST { "action": "init_data" }
   * - POST { "action": "phase_lookups" }
   */
  function onRequest(context) {
    const { request, response } = context;

    log.audit({
      title: 'REQUEST_RECEIVED',
      details: { method: request.method, origin: getOrigin(request) },
    });

    if (handleCors(context)) return;

    if (request.method !== 'POST') {
      log.error({
        title: 'METHOD_NOT_ALLOWED',
        details: { method: request.method },
      });
      writeJson(response, 405, {
        success: false,
        error: {
          name: 'METHOD_NOT_ALLOWED',
          message: 'Only POST is supported.',
        },
      });
      return;
    }

    const body = parseBody(request);
    const action = body.action || '';

    try {
      log.audit({
        title: 'REQUEST',
        details: {
          origin: getOrigin(request),
          action,
          hasBody: Boolean(request.body),
        },
      });
      if (action === 'init_data') {
        const data = init_data_mod.getInitData() || {};
        data.authz = rbac.getAuthzSnapshot();
        if (!data.links) data.links = {};
        if (!data.links.netsuiteHomeUrl) {
          data.links.netsuiteHomeUrl = currDomain
            ? `https://${currDomain}/app/center/card.nl?sc=`
            : '/app/center/card.nl?sc=';
        }
        writeJson(response, 200, { success: true, action: 'init_data', data });
        return;
      }

      if (action === 'phase_lookups') {
        const data = init_data_mod.getPhaseLookups(body.projectId || null);
        writeJson(response, 200, {
          success: true,
          action: 'phase_lookups',
          data,
        });
        return;
      }

      if (action === 'rbac_config_snapshot') {
        const authz = rbac.authorize({
          capability: rbac.CAPABILITIES.RBAC_MANAGE,
        });
        if (!authz.allowed) {
          denyForbidden(response, { action, authz });
          return;
        }
        writeJson(response, 200, {
          success: true,
          action: 'rbac_config_snapshot',
          data: rbac_admin_mod.getRbacConfigSnapshot(),
        });
        return;
      }

      if (action === 'rbac_config_upsert') {
        if (!requireActionAuthorization({ response, action })) return;
        const result = rbac_admin_mod.saveRbacConfig({ config: body.config || {} });
        writeJson(response, 200, {
          success: true,
          action: 'rbac_config_upsert',
          data: result,
        });
        return;
      }

      if (action === 'projects_list') {
        const startedAt = Date.now();
        const projects = list_mod.getProjects();
        const durationMs = Date.now() - startedAt;
        log.audit({
          title: 'PM_PROJECTS_LIST_HANDLER_TIMING',
          details: { durationMs, count: Array.isArray(projects) ? projects.length : 0 },
        });
        writeJson(response, 200, {
          success: true,
          action: 'projects_list',
          data: { projects },
        });
        return;
      }

      if (action === 'projects_list_paginated') {
        const startedAt = Date.now();
        const result = list_mod.getProjectsPaginated({
          page: body?.page,
          pageSize: body?.pageSize,
          search: body?.search,
          customerId: body?.customerId,
          projectManagerId: body?.projectManagerId,
          departmentId: body?.departmentId,
          statusKeys: body?.statusKeys,
          revPlanStatusKeys: body?.revPlanStatusKeys,
          includeRevPlanCounters: body?.includeRevPlanCounters,
          revPlanStatusConflictOnly: body?.revPlanStatusConflictOnly,
          sortBy: body?.sortBy,
          sortDir: body?.sortDir,
        });
        const projects = Array.isArray(result?.projects)
          ? result.projects
          : Array.isArray(result)
            ? result
            : [];
        const pagination =
          result && typeof result === 'object' && !Array.isArray(result)
            ? result.pagination || null
            : null;
        const statusCounters =
          result && typeof result === 'object' && !Array.isArray(result)
            ? result.statusCounters || null
            : null;
        const revPlanStatusCounters =
          result && typeof result === 'object' && !Array.isArray(result)
            ? result.revPlanStatusCounters || null
            : null;
        const durationMs = Date.now() - startedAt;
        log.audit({
          title: 'PM_PROJECTS_LIST_PAGINATED_HANDLER_TIMING',
          details: { durationMs, count: Array.isArray(projects) ? projects.length : 0 },
        });
        writeJson(response, 200, {
          success: true,
          action: 'projects_list_paginated',
          data: { projects, pagination, statusCounters, revPlanStatusCounters },
        });
        return;
      }

      if (action === 'project_phases_list') {
        const projectId = body.projectId || null;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for project_phases_list.',
            },
          });
          return;
        }

        const phases = project_phase_mod.getProjectPhases(projectId);
        writeJson(response, 200, {
          success: true,
          action: 'project_phases_list',
          data: { projectId, phases },
        });
        return;
      }

      if (action === 'project_financials') {
        const projectId = body.projectId || null;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for project_financials.',
            },
          });
          return;
        }

        const data = project_financials_mod.getProjectFinancials(projectId);
        writeJson(response, 200, {
          success: true,
          action: 'project_financials',
          data,
        });
        return;
      }

      if (action === 'project_load') {
        const projectId = body.projectId || null;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for project_load.',
            },
          });
          return;
        }

        const data = project_mod.getProjectLoad(projectId);
        data.authz = {
          projectId: String(projectId),
          capabilities: Object.values(rbac.CAPABILITIES).filter(
            (capability) => rbac.authorize({ capability, projectId }).allowed,
          ),
        };
        writeJson(response, 200, {
          success: true,
          action: 'project_load',
          data,
        });
        return;
      }

      if (action === 'project_month_simulation_upsert') {
        const projectId = body?.projectId || null;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message:
                'projectId is required for project_month_simulation_upsert.',
            },
          });
          return;
        }

        if (
          !requireActionAuthorization({
            response,
            action,
            projectId,
            capability: rbac.CAPABILITIES.PROJECT_UPDATE,
          })
        )
          return;

        const result = project_mod.upsertProjectMonthSimulation({
          projectId,
          simulatedPeriod: body?.simulatedPeriod ?? '',
        });
        if (result?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: result?.name || 'PROJECT_MONTH_SIMULATION_UPSERT_FAILED',
              message: result?.message || 'Failed to update project month simulation.',
            },
          });
          return;
        }

        const data = project_mod.getProjectLoad(projectId);
        data.authz = {
          projectId: String(projectId),
          capabilities: Object.values(rbac.CAPABILITIES).filter(
            (capability) => rbac.authorize({ capability, projectId }).allowed,
          ),
        };
        writeJson(response, 200, {
          success: true,
          action: 'project_month_simulation_upsert',
          data,
        });
        return;
      }

      if (action === 'project_edit_lookups') {
        const data = init_data_mod.getProjectEditLookups({
          customerLimit: body?.customerLimit,
          projectManagerLimit: body?.projectManagerLimit,
        });
        writeJson(response, 200, {
          success: true,
          action: 'project_edit_lookups',
          data,
        });
        return;
      }

      if (action === 'project_upsert') {
        const project = body?.project || null;
        const payload =
          project && typeof project === 'object'
            ? {
                ...project,
                projectId: body?.projectId || project?.projectId || null,
              }
            : { ...body };
        const hasProjectId = Boolean(
          payload?.projectId != null && String(payload.projectId).trim(),
        );
        const requiredCapability = hasProjectId
          ? rbac.CAPABILITIES.PROJECT_UPDATE
          : rbac.CAPABILITIES.PROJECT_CREATE;
        if (
          !requireActionAuthorization({
            response,
            action,
            projectId: hasProjectId ? payload?.projectId : null,
            capability: requiredCapability,
          })
        )
          return;
        const freezeErr = getProjectFrozenError({
          projectId: payload?.projectId,
          actionLabel: 'Project edit',
        });
        if (freezeErr?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: freezeErr?.name || 'PROJECT_FROZEN',
              message: freezeErr?.message || 'Project is frozen.',
              details: freezeErr?.details || null,
            },
          });
          return;
        }

        const result = project_mod.upsertProject(payload);
        if (result?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: result?.code || result?.name || 'PROJECT_UPSERT_FAILED',
              message: result?.message || 'Failed to update project.',
              details: result?.data || result?.details || null,
            },
          });
          return;
        }

        const projectId = payload?.projectId
          ? String(payload.projectId)
          : result != null
            ? String(result)
            : '';
        if (!projectId) {
          writeJson(response, 500, {
            success: false,
            error: {
              name: 'SAVE_FAILED',
              message: 'Project was not saved.',
            },
          });
          return;
        }

        writeJson(response, 200, {
          success: true,
          action,
          data: { projectId },
        });
        return;
      }

      if (
        action === 'phase_upsert' ||
        action === 'phase_create' ||
        action === 'phase_update'
      ) {
        const projectId = body.projectId || null;
        if (!requireActionAuthorization({ response, action, projectId }))
          return;
        const phase = body.phase || null;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for phase create/update.',
            },
          });
          return;
        }
        if (!phase || typeof phase !== 'object') {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'phase payload is required for phase create/update.',
            },
          });
          return;
        }

        const freezeErr = getProjectFrozenError({
          projectId,
          actionLabel: 'Phase edit/create',
        });
        if (freezeErr?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: freezeErr?.name || 'PROJECT_FROZEN',
              message: freezeErr?.message || 'Project is frozen.',
              details: freezeErr?.details || null,
            },
          });
          return;
        }

        const saved = project_phase_mod.upsertProjectsPhases({
          projectId,
          phase,
        });
        writeJson(response, 200, { success: true, action, data: saved });
        return;
      }

      if (action === 'phases_upsert') {
        const projectId = body.projectId || null;
        if (!requireActionAuthorization({ response, action, projectId }))
          return;
        const phases = Array.isArray(body.phases) ? body.phases : [];
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for phases_upsert.',
            },
          });
          return;
        }
        if (!phases.length) {
          writeJson(response, 200, {
            success: true,
            action,
            data: { projectId, saved: [] },
          });
          return;
        }

        const freezeErr = getProjectFrozenError({
          projectId,
          actionLabel: 'Bulk phase edit/create',
        });
        if (freezeErr?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: freezeErr?.name || 'PROJECT_FROZEN',
              message: freezeErr?.message || 'Project is frozen.',
              details: freezeErr?.details || null,
            },
          });
          return;
        }

        const saved = project_phase_mod.upsertProjectsPhases({
          projectId,
          phases,
        });
        writeJson(response, 200, { success: true, action, data: saved });
        return;
      }

      if (action === 'phase_delete') {
        const projectId = body.projectId || null;
        if (!requireActionAuthorization({ response, action, projectId }))
          return;
        const phaseId = body.phaseId || null;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for phase_delete.',
            },
          });
          return;
        }
        if (!phaseId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'phaseId is required for phase_delete.',
            },
          });
          return;
        }

        const freezeErr = getProjectFrozenError({
          projectId,
          actionLabel: 'Phase delete',
        });
        if (freezeErr?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: freezeErr?.name || 'PROJECT_FROZEN',
              message: freezeErr?.message || 'Project is frozen.',
              details: freezeErr?.details || null,
            },
          });
          return;
        }

        const result = project_phase_mod.deleteProjectPhase({
          projectId,
          phaseId,
        });
        if (!result?.success) {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: 'PHASE_DELETE_BLOCKED',
              message:
                result?.message ||
                'Phase cannot be deleted because one or more rev plans have defined allocation quantity.',
              details: result || null,
            },
          });
          return;
        }

        writeJson(response, 200, { success: true, action, data: result });
        return;
      }

      if (action === 'generate_rev_plans') {
        const projectId = body.projectId || null;
        if (!requireActionAuthorization({ response, action, projectId }))
          return;

        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for generate_rev_plans.',
            },
          });
          return;
        }

        const freezeErr = getProjectFrozenError({
          projectId,
          actionLabel: 'Revenue plan generation',
        });
        if (freezeErr?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: freezeErr?.name || 'PROJECT_FROZEN',
              message: freezeErr?.message || 'Project is frozen.',
              details: freezeErr?.details || null,
            },
          });
          return;
        }

        const result = rev_plan_mod.generateRevenuePlans({ projectId });
        if (result?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: 'GENERATE_REV_PLANS_FAILED',
              message: result?.message || 'Failed to generate revenue plans.',
              details: result?.details || null,
            },
          });
          return;
        }

        writeJson(response, 200, { success: true, action, data: result });
        return;
      }

      if (action === 'project_rev_plans') {
        const projectId = body.projectId || null;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for project_rev_plans.',
            },
          });
          return;
        }

        const data = rev_plan_mod.getProjectRevPlans({
          projectId,
          source: 'project_rev_plans',
        });
        writeJson(response, 200, {
          success: true,
          action: 'project_rev_plans',
          data,
        });
        return;
      }

      if (action === 'revplan_update') {
        if (
          !requireActionAuthorization({
            response,
            action,
            projectId: body?.projectId || null,
            capability: body?.confirmed
              ? rbac.CAPABILITIES.REVPLAN_CONFIRM
              : rbac.CAPABILITIES.REVPLAN_UPDATE,
          })
        )
          return;
        const freezeErr = getProjectFrozenError({
          projectId: body?.projectId || null,
          actionLabel: 'Revenue plan edit',
          allowCompleted: Boolean(body?.confirmed),
        });
        if (freezeErr?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: freezeErr?.name || 'PROJECT_FROZEN',
              message: freezeErr?.message || 'Project is frozen.',
              details: freezeErr?.details || null,
            },
          });
          return;
        }

        const result = rev_plan_mod.updateRevenuePlans(body);
        if (result?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: 'REVPLAN_UPDATE_FAILED',
              message: result?.message || 'Failed to update revenue plans.',
              details: result?.details || null,
            },
          });
          return;
        }

        writeJson(response, 200, { success: true, action, data: result });
        return;
      }

      if (action === 'revplan_reopen') {
        const projectId = body.projectId || null;
        if (!requireActionAuthorization({ response, action, projectId }))
          return;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for revplan_reopen.',
            },
          });
          return;
        }

        const freezeErr = getProjectFrozenError({
          projectId,
          actionLabel: 'Revenue plan reopen',
        });
        if (freezeErr?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: freezeErr?.name || 'PROJECT_FROZEN',
              message: freezeErr?.message || 'Project is frozen.',
              details: freezeErr?.details || null,
            },
          });
          return;
        }

        const result = rev_plan_mod.reopenActualRevenuePlans({ projectId });
        if (result?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: 'REVPLAN_REOPEN_FAILED',
              message: result?.message || 'Failed to reopen revenue plans.',
              details: result?.details || null,
            },
          });
          return;
        }

        writeJson(response, 200, { success: true, action, data: result });
        return;
      }

      if (action === 'project_activate') {
        const projectId = body.projectId || null;
        if (!requireActionAuthorization({ response, action, projectId }))
          return;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for project_activate.',
            },
          });
          return;
        }

        const result = project_mod.activateProject({ projectId });
        if (result?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: result?.name || 'PROJECT_ACTIVATE_FAILED',
              message: result?.message || 'Failed to activate project.',
              details: result?.details || null,
            },
          });
          return;
        }

        writeJson(response, 200, { success: true, action, data: result });
        return;
      }

      if (action === 'project_status_transition') {
        const projectId = body.projectId || null;
        const transition = body.transition || null;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for project_status_transition.',
            },
          });
          return;
        }
        if (!transition) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'transition is required for project_status_transition.',
            },
          });
          return;
        }
        if (
          !requireActionAuthorization({
            response,
            action,
            projectId,
            capability: rbac.capabilityForProjectTransition(transition),
          })
        )
          return;

        const result = project_mod.transitionProjectStatus({
          projectId,
          transition,
        });
        if (result?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: result?.name || 'PROJECT_STATUS_TRANSITION_FAILED',
              message: result?.message || 'Failed to update project status.',
              details: result?.details || null,
            },
          });
          return;
        }

        writeJson(response, 200, { success: true, action, data: result });
        return;
      }

      if (action === 'project_documents_list') {
        const projectId = body.projectId || null;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for project_documents_list.',
            },
          });
          return;
        }

        const data = project_documents_mod.listProjectDocuments({ projectId });
        writeJson(response, 200, { success: true, action, data });
        return;
      }

      if (action === 'project_document_upload') {
        if (
          !requireActionAuthorization({
            response,
            action,
            projectId: body?.projectId || null,
          })
        )
          return;
        const result = project_documents_mod.uploadProjectDocument({
          projectId: body?.projectId || null,
          fileName: body?.fileName || '',
          mimeType: body?.mimeType || '',
          fileSize: body?.fileSize || 0,
          fileContent: body?.fileContent || '',
        });

        if (!result?.success) {
          const statusCode = Number(result?.statusCode || 400);
          writeJson(response, statusCode, {
            success: false,
            action,
            error: {
              name: result?.code || 'DOCUMENT_UPLOAD_FAILED',
              message: result?.error || 'Failed to upload document.',
            },
          });
          return;
        }

        writeJson(response, 200, { success: true, action, data: result });
        return;
      }

      if (action === 'project_document_delete') {
        if (
          !requireActionAuthorization({
            response,
            action,
            projectId: body?.projectId || null,
          })
        )
          return;
        const result = project_documents_mod.deleteProjectDocument({
          projectId: body?.projectId || null,
          fileId: body?.fileId || null,
        });

        if (!result?.success) {
          const statusCode = Number(result?.statusCode || 400);
          writeJson(response, statusCode, {
            success: false,
            action,
            error: {
              name: result?.code || 'DOCUMENT_DELETE_FAILED',
              message: result?.error || 'Failed to delete document.',
            },
          });
          return;
        }

        writeJson(response, 200, { success: true, action, data: result });
        return;
      }

      if (action === 'project_notes_list') {
        const projectId = body.projectId || null;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for project_notes_list.',
            },
          });
          return;
        }

        const data = project_notes_mod.listProjectNotes({ projectId });
        writeJson(response, 200, { success: true, action, data });
        return;
      }

      if (action === 'project_note_create') {
        if (
          !requireActionAuthorization({
            response,
            action,
            projectId: body?.projectId || null,
          })
        )
          return;
        const result = project_notes_mod.createProjectNote({
          projectId: body?.projectId || null,
          title: body?.title || '',
          content: body?.content || '',
        });
        if (!result?.success) {
          const statusCode = Number(result?.statusCode || 400);
          writeJson(response, statusCode, {
            success: false,
            action,
            error: {
              name: result?.code || 'PROJECT_NOTE_CREATE_FAILED',
              message: result?.error || 'Failed to create project note.',
            },
          });
          return;
        }

        writeJson(response, 200, { success: true, action, data: result });
        return;
      }

      if (action === 'rev_rec_generation_preview') {
        const projectId = body.projectId || null;
        if (
          !requireActionAuthorization({
            response,
            action,
            projectId,
            capability: rbac.CAPABILITIES.REVREC_GENERATE,
          })
        )
          return;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for rev_rec_generation_preview.',
            },
          });
          return;
        }

        const freezeErr = getProjectFrozenError({
          projectId,
          actionLabel: 'Rev Rec Journal generation',
          allowCompleted: true,
        });
        if (freezeErr?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: freezeErr?.name || 'PROJECT_FROZEN',
              message: freezeErr?.message || 'Project is frozen.',
              details: freezeErr?.details || null,
            },
          });
          return;
        }

        const eligibilityErr = rev_rec_mod.validateProjectRevRecEligibility({
          projectId,
        });
        if (eligibilityErr?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: eligibilityErr?.name || 'REV_REC_ELIGIBILITY_FAILED',
              message:
                eligibilityErr?.message ||
                'Project is not eligible for rev rec journal generation.',
              details: eligibilityErr?.details || null,
            },
          });
          return;
        }

        const preview = rev_rec_mod.buildRevRecGenerationPreview({ projectId });
        if (preview?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: preview?.name || 'REV_REC_PREVIEW_FAILED',
              message:
                preview?.message ||
                'Failed to compute rev rec generation preview.',
              details: preview?.details || null,
            },
          });
          return;
        }

        writeJson(response, 200, { success: true, action, data: preview });
        return;
      }

      if (action === 'rev_rec_generation_previews') {
        if (
          !requireActionAuthorization({
            response,
            action,
            capability: rbac.CAPABILITIES.REVREC_GENERATE,
          })
        )
          return;

        const rawProjectIds = Array.isArray(body?.projectIds)
          ? body.projectIds
          : [];
        const projectIds = rev_rec_mod.normalizeProjectIds(rawProjectIds);
        if (!projectIds.length) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message:
                'projectIds is required for rev_rec_generation_previews and must be a non-empty array.',
            },
          });
          return;
        }

        const previews = [];
        const blocked = [];
        projectIds.forEach((projectId) => {
          const freezeErr = getProjectFrozenError({
            projectId,
            actionLabel: 'Rev Rec Journal generation',
            allowCompleted: true,
          });
          if (freezeErr?.status === 'ERROR') {
            blocked.push({
              projectId: String(projectId),
              name: freezeErr?.name || 'PROJECT_FROZEN',
              message: freezeErr?.message || 'Project is frozen.',
              details: freezeErr?.details || null,
            });
            return;
          }

          const eligibilityErr = rev_rec_mod.validateProjectRevRecEligibility({
            projectId,
          });
          if (eligibilityErr?.status === 'ERROR') {
            blocked.push({
              projectId: String(projectId),
              name: eligibilityErr?.name || 'REV_REC_ELIGIBILITY_FAILED',
              message:
                eligibilityErr?.message ||
                'Project is not eligible for rev rec journal generation.',
              details: eligibilityErr?.details || null,
            });
            return;
          }

          const preview = rev_rec_mod.buildRevRecGenerationPreview({
            projectId,
          });
          if (preview?.status === 'ERROR') {
            blocked.push({
              projectId: String(projectId),
              name: preview?.name || 'REV_REC_PREVIEW_FAILED',
              message:
                preview?.message ||
                'Failed to compute rev rec generation preview.',
              details: preview?.details || null,
            });
            return;
          }

          previews.push(preview);
        });

        writeJson(response, 200, {
          success: true,
          action,
          data: { previews, blocked },
        });
        return;
      }

      if (action === 'generate_rev_rec_journal') {
        const projectId = body.projectId || null;
        if (
          !requireActionAuthorization({
            response,
            action,
            projectId,
            capability: rbac.CAPABILITIES.REVREC_GENERATE,
          })
        )
          return;
        if (!projectId) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message: 'projectId is required for generate_rev_rec_journal.',
            },
          });
          return;
        }

        const freezeErr = getProjectFrozenError({
          projectId,
          actionLabel: 'Rev Rec Journal generation',
          allowCompleted: true,
        });
        if (freezeErr?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: freezeErr?.name || 'PROJECT_FROZEN',
              message: freezeErr?.message || 'Project is frozen.',
              details: freezeErr?.details || null,
            },
          });
          return;
        }

        const eligibilityErr = rev_rec_mod.validateProjectRevRecEligibility({
          projectId,
        });
        if (eligibilityErr?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: eligibilityErr?.name || 'REV_REC_ELIGIBILITY_FAILED',
              message:
                eligibilityErr?.message ||
                'Project is not eligible for rev rec journal generation.',
              details: eligibilityErr?.details || null,
            },
          });
          return;
        }

        const mode = String(body?.mode || 'auto')
          .trim()
          .toLowerCase();
        const forceMissingOpen = Boolean(body?.forceMissingOpen);

        const result = rev_rec_mod.generateRevRecJournal({
          projectId,
          mode,
          forceMissingOpen,
        });
        if (result?.status === 'ERROR') {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: result?.name || 'GENERATE_REV_REC_JOURNAL_FAILED',
              message: result?.message || 'Failed to generate rev rec journal.',
              details: result?.details || null,
            },
          });
          return;
        }

        writeJson(response, 200, { success: true, action, data: result });
        return;
      }

      if (action === 'generate_rev_rec_journals') {
        if (
          !requireActionAuthorization({
            response,
            action,
            capability: rbac.CAPABILITIES.REVREC_GENERATE,
          })
        )
          return;

        const rawProjectIds = Array.isArray(body?.projectIds)
          ? body.projectIds
          : [];
        const projectIds = rev_rec_mod.normalizeProjectIds(rawProjectIds);
        if (!projectIds.length) {
          writeJson(response, 400, {
            success: false,
            error: {
              name: 'BAD_REQUEST',
              message:
                'projectIds is required for generate_rev_rec_journals and must be a non-empty array.',
            },
          });
          return;
        }

        const blocked = [];
        projectIds.forEach((projectId) => {
          const freezeErr = getProjectFrozenError({
            projectId,
            actionLabel: 'Rev Rec Journal generation',
            allowCompleted: true,
          });
          if (freezeErr?.status === 'ERROR') {
            blocked.push({
              projectId: String(projectId),
              name: freezeErr?.name || 'PROJECT_FROZEN',
              message: freezeErr?.message || 'Project is frozen.',
              details: freezeErr?.details || null,
            });
            return;
          }

          const eligibilityErr = rev_rec_mod.validateProjectRevRecEligibility({
            projectId,
          });
          if (eligibilityErr?.status === 'ERROR') {
            blocked.push({
              projectId: String(projectId),
              name: eligibilityErr?.name || 'REV_REC_ELIGIBILITY_FAILED',
              message:
                eligibilityErr?.message ||
                'Project is not eligible for rev rec journal generation.',
              details: eligibilityErr?.details || null,
            });
          }
        });

        if (blocked.length) {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: 'PROJECTS_BLOCKED',
              message:
                'Some selected projects are not eligible for rev rec journal generation.',
              details: { blocked },
            },
          });
          return;
        }

        const mode = String(body?.mode || 'auto')
          .trim()
          .toLowerCase();
        const forceMissingOpen = Boolean(body?.forceMissingOpen);
        const threshold = pmConfig?.REV_REC_JNL_BULK_ASYNC_THRESHOLD;
        const hasCustomGenerationOptions = mode !== 'auto' || forceMissingOpen;
        const useAsync =
          !hasCustomGenerationOptions && projectIds.length > threshold;

        if (useAsync) {
          const scriptId = 'customscript_bc_pm_mrs_bulkrevrecjnl';
          const deploymentId = 'customdeploy_bc_pm_mrs_bulkrevrecjnl';

          try {
            const mrTask = task.create({
              taskType: task.TaskType.MAP_REDUCE,
              scriptId,
              deploymentId,
              params: {
                custscript_pm_bulk_jnl_project_ids: projectIds.join(','),
              },
            });
            const taskId = String(mrTask.submit() || '').trim();
            if (!taskId)
              throw new Error('Map/Reduce task id was not returned.');

            const lockResult = rev_rec_mod.lockProjectsForJournalProcessing({
              projectIds,
              taskId,
            });

            if (Array.isArray(lockResult?.failed) && lockResult.failed.length) {
              lockResult.failed.forEach((row) => {
                try {
                  rev_rec_mod.markProjectJournalProcessingFailed({
                    projectId: row.projectId,
                    taskId,
                    error: row.message || 'Failed to set processing lock.',
                  });
                } catch (e) {
                  // ignore
                }
              });
            }

            writeJson(response, 200, {
              success: true,
              action,
              data: {
                mode: 'async',
                taskId,
                threshold,
                requestedProjectIds: projectIds,
                lockedProjectIds: lockResult?.lockedProjectIds || [],
                lockFailures: lockResult?.failed || [],
              },
            });
            return;
          } catch (e) {
            writeJson(response, 400, {
              success: false,
              action,
              error: {
                name: 'GENERATE_REV_REC_JOURNALS_ASYNC_FAILED',
                message:
                  e?.message ||
                  'Failed to start background journal processing.',
              },
            });
            return;
          }
        }

        const results = [];
        let hasError = false;
        projectIds.forEach((projectId) => {
          const result = rev_rec_mod.generateRevRecJournal({
            projectId,
            mode,
            forceMissingOpen,
          });
          results.push({ projectId, ...(result || {}) });
          if (String(result?.status || '') === 'ERROR') hasError = true;
        });

        if (hasError) {
          writeJson(response, 400, {
            success: false,
            action,
            error: {
              name: 'GENERATE_REV_REC_JOURNALS_FAILED',
              message:
                'One or more selected projects failed to generate rev rec journal.',
              details: { results },
            },
          });
          return;
        }

        writeJson(response, 200, {
          success: true,
          action,
          data: {
            mode: 'sync',
            threshold,
            generationMode: mode,
            forceMissingOpen,
            results,
          },
        });
        return;
      }

      writeJson(response, 400, {
        success: false,
        error: {
          name: 'BAD_REQUEST',
          message:
            'Unsupported action. Use POST { "action": "init_data" }, POST { "action": "phase_lookups" }, POST { "action": "projects_list" }, POST { "action": "project_phases_list", "projectId": "123" }, POST { "action": "project_financials", "projectId": "123" }, POST { "action": "project_load", "projectId": "123" }, POST { "action": "project_month_simulation_upsert", "projectId": "123", "simulatedPeriod": "jul-2026" }, POST { "action": "project_edit_lookups" }, POST { "action": "project_upsert", "projectId": "123", "project": {...} }, POST { "action": "project_rev_plans", "projectId": "123" }, POST { "action": "generate_rev_plans", "projectId": "123" }, POST { "action": "revplan_update", "projectId": "123", "confirmed": true, "phasesData": [...] }, POST { "action": "revplan_reopen", "projectId": "123" }, POST { "action": "rev_rec_generation_preview", "projectId": "123" }, POST { "action": "rev_rec_generation_previews", "projectIds": ["123","456"] }, POST { "action": "generate_rev_rec_journal", "projectId": "123", "mode": "auto|current_only|missing_only|missing_and_current", "forceMissingOpen": false }, POST { "action": "generate_rev_rec_journals", "projectIds": ["123","456"], "mode": "auto|current_only|missing_only|missing_and_current", "forceMissingOpen": false }, POST { "action": "project_activate", "projectId": "123" }, POST { "action": "project_status_transition", "projectId": "123", "transition": "on_hold|complete|close|activate" }, POST { "action": "project_documents_list", "projectId": "123" }, POST { "action": "project_document_upload", "projectId": "123", "fileName": "x.pdf", "mimeType": "application/pdf", "fileSize": 1234, "fileContent": "<base64>" }, POST { "action": "project_document_delete", "projectId": "123", "fileId": "456" }, POST { "action": "project_notes_list", "projectId": "123" }, POST { "action": "project_note_create", "projectId": "123", "title": "Note title", "content": "Note content" }, POST { "action": "phase_upsert", "projectId": "123", "phase": {...} }, POST { "action": "phases_upsert", "projectId": "123", "phases": [{...}] }.',
        },
      });
    } catch (e) {
      if (e?.name === 'STATUS_MAPPING_MISSING') {
        log.error({ title: 'STATUS_MAPPING_MISSING', details: e });
        writeJson(response, 400, {
          success: false,
          action,
          error: {
            name: 'STATUS_MAPPING_MISSING',
            message:
              e?.message ||
              'NetSuite status mapping is missing for this operation.',
            details: e?.details || null,
          },
        });
        return;
      }
      log.error({ title: 'SUITELET_ERROR', details: e });
      writeJson(response, 500, {
        success: false,
        error: {
          name: e?.name || 'UNEXPECTED_ERROR',
          message: e?.message || String(e),
        },
      });
    }
  }

  return { onRequest };
});
