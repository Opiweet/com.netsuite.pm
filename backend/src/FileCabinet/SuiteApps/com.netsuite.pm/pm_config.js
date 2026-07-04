/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
  const IS_PROD = false; // Set to true for production environment, false for sandbox/testing

  const SUBS = {
    FRANKLIN: IS_PROD ? '19' : '19',
  };

  const SUBSIDIARY = SUBS.FRANKLIN;

  const REV_REC_JNL_BULK_ASYNC_THRESHOLD = 1;

  const ROLE_IDS = {
    ADMINISTRATOR: IS_PROD ? 'administrator' : 'administrator',
    SALES_MANAGER: IS_PROD
      ? 'customrole_rsm_sales_manager_classic'
      : 'customrole_rsm_sales_manager_classic',
    REVENUE_MANAGER: IS_PROD
      ? 'customrole_rsm_revenue_manager'
      : 'customrole_rsm_revenue_manager',
    ACCOUNTING_MANAGER: IS_PROD
      ? 'customrole_rsm_accounting_manager'
      : 'customrole_rsm_accounting_manager',
    ONLINE_USER: IS_PROD ? 'not_available_on_prod' : 'online_form_user',
  };

  const LIST_IDS_BY_ENV = {
    PRODUCTION: {
      PROJECT_STATUS: {
        ACTIVE: '7',
      },
      REV_PLAN_STATUS: {
        OPEN: '1',
        REV_REC_READY: '2',
        CANCELLED: '3',
        COMPLETED: '4',
      },
      REV_PLAN_TYPE: {
        ACTUAL: '1',
        FORECAST: '2',
      },
      REV_REC_STATUS: {
        OPEN: '1',
        READY: '2',
      },
      REV_REC_TYPE: {
        ACTUAL: '1',
        FORECAST: '2',
      },
      ITEM_PRODUCT_FAMILY: {
        MILESTONE: '6',
      },
      PHASE_STATUS: {
        REV_PLAN_CREATED: '2',
      },
    },
    SANDBOX: {
      PROJECT_STATUS: {
        ACTIVE: '7',
      },
      REV_PLAN_STATUS: {
        OPEN: '1',
        REV_REC_READY: '2',
        CANCELLED: '3',
        COMPLETED: '4',
      },
      REV_PLAN_TYPE: {
        ACTUAL: '1',
        FORECAST: '2',
      },
      REV_REC_STATUS: {
        OPEN: '1',
        READY: '2',
      },
      REV_REC_TYPE: {
        ACTUAL: '1',
        FORECAST: '2',
      },
      ITEM_PRODUCT_FAMILY: {
        MILESTONE: '6',
      },
      PHASE_STATUS: {
        REV_PLAN_CREATED: '2',
      },
    },
  };

  const LIST_IDS = IS_PROD
    ? LIST_IDS_BY_ENV.PRODUCTION
    : LIST_IDS_BY_ENV.SANDBOX;

  return {
    IS_PROD,
    SUBS,
    REV_REC_JNL_BULK_ASYNC_THRESHOLD,
    ROLE_IDS,
    SUBSIDIARY,
    LIST_IDS,
  };
});
