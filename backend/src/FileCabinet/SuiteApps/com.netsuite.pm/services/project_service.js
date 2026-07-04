/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/query', '../lib/constants', '../lib/errors'], (query, C, errors) => {

  const run = (queryText, params) => {
    return query.runSuiteQL({ query: queryText, params: params || [] }).asMappedResults() || [];
  }

  const listProjects = ({ site, department, status, page, pageSize }) => {
    const start = (page - 1) * pageSize;
    const where = [];
    const params = [];

    if (site) {
      where.push(`${C.FLD_PROJECT_SITE} = ?`);
      params.push(site);
    }
    if (department) {
      where.push(`${C.FLD_PROJECT_DEPT} = ?`);
      params.push(department);
    }
    if (status) {
      where.push(`${C.FLD_PROJECT_STATUS} = ?`);
      params.push(status);
    }

    params.push(start);
    params.push(pageSize);

    const queryText = `
      SELECT
        id,
        name,
        ${C.FLD_PROJECT_SITE} AS site,
        ${C.FLD_PROJECT_DEPT} AS department,
        ${C.FLD_PROJECT_STATUS} AS status,
        ${C.FLD_PROJECT_TYPE} AS type
      FROM ${C.REC_PROJECT}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id AND created DESC
      OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    `;

    const rows = run(queryText, params);
    return rows.map(r => ({
      id: String(r.id),
      name: r.name,
      site: r.site,
      department: r.department,
      status: r.status,
      type: r.type
    }));
  }

  const getProject = (projectId) => {
    const rows = run(`
      SELECT
        id,
        name,
        ${C.FLD_PROJECT_SITE} AS site,
        ${C.FLD_PROJECT_DEPT} AS department,
        ${C.FLD_PROJECT_STATUS} AS status,
        ${C.FLD_PROJECT_TYPE} AS type
      FROM ${C.REC_PROJECT}
      WHERE id = ?
      ORDER BY id
      FETCH FIRST 1 ROWS ONLY
    `, [projectId]);

    const r = rows[0];
    if (!r) throw errors.notFound('PROJECT_NOT_FOUND', 'Project not found');

    return {
      id: String(r.id),
      name: r.name,
      site: r.site,
      department: r.department,
      status: r.status,
      type: r.type
    };
  }

  return { listProjects, getProject };
});
