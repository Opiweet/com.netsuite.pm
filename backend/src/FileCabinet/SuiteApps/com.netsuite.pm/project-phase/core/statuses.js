/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['./helper'], (helper) => {
  const { toId, normalizeLower } = helper;

  const ENTITY_TYPES = Object.freeze({
    PROJECT: 'project',
    PHASE: 'phase',
    REVPLAN: 'revplan',
  });

  const PROJECT_STATUS_KEYS = Object.freeze({
    DRAFT: 'draft',
    ACTIVE: 'active',
    ON_HOLD: 'on_hold',
    COMPLETED: 'completed',
    CLOSED: 'closed',
  });

  const PHASE_STATUS_KEYS = Object.freeze({
    PENDING: 'pending',
    REV_PLAN_CREATED: 'rev_plan_created',
  });

  const REVPLAN_STATUS_KEYS = Object.freeze({
    OPEN: 'open',
    REV_REC_READY: 'rev_rec_ready',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  });

  const PROJECT_STATUS_LABEL_BY_KEY = Object.freeze({
    [PROJECT_STATUS_KEYS.DRAFT]: 'Draft',
    [PROJECT_STATUS_KEYS.ACTIVE]: 'Active',
    [PROJECT_STATUS_KEYS.ON_HOLD]: 'On Hold',
    [PROJECT_STATUS_KEYS.COMPLETED]: 'Completed',
    [PROJECT_STATUS_KEYS.CLOSED]: 'Closed',
  });

  const PHASE_STATUS_LABEL_BY_KEY = Object.freeze({
    [PHASE_STATUS_KEYS.PENDING]: 'Pending',
    [PHASE_STATUS_KEYS.REV_PLAN_CREATED]: 'Rev Plan Created',
  });

  const REVPLAN_STATUS_LABEL_BY_KEY = Object.freeze({
    [REVPLAN_STATUS_KEYS.OPEN]: 'Open',
    [REVPLAN_STATUS_KEYS.REV_REC_READY]: 'Rev Rec Ready',
    [REVPLAN_STATUS_KEYS.COMPLETED]: 'Completed',
    [REVPLAN_STATUS_KEYS.CANCELLED]: 'Cancelled',
  });

  function toPhaseStatusKey(text) {
    const raw = normalizeLower(text);
    if (!raw) return '';
    if (raw.includes('pending')) return PHASE_STATUS_KEYS.PENDING;
    if (raw.includes('rev plan created'))
      return PHASE_STATUS_KEYS.REV_PLAN_CREATED;
    return '';
  }

  function toProjectStatusKey(text) {
    const raw = normalizeLower(text);
    if (!raw) return '';
    if (raw.includes('draft')) return PROJECT_STATUS_KEYS.DRAFT;
    if (raw.includes('on hold') || raw.includes('onhold')) {
      return PROJECT_STATUS_KEYS.ON_HOLD;
    }
    if (raw.includes('active')) return PROJECT_STATUS_KEYS.ACTIVE;
    if (raw.includes('complete')) return PROJECT_STATUS_KEYS.COMPLETED;
    if (raw.includes('close')) return PROJECT_STATUS_KEYS.CLOSED;
    if (raw.includes('approved')) return PROJECT_STATUS_KEYS.ACTIVE;
    if (raw.includes('pending')) return PROJECT_STATUS_KEYS.DRAFT;
    if (raw.includes('reject')) return PROJECT_STATUS_KEYS.DRAFT;
    return '';
  }

  function normalizeRevPlanRawKey(value) {
    const raw = normalizeLower(value)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
    if (!raw) return '';
    if (raw === 'revrec_ready') return REVPLAN_STATUS_KEYS.REV_REC_READY;
    if (raw === 'rev_rec_ready') return REVPLAN_STATUS_KEYS.REV_REC_READY;
    if (raw === 'open') return REVPLAN_STATUS_KEYS.OPEN;
    if (raw === 'completed') return REVPLAN_STATUS_KEYS.COMPLETED;
    if (raw === 'cancelled' || raw === 'canceled') {
      return REVPLAN_STATUS_KEYS.CANCELLED;
    }
    return '';
  }

  function toRevPlanStatusKey({ id, text } = {}) {
    const byText = normalizeRevPlanRawKey(text);
    if (byText) return byText;
    const byId = normalizeRevPlanRawKey(id);
    if (byId) return byId;
    return '';
  }

  function keyToLabel(entityType, key) {
    const entity = String(entityType || '').trim();
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return '';

    if (entity === ENTITY_TYPES.PROJECT) {
      return PROJECT_STATUS_LABEL_BY_KEY[normalizedKey] || normalizedKey;
    }
    if (entity === ENTITY_TYPES.PHASE) {
      return PHASE_STATUS_LABEL_BY_KEY[normalizedKey] || normalizedKey;
    }
    if (entity === ENTITY_TYPES.REVPLAN) {
      return REVPLAN_STATUS_LABEL_BY_KEY[normalizedKey] || normalizedKey;
    }
    return normalizedKey;
  }

  function fromNetSuiteStatus(entityType, { id, text } = {}) {
    const entity = String(entityType || '').trim();
    const statusId = toId(id);
    const statusText = String(text || '').trim();

    let key = '';
    if (entity === ENTITY_TYPES.PROJECT) key = toProjectStatusKey(statusText);
    if (entity === ENTITY_TYPES.PHASE) key = toPhaseStatusKey(statusText);
    if (entity === ENTITY_TYPES.REVPLAN) {
      key = toRevPlanStatusKey({ id: statusId, text: statusText });
    }

    const known = Boolean(key);
    const resolvedKey = known ? key : '';

    return {
      id: statusId,
      key: resolvedKey,
      label: keyToLabel(entity, resolvedKey),
      known,
      rawText: statusText,
    };
  }

  function buildStatusMappingMissingError({
    entityType,
    statusId,
    statusText,
  }) {
    const err = new Error(
      `NetSuite status mapping is missing for ${entityType} status.`,
    );
    err.name = 'STATUS_MAPPING_MISSING';
    err.details = {
      entityType: String(entityType || '').trim(),
      status: {
        id: String(statusId || ''),
        text: String(statusText || ''),
      },
    };
    return err;
  }

  function mapNetSuiteStatusStrict(
    entityType,
    { id, text, contextAction = '', logger = null, logTitle = '' } = {},
  ) {
    const mapped = toStatusPayload(entityType, { id, text });
    if (mapped.known) return mapped;

    const statusId = toId(id);
    const statusText = String(text || '').trim();
    const context = String(contextAction || '').trim();
    if (logger && typeof logger.error === 'function') {
      const details = {
        entityType: String(entityType || '').trim(),
        statusId,
        statusText,
      };
      if (context) details.contextAction = context;
      logger.error({
        title: String(logTitle || 'STATUS_MAPPING_UNKNOWN_READ'),
        details,
      });
    }

    throw buildStatusMappingMissingError({
      entityType,
      statusId,
      statusText,
    });
  }

  function statusLabelForKey(entityType, key) {
    return keyToLabel(entityType, key);
  }

  function toStatusPayload(entityType, { id, text } = {}) {
    return fromNetSuiteStatus(entityType, { id, text });
  }

  function isKnownStatusKey(entityType, key) {
    const entity = String(entityType || '').trim();
    const k = String(key || '').trim();
    if (!k) return false;
    if (entity === ENTITY_TYPES.PROJECT) {
      return Object.values(PROJECT_STATUS_KEYS).includes(k);
    }
    if (entity === ENTITY_TYPES.PHASE) {
      return Object.values(PHASE_STATUS_KEYS).includes(k);
    }
    if (entity === ENTITY_TYPES.REVPLAN) {
      return Object.values(REVPLAN_STATUS_KEYS).includes(k);
    }
    return false;
  }

  function getProjectTransitionViolation(fromStatusKey, transition) {
    const fromKey = String(fromStatusKey || '').trim();
    const action = String(transition || '')
      .trim()
      .toLowerCase();

    if (action === 'activate') return '';

    if (action === 'on_hold') {
      if (isTerminalProjectStatus(fromKey)) {
        return 'Completed or Closed project cannot be put On Hold.';
      }
      if (fromKey === PROJECT_STATUS_KEYS.ON_HOLD) {
        return 'Project is already On Hold.';
      }
      if (fromKey !== PROJECT_STATUS_KEYS.ACTIVE) {
        return 'Only Active projects can be put On Hold.';
      }
      return '';
    }

    if (action === 'complete') {
      if (isCompletedProjectStatus(fromKey)) {
        return 'Project is already Completed.';
      }
      if (isClosedProjectStatus(fromKey)) return 'Project is already Closed.';
      return '';
    }

    if (action === 'close') {
      if (isClosedProjectStatus(fromKey)) return 'Project is already Closed.';
      return '';
    }

    return 'Unsupported transition. Use activate, on_hold, complete, or close.';
  }

  function isOperationalProjectStatus(key) {
    const k = String(key || '').trim();
    return (
      k === PROJECT_STATUS_KEYS.ACTIVE || k === PROJECT_STATUS_KEYS.ON_HOLD
    );
  }

  function isCompletedProjectStatus(key) {
    const k = String(key || '').trim();
    return k === PROJECT_STATUS_KEYS.COMPLETED;
  }

  function isClosedProjectStatus(key) {
    const k = String(key || '').trim();
    return k === PROJECT_STATUS_KEYS.CLOSED;
  }

  function isTerminalProjectStatus(key) {
    const k = String(key || '').trim();
    return isCompletedProjectStatus(k) || isClosedProjectStatus(k);
  }

  function isFrozenProjectStatus(key) {
    return isClosedProjectStatus(key);
  }

  function isRevPlanEditableStatus(key, monthCtx = {}) {
    const k = String(key || '').trim();
    if (k === REVPLAN_STATUS_KEYS.COMPLETED) return false;

    const planMonthNum = Number(monthCtx?.planMonthNum || 0);
    const currentMonthNum = Number(monthCtx?.currentMonthNum || 0);
    if (
      k === REVPLAN_STATUS_KEYS.REV_REC_READY &&
      Number.isFinite(planMonthNum) &&
      Number.isFinite(currentMonthNum) &&
      planMonthNum > 0 &&
      currentMonthNum > 0 &&
      planMonthNum < currentMonthNum
    ) {
      return false;
    }

    return true;
  }

  return {
    ENTITY_TYPES,
    PROJECT_STATUS_KEYS,
    PHASE_STATUS_KEYS,
    REVPLAN_STATUS_KEYS,
    fromNetSuiteStatus,
    buildStatusMappingMissingError,
    mapNetSuiteStatusStrict,
    toStatusPayload,
    isKnownStatusKey,
    getProjectTransitionViolation,
    statusLabelForKey,
    isOperationalProjectStatus,
    isCompletedProjectStatus,
    isClosedProjectStatus,
    isTerminalProjectStatus,
    isFrozenProjectStatus,
    isRevPlanEditableStatus,
  };
});
