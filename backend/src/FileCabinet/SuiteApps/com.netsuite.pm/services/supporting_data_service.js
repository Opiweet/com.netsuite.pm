/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/query'], (query) => {

  const run = (queryText, params) => {
    return query.runSuiteQL({ query: queryText, params: params || [] }).asMappedResults() || [];
  }

  // Supporting data should not block entirely if one optional source is unavailable.
  const runSafe = (queryText, params) => {
    try {
      return run(queryText, params);
    } catch (e) {
      return [];
    }
  }

  const toIds = (value) => {
    if (value == null || value === '') return [];
    return String(value).split(',').map(x => x.trim()).filter(Boolean);
  }

  const pickIdName = (rows) => {
    return rows.map(r => ({
      id: String(r.id),
      name: String(r.name || '')
    }));
  }

  const getUsersBySubsidiaryScope = (principal) => {
    const where = [`isinactive = 'F'`];
    const params = [];

    // If logged-in user's subsidiary is null -> return all users.
    if (principal && principal.subsidiary) {
      where.push(`custrecord_pm_usermngt_subsidiary = ?`);
      params.push(String(principal.subsidiary));
    }

    const rows = runSafe(`
      SELECT
        id,
        custrecord_pm_usermngt_username AS username,
        custrecord_pm_usermngt_email AS email,
        custrecord_pm_usermngt_firstname AS firstname,
        custrecord_pm_usermngt_lastname AS lastname,
        custrecord_pm_usermngt_access AS access,
        custrecord_pm_usermngt_lock AS locked,
        custrecord_pm_usermngt_subsidiary AS subsidiary,
        custrecord_pm_usermngt_roles AS roles,
        custrecord_pm_usermngt_sites AS sites,
        custrecord_pm_usermngt_depts AS departments
      FROM customrecord_pm_usermanagement
      WHERE ${where.join(' AND ')}
      ORDER BY id
    `, params);

    return rows.map(r => ({
      id: String(r.id),
      username: r.username || '',
      email: r.email || '',
      firstname: r.firstname || '',
      lastname: r.lastname || '',
      access: r.access === true || r.access === 'T',
      locked: r.locked === true || r.locked === 'T',
      subsidiary: r.subsidiary == null ? null : String(r.subsidiary),
      roles: toIds(r.roles),
      sites: toIds(r.sites),
      departments: toIds(r.departments)
    }));
  }

  const listTableValues = (tableName) => {
    const rows = runSafe(`
      SELECT id, name
      FROM ${tableName}
      WHERE isinactive = 'F'
      ORDER BY name
    `);
    return pickIdName(rows);
  }

  const listSubsidiaries = (principal) => {
    const where = [`isinactive = 'F'`];
    const params = [];

    // Non-null subsidiary users should only see their own subsidiary.
    if (principal && principal.subsidiary) {
      where.push(`id = ?`);
      params.push(String(principal.subsidiary));
    }

    const rows = runSafe(`
      SELECT id, name
      FROM subsidiary
      WHERE ${where.join(' AND ')}
      ORDER BY name
    `, params);
    return pickIdName(rows);
  }

  const listSites = (principal) => {
    const where = [`isinactive = 'F'`];
    const params = [];

    // Restrict to the user's subsidiary if set.
    if (principal && principal.subsidiary) {
      where.push(`subsidiary = ?`);
      params.push(String(principal.subsidiary));
    }

    // Restrict to explicitly assigned sites if present.
    const siteIds = principal && Array.isArray(principal.sites)
      ? principal.sites.map(String).filter(Boolean)
      : [];
    if (siteIds.length) {
      where.push(`id IN (${siteIds.map(() => '?').join(', ')})`);
      siteIds.forEach(id => params.push(id));
    }

    const rows = runSafe(`
      SELECT id, name
      FROM location
      WHERE ${where.join(' AND ')}
      ORDER BY name
    `, params);
    return pickIdName(rows);
  }

  const listDepartments = () => {
    const rows = runSafe(`
      SELECT id, name
      FROM department
      WHERE isinactive = 'F'
      ORDER BY name
    `);
    return pickIdName(rows);
  }

  const listProjectSubtypes = () => {
    const rows = runSafe(`
      SELECT
        id,
        name,
        custrecord_pm_projectsubtype_type AS projecttype
      FROM customrecord_pm_project_subtypes
      WHERE isinactive = 'F'
      ORDER BY name
    `);
    return rows.map(r => ({
      id: String(r.id),
      name: String(r.name || ''),
      projectTypeId: r.projecttype == null ? null : String(r.projecttype)
    }));
  }

  const listJobTypes = () => {
    const rows = runSafe(`
      SELECT
        id,
        name,
        custrecord_pm_jobtypes_projecttype AS projecttype
      FROM customrecord_pm_jobtypes
      WHERE isinactive = 'F'
      ORDER BY name
    `);
    return rows.map(r => ({
      id: String(r.id),
      name: String(r.name || ''),
      projectTypeId: r.projecttype == null ? null : String(r.projecttype)
    }));
  }

  const listJobSubtypes = () => {
    const rows = runSafe(`
      SELECT
        id,
        name,
        custrecord_pm_jobsubtypes_fa_type AS fixedassettype
      FROM customrecord_pm_jobsubtypes
      WHERE isinactive = 'F'
      ORDER BY name
    `);
    return rows.map(r => ({
      id: String(r.id),
      name: String(r.name || ''),
      fixedAssetType: String(r.fixedassettype || '')
    }));
  }

  const getSupportingData = (principal) => {
    return {
      subsidiaries: listSubsidiaries(principal),
      sites: listSites(principal),
      departments: listDepartments(),
      users: getUsersBySubsidiaryScope(principal),
      customLists: {
        projectTypes: listTableValues('customlist_pm_projecttypes'),
        projectStatus: listTableValues('customlist_pm_project_status'),
        jobStatus: listTableValues('customlist_pm_job_status'),
        jobSite: listTableValues('customlist_pm_job_site'),
        jobSatisfaction: listTableValues('customlist_pm_job_satisfaction'),
        permissions: listTableValues('customlist_pm_perms')
      },
      customRecords: {
        projectSubtypes: listProjectSubtypes(),
        jobTypes: listJobTypes(),
        jobSubtypes: listJobSubtypes()
      }
    };
  }

  return { getSupportingData };
});
