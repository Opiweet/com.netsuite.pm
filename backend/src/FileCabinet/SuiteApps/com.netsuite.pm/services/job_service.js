/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/query', 'N/record', '../lib/constants', '../lib/errors'], (query, record, C, errors) => {

  const run = (queryText, params) => {
    return query.runSuiteQL({ query: queryText, params: params || [] }).asMappedResults() || [];
  }

  const listJobsByProject = (projectId, { page, pageSize }) => {
    const start = (page - 1) * pageSize;
    const rows = run(`
      SELECT
        id,
        name,
        ${C.FLD_JOB_PROJECT} AS projectid,
        ${C.FLD_JOB_STATUS} AS status
      FROM ${C.REC_JOB}
      WHERE ${C.FLD_JOB_PROJECT} = ?
      ORDER BY id AND created DESC
      OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    `, [projectId, start, pageSize]);

    return rows.map(r => ({
      id: String(r.id),
      name: r.name,
      projectId: r.projectid,
      status: r.status
    }));
  }

  const getJob = (jobId) => {
    const rows = run(`
      SELECT
        id,
        name,
        ${C.FLD_JOB_PROJECT} AS projectid,
        ${C.FLD_JOB_STATUS} AS status
      FROM ${C.REC_JOB}
      WHERE id = ?
      ORDER BY id
      FETCH FIRST 1 ROWS ONLY
    `, [jobId]);

    const r = rows[0];
    if (!r) throw errors.notFound('JOB_NOT_FOUND', 'Job not found');

    return {
      id: String(r.id),
      name: r.name,
      projectId: r.projectid,
      status: r.status
    };
  }

  const createJob = ({ projectId, payload }) => {
    const rec = record.create({ type: C.REC_JOB, isDynamic: true });
    rec.setValue({ fieldId: C.FLD_JOB_PROJECT, value: projectId });
    rec.setValue({ fieldId: C.FLD_JOB_SITE, value: payload.site });
    if (payload.name) rec.setValue({ fieldId: 'name', value: payload.name });
    if (payload.status != null) rec.setValue({ fieldId: C.FLD_JOB_STATUS, value: payload.status });

    const id = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return getJob(id);
  }

  return { listJobsByProject, getJob, createJob };
});
