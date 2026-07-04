/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
  return {
    MAX_PAGE_SIZE: 100,
    DEFAULT_PAGE_SIZE: 50,
    MAX_LOGIN_ATTEMPTS: 3,

    // --- Custom record types ---
    REC_PROJECT: 'customrecord_pm_projects',
    REC_JOB: 'customrecord_pm_jobs',
    REC_IR: 'customrecord_p09_internal_req',

    // --- Project fields ---
    FLD_PROJECT_SITE: 'custrecord_pm_project_site',
    FLD_PROJECT_DEPT: 'custrecord_pm_project_dept',
    FLD_PROJECT_STATUS: 'custrecord_pm_project_status',
    FLD_PROJECT_TYPE: 'custrecord_pm_project_type',

    // --- Job fields ---
    FLD_JOB_PROJECT: 'custrecord_pm_job_parent',
    FLD_JOB_STATUS: 'custrecord_pm_job_status',
    FLD_JOB_SITE: 'custrecord_pm_job_site',

    FLD_IR_JOB: 'custrecord_p09_ir_job',
    FLD_IR_PROJECT: 'custrecord_p09_ir_project',
    FLD_IR_STATUS: 'custrecord_p09_ir_status',
    FLD_IR_IS_DELETED: 'custrecord_p09_ir_is_deleted',
    FLD_IR_REQUESTOR_EMAIL: 'custrecord_p09_ir_requestor_email',
    FLD_IR_TOTAL: 'custrecord_p09_ir_total',

    // Optional: item category restrictions, etc.
  };
});
