/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['./errors', './constants'], (errors, C) => {

  const asInt = (val, name) => {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n <= 0) throw errors.badRequest('INVALID_INT', `${name} must be a positive integer`);
    return n;
  }

  const asString = (val, name, { min = 1, max = 200 } = {}) => {
    if (typeof val !== 'string') throw errors.badRequest('INVALID_STRING', `${name} must be a string`);
    const s = val.trim();
    if (s.length < min || s.length > max) throw errors.badRequest('INVALID_STRING_LEN', `${name} length invalid`);
    return s;
  }

  const oneOf = (val, name, allowed) => {
    if (!allowed.includes(val)) throw errors.badRequest('INVALID_ENUM', `${name} must be one of: ${allowed.join(', ')}`);
    return val;
  }

  const pageParams = (params) => {
    const page = params.page ? asInt(params.page, 'page') : 1;
    const pageSizeRaw = params.pageSize ? asInt(params.pageSize, 'pageSize') : C.DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(pageSizeRaw, C.MAX_PAGE_SIZE);
    return { page, pageSize };
  }

  // Strict router allowlist
  const RESOURCES = ['projects', 'jobs', 'irs', 'financial-summary', 'users', 'supporting-data'];
  const validateResource = (resource) => {
    return oneOf(resource, 'resource', RESOURCES);
  }

  // IR payload validation (example)
  const validateIrCreate = (body) => {
    if (!body || typeof body !== 'object') throw errors.badRequest('INVALID_BODY', 'Body must be JSON object');
    return {
      requestorEmail: asString(body.requestorEmail || '', 'requestorEmail', { min: 3, max: 254 }),
      // Add additional IR fields you store on the custom record:
      // e.g. description, lines, totals, neededByDate etc.
      total: body.total == null ? null : Number(body.total)
    };
  }

  const validateIrUpdate = (body) => {
    if (!body || typeof body !== 'object') throw errors.badRequest('INVALID_BODY', 'Body must be JSON object');
    const out = {};
    if (body.requestorEmail != null) out.requestorEmail = asString(body.requestorEmail, 'requestorEmail', { min: 3, max: 254 });
    if (body.total != null) out.total = Number(body.total);
    if (Object.keys(out).length === 0) throw errors.badRequest('EMPTY_UPDATE', 'No fields to update');
    return out;
  }

  const validateJobCreate = (body) => {
    if (!body || typeof body !== 'object') throw errors.badRequest('INVALID_BODY', 'Body must be JSON object');
    const out = {
      site: asInt(body.site, 'site')
    };
    if (body.name != null) out.name = asString(String(body.name), 'name', { min: 1, max: 300 });
    if (body.status != null) out.status = asInt(body.status, 'status');
    return out;
  }

  return {
    asInt,
    asString,
    oneOf,
    pageParams,
    validateResource,
    validateIrCreate,
    validateIrUpdate,
    validateJobCreate
  };
});
