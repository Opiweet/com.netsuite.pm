/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/query', '../lib/constants', '../lib/errors'], (record, query, C, errors) => {

  const run = (queryText, params) => {
    return query.runSuiteQL({ query: queryText, params: params || [] }).asMappedResults() || [];
  }

  const getIr = (irId) => {
    const rows = run(`
      SELECT
        id,
        ${C.FLD_IR_JOB} AS jobid,
        ${C.FLD_IR_PROJECT} AS projectid,
        ${C.FLD_IR_STATUS} AS status,
        ${C.FLD_IR_REQUESTOR_EMAIL} AS requestoremail,
        ${C.FLD_IR_TOTAL} AS total
      FROM ${C.REC_IR}
      WHERE id = ?
        AND ${C.FLD_IR_IS_DELETED} = 'F'
      ORDER BY id
      FETCH FIRST 1 ROWS ONLY
    `, [irId]);

    const r = rows[0];
    if (!r) throw errors.notFound('IR_NOT_FOUND', 'IR not found');

    return {
      id: String(r.id),
      jobId: r.jobid,
      projectId: r.projectid,
      status: r.status,
      requestorEmail: r.requestoremail,
      total: r.total
    };
  }

  const createIr = ({ jobId, projectId, payload }) => {
    // Business rules (examples):
    // - ensure jobId belongs to projectId (enforce linkage)
    // - check job/project status open
    // These checks are better done by looking up job/project via searches.

    const rec = record.create({ type: C.REC_IR, isDynamic: true });
    rec.setValue({ fieldId: C.FLD_IR_JOB, value: jobId });
    rec.setValue({ fieldId: C.FLD_IR_PROJECT, value: projectId });
    rec.setValue({ fieldId: C.FLD_IR_IS_DELETED, value: false });

    if (payload.requestorEmail) rec.setValue({ fieldId: C.FLD_IR_REQUESTOR_EMAIL, value: payload.requestorEmail });
    if (payload.total != null && !Number.isNaN(payload.total)) rec.setValue({ fieldId: C.FLD_IR_TOTAL, value: payload.total });

    const id = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return getIr(id);
  }

  const updateIr = ({ irId, payload }) => {
    const rec = record.load({ type: C.REC_IR, id: irId, isDynamic: true });

    // Optional: block edits if status is processed/approved, etc.
    // const status = rec.getValue({ fieldId: C.FLD_IR_STATUS });

    if (payload.requestorEmail != null) rec.setValue({ fieldId: C.FLD_IR_REQUESTOR_EMAIL, value: payload.requestorEmail });
    if (payload.total != null && !Number.isNaN(payload.total)) rec.setValue({ fieldId: C.FLD_IR_TOTAL, value: payload.total });

    rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return getIr(irId);
  }

  const softDeleteIr = ({ irId }) => {
    const rec = record.load({ type: C.REC_IR, id: irId, isDynamic: true });
    rec.setValue({ fieldId: C.FLD_IR_IS_DELETED, value: true });
    rec.save({ enableSourcing: true, ignoreMandatoryFields: true });
    return { id: irId, deleted: true };
  }

  return { getIr, createIr, updateIr, softDeleteIr };
});
