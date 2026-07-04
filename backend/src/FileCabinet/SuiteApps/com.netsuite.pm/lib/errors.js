/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
  class HttpError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details || null;
    }
  }

  const badRequest = (code, message, details) => { return new HttpError(400, code, message, details); }
  const unauthorized = (code, message) => { return new HttpError(401, code, message); }
  const forbidden = (code, message) => { return new HttpError(403, code, message); }
  const notFound = (code, message) => { return new HttpError(404, code, message); }
  const conflict = (code, message, details) => { return new HttpError(409, code, message, details); }
  const serverError = (code, message) => { return new HttpError(500, code, message); }

  const toResponse = (err)  => {
    const status = err && err.status ? err.status : 500;
    const code = err && err.code ? err.code : 'UNHANDLED';
    const message = err && err.message ? err.message : 'Unexpected error';
    return {
      ok: false,
      error: { code, message },
      // only include details for 4xx
      details: status >= 500 ? null : (err.details || null)
    };
  }

  return { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, serverError, toResponse };
});
