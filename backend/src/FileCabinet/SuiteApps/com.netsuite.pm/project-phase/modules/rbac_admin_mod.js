/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/query', '../../pm_config', '../core/helper', '../core/rbac', '../core/rbac_config'], (
  query,
  pmConfig,
  helper,
  rbac,
  rbac_config,
) => {
  const { toId } = helper;

  const SYSTEM_ROLES = [
    pmConfig?.ROLE_IDS?.ONLINE_USER
      ? { id: null, scriptId: String(pmConfig.ROLE_IDS.ONLINE_USER), name: 'Online Form User' }
      : null,
  ].filter(Boolean);

  function listRoles() {
    try {
      const sql =
        "SELECT id, scriptid, name FROM role WHERE isinactive = 'F' ORDER BY name ASC";
      const results = query.runSuiteQL({ query: sql }).asMappedResults() || [];
      const mapped = results
        .map((row) => ({
          id: toId(row.id) || null,
          scriptId: String(row.scriptid || '').trim(),
          name: String(row.name || '').trim(),
        }))
        .filter((row) => row.scriptId || row.name);

      const existingScriptIds = new Set(mapped.map((r) => r.scriptId));
      SYSTEM_ROLES.forEach((role) => {
        if (!existingScriptIds.has(role.scriptId)) mapped.push(role);
      });

      return mapped;
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  }

  function getRbacConfigSnapshot() {
    const rolesResult = listRoles();
    const rolesError =
      rolesResult && !Array.isArray(rolesResult) ? rolesResult.error : null;
    return {
      ...rbac.getAdminConfigSnapshot(),
      roles: Array.isArray(rolesResult) ? rolesResult : [],
      rolesError: rolesError || null,
    };
  }

  function saveRbacConfig({ config } = {}) {
    const normalized = rbac.prepareAdminConfigForSave(config || {});
    rbac_config.saveStoredConfig(normalized);
    rbac_config.clearCache();
    return {
      saved: true,
      snapshot: getRbacConfigSnapshot(),
    };
  }

  return {
    getRbacConfigSnapshot,
    saveRbacConfig,
  };
});
