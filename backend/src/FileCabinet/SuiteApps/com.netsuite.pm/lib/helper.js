/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
  const normalize = str => {
    return String(str || '').trim().toLowerCase();
  }

  const toInt = (val, fallback = 0) => {
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  const toBoolean = val => {
    return val === true || val === 'T';
  }

  const asBool = val => {
    return val === true || val === 'true' || val === 1 || val === '1';
  }

  const buildRequestId = () => {
    return `REQ-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  }

  const toMultiSelectIds = arr => {
    if (!Array.isArray(arr)) return [];
    return arr.map(x => String(x.value));
  }

  const toMultiSelectText = arr => {
    if (!Array.isArray(arr)) return [];
    return arr.map(x => String(x.text));
  }

  return {
    normalize,
    toInt,
    toBoolean,
    asBool,
    buildRequestId,
    toMultiSelectIds,
    toMultiSelectText
  };
});
