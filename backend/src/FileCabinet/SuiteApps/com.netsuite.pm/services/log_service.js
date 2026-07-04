/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/record'], (record) => {
  const REC_LOG = 'customrecord_pm_logs';

  const FIELDS = {
    eventTime: 'custrecord_pm_log_event_time',
    level: 'custrecord_pm_log_level',
    eventType: 'custrecord_pm_log_event_type',
    source: 'custrecord_pm_log_source',
    resource: 'custrecord_pm_log_resource',
    action: 'custrecord_pm_log_action',
    uid: 'custrecord_pm_log_uid',
    requestId: 'custrecord_pm_log_request_id',
    status: 'custrecord_pm_log_status',
    errorCode: 'custrecord_pm_log_error_code',
    errorMessage: 'custrecord_pm_log_error_message',
    requestPayload: 'custrecord_pm_log_request_payload',
    responsePayload: 'custrecord_pm_log_response_payload',
    stack: 'custrecord_pm_log_stack',
    clientInfo: 'custrecord_pm_log_client_info'
  };

  const SENSITIVE_KEYS = {
    password: true,
    signature: true,
    token: true,
    authorization: true,
    'x-api-key': true,
    sid: true
  };

  const safeString = (value, maxLen) => {
    if (value == null) return '';
    const s = String(value);
    return maxLen && s.length > maxLen ? s.slice(0, maxLen) : s;
  }

  const redact = (value) => {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map(redact);
    if (typeof value !== 'object') return value;

    const out = {};
    Object.keys(value).forEach((k) => {
      const lowered = String(k || '').toLowerCase();
      if (SENSITIVE_KEYS[lowered]) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(value[k]);
      }
    });
    return out;
  }

  const toJson = (value, maxLen) => {
    if (value == null) return '';
    try {
      return safeString(JSON.stringify(redact(value)), maxLen || 100000);
    } catch (_) {
      return safeString(String(value), maxLen || 100000);
    }
  }

  const normalizeUid = (uid) => {
    if (uid == null || uid === '') return null;
    const s = String(uid).trim();
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const createName = (eventType, requestId) => {
    const base = `${safeString(eventType || 'API_EVENT', 40)} ${new Date().toISOString()}`;
    if (!requestId) return safeString(base, 200);
    return safeString(`${base} ${safeString(requestId, 40)}`, 200);
  }

  const write = (payload) => {
    try {
      const rec = record.create({ type: REC_LOG, isDynamic: true });

      rec.setValue({ fieldId: 'name', value: createName(payload.eventType, payload.requestId) });
      rec.setValue({ fieldId: FIELDS.eventTime, value: payload.eventTime || new Date() });
      rec.setValue({ fieldId: FIELDS.level, value: safeString(payload.level || 'INFO', 30) });
      rec.setValue({ fieldId: FIELDS.eventType, value: safeString(payload.eventType || 'API_EVENT', 120) });
      rec.setValue({ fieldId: FIELDS.source, value: safeString(payload.source || 'restlet', 30) });

      if (payload.resource != null) rec.setValue({ fieldId: FIELDS.resource, value: safeString(payload.resource, 50) });
      if (payload.action != null) rec.setValue({ fieldId: FIELDS.action, value: safeString(payload.action, 60) });
      if (payload.requestId != null) rec.setValue({ fieldId: FIELDS.requestId, value: safeString(payload.requestId, 120) });
      if (payload.status != null) rec.setValue({ fieldId: FIELDS.status, value: safeString(payload.status, 30) });
      if (payload.errorCode != null) rec.setValue({ fieldId: FIELDS.errorCode, value: safeString(payload.errorCode, 120) });
      if (payload.errorMessage != null) rec.setValue({ fieldId: FIELDS.errorMessage, value: safeString(payload.errorMessage, 100000) });
      if (payload.requestPayload != null) rec.setValue({ fieldId: FIELDS.requestPayload, value: toJson(payload.requestPayload, 100000) });
      if (payload.responsePayload != null) rec.setValue({ fieldId: FIELDS.responsePayload, value: toJson(payload.responsePayload, 100000) });
      if (payload.stack != null) rec.setValue({ fieldId: FIELDS.stack, value: safeString(payload.stack, 100000) });
      if (payload.clientInfo != null) rec.setValue({ fieldId: FIELDS.clientInfo, value: toJson(payload.clientInfo, 100000) });

      const uid = normalizeUid(payload.uid);
      if (uid != null) rec.setValue({ fieldId: FIELDS.uid, value: uid });

      rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
    } catch (e) {
      // Logging failures must not break the API flow.
      log.error({
        title: 'PM_LOG_WRITE_FAILED',
        details: {
          message: e && e.message ? e.message : String(e),
          payloadMeta: {
            eventType: payload && payload.eventType ? payload.eventType : null,
            resource: payload && payload.resource ? payload.resource : null,
            action: payload && payload.action ? payload.action : null
          }
        }
      });
    }
  }

  const createActionLogger = (baseContext) => {
    const base = baseContext && typeof baseContext === 'object' ? { ...baseContext } : {};

    const emit = (level, eventType, payload) => {
      write({
        ...base,
        ...(payload && typeof payload === 'object' ? payload : {}),
        level,
        eventType
      });
    };

    return {
      info: (eventType, payload) => emit('INFO', eventType, payload),
      warn: (eventType, payload) => emit('WARN', eventType, payload),
      error: (eventType, payload) => emit('ERROR', eventType, payload),
      security: (eventType, payload) => emit('SECURITY', eventType, payload)
    };
  }

  return { write, createActionLogger };
});
