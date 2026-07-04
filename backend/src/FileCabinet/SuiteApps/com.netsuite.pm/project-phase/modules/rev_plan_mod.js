/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
  'N/search',
  'N/query',
  'N/config',
  'N/runtime',
  'N/record',
  '../../pm_config',
  '../core/helper',
  '../core/statuses',
  './project_financials_mod',
  '../core/validator',
  './rev_rec_mod',
  './project_month_context_mod',
], (
  search,
  query,
  config,
  runtime,
  record,
  pmConfig,
  helper,
  statuses,
  projectFinancialsMod,
  validator,
  revRecMod,
  projectMonthContextMod,
) => {
  const {
    chunkArray,
    formatDateForSQL,
    getCompanyTimeZone,
    getAllResults,
    getYearMonthInTimeZone,
    iterateMonthsInclusive,
    monthKey,
    monthKeyNumberFromKey,
    monthLabel,
    parseDateAny,
    toNumber,
  } = helper;
  const { getEffectivePeriodInfo: getEffectivePeriodContext } =
    projectMonthContextMod;

  const revPlanStatusTextByIdCache = {};

  function getRevPlanStatusTextById(statusId) {
    const id = String(statusId || '').trim();
    if (!id) return '';
    if (id in revPlanStatusTextByIdCache) return revPlanStatusTextByIdCache[id];
    try {
      const fields = search.lookupFields({
        type: 'customlist_pm_revplan_status',
        id,
        columns: ['name'],
      });
      revPlanStatusTextByIdCache[id] = String(fields?.name || '').trim();
    } catch (_e) {
      revPlanStatusTextByIdCache[id] = '';
    }
    return revPlanStatusTextByIdCache[id];
  }

  function mapRevPlanStatusStrict({ id, text, contextAction = '' } = {}) {
    const statusId = String(id || '').trim();
    const statusText =
      String(text || '').trim() || getRevPlanStatusTextById(statusId);
    return statuses.mapNetSuiteStatusStrict(statuses.ENTITY_TYPES.REVPLAN, {
      id: statusId,
      text: statusText,
      contextAction,
      logger: log,
      logTitle: 'STATUS_MAPPING_UNKNOWN',
    });
  }

  function normalizeRevPlanStatusKey(value) {
    const mapped = statuses.toStatusPayload(statuses.ENTITY_TYPES.REVPLAN, {
      id: String(value || ''),
      text: String(value || ''),
    });
    if (!mapped.known) return '';
    return statuses.isKnownStatusKey(statuses.ENTITY_TYPES.REVPLAN, mapped.key)
      ? mapped.key
      : '';
  }

  function revPlanStatusLabelForKey(key) {
    if (!statuses.isKnownStatusKey(statuses.ENTITY_TYPES.REVPLAN, key)) {
      return statuses.statusLabelForKey(
        statuses.ENTITY_TYPES.REVPLAN,
        statuses.REVPLAN_STATUS_KEYS.OPEN,
      );
    }
    return statuses.statusLabelForKey(statuses.ENTITY_TYPES.REVPLAN, key);
  }

  function isRevenueReadyStatusKey(statusValueKey) {
    const key = normalizeRevPlanStatusKey(statusValueKey);
    return (
      key === statuses.REVPLAN_STATUS_KEYS.OPEN ||
      key === statuses.REVPLAN_STATUS_KEYS.REV_REC_READY
    );
  }

  function getRevPlanEditLock({
    statusValueKey,
    planMonthKey,
    currentMonthNum,
  }) {
    const key = normalizeRevPlanStatusKey(statusValueKey);
    if (key === statuses.REVPLAN_STATUS_KEYS.COMPLETED) {
      return {
        isLockedForEdit: true,
        lockReason: 'Completed revenue plans are locked for editing.',
      };
    }

    const planNum = monthKeyNumberFromKey(planMonthKey);
    if (
      key === statuses.REVPLAN_STATUS_KEYS.REV_REC_READY &&
      planNum != null &&
      currentMonthNum != null &&
      planNum < currentMonthNum
    ) {
      return {
        isLockedForEdit: true,
        lockReason:
          'Previous-month Rev Rec Ready revenue plans are locked for editing.',
      };
    }

    return { isLockedForEdit: false, lockReason: '' };
  }

  function getCurrentScriptParam(name) {
    try {
      const script = runtime?.getCurrentScript?.();
      if (!script || !name) return '';
      return String(script.getParameter({ name }) || '').trim();
    } catch (e) {
      return '';
    }
  }

  function getCurrentCompanyMonthYear(options) {
    return getEffectivePeriodContext(options || {})?.effective || null;
  }

  function getEffectiveCutoffDate(options) {
    return getCurrentCompanyMonthYear(options || {})?.monthEnd || null;
  }

  function getProjectActualRevPlanRollups({ projectId } = {}) {
    const current = getCurrentCompanyMonthYear({ projectId });
    const currentMonth = current?.month ?? null;
    const currentYear = current?.year ?? null;
    const companyTz = getCompanyTimeZone(config);
    const pid = String(projectId || '').trim();
    const hasProjectFilter = /^\d+$/.test(pid);

    const actualTypeId =
      pmConfig?.LIST_IDS?.REV_PLAN_TYPE?.ACTUAL != null
        ? String(pmConfig.LIST_IDS.REV_PLAN_TYPE.ACTUAL)
        : '1';

    const actualTypeNum = /^\d+$/.test(String(actualTypeId || ''))
      ? Number(actualTypeId)
      : null;
    const sql = `
      SELECT
        ph.custrecord_pm_phase_parent AS projectid,
        TO_CHAR(rp.custrecord_pm_revplan_period, 'DD/MM/YYYY') AS perioddate,
        rp.custrecord_pm_revplan_type AS typeid,
        BUILTIN.DF(rp.custrecord_pm_revplan_type) AS typetext,
        rp.custrecord_pm_revplan_qty AS qty,
        ph.custrecord_pm_phase_rate AS rate
      FROM customrecord_pm_revenue_plan rp
      JOIN customrecord_pm_project_phase ph
        ON ph.id = rp.custrecord_pm_revplan_parent
      WHERE rp.isinactive = 'F'
        AND ph.isinactive = 'F'
        ${hasProjectFilter ? `AND ph.custrecord_pm_phase_parent = ${pid}` : ''}
    `;
    const rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];

    const rollupsByProjectId = {};
    rows.forEach((row) => {
      const projectId = row?.projectid != null ? String(row.projectid) : '';
      if (!projectId) return;

      const typeText = String(row?.typetext || '').trim();
      const typeTextFromValue = String(row?.typeid || '').trim();
      const typeKey = String(typeText || '').toLowerCase();
      const isActual =
        typeKey === 'actual' ||
        String(typeTextFromValue || '') === String(actualTypeId || '') ||
        (actualTypeNum != null &&
          Number(typeTextFromValue || 0) === Number(actualTypeNum));
      if (!isActual) return;

      const periodRaw = row?.perioddate;
      const periodDate = parseDateAny(periodRaw);
      const ym = periodDate
        ? getYearMonthInTimeZone(periodDate, companyTz)
        : null;
      const month = ym?.month ?? null;
      const year = ym?.year ?? null;

      const qtySum = toNumber(row?.qty);
      const rate = toNumber(row?.rate);
      const amountSum = qtySum * rate;

      const key = String(projectId);
      const bucket = (rollupsByProjectId[key] = rollupsByProjectId[key] || {
        qtyCompleted: 0,
        recognizedPrev: 0,
        recognizedThisMonth: 0,
      });

      bucket.qtyCompleted += qtySum;

      if (!month || !Number.isFinite(year) || !currentMonth || !currentYear)
        return;
      if (year === currentYear && month === currentMonth)
        bucket.recognizedThisMonth += amountSum;
      else if (
        year < currentYear ||
        (year === currentYear && month < currentMonth)
      )
        bucket.recognizedPrev += amountSum;
    });

    log.audit({
      title: 'PM_ACTUAL_ROLLUP_DEBUG',
      details: {
        projectId: hasProjectFilter ? pid : null,
        currentMonth,
        currentYear,
        rowCount: rows.length,
        result: hasProjectFilter
          ? rollupsByProjectId[pid] || {
              qtyCompleted: 0,
              recognizedPrev: 0,
              recognizedThisMonth: 0,
            }
          : rollupsByProjectId,
      },
    });

    return rollupsByProjectId;
  }

  function rollProjectCurrentMonthRevPlansActual({ projectId } = {}) {
    const pid = String(projectId || '').trim();
    if (!/^\d+$/.test(pid)) {
      return {
        status: 'ERROR',
        name: 'BAD_REQUEST',
        message: 'projectId is required.',
      };
    }

    const current = getCurrentCompanyMonthYear({ projectId: pid });
    const monthEndSql = formatDateForSQL(current?.monthEnd || null);
    if (!monthEndSql) {
      return {
        status: 'ERROR',
        name: 'BAD_REQUEST',
        message: 'Unable to resolve the project current month.',
      };
    }

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
    const forecastTypeIdValue =
      Number.isFinite(forecastTypeId) && forecastTypeId > 0
        ? Math.trunc(forecastTypeId)
        : 2;

    const currentMonthSql = `
      SELECT
        rp.id,
        rp.custrecord_pm_revplan_type
      FROM customrecord_pm_revenue_plan rp
      WHERE rp.isinactive = 'F'
        AND rp.custrecord_pm_revplan_project = ${pid}
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
        AND rp.custrecord_pm_revplan_project = ${pid}
        AND rp.custrecord_pm_revplan_period > TO_DATE('${monthEndSql}', 'YYYY-MM-DD')
        AND rp.custrecord_pm_revplan_type = ${actualTypeIdSql}
      ORDER BY rp.id
    `;

    const currentMonthRows =
      query.runSuiteQL({ query: currentMonthSql }).asMappedResults() || [];
    const futureMonthRows =
      query.runSuiteQL({ query: futureMonthSql }).asMappedResults() || [];

    const seen = new Set();
    const errors = [];
    let updatedActual = 0;
    let updatedForecast = 0;

    const updateRowType = (row, targetTypeId, targetTypeKey) => {
      const id = String(row?.id || '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);

      try {
        record.submitFields({
          type: 'customrecord_pm_revenue_plan',
          id,
          values: { custrecord_pm_revplan_type: Number(targetTypeId) },
          options: { enableSourcing: false, ignoreMandatoryFields: true },
        });
        if (targetTypeKey === 'ACTUAL') updatedActual += 1;
        else if (targetTypeKey === 'FORECAST') updatedForecast += 1;
      } catch (e) {
        const error = {
          id,
          targetTypeId: String(targetTypeId),
          targetTypeKey,
          name: e?.name || '',
          message: e?.message || String(e || ''),
        };
        errors.push(error);
        log.error({
          title: 'PM_PROJECT_REVPLAN_ROLLOVER_UPDATE_FAILED',
          details: { projectId: pid, ...error },
        });
      }
    };

    currentMonthRows.forEach((row) =>
      updateRowType(row, actualTypeIdSql, 'ACTUAL'),
    );
    futureMonthRows.forEach((row) =>
      updateRowType(row, forecastTypeIdValue, 'FORECAST'),
    );

    const result = {
      status: errors.length ? 'PARTIAL' : 'OK',
      projectId: pid,
      currentMonthKey: current?.key || null,
      currentMonthLabel: current?.label || null,
      currentMonthSource: current?.source || null,
      currentMonthToActual: updatedActual,
      futureMonthToForecast: updatedForecast,
      updated: updatedActual + updatedForecast,
      errors,
    };

    log.audit({
      title: 'PM_PROJECT_REVPLAN_ROLLOVER_RESULT',
      details: {
        projectId: pid,
        currentMonthKey: result.currentMonthKey,
        currentMonthLabel: result.currentMonthLabel,
        currentMonthSource: result.currentMonthSource,
        currentMonthToActual: updatedActual,
        futureMonthToForecast: updatedForecast,
        updated: result.updated,
        errorCount: errors.length,
      },
    });

    return result;
  }

  function getProjectRevenueReadyRollups() {
    const current = getCurrentCompanyMonthYear();
    const currentMonth = current?.month ?? null;
    const currentYear = current?.year ?? null;
    const currentMonthNum = monthKeyNumberFromKey(
      monthKey(currentYear, currentMonth),
    );
    const companyTz = getCompanyTimeZone(config);

    const columns = [
      search.createColumn({
        name: 'custrecord_pm_phase_parent',
        join: 'custrecord_pm_revplan_parent',
        summary: search.Summary.GROUP,
      }),
      search.createColumn({ name: 'custrecord_pm_revplan_period' }),
      search.createColumn({ name: 'custrecord_pm_revplan_status' }),
      search.createColumn({
        name: 'formulanumeric',
        formula:
          '(CASE WHEN {custrecord_pm_revplan_qty} IS NULL THEN 0 ELSE {custrecord_pm_revplan_qty} END) * (CASE WHEN {custrecord_pm_revplan_parent.custrecord_pm_phase_rate} IS NULL THEN 0 ELSE {custrecord_pm_revplan_parent.custrecord_pm_phase_rate} END)',
      }),
    ];

    const baseFilters = [['isinactive', 'is', 'F']];
    const activePhaseFilters = [
      ...baseFilters,
      'AND',
      ['custrecord_pm_revplan_parent.isinactive', 'is', 'F'],
    ];

    const filterVariants = [activePhaseFilters, baseFilters];

    let results = [];
    for (const filters of filterVariants) {
      try {
        const suiteSearch = search.create({
          type: 'customrecord_pm_revenue_plan',
          filters,
          columns,
        });
        results = getAllResults(suiteSearch);
        break;
      } catch (e) {
        // try next variant
      }
    }

    const rollupsByProjectId = {};

    results.forEach((res) => {
      const projectId = res.getValue({
        name: 'custrecord_pm_phase_parent',
        join: 'custrecord_pm_revplan_parent',
        summary: search.Summary.GROUP,
      });
      if (!projectId) return;

      const periodRaw = res.getValue({ name: 'custrecord_pm_revplan_period' });
      const periodDate = parseDateAny(periodRaw);
      const ym = periodDate
        ? getYearMonthInTimeZone(periodDate, companyTz)
        : null;
      const month = ym?.month ?? null;
      const year = ym?.year ?? null;
      if (!month || !Number.isFinite(year) || !currentMonth || !currentYear)
        return;
      const periodMonthNum = monthKeyNumberFromKey(monthKey(year, month));
      if (
        currentMonthNum == null ||
        periodMonthNum == null ||
        periodMonthNum > currentMonthNum
      )
        return;

      const statusText =
        res.getText?.({ name: 'custrecord_pm_revplan_status' }) || '';
      const statusValue = res.getValue({
        name: 'custrecord_pm_revplan_status',
      });
      const statusMapped = mapRevPlanStatusStrict({
        id: statusValue,
        text: statusText,
        contextAction: 'getProjectRevenueReadyRollups',
      });
      const statusValueKey = statusMapped.key;
      if (!isRevenueReadyStatusKey(statusValueKey)) return;

      const amountSum = toNumber(res.getValue({ name: 'formulanumeric' }));
      const key = String(projectId);
      if (!rollupsByProjectId[key]) rollupsByProjectId[key] = 0;
      rollupsByProjectId[key] += amountSum;
    });

    return rollupsByProjectId;
  }

  function getProjectRevPlanStatusRollups() {
    // Must match the same record set + same month-pick rules used by `getProjectRevPlans`.
    // - Record set: revenue plan lines belonging to active project phases only
    // - Per-project phase pick: choose one representative phase
    //   - prefer a phase that has the current month
    //   - otherwise choose the phase whose latest rev plan month is the most recent
    // - Month pick (within that phase): current month if it exists; otherwise the latest month that exists
    const current = getCurrentCompanyMonthYear();
    const currentKey = monthKey(current?.year, current?.month);
    const companyTz = getCompanyTimeZone(config);

    // 1) Build a phaseId -> projectId map from ACTIVE phases (same filter as project_phase_mod.getProjectPhases)
    const phaseParentByPhaseId = {};
    const phaseIdsByProjectId = {};
    const activePhases = search.create({
      type: 'customrecord_pm_project_phase',
      filters: [['isinactive', 'is', 'F']],
      columns: [
        search.createColumn({ name: 'internalid' }),
        search.createColumn({ name: 'custrecord_pm_phase_parent' }),
      ],
    });
    getAllResults(activePhases).forEach((res) => {
      const phaseId = res.getValue({ name: 'internalid' });
      const projectId = res.getValue({ name: 'custrecord_pm_phase_parent' });
      if (!phaseId || !projectId) return;
      const pid = String(projectId);
      const phid = String(phaseId);
      phaseParentByPhaseId[phid] = pid;
      if (!phaseIdsByProjectId[pid]) phaseIdsByProjectId[pid] = [];
      phaseIdsByProjectId[pid].push(phid);
    });

    const activePhaseIds = Object.keys(phaseParentByPhaseId);
    if (!activePhaseIds.length) return {};

    // 2) Scan revenue plan lines for those active phases and capture status per phase+month.
    const monthStatusByPhaseId = {};
    const monthKeysByPhaseId = {};
    const conflictCountByProjectId = {};
    const conflictSamplesByProjectId = {};
    const chunks = chunkArray(activePhaseIds, 900);
    chunks.forEach((ids) => {
      const planSearch = search.create({
        type: 'customrecord_pm_revenue_plan',
        filters: [
          ['isinactive', 'is', 'F'],
          'AND',
          ['custrecord_pm_revplan_parent', 'anyof', ...ids],
        ],
        columns: [
          search.createColumn({ name: 'custrecord_pm_revplan_parent' }),
          search.createColumn({ name: 'custrecord_pm_revplan_period' }),
          search.createColumn({ name: 'custrecord_pm_revplan_status' }),
        ],
      });

      getAllResults(planSearch).forEach((res) => {
        const phaseId = res.getValue({ name: 'custrecord_pm_revplan_parent' });
        if (!phaseId) return;
        const phid = String(phaseId);
        const projectId = phaseParentByPhaseId[phid] || '';
        if (!projectId) return;

        const periodRaw = res.getValue({
          name: 'custrecord_pm_revplan_period',
        });
        const periodDate = parseDateAny(periodRaw);
        const ym = periodDate
          ? getYearMonthInTimeZone(periodDate, companyTz)
          : null;
        const mKey = ym ? monthKey(ym.year, ym.month) : '';
        if (!mKey) return;

        if (!monthKeysByPhaseId[phid]) monthKeysByPhaseId[phid] = new Set();
        monthKeysByPhaseId[phid].add(mKey);

        const statusText =
          res.getText?.({ name: 'custrecord_pm_revplan_status' }) || '';
        const statusValue = res.getValue({
          name: 'custrecord_pm_revplan_status',
        });
        const statusValueKey = mapRevPlanStatusStrict({
          id: statusValue,
          text: statusText,
          contextAction: 'getProjectRevPlanStatusRollups',
        }).key;

        if (!monthStatusByPhaseId[phid]) monthStatusByPhaseId[phid] = {};
        const prev = monthStatusByPhaseId[phid][mKey] || '';
        if (!prev) monthStatusByPhaseId[phid][mKey] = statusValueKey;
        else if (prev !== statusValueKey) {
          const pid = String(projectId);
          conflictCountByProjectId[pid] =
            (conflictCountByProjectId[pid] || 0) + 1;
          if (!conflictSamplesByProjectId[pid])
            conflictSamplesByProjectId[pid] = [];
          if (conflictSamplesByProjectId[pid].length < 10) {
            conflictSamplesByProjectId[pid].push({
              phaseId: phid,
              monthKey: mKey,
              prev,
              next: statusValueKey,
            });
          }
          log?.error?.({
            title: 'REV_PLAN_STATUS_MISMATCH',
            details: {
              phaseId: phid,
              monthKey: mKey,
              prev,
              next: statusValueKey,
            },
          });
        }
      });
    });

    // 3) Choose the representative phase+month per project's *rev plan status* using the same rule as `getProjectRevPlans`.
    const out = {};
    Object.keys(phaseIdsByProjectId).forEach((projectId) => {
      const phaseIds = phaseIdsByProjectId[projectId] || [];
      if (!phaseIds.length) return;

      let chosenPhaseId = '';
      let chosenPhaseHasCurrent = false;
      let chosenPhaseLatestNum = null;
      let chosenPhaseLatestKey = '';

      phaseIds.forEach((phid) => {
        const keysSet = monthKeysByPhaseId[phid] || null;
        if (!keysSet || !keysSet.size) return;

        const hasCurrent = Boolean(currentKey) && keysSet.has(currentKey);
        let bestNum = null;
        let bestKey = '';
        keysSet.forEach((k) => {
          const n = monthKeyNumberFromKey(k);
          if (n == null) return;
          if (bestNum == null || n > bestNum) {
            bestNum = n;
            bestKey = k;
          }
        });

        if (!chosenPhaseId) {
          chosenPhaseId = phid;
          chosenPhaseHasCurrent = hasCurrent;
          chosenPhaseLatestNum = bestNum;
          chosenPhaseLatestKey = bestKey || '';
          return;
        }

        // Prefer a phase that contains the current month; otherwise prefer the phase with the latest month.
        if (hasCurrent && !chosenPhaseHasCurrent) {
          chosenPhaseId = phid;
          chosenPhaseHasCurrent = hasCurrent;
          chosenPhaseLatestNum = bestNum;
          chosenPhaseLatestKey = bestKey || '';
          return;
        }
        if (hasCurrent === chosenPhaseHasCurrent) {
          const curLatest = bestNum == null ? -1 : bestNum;
          const chosenLatest =
            chosenPhaseLatestNum == null ? -1 : chosenPhaseLatestNum;
          if (curLatest > chosenLatest) {
            chosenPhaseId = phid;
            chosenPhaseHasCurrent = hasCurrent;
            chosenPhaseLatestNum = bestNum;
            chosenPhaseLatestKey = bestKey || '';
            return;
          }
          if (
            curLatest === chosenLatest &&
            String(phid) < String(chosenPhaseId)
          ) {
            chosenPhaseId = phid;
            chosenPhaseHasCurrent = hasCurrent;
            chosenPhaseLatestNum = bestNum;
            chosenPhaseLatestKey = bestKey || '';
          }
        }
      });

      if (!chosenPhaseId) return;

      const chosenMonthKey = chosenPhaseHasCurrent
        ? currentKey
        : chosenPhaseLatestKey || '';
      const byMonth = monthStatusByPhaseId[chosenPhaseId] || {};
      const statusValueKey = chosenMonthKey
        ? byMonth[chosenMonthKey] || statuses.REVPLAN_STATUS_KEYS.OPEN
        : statuses.REVPLAN_STATUS_KEYS.OPEN;
      out[String(projectId)] = {
        revPlanStatus: {
          id: '',
          key: statusValueKey,
          label: revPlanStatusLabelForKey(statusValueKey),
        },
        revPlanStatusMonthKey: chosenMonthKey || null,
        revPlanStatusConflict: Boolean(
          conflictCountByProjectId[String(projectId)],
        ),
        revPlanStatusConflictCount:
          conflictCountByProjectId[String(projectId)] || 0,
        revPlanStatusConflicts:
          conflictSamplesByProjectId[String(projectId)] || [],
      };
    });

    return out;
  }

  function getProjectInfoForRevPlans(projectId) {
    const pid = String(projectId || '').trim();
    if (!pid) return { startDate: null, endDate: null };
    const startDateCol = search.createColumn({
      name: 'formulatext',
      formula: "TO_CHAR({custrecord_pm_project_startdate}, 'DD/MM/YYYY')",
    });
    const endDateCol = search.createColumn({
      name: 'formulatext',
      formula: "TO_CHAR({custrecord_pm_project_enddate}, 'DD/MM/YYYY')",
    });
    const suiteSearch = search.create({
      type: 'customrecord_pm_projects',
      filters: [['internalid', 'anyof', pid]],
      columns: [startDateCol, endDateCol],
    });
    const first = suiteSearch.run().getRange({ start: 0, end: 1 })?.[0] || null;
    if (!first) return { startDate: null, endDate: null };
    return {
      startDate: first.getValue(startDateCol) || null,
      endDate: first.getValue(endDateCol) || null,
    };
  }

  function getProjectPhasesForRevPlans(projectId) {
    const pid = String(projectId || '').trim();
    if (!pid) return [];
    const sequenceCol = search.createColumn({
      name: 'custrecord_pm_phase_sequence',
      sort: search.Sort.ASC,
    });
    const internalIdCol = search.createColumn({
      name: 'internalid',
      sort: search.Sort.ASC,
    });
    const suiteSearch = search.create({
      type: 'customrecord_pm_project_phase',
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        ['custrecord_pm_phase_parent', 'anyof', pid],
      ],
      columns: [
        sequenceCol,
        internalIdCol,
        search.createColumn({ name: 'name' }),
        search.createColumn({ name: 'custrecord_pm_phase_dept' }),
        search.createColumn({ name: 'custrecord_pm_phase_milestone' }),
        search.createColumn({ name: 'custrecord_pm_phase_milestone_desc' }),
        search.createColumn({ name: 'custrecord_pm_phase_note' }),
        search.createColumn({ name: 'custrecord_pm_phase_qty' }),
        search.createColumn({ name: 'custrecord_pm_phase_ctg_qty' }),
        search.createColumn({ name: 'custrecord_pm_phase_rate' }),
      ],
    });
    return getAllResults(suiteSearch).map((res) => {
      const milestoneDesc = String(
        res.getValue({ name: 'custrecord_pm_phase_milestone_desc' }) || '',
      ).trim();
      const milestoneText =
        milestoneDesc ||
        res.getText({ name: 'custrecord_pm_phase_milestone' }) ||
        null;
      return {
        id: String(res.getValue({ name: 'internalid' }) || ''),
        name: res.getValue({ name: 'name' }) || '',
        sequence: toNumber(
          res.getValue({ name: 'custrecord_pm_phase_sequence' }) || 0,
        ),
        department:
          String(res.getText({ name: 'custrecord_pm_phase_dept' }) || '')
            .split(':')
            .pop()
            .trim() || null,
        milestone: milestoneText,
        milestoneDesc: milestoneDesc || null,
        serviceItem: milestoneText,
        note: String(
          res.getValue({ name: 'custrecord_pm_phase_note' }) || '',
        ).trim(),
        definedQty: res.getValue({ name: 'custrecord_pm_phase_qty' }) || null,
        contingency: toNumber(
          res.getValue({ name: 'custrecord_pm_phase_ctg_qty' }) || 0,
        ),
        rate: res.getValue({ name: 'custrecord_pm_phase_rate' }) || null,
      };
    });
  }

  function getProjectRevPlans({ projectId, projectInfo, phases, source } = {}) {
    if (!projectId) return null;

    const current = getCurrentCompanyMonthYear({ projectId });
    const effectiveCutoffDate = getEffectiveCutoffDate({ projectId });
    const costTotals =
      projectFinancialsMod.getProjectCostTotals?.(projectId, {
        cutoffDate: effectiveCutoffDate,
      }) || {};
    const subcontractorCost = toNumber(costTotals?.subcontractorCost || 0);
    const materialCost = toNumber(costTotals?.materialCost || 0);
    const companyTz = getCompanyTimeZone(config);

    const resolvedProjectInfo =
      projectInfo && typeof projectInfo === 'object'
        ? projectInfo
        : getProjectInfoForRevPlans(projectId);
    const resolvedPhases = Array.isArray(phases)
      ? phases
      : getProjectPhasesForRevPlans(projectId);

    const expectedInfo = validator.getExpectedProjectMonthsAndKeys(
      resolvedProjectInfo?.startDate,
      resolvedProjectInfo?.endDate,
    );
    const expectedMonths = expectedInfo.months;
    const expectedKeys = expectedInfo.keys;
    const callSource = String(source || 'unknown');

    const safePhases = Array.isArray(resolvedPhases) ? resolvedPhases : [];
    const phaseIds = safePhases
      .map((p) => p?.id)
      .filter(Boolean)
      .map(String);
    log.audit({
      title: 'PM_REVPLAN_META_PHASE_SCOPE',
      details: {
        projectId: String(projectId || ''),
        source: callSource,
        projectStartDateRaw: resolvedProjectInfo?.startDate || null,
        projectEndDateRaw: resolvedProjectInfo?.endDate || null,
        expectedMonthsCount: Array.isArray(expectedMonths)
          ? expectedMonths.length
          : 0,
        expectedKeysCount: expectedKeys?.size || 0,
        expectedKeysSample: Array.from(expectedKeys || []).slice(0, 20),
        phasesCount: safePhases.length,
        phaseIdsCount: phaseIds.length,
        phaseIdsSample: phaseIds.slice(0, 20),
      },
    });

    const byPhaseMonth = {};
    const byPhaseMonthPlanIds = {};
    const monthHasActual = {};
    const monthHasForecast = {};
    const monthPlanTypeStats = {};
    const monthStatusCounts = {};
    const monthStatusByPhaseId = {};
    const monthKeysByPhaseId = {};
    const revPlanStatusConflicts = [];
    let revPlanStatusConflictCount = 0;
    const foundMonthKeys = new Set();
    const actualQtyByPhaseId = {};
    let monthMismatch = false;
    let planLinesFound = 0;
    const planStatusById = {};
    let hasActualCompletedUpToCurrentMonth = false;
    let hasActualOpenOrReadyUpToCurrentMonth = false;
    const currentKey = monthKey(current?.year, current?.month);
    const currentNum = monthKeyNumberFromKey(currentKey);

    if (phaseIds.length) {
      const chunks = chunkArray(phaseIds, 900);
      log.audit({
        title: 'PM_REVPLAN_META_PHASE_CHUNKS',
        details: {
          projectId: String(projectId || ''),
          chunkCount: chunks.length,
          chunkSizes: chunks.map((c) => c.length),
        },
      });
      chunks.forEach((ids) => {
        const suiteSearch = search.create({
          type: 'customrecord_pm_revenue_plan',
          filters: [
            ['isinactive', 'is', 'F'],
            'AND',
            ['custrecord_pm_revplan_parent', 'anyof', ...ids],
          ],
          columns: [
            search.createColumn({ name: 'internalid' }),
            search.createColumn({ name: 'custrecord_pm_revplan_parent' }),
            search.createColumn({ name: 'custrecord_pm_revplan_period' }),
            search.createColumn({ name: 'custrecord_pm_revplan_status' }),
            search.createColumn({ name: 'custrecord_pm_revplan_type' }),
            search.createColumn({ name: 'custrecord_pm_revplan_qty' }),
          ],
        });

        getAllResults(suiteSearch).forEach((res) => {
          planLinesFound += 1;
          const planId = String(
            res.id || res.getValue({ name: 'internalid' }) || '',
          );
          const phaseId = res.getValue({
            name: 'custrecord_pm_revplan_parent',
          });
          if (!phaseId) return;

          const periodRaw = res.getValue({
            name: 'custrecord_pm_revplan_period',
          });
          const periodDate = parseDateAny(periodRaw);
          const ym = periodDate
            ? getYearMonthInTimeZone(periodDate, companyTz)
            : null;
          const key = ym ? monthKey(ym.year, ym.month) : '';
          if (!key) return;

          foundMonthKeys.add(key);
          if (expectedKeys.size && !expectedKeys.has(key)) monthMismatch = true;

          const pid = String(phaseId);
          if (!monthKeysByPhaseId[pid]) monthKeysByPhaseId[pid] = new Set();
          monthKeysByPhaseId[pid].add(key);

          const statusText =
            res.getText?.({ name: 'custrecord_pm_revplan_status' }) || '';
          const statusValue = res.getValue({
            name: 'custrecord_pm_revplan_status',
          });
          const statusValueKey = mapRevPlanStatusStrict({
            id: statusValue,
            text: statusText,
            contextAction: 'getProjectRevPlans',
          }).key;
          if (!monthStatusCounts[key]) monthStatusCounts[key] = {};
          monthStatusCounts[key][statusValueKey] =
            Number(monthStatusCounts[key][statusValueKey] || 0) + 1;
          if (!monthStatusByPhaseId[pid]) monthStatusByPhaseId[pid] = {};
          const prev = monthStatusByPhaseId[pid][key] || '';
          if (!prev) monthStatusByPhaseId[pid][key] = statusValueKey;
          else if (prev !== statusValueKey) {
            revPlanStatusConflictCount += 1;
            if (revPlanStatusConflicts.length < 10) {
              revPlanStatusConflicts.push({
                phaseId: pid,
                monthKey: key,
                prev,
                next: statusValueKey,
              });
            }
            log?.error?.({
              title: 'REV_PLAN_STATUS_MISMATCH',
              details: {
                phaseId: pid,
                monthKey: key,
                prev,
                next: statusValueKey,
              },
            });
          }

          const typeText =
            res.getText?.({ name: 'custrecord_pm_revplan_type' }) ||
            res.getValue({ name: 'custrecord_pm_revplan_type' }) ||
            '';
          const isActual = String(typeText).toLowerCase() === 'actual';

          const qty = toNumber(
            res.getValue({ name: 'custrecord_pm_revplan_qty' }),
          );

          if (planId) {
            const lockInfo = getRevPlanEditLock({
              statusValueKey,
              planMonthKey: key,
              currentMonthNum: currentNum,
            });
            planStatusById[planId] = {
              status: {
                key: statusValueKey || '',
                label: revPlanStatusLabelForKey(statusValueKey),
              },
              isActual: Boolean(isActual),
              monthKey: key,
              isLockedForEdit: Boolean(lockInfo.isLockedForEdit),
              lockReason: String(lockInfo.lockReason || ''),
            };
          }

          if (!monthPlanTypeStats[key]) {
            monthPlanTypeStats[key] = {
              actual: { total: 0, locked: 0 },
              forecast: { total: 0, locked: 0 },
            };
          }
          const statsBucket = isActual
            ? monthPlanTypeStats[key].actual
            : monthPlanTypeStats[key].forecast;
          statsBucket.total += 1;
          const statsLock = getRevPlanEditLock({
            statusValueKey,
            planMonthKey: key,
            currentMonthNum: currentNum,
          });
          if (statsLock.isLockedForEdit) statsBucket.locked += 1;

          const planMonthNum = monthKeyNumberFromKey(key);
          const isUpToCurrentMonth =
            currentNum != null &&
            planMonthNum != null &&
            planMonthNum <= currentNum;
          if (isActual && isUpToCurrentMonth) {
            if (statusValueKey === statuses.REVPLAN_STATUS_KEYS.COMPLETED)
              hasActualCompletedUpToCurrentMonth = true;
            if (isRevenueReadyStatusKey(statusValueKey))
              hasActualOpenOrReadyUpToCurrentMonth = true;
          }

          if (!byPhaseMonth[pid]) byPhaseMonth[pid] = {};
          if (!byPhaseMonth[pid][key])
            byPhaseMonth[pid][key] = { actual: 0, planned: 0 };
          if (!byPhaseMonthPlanIds[pid]) byPhaseMonthPlanIds[pid] = {};
          if (!byPhaseMonthPlanIds[pid][key])
            byPhaseMonthPlanIds[pid][key] = { actual: [], planned: [] };
          if (isActual) {
            byPhaseMonth[pid][key].actual += qty;
            actualQtyByPhaseId[pid] = (actualQtyByPhaseId[pid] || 0) + qty;
            monthHasActual[key] = true;
            if (planId) byPhaseMonthPlanIds[pid][key].actual.push(planId);
          } else {
            byPhaseMonth[pid][key].planned += qty;
            monthHasForecast[key] = true;
            if (planId) byPhaseMonthPlanIds[pid][key].planned.push(planId);
          }
        });
      });
    }
    log.audit({
      title: 'PM_REVPLAN_META_SEARCH_RESULT',
      details: {
        projectId: String(projectId || ''),
        source: callSource,
        planLinesFound: Number(planLinesFound || 0),
        foundMonthKeysCount: foundMonthKeys.size,
        foundMonthKeysSample: Array.from(foundMonthKeys).slice(0, 20),
        monthMismatch: Boolean(monthMismatch),
      },
    });

    // If the project has no revenue plan records at all, do not synthesize a grid.
    if (planLinesFound === 0) {
      log.audit({
        title: 'PM_REVPLAN_META_EMPTY',
        details: {
          projectId: String(projectId || ''),
          reason: 'No revenue plan lines found for active phase IDs.',
          phaseIdsCount: phaseIds.length,
        },
      });
      const safePhases = Array.isArray(resolvedPhases) ? resolvedPhases : [];
      const totalAmount = safePhases.reduce((sum, phase) => {
        const qty = toNumber(phase?.definedQty);
        const rate = toNumber(phase?.rate);
        return sum + qty * rate;
      }, 0);
      return {
        projectId: String(projectId),
        hasRevPlans: false,
        revPlanStatus: null,
        revPlanStatusMonthKey: null,
        revPlanStatusConflict: false,
        revPlanStatusConflictCount: 0,
        revPlanStatusConflicts: [],
        recognizedByDepartment: [],
        months: [],
        rows: [],
        monthMismatch: false,
        summary: {
          totalAmount,
          recognizedToDate: 0,
          remaining: totalAmount,
          subcontractorCost,
          materialCost,
        },
      };
    }

    // NetSuite is the source of truth: render only months that exist in rev plan records.
    // (Do not synthesize missing months from project date range.)
    const extraFoundKeys = expectedKeys.size
      ? Array.from(foundMonthKeys).filter((k) => !expectedKeys.has(k))
      : [];
    const missingExpectedKeys = expectedKeys.size
      ? Array.from(expectedKeys).filter((k) => !foundMonthKeys.has(k))
      : [];
    if (missingExpectedKeys.length) monthMismatch = true;

    log.audit({
      title: 'PM_REVPLAN_META_MONTH_MISMATCH_DIAG',
      details: {
        projectId: String(projectId || ''),
        source: callSource,
        monthMismatchFinal: Boolean(monthMismatch),
        expectedKeysCount: expectedKeys.size,
        foundMonthKeysCount: foundMonthKeys.size,
        extraFoundKeysCount: extraFoundKeys.length,
        extraFoundKeysSample: extraFoundKeys.slice(0, 20),
        missingExpectedKeysCount: missingExpectedKeys.length,
        missingExpectedKeysSample: missingExpectedKeys.slice(0, 20),
      },
    });

    // Choose one representative phase for the project's rev plan status:
    // - prefer a phase that has the current company month
    // - otherwise choose the phase whose latest rev plan month is the most recent
    // Then, within that phase, pick current month if present; otherwise pick the latest month present.
    const chosenCurrentKey = monthKey(current?.year, current?.month);
    const phaseIdsSorted = Array.isArray(phaseIds) ? phaseIds.slice() : [];
    phaseIdsSorted.sort();
    let chosenPhaseId = '';
    let chosenPhaseHasCurrent = false;
    let chosenPhaseLatestNum = null;
    let chosenPhaseLatestKey = '';
    phaseIdsSorted.forEach((pid) => {
      const keysSet = monthKeysByPhaseId[pid] || null;
      if (!keysSet || !keysSet.size) return;

      const hasCurrent =
        Boolean(chosenCurrentKey) && keysSet.has(chosenCurrentKey);
      let bestNum = null;
      let bestKey = '';
      keysSet.forEach((k) => {
        const n = monthKeyNumberFromKey(k);
        if (n == null) return;
        if (bestNum == null || n > bestNum) {
          bestNum = n;
          bestKey = k;
        }
      });

      if (!chosenPhaseId) {
        chosenPhaseId = pid;
        chosenPhaseHasCurrent = hasCurrent;
        chosenPhaseLatestNum = bestNum;
        chosenPhaseLatestKey = bestKey || '';
        return;
      }

      if (hasCurrent && !chosenPhaseHasCurrent) {
        chosenPhaseId = pid;
        chosenPhaseHasCurrent = hasCurrent;
        chosenPhaseLatestNum = bestNum;
        chosenPhaseLatestKey = bestKey || '';
        return;
      }
      if (hasCurrent === chosenPhaseHasCurrent) {
        const curLatest = bestNum == null ? -1 : bestNum;
        const chosenLatest =
          chosenPhaseLatestNum == null ? -1 : chosenPhaseLatestNum;
        if (curLatest > chosenLatest) {
          chosenPhaseId = pid;
          chosenPhaseHasCurrent = hasCurrent;
          chosenPhaseLatestNum = bestNum;
          chosenPhaseLatestKey = bestKey || '';
        }
      }
    });

    const chosenMonthKey = chosenPhaseHasCurrent
      ? chosenCurrentKey
      : chosenPhaseLatestKey || '';
    const statusByMonthForPhase = monthStatusByPhaseId[chosenPhaseId] || {};
    const revPlanStatusValueKey = chosenMonthKey
      ? statusByMonthForPhase[chosenMonthKey] ||
        statuses.REVPLAN_STATUS_KEYS.OPEN
      : statuses.REVPLAN_STATUS_KEYS.OPEN;
    log.audit({
      title: 'PM_REVPLAN_META_STATUS_PICK',
      details: {
        projectId: String(projectId || ''),
        chosenPhaseId: chosenPhaseId || null,
        chosenMonthKey: chosenMonthKey || null,
        revPlanStatusValueKey: revPlanStatusValueKey || null,
        revPlanStatusConflictCount: Number(revPlanStatusConflictCount || 0),
      },
    });

    const months = Array.from(foundMonthKeys)
      .map((key) => {
        const num = monthKeyNumberFromKey(key);
        if (num == null) return null;
        const year = Math.floor(num / 100);
        const month = num % 100;
        const isCurrent = current?.year === year && current?.month === month;
        const type = monthHasActual[key] ? 'actual' : 'forecast';
        const statusCounts =
          monthStatusCounts[key] && typeof monthStatusCounts[key] === 'object'
            ? monthStatusCounts[key]
            : {};
        const monthStatusKeys = Object.keys(statusCounts).filter(Boolean);
        const statusValueKey =
          monthStatusKeys.length > 1
            ? 'mixed'
            : monthStatusKeys[0] ||
              statusByMonthForPhase[key] ||
              statuses.REVPLAN_STATUS_KEYS.OPEN;
        const stats = monthPlanTypeStats?.[key]?.[type] || {
          total: 0,
          locked: 0,
        };
        const isLockedForEdit =
          Number(stats.total || 0) > 0 &&
          Number(stats.locked || 0) >= Number(stats.total || 0);
        const lockReason = isLockedForEdit
          ? 'All revenue plans for this month are locked for editing.'
          : '';
        return {
          key,
          year,
          month,
          label: monthLabel(year, month),
          status: {
            id: '',
            key: statusValueKey,
            label:
              statusValueKey === 'mixed'
                ? 'Mixed'
                : revPlanStatusLabelForKey(statusValueKey),
          },
          type,
          isCurrent,
          isLockedForEdit,
          isEditable: !isLockedForEdit,
          lockReason,
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          (monthKeyNumberFromKey(a.key) || 0) -
          (monthKeyNumberFromKey(b.key) || 0),
      );

    const rows = [];
    let totalAmount = 0;
    let recognizedToDate = 0;
    const missingRevPlansByPhase = [];
    let missingRevPlansCount = 0;

    safePhases.forEach((phase) => {
      const pid = String(phase?.id || '');
      const qty = toNumber(phase?.definedQty);
      const rate = toNumber(phase?.rate);
      const monthsMap = {};
      const planIds = {};
      let hasPlanLinesForPhase = false;

      months.forEach((m) => {
        const bucket = byPhaseMonth?.[pid]?.[m.key] || {
          actual: 0,
          planned: 0,
        };
        const value = m.type === 'actual' ? bucket.actual : bucket.planned;
        monthsMap[m.key] = Number.isFinite(value) ? value : 0;

        const ids =
          byPhaseMonthPlanIds?.[pid]?.[m.key]?.[
            m.type === 'actual' ? 'actual' : 'planned'
          ] || [];
        const normalizedIds = Array.isArray(ids)
          ? ids.filter(Boolean).map(String)
          : [];
        if (normalizedIds.length) hasPlanLinesForPhase = true;
        planIds[m.key] = normalizedIds;
      });

      // Render rows only for phases that actually have rev plan lines in NetSuite.
      // This prevents newly recreated phases (with no plans yet) from appearing
      // as if they already had rev plans.
      if (!hasPlanLinesForPhase) return;

      const phaseMonthKeySet = monthKeysByPhaseId?.[pid] || new Set();
      const missingMonthKeys = Array.from(expectedKeys)
        .filter((key) => !phaseMonthKeySet.has(key))
        .sort(
          (a, b) =>
            (monthKeyNumberFromKey(a) || 0) - (monthKeyNumberFromKey(b) || 0),
        );
      const missingMonthLabels = missingMonthKeys.map((key) => {
        const n = monthKeyNumberFromKey(key);
        if (n == null) return key;
        const year = Math.floor(n / 100);
        const month = n % 100;
        return monthLabel(year, month);
      });
      if (missingMonthKeys.length) {
        missingRevPlansCount += missingMonthKeys.length;
        missingRevPlansByPhase.push({
          phaseId: pid,
          phase: phase?.name || '',
          missingMonthKeys,
          missingMonthLabels,
        });
      }

      const milestoneDesc =
        phase?.milestoneDesc || phase?.milestone || phase?.serviceItem || '';
      const phaseTotal = qty * rate;
      const recognizedQty = toNumber(actualQtyByPhaseId[pid] || 0);
      const phaseRecognized = recognizedQty * rate;

      totalAmount += phaseTotal;
      recognizedToDate += phaseRecognized;
      rows.push({
        phaseId: pid,
        department: phase?.department || 'Unassigned',
        milestone: String(milestoneDesc || '—'),
        phase: phase?.name || '',
        qty,
        rate,
        total: phaseTotal,
        notes: phase?.note || '',
        contingency: toNumber(phase?.contingency || 0),
        months: monthsMap,
        planIds,
        missingMonthKeys,
        missingMonthLabels,
      });
    });

    const remaining = totalAmount - recognizedToDate;
    const recognizedByDepartmentRaw =
      projectFinancialsMod.getRevenueRecognizedByDepartment?.(projectId, {
        cutoffDate: effectiveCutoffDate,
      }) || [];
    const recognizedByDepartment = Array.isArray(recognizedByDepartmentRaw)
      ? recognizedByDepartmentRaw
      : [];
    const recognizedByPhaseRaw =
      projectFinancialsMod.getRevenueRecognizedByPhase?.(projectId, {
        cutoffDate: effectiveCutoffDate,
      }) || [];
    const recognizedByPhase = Array.isArray(recognizedByPhaseRaw)
      ? recognizedByPhaseRaw
      : [];

    const salesOrderIds =
      projectFinancialsMod.getProjectSalesOrderIds?.(projectId) || [];
    const billedToDate = toNumber(
      projectFinancialsMod.getNetInvoicedAmountForSalesOrders?.(
        salesOrderIds,
        effectiveCutoffDate,
      ) || 0,
    );
    const isPostJournalState =
      Boolean(hasActualCompletedUpToCurrentMonth) &&
      !Boolean(hasActualOpenOrReadyUpToCurrentMonth);

    return {
      projectId: String(projectId),
      hasRevPlans: true,
      isPostJournalState,
      hasActualOpenOrReadyUpToCurrentMonth: Boolean(
        hasActualOpenOrReadyUpToCurrentMonth,
      ),
      revPlanStatus: {
        id: '',
        key: revPlanStatusValueKey,
        label: revPlanStatusLabelForKey(revPlanStatusValueKey),
      },
      revPlanStatusMonthKey: chosenMonthKey || null,
      revPlanStatusConflict: revPlanStatusConflictCount > 0,
      revPlanStatusConflictCount,
      revPlanStatusConflicts,
      recognizedByDepartment,
      recognizedByPhase,
      months,
      rows,
      planStatusById,
      missingRevPlans: {
        count: missingRevPlansCount,
        byPhase: missingRevPlansByPhase,
      },
      monthMismatch: Boolean(monthMismatch),
      summary: {
        totalAmount,
        recognizedToDate,
        billedToDate,
        remaining,
        subcontractorCost,
        materialCost,
      },
    };
  }

  function parseBooleanLike(value) {
    if (value === true || value === false) return value;
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  }

  function getSublistLineInternalId(rec, sublistId, line) {
    const tryFields = ['id', 'internalid'];
    for (const fieldId of tryFields) {
      try {
        const v = rec.getSublistValue({ sublistId, fieldId, line });
        if (v != null && String(v).trim() !== '') return String(v);
      } catch (e) {
        // ignore
      }
    }
    return null;
  }

  function getSublistTextSafe(rec, sublistId, fieldId, line) {
    try {
      const t = rec.getSublistText({ sublistId, fieldId, line });
      if (t != null && String(t).trim() !== '') return String(t);
    } catch (e) {
      // ignore
    }
    return null;
  }

  function formatDateKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getRevenueType(periodDate, projectId) {
    const d = periodDate instanceof Date ? periodDate : new Date(periodDate);
    try {
      const current = getCurrentCompanyMonthYear({ projectId });
      const currentKey = monthKey(current?.year, current?.month);
      const currentNum = monthKeyNumberFromKey(currentKey);
      const companyTz = getCompanyTimeZone(config);

      const ym = getYearMonthInTimeZone(d, companyTz);
      const periodKey = monthKey(ym?.year, ym?.month);
      const periodNum = monthKeyNumberFromKey(periodKey);

      if (currentNum != null && periodNum != null) {
        // Business rule for newly-generated plans:
        // any month before OR on the current company month is "Actual", everything after is "Forecast".
        return periodNum <= currentNum
          ? pmConfig.LIST_IDS.REV_PLAN_TYPE.ACTUAL
          : pmConfig.LIST_IDS.REV_PLAN_TYPE.FORECAST;
      }
    } catch (e) {
      // ignore and fall back
    }

    // Fallback: only the effective current month (simulated or actual) is Actual.
    const effective = getCurrentCompanyMonthYear({ projectId });
    return d.getMonth() + 1 === Number(effective?.month || 0) &&
      d.getFullYear() === Number(effective?.year || 0)
      ? pmConfig.LIST_IDS.REV_PLAN_TYPE.ACTUAL
      : pmConfig.LIST_IDS.REV_PLAN_TYPE.FORECAST;
  }

  function validateProject(projectId) {
    try {
      const pid = String(projectId || '').trim();
      if (!/^\d+$/.test(pid)) {
        return { isValid: false, message: 'Invalid project id' };
      }

      const sql = `
        SELECT
          TO_CHAR(custrecord_pm_project_startdate, 'DD/MM/YYYY') AS startdate,
          TO_CHAR(custrecord_pm_project_enddate, 'DD/MM/YYYY') AS enddate
        FROM customrecord_pm_projects
        WHERE id = ${pid}
      `;
      const rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
      const row = rows[0] || {};
      const startDate = row?.startdate ? String(row.startdate) : null;
      const endDate = row?.enddate ? String(row.enddate) : null;
      log.audit({
        title: 'PM_VALIDATE_PROJECT_DATES',
        details: {
          projectId: pid,
          sqlDateStart: startDate,
          sqlDateEnd: endDate,
          hasRow: Boolean(rows.length),
        },
      });
      if (!startDate || !endDate) {
        return {
          isValid: false,
          message: 'Project missing start/end date',
        };
      }
      return {
        isValid: true,
        id: String(projectId),
        startDate,
        endDate,
      };
    } catch (e) {
      return { isValid: false, message: e?.message || String(e) };
    }
  }

  function getProjectPhaseIds(projectId) {
    const phaseIds = [];
    if (!projectId) return phaseIds;

    const suiteSearch = search.create({
      type: 'customrecord_pm_project_phase',
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        ['custrecord_pm_phase_parent', 'anyof', String(projectId)],
      ],
      columns: [search.createColumn({ name: 'internalid' })],
    });

    getAllResults(suiteSearch).forEach((res) => {
      const id = res.getValue({ name: 'internalid' });
      if (id) phaseIds.push(String(id));
    });
    return phaseIds;
  }

  function getExistingRevenuePlans(phaseIds) {
    const ids = Array.isArray(phaseIds)
      ? phaseIds.filter(Boolean).map(String)
      : [];
    if (!ids.length) return {};

    const map = {};
    const chunks = chunkArray(ids, 900);
    chunks.forEach((chunk) => {
      const suiteSearch = search.create({
        type: 'customrecord_pm_revenue_plan',
        filters: [
          ['isinactive', 'is', 'F'],
          'AND',
          ['custrecord_pm_revplan_parent', 'anyof', ...chunk],
        ],
        columns: [
          search.createColumn({ name: 'custrecord_pm_revplan_parent' }),
          search.createColumn({ name: 'custrecord_pm_revplan_period' }),
        ],
      });

      getAllResults(suiteSearch).forEach((res) => {
        const phaseId = res.getValue({ name: 'custrecord_pm_revplan_parent' });
        const periodRaw = res.getValue({
          name: 'custrecord_pm_revplan_period',
        });
        if (!phaseId || !periodRaw) return;
        const periodDate = parseDateAny(periodRaw);
        if (!periodDate) return;
        const key = `${String(phaseId)}_${formatDateKey(periodDate)}`;
        map[key] = true;
      });
    });

    return map;
  }

  function getGuideStatusByMonth(phaseIds, expectedMonthKeys) {
    const ids = Array.isArray(phaseIds)
      ? phaseIds.filter(Boolean).map(String)
      : [];
    const expected = Array.isArray(expectedMonthKeys)
      ? expectedMonthKeys.filter(Boolean).map(String)
      : [];
    if (!ids.length || !expected.length) return {};

    const byPhase = {};
    const chunks = chunkArray(ids, 900);
    chunks.forEach((chunk) => {
      const suiteSearch = search.create({
        type: 'customrecord_pm_revenue_plan',
        filters: [
          ['isinactive', 'is', 'F'],
          'AND',
          ['custrecord_pm_revplan_parent', 'anyof', ...chunk],
        ],
        columns: [
          search.createColumn({ name: 'custrecord_pm_revplan_parent' }),
          search.createColumn({ name: 'custrecord_pm_revplan_period' }),
          search.createColumn({ name: 'custrecord_pm_revplan_status' }),
        ],
      });

      getAllResults(suiteSearch).forEach((res) => {
        const phaseId = String(
          res.getValue({ name: 'custrecord_pm_revplan_parent' }) || '',
        ).trim();
        const periodRaw = res.getValue({
          name: 'custrecord_pm_revplan_period',
        });
        const statusId = String(
          res.getValue({ name: 'custrecord_pm_revplan_status' }) || '',
        ).trim();
        if (!phaseId || !periodRaw || !statusId) return;
        const periodDate = parseDateAny(periodRaw);
        if (!periodDate) return;
        const monthKey = formatDateKey(
          new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 0),
        );
        if (!monthKey) return;

        if (!byPhase[phaseId]) byPhase[phaseId] = {};
        // Keep first seen status for that month as guide.
        if (!byPhase[phaseId][monthKey]) byPhase[phaseId][monthKey] = statusId;
      });
    });

    // Pick the phase that gives the best status guidance for already-existing
    // months. This preserves completed/open states for backfilled months even
    // when the project end date is extended to a brand-new future month.
    let guidePhaseId = '';
    let bestCoverage = -1;
    ids.forEach((phaseId) => {
      const m = byPhase[String(phaseId)] || {};
      const coverage = expected.reduce(
        (count, key) => count + (m[key] ? 1 : 0),
        0,
      );
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        guidePhaseId = String(phaseId);
      }
    });

    if (!guidePhaseId || bestCoverage <= 0) return {};
    return byPhase[guidePhaseId] || {};
  }

  function createRevenuePlan({
    projectId,
    phaseId,
    month,
    year,
    periodDate,
    statusId,
  }) {
    const rec = record.create({ type: 'customrecord_pm_revenue_plan' });
    rec.setValue({ fieldId: 'name', value: `RP-${phaseId}-${year}-${month}` });
    rec.setValue({
      fieldId: 'custrecord_pm_revplan_project',
      value: String(projectId),
    });
    rec.setValue({
      fieldId: 'custrecord_pm_revplan_parent',
      value: String(phaseId),
    });
    rec.setValue({
      fieldId: 'custrecord_pm_revplan_period',
      value: periodDate,
    });
    rec.setValue({ fieldId: 'custrecord_pm_revplan_qty', value: 0 });
    rec.setValue({
      fieldId: 'custrecord_pm_revplan_status',
      value: statusId || pmConfig.LIST_IDS.REV_PLAN_STATUS.OPEN,
    });
    rec.setValue({
      fieldId: 'custrecord_pm_revplan_type',
      value: getRevenueType(periodDate, projectId),
    });
    return rec.save();
  }

  function updatePhaseStatus(phaseId) {
    try {
      record.submitFields({
        type: 'customrecord_pm_project_phase',
        id: String(phaseId),
        values: {
          custrecord_pm_phase_status:
            pmConfig.LIST_IDS.PHASE_STATUS.REV_PLAN_CREATED,
        },
        options: { enableSourcing: false, ignoreMandatoryFields: true },
      });
    } catch (e) {
      log?.error?.({
        title: 'PHASE_STATUS_UPDATE_FAILED',
        details: { phaseId: String(phaseId), message: e?.message || String(e) },
      });
    }
  }

  function refreshPhaseContingencyForPhaseIds(phaseIds) {
    const ids = Array.isArray(phaseIds)
      ? phaseIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (!ids.length) return;

    const definedQtyByPhaseId = {};
    const phaseChunks = chunkArray(ids, 900);
    phaseChunks.forEach((chunk) => {
      const phaseSearch = search.create({
        type: 'customrecord_pm_project_phase',
        filters: [['internalid', 'anyof', ...chunk]],
        columns: [
          search.createColumn({ name: 'internalid' }),
          search.createColumn({ name: 'custrecord_pm_phase_qty' }),
        ],
      });
      getAllResults(phaseSearch).forEach((res) => {
        const phaseId = String(res.getValue({ name: 'internalid' }) || '').trim();
        if (!phaseId) return;
        definedQtyByPhaseId[phaseId] = toNumber(
          res.getValue({ name: 'custrecord_pm_phase_qty' }) || 0,
        );
      });
    });

    const allocatedQtyByPhaseId = {};
    const chunks = chunkArray(ids, 900);
    chunks.forEach((chunk) => {
      const suiteSearch = search.create({
        type: 'customrecord_pm_revenue_plan',
        filters: [
          ['isinactive', 'is', 'F'],
          'AND',
          ['custrecord_pm_revplan_parent', 'anyof', ...chunk],
        ],
        columns: [
          search.createColumn({ name: 'custrecord_pm_revplan_parent' }),
          search.createColumn({ name: 'custrecord_pm_revplan_qty' }),
        ],
      });

      getAllResults(suiteSearch).forEach((res) => {
        const phaseId = String(
          res.getValue({ name: 'custrecord_pm_revplan_parent' }) || '',
        ).trim();
        if (!phaseId) return;
        allocatedQtyByPhaseId[phaseId] =
          toNumber(allocatedQtyByPhaseId[phaseId] || 0) +
          toNumber(res.getValue({ name: 'custrecord_pm_revplan_qty' }) || 0);
      });
    });

    ids.forEach((phaseId) => {
      const definedQty = toNumber(definedQtyByPhaseId[phaseId] || 0);
      const allocatedQty = toNumber(allocatedQtyByPhaseId[phaseId] || 0);
      const contingencyQty = definedQty - allocatedQty;
      try {
        record.submitFields({
          type: 'customrecord_pm_project_phase',
          id: phaseId,
          values: {
            custrecord_pm_phase_ctg_qty: contingencyQty,
          },
          options: { enableSourcing: false, ignoreMandatoryFields: true },
        });
      } catch (e) {
        log?.error?.({
          title: 'PHASE_CONTINGENCY_UPDATE_FAILED',
          details: {
            phaseId,
            definedQty,
            allocatedQty,
            contingencyQty,
            message: e?.message || String(e),
          },
        });
      }
    });
  }

  function generateRevenuePlans(payload) {
    try {
      const projectId = payload?.projectId ? String(payload.projectId) : '';
      const bypassVarianceCheck =
        parseBooleanLike(payload?.bypassVarianceCheck) === true;
      if (!projectId)
        return { status: 'ERROR', message: 'projectId is required' };

      const projectStatus = projectFinancialsMod.getProjectStatus(projectId);
      if (statuses.isTerminalProjectStatus(projectStatus?.key)) {
        return {
          status: 'ERROR',
          name: 'PROJECT_FROZEN',
          message:
            'Project is Completed or Closed. Revenue plans cannot be generated.',
        };
      }
      const financials = projectFinancialsMod.getProjectFinancials(projectId);
      const varianceCheck = validator.isVarianceWithinTolerance(financials);
      log.audit({
        title: 'PM_REVPLAN_GENERATE_VARIANCE_CHECK',
        details: {
          projectId,
          bypassVarianceCheck,
          status: projectStatus || null,
          variance: toNumber(financials?.totals?.variance || 0),
          varianceAbs: varianceCheck.variance,
          effectiveTolerance:
            varianceCheck.tolerance?.effectiveTolerance || null,
          selectedSource: varianceCheck.tolerance?.selectedSource || null,
          ok: varianceCheck.ok,
        },
      });
      if (!bypassVarianceCheck) {
        const varianceErr = validator.validateActiveAndZeroVariance({
          status: projectStatus,
          statusValueKey: projectStatus?.key || null,
          financials,
          message:
            'Project must be Active/On Hold and within variance tolerance before generating revenue plans.',
        });
        if (varianceErr) return varianceErr;
      }

      log.error('Before project validation', payload);

      const project = validateProject(projectId);

      log.error('After project validation', project);

      if (!project.isValid) {
        return { status: 'WARNING', type: 'WARNING', message: project.message };
      }

      const phaseIds = getProjectPhaseIds(projectId);

      log.error('After fetching phase ids', { phaseIds });

      if (!phaseIds.length) {
        return {
          status: 'WARNING',
          type: 'WARNING',
          message: 'No phases found',
        };
      }

      const months = iterateMonthsInclusive(project.startDate, project.endDate);
      if (!months.length) {
        return {
          status: 'WARNING',
          type: 'WARNING',
          message: 'No months found between project start/end date',
        };
      }

      const expectedMonthKeys = months.map((m) =>
        formatDateKey(new Date(m.year, m.month, 0)),
      );
      const existingMap = getExistingRevenuePlans(phaseIds);
      const guideStatusByMonth = getGuideStatusByMonth(
        phaseIds,
        expectedMonthKeys,
      );
      let createdCount = 0;
      let existingTotal = 0;
      const phasesToUpdate = new Set();

      phaseIds.forEach((phaseId) => {
        months.forEach((m) => {
          const periodDate = new Date(m.year, m.month, 0);
          const key = `${phaseId}_${formatDateKey(periodDate)}`;

          if (existingMap[key]) {
            existingTotal++;
            return;
          }

          try {
            createRevenuePlan({
              projectId,
              phaseId,
              month: m.month,
              year: m.year,
              periodDate,
              statusId:
                guideStatusByMonth[formatDateKey(periodDate)] ||
                pmConfig.LIST_IDS.REV_PLAN_STATUS.OPEN,
            });

            createdCount++;
            phasesToUpdate.add(String(phaseId));
          } catch (e) {
            log.error('Failed to create revenue plan', e);
          }
        });
      });

      phasesToUpdate.forEach((phaseId) => updatePhaseStatus(phaseId));
      refreshPhaseContingencyForPhaseIds(phaseIds);

      if (createdCount === 0 && existingTotal > 0) {
        return {
          status: 'SUCCESS',
          type: 'EXISTING',
          message: `${existingTotal} revenue plan(s) already exist`,
          createdCount,
          existingTotal,
        };
      }

      return {
        status: 'SUCCESS',
        type: 'CREATED',
        message: `${createdCount} plans created`,
        createdCount,
        existingTotal,
      };
    } catch (e) {
      if (e?.name === 'STATUS_MAPPING_MISSING') throw e;
      return { status: 'ERROR', message: e?.message || String(e) };
    }
  }

  function updateRevenuePlans(payload) {
    try {
      const projectId = payload?.projectId ? String(payload.projectId) : '';
      if (!projectId)
        return { status: 'ERROR', message: 'projectId is required' };

      const confirmed = parseBooleanLike(payload?.confirmed);
      if (confirmed == null)
        return { status: 'ERROR', message: 'confirmed must be true/false' };

      const phasesData = Array.isArray(payload?.phasesData)
        ? payload.phasesData
        : [];
      if (!phasesData.length)
        return {
          status: 'ERROR',
          message: 'phasesData must be a non-empty array',
        };

      const projectStatus = projectFinancialsMod.getProjectStatus(projectId);
      const projectStatusKey = String(projectStatus?.key || '');
      const isCompletedProject =
        statuses.isCompletedProjectStatus(projectStatusKey);
      const isClosedProject = statuses.isClosedProjectStatus(projectStatusKey);
      if (isClosedProject) {
        return {
          status: 'ERROR',
          name: 'PROJECT_FROZEN',
          message:
            'Project is Completed or Closed. Revenue plans cannot be edited.',
        };
      }
      if (isCompletedProject && !confirmed) {
        return {
          status: 'ERROR',
          name: 'PROJECT_FROZEN',
          message:
            'Project is Completed. Revenue plan allocations cannot be edited.',
        };
      }
      const financials = projectFinancialsMod.getProjectFinancials(projectId);
      const varianceCheck = validator.isVarianceWithinTolerance(financials);
      log.audit({
        title: 'PM_REVPLAN_UPDATE_VARIANCE_CHECK',
        details: {
          projectId,
          status: projectStatus || null,
          variance: toNumber(financials?.totals?.variance || 0),
          varianceAbs: varianceCheck.variance,
          effectiveTolerance:
            varianceCheck.tolerance?.effectiveTolerance || null,
          selectedSource: varianceCheck.tolerance?.selectedSource || null,
          ok: varianceCheck.ok,
        },
      });
      if (!(confirmed && isCompletedProject)) {
        const varianceErr = validator.validateActiveAndZeroVariance({
          status: projectStatus,
          statusValueKey: projectStatus?.key || null,
          financials,
          message:
            'Project must be Active/On Hold and within variance tolerance before updating revenue plans.',
        });
        if (varianceErr) return varianceErr;
      } else if (!varianceCheck.ok) {
        return {
          status: 'ERROR',
          message:
            'Project must be within variance tolerance before submitting revenue plans to finance.',
          details: {
            status: projectStatus || null,
            statusValueKey: projectStatus?.key || null,
            hasNoVariance: false,
            variance: varianceCheck.variance,
            varianceTolerance: varianceCheck.tolerance,
          },
        };
      }

      const project = record.load({
        type: 'customrecord_pm_projects',
        id: projectId,
        isDynamic: false,
      });

      const expectedInfo = validator.getExpectedProjectMonthsAndKeys(
        project.getValue({ fieldId: 'custrecord_pm_project_startdate' }),
        project.getValue({ fieldId: 'custrecord_pm_project_enddate' }),
      );
      const expectedKeys = expectedInfo.keys;
      if (!expectedInfo.months.length) {
        return {
          status: 'ERROR',
          message: 'No months found between project start/end date',
        };
      }
      const companyTz = getCompanyTimeZone(config);
      const current = getCurrentCompanyMonthYear();
      const currentKey = monthKey(current?.year, current?.month);
      const currentNum = monthKeyNumberFromKey(currentKey);
      const workflow = revRecMod.buildRevRecWorkflowState({ projectId });
      if (workflow?.status === 'ERROR') return workflow;
      const submitAction =
        workflow?.submitToFinanceAction &&
        typeof workflow.submitToFinanceAction === 'object'
          ? workflow.submitToFinanceAction
          : null;
      const confirmedTargetMonthKeys = confirmed
        ? Array.isArray(submitAction?.targetMonthKeys)
          ? submitAction.targetMonthKeys.map((value) => String(value || ''))
          : []
        : [];
      let hasActualCompletedUpToCurrentMonth = false;
      let hasActualOpenOrReadyUpToCurrentMonth = false;

      const phaseLineById = {};
      const phaseMaxQty = {};
      const phaseNameById = {};
      const phaseCtgQtyById = {};
      const phaseLineCount =
        project.getLineCount({
          sublistId: 'recmachcustrecord_pm_phase_parent',
        }) || 0;
      for (let line = 0; line < phaseLineCount; line++) {
        const id = getSublistLineInternalId(
          project,
          'recmachcustrecord_pm_phase_parent',
          line,
        );
        if (!id) continue;
        phaseLineById[id] = line;
        const maxQty = toNumber(
          project.getSublistValue({
            sublistId: 'recmachcustrecord_pm_phase_parent',
            fieldId: 'custrecord_pm_phase_qty',
            line,
          }),
        );
        const phaseName = String(
          project.getSublistValue({
            sublistId: 'recmachcustrecord_pm_phase_parent',
            fieldId: 'name',
            line,
          }) || '',
        ).trim();
        const contingencyQty = toNumber(
          project.getSublistValue({
            sublistId: 'recmachcustrecord_pm_phase_parent',
            fieldId: 'custrecord_pm_phase_ctg_qty',
            line,
          }) || 0,
        );
        phaseMaxQty[id] = maxQty;
        phaseNameById[id] = phaseName || id;
        phaseCtgQtyById[id] = contingencyQty;
      }

      const planLineById = {};
      const planInfoById = {};
      const phaseTotals = {};
      const phaseMonthKeys = {};

      const planLineCount =
        project.getLineCount({
          sublistId: 'recmachcustrecord_pm_revplan_project',
        }) || 0;
      for (let line = 0; line < planLineCount; line++) {
        const id = getSublistLineInternalId(
          project,
          'recmachcustrecord_pm_revplan_project',
          line,
        );
        if (!id) continue;

        const phaseId = project.getSublistValue({
          sublistId: 'recmachcustrecord_pm_revplan_project',
          fieldId: 'custrecord_pm_revplan_parent',
          line,
        });
        const periodRaw = project.getSublistValue({
          sublistId: 'recmachcustrecord_pm_revplan_project',
          fieldId: 'custrecord_pm_revplan_period',
          line,
        });
        const qty = toNumber(
          project.getSublistValue({
            sublistId: 'recmachcustrecord_pm_revplan_project',
            fieldId: 'custrecord_pm_revplan_qty',
            line,
          }),
        );
        const typeText = getSublistTextSafe(
          project,
          'recmachcustrecord_pm_revplan_project',
          'custrecord_pm_revplan_type',
          line,
        );
        const typeValue = project.getSublistValue({
          sublistId: 'recmachcustrecord_pm_revplan_project',
          fieldId: 'custrecord_pm_revplan_type',
          line,
        });
        const typeRaw = String(typeText || typeValue || '')
          .trim()
          .toLowerCase();
        const isActual = typeRaw === 'actual' || typeRaw.includes('actual');
        const statusText = getSublistTextSafe(
          project,
          'recmachcustrecord_pm_revplan_project',
          'custrecord_pm_revplan_status',
          line,
        );
        const statusValue = project.getSublistValue({
          sublistId: 'recmachcustrecord_pm_revplan_project',
          fieldId: 'custrecord_pm_revplan_status',
          line,
        });
        const statusValueKey = mapRevPlanStatusStrict({
          id: statusValue,
          text: statusText,
          contextAction: 'updateRevenuePlans.scanSublist',
        }).key;

        let planMonthKey = '';
        let isActualUpToCurrentMonth = false;
        if (periodRaw) {
          const periodDate = parseDateAny(periodRaw);
          const ym = periodDate
            ? getYearMonthInTimeZone(periodDate, companyTz)
            : null;
          planMonthKey = ym ? monthKey(ym.year, ym.month) : '';
          const periodNum = monthKeyNumberFromKey(planMonthKey);
          isActualUpToCurrentMonth =
            Boolean(isActual) &&
            currentNum != null &&
            periodNum != null &&
            periodNum <= currentNum;
        }
        if (isActualUpToCurrentMonth) {
          if (statusValueKey === statuses.REVPLAN_STATUS_KEYS.COMPLETED)
            hasActualCompletedUpToCurrentMonth = true;
          if (isRevenueReadyStatusKey(statusValueKey))
            hasActualOpenOrReadyUpToCurrentMonth = true;
        }

        planLineById[id] = line;
        planInfoById[id] = {
          line,
          phaseId: phaseId ? String(phaseId) : '',
          oldQty: qty,
          status: {
            key: statusValueKey,
            label: revPlanStatusLabelForKey(statusValueKey),
          },
          statusText: statusText || null,
          isActual,
          monthKey: planMonthKey,
          isActualUpToCurrentMonth,
        };
        const lockInfo = getRevPlanEditLock({
          statusValueKey,
          planMonthKey,
          currentMonthNum: currentNum,
        });
        planInfoById[id].isLockedForEdit = Boolean(lockInfo.isLockedForEdit);
        planInfoById[id].lockReason = String(lockInfo.lockReason || '');

        const pid = phaseId ? String(phaseId) : '';
        if (!phaseTotals[pid]) phaseTotals[pid] = 0;
        phaseTotals[pid] += qty;

        if (pid && periodRaw) {
          const periodDate = parseDateAny(periodRaw);
          const ym = periodDate
            ? getYearMonthInTimeZone(periodDate, companyTz)
            : null;
          const key = ym ? monthKey(ym.year, ym.month) : '';
          if (key) {
            if (!phaseMonthKeys[pid]) phaseMonthKeys[pid] = new Set();
            phaseMonthKeys[pid].add(key);
          }

          planInfoById[id].isCurrentMonth =
            Boolean(currentKey) && key === currentKey;
        }
      }

      const isPostJournalState =
        Boolean(hasActualCompletedUpToCurrentMonth) &&
        !Boolean(hasActualOpenOrReadyUpToCurrentMonth);
      if (confirmed && isPostJournalState) {
        return {
          status: 'ERROR',
          message:
            'Rev Rec journal has already been generated for this month. Submit to Finance is not available.',
        };
      }
      if (confirmed && !confirmedTargetMonthKeys.length) {
        return {
          status: 'ERROR',
          message:
            submitAction?.reason ||
            'No rev plan allocations are Open for submission.',
        };
      }

      const monthErr = validator.validatePhaseMonthKeysMatchExpected({
        expectedKeys,
        phaseMonthKeys,
      });
      if (monthErr) return monthErr;

      let payloadUpdates = [];
      const built = validator.buildUpdateRevenuePlansUpdates({
        projectId,
        phasesData,
        phaseLineById,
        planInfoById,
      });
      if (built?.status === 'SUCCESS') {
        payloadUpdates = Array.isArray(built?.updates) ? built.updates : [];
      } else if (!(confirmed && built?.status === 'WARNING')) {
        return built;
      }

      const updatesByPlanId = {};
      payloadUpdates.forEach((update) => {
        if (!update?.planId) return;
        updatesByPlanId[String(update.planId)] = update;
      });

      if (confirmed) {
        const targetMonthKeySet = new Set(confirmedTargetMonthKeys);
        Object.keys(planInfoById || {}).forEach((planId) => {
          const info = planInfoById[planId];
          const monthKey = String(info?.monthKey || '');
          if (!monthKey || !targetMonthKeySet.has(monthKey)) return;
          if (Boolean(info?.isLockedForEdit)) return;
          if (
            String(info?.status?.key || '') ===
            statuses.REVPLAN_STATUS_KEYS.COMPLETED
          )
            return;
          if (updatesByPlanId[planId]) return;

          updatesByPlanId[planId] = {
            phaseId: info?.phaseId ? String(info.phaseId) : '',
            planId: String(planId),
            line: info?.line,
            monthKey,
            oldQty: info?.oldQty,
            newQty: info?.oldQty,
            oldStatusValueKey: info?.status?.key || null,
            isActual: Boolean(info?.isActual),
            isCurrentMonth: Boolean(info?.isCurrentMonth),
            isActualUpToCurrentMonth: Boolean(info?.isActualUpToCurrentMonth),
          };
        });
      }

      const updates = Object.values(updatesByPlanId);
      if (!updates.length) {
        return {
          status: 'WARNING',
          message: 'No plans provided',
          updated: 0,
          skipped: 0,
        };
      }

      let updated = 0;
      let skipped = 0;
      let changed = false;

      const nextStatusText = confirmed ? 'Rev Rec Ready' : 'Open';
      const OPEN_KEY = 'open';
      const actualTypeId =
        pmConfig?.LIST_IDS?.REV_PLAN_TYPE?.ACTUAL != null
          ? Number(pmConfig.LIST_IDS.REV_PLAN_TYPE.ACTUAL)
          : 1;

      // Pre-simulate all qty changes per phase and validate only the final
      // cumulative total. Individual plans may be negative (e.g. credit lines),
      // so we must not validate mid-loop intermediates.
      const simulatedTotals = {};
      for (const u of updates) {
        const base =
          simulatedTotals[u.phaseId] !== undefined
            ? simulatedTotals[u.phaseId]
            : toNumber(phaseTotals[u.phaseId] ?? 0);
        simulatedTotals[u.phaseId] =
          base - toNumber(u.oldQty) + toNumber(u.newQty);
      }
      for (const phaseId of Object.keys(simulatedTotals)) {
        const maxQty = toNumber(phaseMaxQty[phaseId] ?? 0);
        const simulatedTotal = simulatedTotals[phaseId];
        const submitted = (Array.isArray(phasesData) ? phasesData : []).find(
          (p) => String(p?.phaseId || '') === String(phaseId),
        );
        const contingencyQty =
          submitted != null
            ? toNumber(submitted?.contingency || 0)
            : toNumber(phaseCtgQtyById[phaseId] ?? 0);
        const totalWithContingency = simulatedTotal + contingencyQty;
        if (simulatedTotal < 0 || simulatedTotal > maxQty) {
          const phaseLabel = phaseNameById[phaseId] || String(phaseId);
          return {
            status: 'ERROR',
            message: `Phase "${phaseLabel}" cumulative quantity would be out of bounds`,
            details: { phaseId: String(phaseId), phaseName: phaseLabel, simulatedTotal, min: 0, max: maxQty },
          };
        }
        if (Math.abs(totalWithContingency - maxQty) > 0.0001) {
          const phaseLabel = phaseNameById[phaseId] || String(phaseId);
          return {
            status: 'ERROR',
            message: `Phase "${phaseLabel}" contingency must equal Total Qty - (Actual + Forecast).`,
            details: {
              phaseId: String(phaseId),
              phaseName: phaseLabel,
              totalQty: maxQty,
              actualForecastQty: simulatedTotal,
              contingencyQty,
              requiredContingency: maxQty - simulatedTotal,
            },
          };
        }
      }

      for (const u of updates) {
        if (isPostJournalState && u.isActualUpToCurrentMonth) {
          if (toNumber(u.oldQty) !== toNumber(u.newQty)) {
            return {
              status: 'ERROR',
              message: `Actual revenue plan ${String(u.planId)} cannot be modified after journal generation for this month.`,
            };
          }
        }

        const qtyChanged = toNumber(u.oldQty) !== toNumber(u.newQty);
        const isTargetMonth = confirmed
          ? confirmedTargetMonthKeys.includes(String(u.monthKey || ''))
          : false;
        const typeWillChange =
          confirmed && isTargetMonth && !Boolean(u.isActual);

        let statusWillChange = false;
        if (confirmed) {
          statusWillChange =
            Boolean(isTargetMonth) &&
            u.oldStatusValueKey !== statuses.REVPLAN_STATUS_KEYS.COMPLETED;
        } else {
          statusWillChange = isPostJournalState
            ? false
            : u.oldStatusValueKey !== OPEN_KEY;
        }

        if (!qtyChanged && !statusWillChange && !typeWillChange) {
          skipped++;
          continue;
        }

        if (qtyChanged) {
          project.setSublistValue({
            sublistId: 'recmachcustrecord_pm_revplan_project',
            fieldId: 'custrecord_pm_revplan_qty',
            line: u.line,
            value: u.newQty,
          });
        }

        if (typeWillChange) {
          project.setSublistValue({
            sublistId: 'recmachcustrecord_pm_revplan_project',
            fieldId: 'custrecord_pm_revplan_type',
            line: u.line,
            value: actualTypeId,
          });
        }

        if (statusWillChange) {
          project.setSublistText({
            sublistId: 'recmachcustrecord_pm_revplan_project',
            fieldId: 'custrecord_pm_revplan_status',
            line: u.line,
            text: nextStatusText,
          });
        }

        updated++;
        changed = true;
      }

      // Completed projects still allow submit-to-finance, but not note or
      // contingency edits.
      if (!isCompletedProject) {
        for (const phaseData of phasesData) {
          const phaseId = phaseData?.phaseId ? String(phaseData.phaseId) : '';
          if (!phaseId || phaseLineById[phaseId] == null) continue;
          const note = phaseData?.note != null ? String(phaseData.note) : '';
          const contingency = toNumber(phaseData?.contingency || 0);
          project.setSublistValue({
            sublistId: 'recmachcustrecord_pm_phase_parent',
            fieldId: 'custrecord_pm_phase_note',
            line: phaseLineById[phaseId],
            value: note,
          });
          project.setSublistValue({
            sublistId: 'recmachcustrecord_pm_phase_parent',
            fieldId: 'custrecord_pm_phase_ctg_qty',
            line: phaseLineById[phaseId],
            value: contingency,
          });
          changed = true;
        }
      }

      if (changed) {
        project.save({ enableSourcing: false, ignoreMandatoryFields: true });
      }

      return {
        status: 'SUCCESS',
        message: `${updated} updated, ${skipped} skipped`,
        updated,
        skipped,
        targetMonthKeys: confirmedTargetMonthKeys,
        targetMonthLabels: confirmed
          ? Array.isArray(submitAction?.targetMonthLabels)
            ? submitAction.targetMonthLabels.map((value) => String(value || ''))
            : []
          : [],
      };
    } catch (e) {
      if (e?.name === 'STATUS_MAPPING_MISSING') throw e;
      return { status: 'ERROR', message: e?.message || e };
    }
  }

  function reopenActualRevenuePlans({ projectId } = {}) {
    try {
      const pid = projectId ? String(projectId) : '';
      if (!pid) return { status: 'ERROR', message: 'projectId is required' };
      const projectStatus = projectFinancialsMod.getProjectStatus(pid);
      if (statuses.isTerminalProjectStatus(projectStatus?.key)) {
        return {
          status: 'ERROR',
          name: 'PROJECT_FROZEN',
          message:
            'Project is Completed or Closed. Revenue plans cannot be reopened.',
        };
      }

      const project = record.load({
        type: 'customrecord_pm_projects',
        id: pid,
        isDynamic: false,
      });

      const planLineCount =
        project.getLineCount({
          sublistId: 'recmachcustrecord_pm_revplan_project',
        }) || 0;
      let updated = 0;

      for (let line = 0; line < planLineCount; line++) {
        const typeText = getSublistTextSafe(
          project,
          'recmachcustrecord_pm_revplan_project',
          'custrecord_pm_revplan_type',
          line,
        );
        const typeValue = project.getSublistValue({
          sublistId: 'recmachcustrecord_pm_revplan_project',
          fieldId: 'custrecord_pm_revplan_type',
          line,
        });
        const typeRaw = String(typeText || typeValue || '')
          .trim()
          .toLowerCase();
        const isActual = typeRaw === 'actual' || typeRaw.includes('actual');
        if (!isActual) continue;

        const statusText = getSublistTextSafe(
          project,
          'recmachcustrecord_pm_revplan_project',
          'custrecord_pm_revplan_status',
          line,
        );
        const statusValue = project.getSublistValue({
          sublistId: 'recmachcustrecord_pm_revplan_project',
          fieldId: 'custrecord_pm_revplan_status',
          line,
        });
        const statusValueKey = mapRevPlanStatusStrict({
          id: statusValue,
          text: statusText,
          contextAction: 'reopenActualRevenuePlans.scanSublist',
        }).key;

        if (statusValueKey !== statuses.REVPLAN_STATUS_KEYS.REV_REC_READY)
          continue;

        project.setSublistText({
          sublistId: 'recmachcustrecord_pm_revplan_project',
          fieldId: 'custrecord_pm_revplan_status',
          line,
          text: 'Open',
        });
        updated++;
      }

      if (updated > 0) {
        project.save({ enableSourcing: false, ignoreMandatoryFields: true });
      }

      return { status: 'SUCCESS', updated };
    } catch (e) {
      if (e?.name === 'STATUS_MAPPING_MISSING') throw e;
      return { status: 'ERROR', message: e?.message || e };
    }
  }

  return {
    normalizeRevPlanStatusKey,
    revPlanStatusLabelForKey,
    getProjectActualRevPlanRollups,
    rollProjectCurrentMonthRevPlansActual,
    getProjectRevenueReadyRollups,
    getProjectRevPlanStatusRollups,
    getProjectRevPlans,
    generateRevenuePlans,
    updateRevenuePlans,
    reopenActualRevenuePlans,
  };
});
