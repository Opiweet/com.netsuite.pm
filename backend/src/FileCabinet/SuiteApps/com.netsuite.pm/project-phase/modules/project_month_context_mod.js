/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
  'N/search',
  'N/config',
  'N/runtime',
  '../core/helper',
], (search, config, runtime, helper) => {
  const { getCompanyTimeZone, getYearMonthInTimeZone, monthKey, monthLabel } =
    helper;

  function getCurrentScriptParam(name) {
    try {
      const script = runtime?.getCurrentScript?.();
      if (!script || !name) return '';
      return String(script.getParameter({ name }) || '').trim();
    } catch (_e) {
      return '';
    }
  }

  function parseSimulatedPeriod(raw) {
    const text = String(raw || '')
      .trim()
      .toLowerCase();
    if (!text) return null;
    const m = text.match(
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{4})$/,
    );
    if (!m) return null;
    const monthMap = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };
    const month = monthMap[m[1]] || null;
    const year = Number(m[2]);
    if (!month || !Number.isFinite(year)) return null;
    return { year, month, raw: `${m[1]}-${year}` };
  }

  function periodInfoFromYearMonth({
    year,
    month,
    source = 'current',
    raw = '',
  } = {}) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12)
      return null;
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0);
    return {
      year: y,
      month: m,
      key: monthKey(y, m),
      label: monthLabel(y, m),
      raw: String(raw || '').trim(),
      monthStart,
      monthEnd,
      source,
    };
  }

  function getActualCurrentPeriod() {
    const tz = getCompanyTimeZone(config);
    const now = new Date();
    const ym = getYearMonthInTimeZone(now, tz);
    return periodInfoFromYearMonth({
      year: Number(ym?.year || now.getFullYear()),
      month: Number(ym?.month || now.getMonth() + 1),
      source: 'current',
    });
  }

  function getAppSimulatedPeriod() {
    const parsed = parseSimulatedPeriod(
      getCurrentScriptParam('custscript_pm_simulated_period'),
    );
    if (!parsed) return null;
    return periodInfoFromYearMonth({
      year: parsed.year,
      month: parsed.month,
      source: 'app_override',
      raw: parsed.raw,
    });
  }

  function getProjectSimulatedPeriod(projectId) {
    const pid = String(projectId || '').trim();
    if (!pid) return null;
    try {
      const fields = search.lookupFields({
        type: 'customrecord_pm_projects',
        id: pid,
        columns: ['custrecord_pm_project_sim_month'],
      });
      const raw = String(fields?.custrecord_pm_project_sim_month || '').trim();
      const parsed = parseSimulatedPeriod(raw);
      if (!parsed) return null;
      return periodInfoFromYearMonth({
        year: parsed.year,
        month: parsed.month,
        source: 'project_override',
        raw: parsed.raw,
      });
    } catch (_e) {
      return null;
    }
  }

  function getEffectivePeriodInfo({ projectId } = {}) {
    const actual = getActualCurrentPeriod();
    const appSimulated = getAppSimulatedPeriod();
    const projectSimulated = getProjectSimulatedPeriod(projectId);
    const effective = projectSimulated || appSimulated || actual;
    return {
      actual,
      appSimulated,
      projectSimulated,
      effective,
      source: projectSimulated
        ? 'project_override'
        : appSimulated
          ? 'app_override'
          : 'current',
    };
  }

  return {
    getActualCurrentPeriod,
    getAppSimulatedPeriod,
    getProjectSimulatedPeriod,
    getEffectivePeriodInfo,
    parseSimulatedPeriod,
    periodInfoFromYearMonth,
  };
});
