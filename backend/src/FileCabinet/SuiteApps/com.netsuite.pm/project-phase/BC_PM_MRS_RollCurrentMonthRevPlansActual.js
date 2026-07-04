/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define([
  'N/record',
  'N/query',
  'N/log',
  'N/config',
  'N/runtime',
  './core/helper',
  '../pm_config',
], (record, query, log, config, runtime, helper, pmConfig) => {
  const { formatDateForSQL, runSuiteQLMax } = helper;

  function safeError(e) {
    return {
      name: e?.name || '',
      message: e?.message || String(e || ''),
      stack: e?.stack || '',
    };
  }

  function getCurrentScriptParam(name) {
    try {
      const script = runtime?.getCurrentScript?.();
      if (!script || !name) return '';
      const value = String(script.getParameter({ name }) || '').trim();
      log.debug({
        title: 'REVPLAN_ROLLOVER_SCRIPT_PARAM',
        details: { name, value: value || null },
      });
      return value;
    } catch (e) {
      log.error({
        title: 'REVPLAN_ROLLOVER_SCRIPT_PARAM_ERROR',
        details: { name, error: safeError(e) },
      });
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
    const year = Number(m[2]);
    const month = Number(monthMap[m[1]] || 0);
    if (!year || !month) return null;
    return { year, month };
  }

  function getEffectiveYearMonth() {
    const simulatedRaw = getCurrentScriptParam(
      'custscript_pm_sim_period_rollrevplan',
    );
    const simulated = parseSimulatedPeriod(simulatedRaw);
    if (simulated) {
      log.audit({
        title: 'REVPLAN_ROLLOVER_EFFECTIVE_PERIOD',
        details: {
          source: 'SCRIPT_PARAM',
          simulatedRaw,
          year: simulated.year,
          month: simulated.month,
        },
      });
      return { ...simulated, simulatedRaw };
    }
    const current = getCompanyYearMonth();
    log.audit({
      title: 'REVPLAN_ROLLOVER_EFFECTIVE_PERIOD',
      details: {
        source: simulatedRaw
          ? 'INVALID_SCRIPT_PARAM_FALLBACK'
          : 'COMPANY_TIMEZONE',
        simulatedRaw: simulatedRaw || null,
        year: current.year,
        month: current.month,
      },
    });
    return { ...current, simulatedRaw: '' };
  }

  function isActualTypeFromRow(row, actualTypeId) {
    const value = String(row?.typeId || '').trim();
    return Boolean(value) && value === String(actualTypeId);
  }

  function runRevPlanSuiteQLRows(sql, queryId) {
    try {
      const rawRows = runSuiteQLMax({ query: sql }, query) || [];
      const out = [];
      rawRows.forEach((row) => {
        const values = Array.isArray(row?.values) ? row.values : [];
        const id = String(values[0] || '').trim();
        const typeId = String(values[1] || '').trim();
        if (!id) return;
        out.push({ id, typeId });
      });
      log.audit({
        title: 'REVPLAN_ROLLOVER_SUITEQL_OK',
        details: { queryId, rowCount: out.length },
      });
      return out;
    } catch (e) {
      log.error({
        title: 'REVPLAN_ROLLOVER_SUITEQL_FAILED',
        details: { queryId, sql, error: safeError(e) },
      });
      return [];
    }
  }

  function getCompanyYearMonth() {
    const now = new Date();
    let timeZone = null;
    try {
      const company = config.load({ type: config.Type.COMPANY_INFORMATION });
      timeZone = company.getValue({ fieldId: 'timezone' }) || null;
    } catch (e) {
      log.error({
        title: 'REVPLAN_ROLLOVER_COMPANY_TZ_LOAD_FAILED',
        details: { error: safeError(e) },
      });
    }

    if (!timeZone) {
      log.debug({
        title: 'REVPLAN_ROLLOVER_COMPANY_YM',
        details: {
          source: 'SYSTEM_DATE_FALLBACK',
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
      });
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }

    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
      }).formatToParts(now);
      const year = Number(
        parts.find((p) => p.type === 'year')?.value || now.getFullYear(),
      );
      const month = Number(
        parts.find((p) => p.type === 'month')?.value || now.getMonth() + 1,
      );
      log.debug({
        title: 'REVPLAN_ROLLOVER_COMPANY_YM',
        details: { source: 'COMPANY_TIMEZONE', timeZone, year, month },
      });
      return { year, month };
    } catch (e) {
      log.error({
        title: 'REVPLAN_ROLLOVER_COMPANY_YM_PARSE_FAILED',
        details: { timeZone, error: safeError(e) },
      });
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }
  }

  function monthRangeFor(year, month) {
    return {
      monthStart: new Date(year, month - 1, 1),
      monthEnd: new Date(year, month, 0),
    };
  }

  function getInputData() {
    const actualTypeId =
      pmConfig?.LIST_IDS?.REV_PLAN_TYPE?.ACTUAL != null
        ? Number(pmConfig.LIST_IDS.REV_PLAN_TYPE.ACTUAL)
        : 1;
    const forecastTypeId =
      pmConfig?.LIST_IDS?.REV_PLAN_TYPE?.FORECAST != null
        ? Number(pmConfig.LIST_IDS.REV_PLAN_TYPE.FORECAST)
        : 2;
    const actualTypeIdSql =
      Number.isFinite(actualTypeId) && actualTypeId > 0
        ? Math.trunc(actualTypeId)
        : 1;
    const { year, month, simulatedRaw } = getEffectiveYearMonth();
    const { monthStart, monthEnd } = monthRangeFor(year, month);
    const monthEndSql = formatDateForSQL(monthEnd);
    const forecastTypeIdText = String(forecastTypeId);

    log.audit({
      title: 'REVPLAN_ROLLOVER_INPUT',
      details: {
        year,
        month,
        monthStart,
        monthEnd,
        monthEndSql: monthEndSql || null,
        actualTypeId,
        actualTypeIdSql,
        forecastTypeId,
        simulatedPeriod: simulatedRaw || null,
      },
    });

    if (!monthEndSql) {
      log.error({
        title: 'REVPLAN_ROLLOVER_INVALID_MONTH_END_SQL',
        details: { monthEnd },
      });
      return [];
    }

    const currentMonthSql = `
        SELECT
          rp.id,
          rp.custrecord_pm_revplan_type
        FROM customrecord_pm_revenue_plan rp
        WHERE rp.isinactive = 'F'
          AND rp.custrecord_pm_revplan_period = TO_DATE('${monthEndSql}', 'YYYY-MM-DD')
          AND (
            rp.custrecord_pm_revplan_type IS NULL
            OR rp.custrecord_pm_revplan_type <> ${actualTypeIdSql}
          )
        ORDER BY rp.id
      `;
    const futureMonthSql = `
        SELECT
          rp.id,
          rp.custrecord_pm_revplan_type
        FROM customrecord_pm_revenue_plan rp
        WHERE rp.isinactive = 'F'
          AND rp.custrecord_pm_revplan_period > TO_DATE('${monthEndSql}', 'YYYY-MM-DD')
          AND rp.custrecord_pm_revplan_type = ${actualTypeIdSql}
        ORDER BY rp.id
      `;

    const currentMonthForecastRows = runRevPlanSuiteQLRows(
      currentMonthSql,
      'CURRENT_MONTH_REVPLAN_ROWS',
    );
    const futureMonthActualRows = runRevPlanSuiteQLRows(
      futureMonthSql,
      'FUTURE_MONTH_REVPLAN_ROWS',
    );

    let currentMonthActualCount = 0;
    let currentMonthNonActualCount = 0;
    currentMonthForecastRows.forEach((row) => {
      if (isActualTypeFromRow(row, actualTypeId)) currentMonthActualCount++;
      else currentMonthNonActualCount++;
    });

    let futureMonthActualCount = 0;
    let futureMonthNonActualCount = 0;
    futureMonthActualRows.forEach((row) => {
      if (isActualTypeFromRow(row, actualTypeId)) futureMonthActualCount++;
      else futureMonthNonActualCount++;
    });

    log.audit({
      title: 'REVPLAN_ROLLOVER_SEARCH_BREAKDOWN',
      details: {
        currentMonthRowsTotal: currentMonthForecastRows.length,
        currentMonthActualCount,
        currentMonthNonActualCount,
        futureMonthRowsTotal: futureMonthActualRows.length,
        futureMonthActualCount,
        futureMonthNonActualCount,
        monthStart,
        monthEnd,
      },
    });

    const seen = {};
    const out = [];
    currentMonthForecastRows.forEach((row) => {
      const id = String(row?.id || '').trim();
      const isActual = isActualTypeFromRow(row, actualTypeId);
      if (isActual) return;
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push({
        id,
        targetTypeId: String(actualTypeId),
        targetTypeKey: 'ACTUAL',
        reason: 'CURRENT_MONTH_SHOULD_BE_ACTUAL',
      });
    });
    futureMonthActualRows.forEach((row) => {
      const id = String(row?.id || '').trim();
      const isActual = isActualTypeFromRow(row, actualTypeId);
      if (!isActual) return;
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push({
        id,
        targetTypeId: forecastTypeIdText,
        targetTypeKey: 'FORECAST',
        reason: 'FUTURE_MONTH_SHOULD_BE_FORECAST',
      });
    });

    log.audit({
      title: 'REVPLAN_ROLLOVER_CANDIDATES',
      details: {
        currentMonthToActual: currentMonthNonActualCount,
        futureMonthToForecast: futureMonthActualCount,
        total: out.length,
        sampleCandidateIds: out.slice(0, 20).map((x) => x.id),
      },
    });

    return out;
  }

  function map(context) {
    let id = '';
    let targetTypeId = '';
    let targetTypeKey = '';
    let reason = '';
    try {
      const parsed = JSON.parse(context.value || '{}');
      id = String(parsed?.id || '').trim();
      targetTypeId = String(parsed?.targetTypeId || '').trim();
      targetTypeKey = String(parsed?.targetTypeKey || '').trim();
      reason = String(parsed?.reason || '').trim();
    } catch (e) {
      log.error({
        title: 'REVPLAN_ROLLOVER_MAP_PARSE_FAILED',
        details: { rawValue: context.value || '', error: safeError(e) },
      });
      id = '';
    }
    if (!id || !targetTypeId) {
      log.debug({
        title: 'REVPLAN_ROLLOVER_MAP_SKIP_INVALID_INPUT',
        details: { id, targetTypeId, targetTypeKey, reason },
      });
      return;
    }

    try {
      log.debug({
        title: 'REVPLAN_ROLLOVER_MAP_UPDATE_START',
        details: { id, targetTypeId, targetTypeKey, reason },
      });
      record.submitFields({
        type: 'customrecord_pm_revenue_plan',
        id,
        values: { custrecord_pm_revplan_type: Number(targetTypeId) },
        options: { enableSourcing: false, ignoreMandatoryFields: true },
      });
      log.debug({
        title: 'REVPLAN_ROLLOVER_MAP_UPDATE_SUCCESS',
        details: { id, targetTypeId, targetTypeKey, reason },
      });
      context.write({
        key: `updated_${targetTypeKey || 'UNKNOWN'}`,
        value: JSON.stringify({ id, reason }),
      });
    } catch (e) {
      log.error({
        title: 'REVPLAN_ROLLOVER_UPDATE_FAILED',
        details: {
          id,
          targetTypeId,
          targetTypeKey,
          reason,
          error: safeError(e),
        },
      });
      context.write({
        key: 'error',
        value: JSON.stringify({
          id,
          targetTypeId,
          targetTypeKey,
          reason,
          name: e?.name || '',
          message: e?.message || String(e),
        }),
      });
    }
  }

  function summarize(summary) {
    let updatedActual = 0;
    let updatedForecast = 0;
    let updatedOther = 0;
    let outputErrors = 0;
    let mapErrors = 0;

    try {
      summary.output.iterator().each((key) => {
        if (key === 'updated_ACTUAL') updatedActual++;
        else if (key === 'updated_FORECAST') updatedForecast++;
        else if (String(key || '').indexOf('updated_') === 0) updatedOther++;
        else if (key === 'error') outputErrors++;
        return true;
      });
    } catch (e) {
      // ignore
    }

    try {
      summary.mapSummary.errors.iterator().each(() => {
        mapErrors++;
        return true;
      });
    } catch (e) {
      // ignore
    }

    log.audit({
      title: 'REVPLAN_ROLLOVER_SUMMARY',
      details: {
        usage: summary.usage,
        concurrency: summary.concurrency,
        yields: summary.yields,
        updatedActual,
        updatedForecast,
        updatedOther,
        updated: updatedActual + updatedForecast + updatedOther,
        outputErrors,
        mapErrors,
      },
    });
  }

  return { getInputData, map, summarize };
});
