/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['./helper'], (H) => {
  const createHandler = ({ errors, logService }) => {
    return (method, context, fn) => {
      const requestId = context && context.requestId ? String(context.requestId) : H.buildRequestId();
      const resource = context && context.resource ? String(context.resource) : null;
      const action = context && context.action ? String(context.action) : (method === 'GET' ? 'read' : null);
      const uid = context && context.uid ? String(context.uid) : null;
      const clientInfo = context && context.clientInfo && typeof context.clientInfo === 'object'
        ? context.clientInfo
        : null;
      const actionLog = logService.createActionLogger({
        source: 'restlet',
        resource,
        action,
        uid,
        requestId,
        clientInfo,
        requestPayload: context
      });

      try {
        const response = fn(actionLog);
        actionLog.info('API_REQUEST_SUCCESS', {
          status: 'SUCCESS',
          responsePayload: response
        });
        return response;
      } catch (e) {
        log.error({
          title: 'RESTLET_UNHANDLED_ERROR',
          details: {
            method,
            resource: context && context.resource ? String(context.resource) : null,
            action: context && context.action ? String(context.action) : null,
            id: context && context.id ? String(context.id) : null,
            uid: context && context.uid ? String(context.uid) : null,
            name: e && e.name ? e.name : 'Error',
            code: e && e.code ? e.code : null,
            message: e && e.message ? e.message : String(e),
            stack: e && e.stack ? e.stack : null
          }
        });
        const errorResponse = errors.toResponse(e);
        actionLog.error('API_REQUEST_FAILED', {
          status: 'FAIL',
          errorCode: e && e.code ? e.code : null,
          errorMessage: e && e.message ? e.message : String(e),
          stack: e && e.stack ? e.stack : null,
          responsePayload: errorResponse
        });
        return errorResponse;
      }
    };
  }

  return { createHandler };
});
