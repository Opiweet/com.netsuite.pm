/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/runtime', 'N/search', '../../pm_config', './helper', './rbac_config'], (
  runtime,
  search,
  pmConfig,
  helper,
  rbac_config,
) => {
  const { toId, normalizeLower } = helper;

  function getRoleName(roleId) {
    const id = toId(roleId);
    if (!id) return '';
    try {
      const fields = search.lookupFields({
        type: 'role',
        id,
        columns: ['name'],
      });
      return String(fields?.name || '').trim();
    } catch (_e) {
      return '';
    }
  }

  function sanitizeRoleScriptIds(values) {
    const out = [];
    const seen = new Set();
    ;(Array.isArray(values) ? values : []).forEach((value) => {
      const key = String(value || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(key);
    });
    return out;
  }

  function resolveRoleGroups() {
    const defaults = {
      admin: sanitizeRoleScriptIds([String(pmConfig?.ROLE_IDS.ADMINISTRATOR)]),
      salesManager: sanitizeRoleScriptIds([String(pmConfig?.ROLE_IDS.SALES_MANAGER)]),
      finance: sanitizeRoleScriptIds([String(pmConfig?.ROLE_IDS.ACCOUNTING_MANAGER)]),
    };
    const stored = rbac_config.loadStoredConfig() || {};
    const groups = stored?.roleGroups && typeof stored.roleGroups === 'object'
      ? stored.roleGroups
      : {};
    const hasKey = (key) => Object.prototype.hasOwnProperty.call(groups, key);
    return {
      admin: hasKey('admin') ? sanitizeRoleScriptIds(groups.admin) : defaults.admin,
      salesManager: hasKey('salesManager')
        ? sanitizeRoleScriptIds(groups.salesManager)
        : defaults.salesManager,
      finance: hasKey('finance') ? sanitizeRoleScriptIds(groups.finance) : defaults.finance,
    };
  }

  const adminRoles = () => resolveRoleGroups().admin;
  const salesManagerRoles = () => resolveRoleGroups().salesManager;
  const financeUserRoles = () => resolveRoleGroups().finance;

  function getUserTypes() {
    const user = runtime.getCurrentUser();
    const userId = toId(user?.id);
    const roleId = toId(user?.role);
    const roleScriptId = String(user?.roleId || '').trim();
    const roleName = normalizeLower(getRoleName(roleId));

    const users = {
      isAdmin: adminRoles().includes(String(roleScriptId)),
      isSalesManager: salesManagerRoles().includes(String(roleScriptId)),
      isFinanceUser: financeUserRoles().includes(String(roleScriptId)),
    };

    return {
      userId,
      roleId,
      roleScriptId,
      roleName,
      ...users,
    };
  }

  return {
    getUserTypes,
  };
});
