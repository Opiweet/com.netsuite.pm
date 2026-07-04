/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
  './user_types',
  './helper',
  './project_meta',
  '../../pm_config',
  './rbac_config',
], (user_types, helper, project_meta, pmConfig, rbac_config) => {
  const { normalizeLower } = helper;
  const { getProjectPermissionMeta } = project_meta;
  const CAPABILITIES = Object.freeze({
    RBAC_MANAGE: 'rbac.manage',
    REVPLAN_VIEW: 'revplan.view',
    PROJECT_CREATE: 'project.create',
    PROJECT_UPDATE: 'project.update',
    PROJECT_ACTIVATE: 'project.activate',
    PROJECT_HOLD: 'project.hold',
    PROJECT_COMPLETE: 'project.complete',
    PROJECT_CLOSE: 'project.close',
    PROJECT_STATUS_TRANSITION: 'project.status.transition',
    PHASE_UPSERT: 'phase.upsert',
    PHASE_DELETE: 'phase.delete',
    REVPLAN_GENERATE: 'revplan.generate',
    REVPLAN_UPDATE: 'revplan.update',
    REVPLAN_CONFIRM: 'revplan.confirm',
    REVPLAN_REOPEN: 'revplan.reopen',
    REVREC_GENERATE: 'revrec.generate',
    DOCUMENTS_MANAGE: 'documents.manage',
    NOTES_CREATE: 'notes.create',
  });

  const MUTATION_ACTION_TO_CAPABILITY = Object.freeze({
    project_upsert: CAPABILITIES.PROJECT_UPDATE,
    project_activate: CAPABILITIES.PROJECT_ACTIVATE,
    project_status_transition: CAPABILITIES.PROJECT_STATUS_TRANSITION,
    phase_upsert: CAPABILITIES.PHASE_UPSERT,
    phase_create: CAPABILITIES.PHASE_UPSERT,
    phase_update: CAPABILITIES.PHASE_UPSERT,
    phases_upsert: CAPABILITIES.PHASE_UPSERT,
    phase_delete: CAPABILITIES.PHASE_DELETE,
    generate_rev_plans: CAPABILITIES.REVPLAN_GENERATE,
    revplan_update: CAPABILITIES.REVPLAN_UPDATE,
    revplan_reopen: CAPABILITIES.REVPLAN_REOPEN,
    generate_rev_rec_journal: CAPABILITIES.REVREC_GENERATE,
    generate_rev_rec_journals: CAPABILITIES.REVREC_GENERATE,
    project_document_upload: CAPABILITIES.DOCUMENTS_MANAGE,
    project_document_delete: CAPABILITIES.DOCUMENTS_MANAGE,
    project_note_create: CAPABILITIES.NOTES_CREATE,
    rbac_config_upsert: CAPABILITIES.RBAC_MANAGE,
  });

  const DEFAULT_STATIC_CAPABILITIES = Object.freeze({
    operational: [
      CAPABILITIES.PROJECT_CREATE,
      CAPABILITIES.REVPLAN_VIEW,
      CAPABILITIES.NOTES_CREATE,
    ],
    salesManager: [
      CAPABILITIES.PROJECT_CREATE,
      CAPABILITIES.REVPLAN_VIEW,
      CAPABILITIES.PHASE_UPSERT,
      CAPABILITIES.REVPLAN_GENERATE,
      CAPABILITIES.REVPLAN_UPDATE,
      CAPABILITIES.REVPLAN_CONFIRM,
      CAPABILITIES.PROJECT_ACTIVATE,
      CAPABILITIES.PROJECT_HOLD,
      CAPABILITIES.PROJECT_COMPLETE,
      CAPABILITIES.PROJECT_CLOSE,
    ],
    finance: [
      CAPABILITIES.PROJECT_CREATE,
      CAPABILITIES.REVPLAN_VIEW,
      CAPABILITIES.REVPLAN_REOPEN,
      CAPABILITIES.REVREC_GENERATE,
    ],
  });

  const DEFAULT_ROLE_GROUPS = Object.freeze({
    admin: [String(pmConfig?.ROLE_IDS.ADMINISTRATOR || '')].filter(Boolean),
    salesManager: [String(pmConfig?.ROLE_IDS.SALES_MANAGER || '')].filter(
      Boolean,
    ),
    finance: [String(pmConfig?.ROLE_IDS.ACCOUNTING_MANAGER || '')].filter(
      Boolean,
    ),
  });

  const DEFAULT_ROLE_CAPABILITY_OVERRIDES = Object.freeze({
    [String(pmConfig?.ROLE_IDS?.REVENUE_MANAGER || '')]: [
      ...DEFAULT_STATIC_CAPABILITIES.finance,
    ].filter(Boolean),
    [String(pmConfig?.ROLE_IDS?.ONLINE_USER || '')]: [
      CAPABILITIES.RBAC_MANAGE,
    ].filter(Boolean),
  });

  function sanitizeRoleScriptIds(values) {
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const key = String(value || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(key);
    });
    return out;
  }

  function sanitizeCapabilityList(values) {
    const valid = new Set(Object.values(CAPABILITIES));
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const key = String(value || '').trim();
      if (!key || !valid.has(key) || seen.has(key)) return;
      seen.add(key);
      out.push(key);
    });
    return out;
  }

  function sanitizeRoleCapabilityOverrides(overrides) {
    const out = {};
    const source = overrides && typeof overrides === 'object' ? overrides : {};
    Object.keys(source).forEach((roleScriptId) => {
      const key = String(roleScriptId || '').trim();
      if (!key) return;
      const capabilities = sanitizeCapabilityList(source[roleScriptId]);
      if (!capabilities.length) return;
      out[key] = capabilities;
    });
    return out;
  }

  function getDefaultAdminConfig() {
    return {
      roleGroups: {
        admin: [...DEFAULT_ROLE_GROUPS.admin],
        salesManager: [...DEFAULT_ROLE_GROUPS.salesManager],
        finance: [...DEFAULT_ROLE_GROUPS.finance],
      },
      staticCapabilities: {
        operational: [...DEFAULT_STATIC_CAPABILITIES.operational],
        salesManager: [...DEFAULT_STATIC_CAPABILITIES.salesManager],
        finance: [...DEFAULT_STATIC_CAPABILITIES.finance],
      },
      roleCapabilityOverrides: sanitizeRoleCapabilityOverrides(
        DEFAULT_ROLE_CAPABILITY_OVERRIDES,
      ),
    };
  }

  function prepareAdminConfigForSave(config) {
    const defaults = getDefaultAdminConfig();
    const source = config && typeof config === 'object' ? config : {};
    const staticCapabilities =
      source?.staticCapabilities &&
      typeof source.staticCapabilities === 'object'
        ? source.staticCapabilities
        : {};
    const roleGroups =
      source?.roleGroups && typeof source.roleGroups === 'object'
        ? source.roleGroups
        : {};
    const hasRoleGroupKey = (key) =>
      Object.prototype.hasOwnProperty.call(roleGroups, key);
    const hasStaticCapabilityKey = (key) =>
      Object.prototype.hasOwnProperty.call(staticCapabilities, key);
    const hasRoleCapabilityOverrides =
      source &&
      typeof source === 'object' &&
      Object.prototype.hasOwnProperty.call(source, 'roleCapabilityOverrides');
    const normalizedRoleCapabilityOverrides = sanitizeRoleCapabilityOverrides(
      source?.roleCapabilityOverrides,
    );
    return {
      version: 1,
      roleGroups: {
        admin: hasRoleGroupKey('admin')
          ? sanitizeRoleScriptIds(roleGroups.admin)
          : defaults.roleGroups.admin,
        salesManager: hasRoleGroupKey('salesManager')
          ? sanitizeRoleScriptIds(roleGroups.salesManager)
          : defaults.roleGroups.salesManager,
        finance: hasRoleGroupKey('finance')
          ? sanitizeRoleScriptIds(roleGroups.finance)
          : defaults.roleGroups.finance,
      },
      staticCapabilities: {
        operational: hasStaticCapabilityKey('operational')
          ? sanitizeCapabilityList(staticCapabilities.operational)
          : defaults.staticCapabilities.operational,
        salesManager: hasStaticCapabilityKey('salesManager')
          ? sanitizeCapabilityList(staticCapabilities.salesManager)
          : defaults.staticCapabilities.salesManager,
        finance: hasStaticCapabilityKey('finance')
          ? sanitizeCapabilityList(staticCapabilities.finance)
          : defaults.staticCapabilities.finance,
      },
      roleCapabilityOverrides: hasRoleCapabilityOverrides
        ? normalizedRoleCapabilityOverrides
        : defaults.roleCapabilityOverrides,
    };
  }

  function getEffectiveAdminConfig() {
    const stored = rbac_config.loadStoredConfig();
    return prepareAdminConfigForSave(stored || {});
  }

  function getAdminConfigSnapshot() {
    const defaults = getDefaultAdminConfig();
    const effective = getEffectiveAdminConfig();
    return {
      capabilitiesCatalog: Object.values(CAPABILITIES).sort(),
      defaults,
      effective,
    };
  }

  function buildStaticCapabilitySets() {
    const effective = getEffectiveAdminConfig();
    return {
      admin: new Set(Object.values(CAPABILITIES)),
      operational: new Set(effective.staticCapabilities.operational),
      salesManager: new Set(effective.staticCapabilities.salesManager),
      finance: new Set(effective.staticCapabilities.finance),
      roleCapabilityOverrides: effective.roleCapabilityOverrides,
    };
  }

  function resolvePrincipal() {
    const types = user_types.getUserTypes() || {};
    return {
      userId: String(types.userId || ''),
      roleId: String(types.roleId || ''),
      roleScriptId: String(types.roleScriptId || ''),
      roleName: String(types.roleName || ''),
      isAdmin: Boolean(types.isAdmin),
      isFinanceUser: Boolean(types.isFinanceUser),
      isSalesManager: Boolean(types.isSalesManager),
    };
  }

  function getPrincipalCapabilities(principal) {
    const resolved = principal || resolvePrincipal();
    const out = new Set();
    const roleName = normalizeLower(resolved.roleName);
    const roleScriptId = String(resolved.roleScriptId || '');
    const isSalesManager = Boolean(resolved.isSalesManager);
    const staticCaps = buildStaticCapabilitySets();
    const isFinanceRole =
      roleName.includes('accounting manager') ||
      roleName.includes('accounting director') ||
      roleName.includes('finance');

    if (resolved.isAdmin || roleName.includes('admin')) {
      staticCaps.admin.forEach((capability) => out.add(capability));
    } else if (isSalesManager) {
      staticCaps.salesManager.forEach((capability) => out.add(capability));
    } else if (resolved.isFinanceUser || isFinanceRole) {
      staticCaps.finance.forEach((capability) => out.add(capability));
    } else {
      staticCaps.operational.forEach((capability) => out.add(capability));
    }

    const roleOverrides =
      staticCaps.roleCapabilityOverrides[roleScriptId] || [];
    roleOverrides.forEach((capability) => out.add(capability));

    return out;
  }

  function canManageProjectByOwnership({ principal, projectId }) {
    const resolved = principal || resolvePrincipal();
    if (resolved.isAdmin) return true;
    const meta = getProjectPermissionMeta(projectId);
    if (!meta.projectId || !resolved.userId) return false;
    return (
      String(meta.projectManagerId || '') === String(resolved.userId) ||
      String(meta.createdById || '') === String(resolved.userId)
    );
  }

  function capabilityForProjectTransition(transition) {
    const key = String(transition || '')
      .trim()
      .toLowerCase();
    if (key === 'activate') return CAPABILITIES.PROJECT_ACTIVATE;
    if (key === 'on_hold') return CAPABILITIES.PROJECT_HOLD;
    if (key === 'complete') return CAPABILITIES.PROJECT_COMPLETE;
    if (key === 'close') return CAPABILITIES.PROJECT_CLOSE;
    return CAPABILITIES.PROJECT_STATUS_TRANSITION;
  }

  function authorize({ action, capability, projectId = null } = {}) {
    const resolved = resolvePrincipal();
    const targetCapability =
      capability ||
      MUTATION_ACTION_TO_CAPABILITY[String(action || '').trim()] ||
      '';
    if (!targetCapability) {
      return {
        allowed: false,
        reasonCode: 'RBAC_CAPABILITY_NOT_MAPPED',
        reason: `Action "${String(action || '')}" is not mapped to a capability.`,
        principal: resolved,
        capability: '',
      };
    }

    const granted = getPrincipalCapabilities(resolved);
    const umbrellaProjectTransitionCaps = new Set([
      CAPABILITIES.PROJECT_ACTIVATE,
      CAPABILITIES.PROJECT_HOLD,
      CAPABILITIES.PROJECT_COMPLETE,
      CAPABILITIES.PROJECT_CLOSE,
    ]);
    const hasCapability =
      granted.has(targetCapability) ||
      (umbrellaProjectTransitionCaps.has(targetCapability) &&
        granted.has(CAPABILITIES.PROJECT_STATUS_TRANSITION));
    if (!hasCapability) {
      return {
        allowed: false,
        reasonCode: 'RBAC_MISSING_CAPABILITY',
        reason: `Missing capability "${targetCapability}".`,
        principal: resolved,
        capability: targetCapability,
      };
    }

    if (targetCapability === CAPABILITIES.DOCUMENTS_MANAGE && projectId) {
      const ok = canManageProjectByOwnership({
        principal: resolved,
        projectId,
      });
      if (!ok) {
        return {
          allowed: false,
          reasonCode: 'RBAC_PROJECT_SCOPE_DENY',
          reason:
            'Document management requires admin, project manager, or project creator.',
          principal: resolved,
          capability: targetCapability,
        };
      }
    }

    return {
      allowed: true,
      reasonCode: null,
      reason: null,
      principal: resolved,
      capability: targetCapability,
    };
  }

  function getAuthzSnapshot() {
    const principal = resolvePrincipal();
    const capabilities = Array.from(getPrincipalCapabilities(principal)).sort();
    return {
      roles: [
        {
          roleId: principal.roleId || null,
          roleScriptId: principal.roleScriptId || null,
          roleName: principal.roleName || null,
          isAdmin: Boolean(principal.isAdmin),
          isFinanceUser: Boolean(principal.isFinanceUser),
        },
      ],
      capabilities,
    };
  }

  return {
    CAPABILITIES,
    MUTATION_ACTION_TO_CAPABILITY,
    capabilityForProjectTransition,
    authorize,
    getAuthzSnapshot,
    getAdminConfigSnapshot,
    prepareAdminConfigForSave,
  };
});
