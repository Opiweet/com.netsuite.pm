/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
  'N/query',
  'N/search',
  'N/record',
  'N/config',
  'N/runtime',
  'N/log',
  '../../pm_config',
  '../core/helper',
  '../core/statuses',
  '../core/validator',
  './project_financials_mod',
  './project_month_context_mod',
], (
  query,
  search,
  record,
  config,
  runtime,
  log,
  pmConfig,
  helper,
  statuses,
  validator,
  projectFinancialsMod,
  projectMonthContextMod,
) => {
  const {
    getAllResults,
    toNumber,
    getYearMonthInTimeZone,
    getCompanyTimeZone,
    monthKey,
    monthKeyNumberFromKey,
    monthLabel,
  } = helper;
  const { getProjectNameById, getProjectSegmentValueIdByName } = validator;
  const { getProjectFinancials, toNsDateFilter } = projectFinancialsMod;
  const {
    getEffectivePeriodInfo: getEffectivePeriodContext,
    periodInfoFromYearMonth,
  } = projectMonthContextMod;
  const STATUS_OPEN = statuses.REVPLAN_STATUS_KEYS.OPEN;
  const STATUS_READY = statuses.REVPLAN_STATUS_KEYS.REV_REC_READY;
  const STATUS_COMPLETED = statuses.REVPLAN_STATUS_KEYS.COMPLETED;
  const PROJECT_REV_ACCOUNTS_FIELD = 'custrecord_pm_project_rev_accounts_used';
  function toLogDetails(value) {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
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

  function getConfiguredAccounts() {
    const revenueFromParam = getCurrentScriptParam('custscript_pm_rev_acc');
    const deferredFromParam = getCurrentScriptParam(
      'custscript_pm_def_rev_acc',
    );
    const unbilledFromParam = getCurrentScriptParam(
      'custscript_pm_unbilled_rec_acc',
    );

    return {
      REVENUE: revenueFromParam,
      DEFERRED_REVENUE: deferredFromParam,
      UNBILLED_RECEIVABLE: unbilledFromParam,
    };
  }

  function normalizeAccountIdList(values) {
    const seen = {};
    const out = [];
    (Array.isArray(values) ? values : []).forEach((raw) => {
      const id = String(raw == null ? '' : raw).trim();
      if (!/^\d+$/.test(id) || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out.sort((a, b) => Number(a) - Number(b));
  }

  function parsePipeDelimitedAccountIds(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    return normalizeAccountIdList(
      text
        .split('|')
        .map((v) => String(v || '').trim())
        .filter(Boolean),
    );
  }

  function formatPipeDelimitedAccountIds(ids) {
    const normalized = normalizeAccountIdList(ids);
    if (!normalized.length) return '';
    return normalized.join('|');
  }

  function getProjectRevenueAccountIds(
    projectId,
    { includeCurrent = true } = {},
  ) {
    const pid = String(projectId || '').trim();
    const ids = [];
    if (pid) {
      try {
        const fields = search.lookupFields({
          type: 'customrecord_pm_projects',
          id: pid,
          columns: [PROJECT_REV_ACCOUNTS_FIELD],
        });
        ids.push(
          ...parsePipeDelimitedAccountIds(fields?.[PROJECT_REV_ACCOUNTS_FIELD]),
        );
      } catch (e) {
        // ignore
      }
    }

    if (includeCurrent) {
      ids.push(String(getConfiguredAccounts()?.REVENUE || '').trim());
    }

    return normalizeAccountIdList(ids);
  }

  function upsertProjectRevenueAccountsUsed(projectId, revenueAccountId) {
    const pid = String(projectId || '').trim();
    const accountId = String(revenueAccountId || '').trim();
    if (!pid || !/^\d+$/.test(accountId)) return;

    const merged = normalizeAccountIdList([
      ...getProjectRevenueAccountIds(pid, { includeCurrent: false }),
      accountId,
    ]);
    const serialized = formatPipeDelimitedAccountIds(merged);

    try {
      record.submitFields({
        type: 'customrecord_pm_projects',
        id: pid,
        values: {
          [PROJECT_REV_ACCOUNTS_FIELD]: serialized,
        },
        options: { enableSourcing: false, ignoreMandatoryFields: true },
      });
    } catch (e) {
      log?.error?.({
        title: 'REV_REC_UPDATE_PROJECT_ACCOUNTS_FAILED',
        details: {
          projectId: pid,
          revenueAccountId: accountId,
          message: e?.message || String(e),
        },
      });
    }
  }

  function getEffectivePeriodInfo(options) {
    return getEffectivePeriodContext(options || {})?.effective || null;
  }

  function parseMonthKeyToInfo(key) {
    const num = monthKeyNumberFromKey(key);
    if (num == null) return null;
    const year = Math.floor(num / 100);
    const month = num % 100;
    return periodInfoFromYearMonth({ year, month });
  }

  function monthKeysBetweenInclusive(startKey, endKey) {
    const startNum = monthKeyNumberFromKey(startKey);
    const endNum = monthKeyNumberFromKey(endKey);
    if (startNum == null || endNum == null || startNum > endNum) return [];

    const out = [];
    let y = Math.floor(startNum / 100);
    let m = startNum % 100;
    const endY = Math.floor(endNum / 100);
    const endM = endNum % 100;

    while (y < endY || (y === endY && m <= endM)) {
      out.push(monthKey(y, m));
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out;
  }

  function normalizeProjectIds(projectIds) {
    const out = [];
    const seen = {};
    (Array.isArray(projectIds) ? projectIds : []).forEach((value) => {
      const id = String(value || '').trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function getProjectStatus(projectId) {
    if (!projectId) return null;
    try {
      const fields = search.lookupFields({
        type: 'customrecord_pm_projects',
        id: String(projectId),
        columns: ['custrecord_pm_project_status'],
      });
      const statusId =
        fields?.custrecord_pm_project_status?.[0]?.value ||
        fields?.custrecord_pm_project_status?.[0]?.id ||
        '';
      const statusText =
        fields?.custrecord_pm_project_status?.[0]?.text ||
        fields?.custrecord_pm_project_status?.[0]?.value ||
        '';
      return statuses.mapNetSuiteStatusStrict(statuses.ENTITY_TYPES.PROJECT, {
        id: statusId,
        text: statusText,
        logger: log,
        logTitle: 'STATUS_MAPPING_UNKNOWN_READ',
      });
    } catch (e) {
      if (e?.name === 'STATUS_MAPPING_MISSING') throw e;
      return null;
    }
  }

  function getProjectAreaSegment(projectId) {
    const pid = String(projectId || '').trim();
    if (!pid) return { customerId: '', id: '', text: '' };
    try {
      const projectFields = search.lookupFields({
        type: 'customrecord_pm_projects',
        id: pid,
        columns: ['custrecord_pm_project_customer'],
      });
      const customerId = String(
        projectFields?.custrecord_pm_project_customer?.[0]?.value || '',
      ).trim();
      if (!customerId) return { customerId: '', id: '', text: '' };

      const customerFields = search.lookupFields({
        type: search.Type.CUSTOMER,
        id: customerId,
        columns: ['cseg_area'],
      });
      return {
        customerId,
        id: String(customerFields?.cseg_area?.[0]?.value || '').trim(),
        text: String(customerFields?.cseg_area?.[0]?.text || '').trim(),
      };
    } catch (e) {
      return { customerId: '', id: '', text: '' };
    }
  }

  function validateProjectRevRecEligibility({ projectId, financials } = {}) {
    const pid = String(projectId || '').trim();
    if (!pid) {
      return {
        status: 'ERROR',
        name: 'BAD_REQUEST',
        message: 'projectId is required.',
      };
    }

    const projectStatus = getProjectStatus(pid);
    const statusValueKey = String(projectStatus?.key || '');
    if (statuses.isClosedProjectStatus(statusValueKey)) {
      return {
        status: 'ERROR',
        name: 'REV_REC_STATUS_BLOCKED',
        message:
          'Rev rec journal can’t be generated because project is Closed.',
        details: { projectId: pid, status: projectStatus || null },
      };
    }
    const canRunRevRec =
      statuses.isOperationalProjectStatus(statusValueKey) ||
      statuses.isCompletedProjectStatus(statusValueKey);
    if (!canRunRevRec) {
      return {
        status: 'ERROR',
        name: 'REV_REC_STATUS_BLOCKED',
        message:
          'Rev rec journal can’t be generated because project is not Active, On Hold, or Completed.',
        details: { projectId: pid, status: projectStatus || null },
      };
    }

    const fin = financials || getProjectFinancials(pid);
    if (!fin) {
      return {
        status: 'ERROR',
        name: 'REV_REC_FINANCIALS_FAILED',
        message:
          'Rev rec journal can’t be generated because project financials/variance could not be calculated.',
        details: { projectId: pid, status: projectStatus || null },
      };
    }

    const variance = toNumber(fin?.totals?.variance || 0);
    const varianceCheck = validator.isVarianceWithinTolerance(fin);
    const hasNoVariance = varianceCheck.ok;
    log.audit({
      title: 'PM_REVREC_VARIANCE_CHECK',
      details: {
        projectId: pid,
        status: projectStatus || null,
        variance,
        varianceAbs: varianceCheck.variance,
        effectiveTolerance: varianceCheck.tolerance?.effectiveTolerance || null,
        selectedSource: varianceCheck.tolerance?.selectedSource || null,
        hasNoVariance,
      },
    });
    if (!hasNoVariance) {
      return {
        status: 'ERROR',
        name: 'REV_REC_VARIANCE_BLOCKED',
        message:
          'Rev rec journal can’t be generated because there is a mismatch between project and sales order amount(s).',
        details: {
          projectId: pid,
          status: projectStatus || null,
          variance,
          varianceTolerance: varianceCheck.tolerance,
        },
      };
    }

    return null;
  }

  function toSqlDateLiteral(dateObj) {
    const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function toSqlTextLiteral(value) {
    return String(value == null ? '' : value).replace(/'/g, "''");
  }

  function getActualRevenuePlanRowsUpToPeriod(projectId, period) {
    const sql = `
      SELECT
        rp.id AS revplanid,
        rp.custrecord_pm_revplan_parent AS phaseid,
        rp.custrecord_pm_revplan_qty AS qty,
        rp.custrecord_pm_revplan_status AS statusid,
        BUILTIN.DF(rp.custrecord_pm_revplan_status) AS statustext,
        rp.custrecord_pm_revplan_period AS perioddate,
        EXTRACT(YEAR FROM rp.custrecord_pm_revplan_period) AS periodyear,
        EXTRACT(MONTH FROM rp.custrecord_pm_revplan_period) AS periodmonth,
        ph.custrecord_pm_phase_dept AS departmentid,
        ph.custrecord_pm_phase_rate AS rate,
        ph.name AS phasetitle,
        ph.custrecord_pm_phase_milestone_desc AS milestonedesc,
        BUILTIN.DF(ph.custrecord_pm_phase_milestone) AS milestonetext
      FROM customrecord_pm_revenue_plan rp
      INNER JOIN customrecord_pm_project_phase ph
        ON ph.id = rp.custrecord_pm_revplan_parent
      WHERE
        rp.isinactive = 'F'
        AND ph.isinactive = 'F'
        AND ph.custrecord_pm_phase_parent = ?
        AND (
          EXTRACT(YEAR FROM rp.custrecord_pm_revplan_period) < ?
          OR (
            EXTRACT(YEAR FROM rp.custrecord_pm_revplan_period) = ?
            AND EXTRACT(MONTH FROM rp.custrecord_pm_revplan_period) <= ?
          )
        )
    `;

    const rows =
      query
        .runSuiteQL({
          query: sql,
          params: [
            Number(projectId),
            Number(period.year),
            Number(period.year),
            Number(period.month),
          ],
        })
        .asMappedResults() || [];

    return rows
      .map((row) => {
        const periodYear = Number(row?.periodyear || 0);
        const periodMonth = Number(row?.periodmonth || 0);
        const resolvedMonthKey =
          Number.isFinite(periodYear) &&
          Number.isFinite(periodMonth) &&
          periodYear > 0 &&
          periodMonth >= 1 &&
          periodMonth <= 12
            ? monthKey(periodYear, periodMonth)
            : '';
        const mappedStatus = statuses.mapNetSuiteStatusStrict(
          statuses.ENTITY_TYPES.REVPLAN,
          {
            id: String(row?.statusid || ''),
            text: String(row?.statustext || ''),
            logger: log,
            logTitle: 'STATUS_MAPPING_UNKNOWN_READ',
          },
        );
        return {
          revPlanId: String(row?.revplanid || ''),
          phaseId: String(row?.phaseid || ''),
          qty: toNumber(row?.qty),
          status: mappedStatus,
          departmentId: String(row?.departmentid || ''),
          rate: toNumber(row?.rate),
          phaseTitle: String(row?.phasetitle || '').trim(),
          milestoneDesc: String(
            row?.milestonedesc || row?.milestonetext || '',
          ).trim(),
          monthKey: resolvedMonthKey,
        };
      })
      .filter((row) => row.revPlanId && row.phaseId && row.monthKey);
  }

  function getLastPostedJournalInfo(projectId) {
    const projectName = String(getProjectNameById(projectId) || '').trim();
    if (!projectName) return { lastPostedMonthKey: null, postedMonthKeys: [] };

    const safeName = toSqlTextLiteral(projectName.toLowerCase());
    const projectSegmentValueId = String(
      getProjectSegmentValueIdByName(projectName) || '',
    ).trim();
    const hasSegmentValueId = /^\d+$/.test(projectSegmentValueId);
    const segmentFilter = hasSegmentValueId
      ? `
        (
          t.cseg_project_seg = ${projectSegmentValueId}
          OR LOWER(BUILTIN.DF(t.cseg_project_seg)) = '${safeName}'
        )
      `
      : `
        (
          LOWER(BUILTIN.DF(t.cseg_project_seg)) = '${safeName}'
        )
      `;
    const sql = `
      SELECT DISTINCT
        TO_CHAR(t.trandate, 'DD/MM/YYYY') AS trandate,
        t.trandate AS actualdate
      FROM transaction t
      WHERE
        t.type = 'Journal'
        AND ${segmentFilter}
        AND (t.isreversal = 'F' OR t.isreversal IS NULL)
        AND (t.voided = 'F' OR t.voided IS NULL)
      ORDER BY actualdate DESC
    `;

    const rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
    log?.audit?.({
      title: 'REV_REC_LAST_POSTED_JOURNAL_LOOKUP',
      details: {
        projectId: String(projectId || ''),
        projectName,
        projectSegmentValueId: hasSegmentValueId ? projectSegmentValueId : null,
        matchedRows: rows.length,
      },
    });
    const postedMonthKeys = [];
    const seen = {};
    let unparsedDateCount = 0;

    rows.forEach((row) => {
      const rawDate = String(row?.trandate || '').trim();
      if (!rawDate) return;

      // NetSuite SuiteQL date output here is account-formatted (e.g. 30/4/2026),
      // so parse explicitly instead of relying on JS Date locale parsing.
      const m = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!m) {
        unparsedDateCount++;
        return;
      }

      const month = Number(m[2]);
      const year = Number(m[3]);
      if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        month < 1 ||
        month > 12
      ) {
        unparsedDateCount++;
        return;
      }

      const key = monthKey(year, month);
      if (!key || seen[key]) return;
      seen[key] = true;
      postedMonthKeys.push(key);
    });

    postedMonthKeys.sort(
      (a, b) =>
        (monthKeyNumberFromKey(a) || 0) - (monthKeyNumberFromKey(b) || 0),
    );
    const lastPostedMonthKey = postedMonthKeys.length
      ? postedMonthKeys[postedMonthKeys.length - 1]
      : null;
    log?.audit?.({
      title: 'REV_REC_LAST_POSTED_JOURNAL_RESULT',
      details: {
        projectId: String(projectId || ''),
        lastPostedMonthKey,
        postedMonthKeys,
        unparsedDateCount,
      },
    });

    return { lastPostedMonthKey, postedMonthKeys };
  }

  function isMonthLocked(monthInfo) {
    if (!monthInfo?.monthEnd) return false;

    try {
      const periodDate = toSqlDateLiteral(monthInfo.monthEnd);
      if (!periodDate) return false;

      const suiteSearch = search.create({
        type: 'accountingperiod',
        filters: [
          ['isposting', 'is', 'T'],
          'AND',
          ['startdate', 'onorbefore', periodDate],
          'AND',
          ['enddate', 'onorafter', periodDate],
        ],
        columns: [
          search.createColumn({ name: 'closed' }),
          search.createColumn({ name: 'alllocked' }),
        ],
      });

      const first =
        suiteSearch.run().getRange({ start: 0, end: 1 })?.[0] || null;
      if (!first) return false;

      const closed = String(first.getValue({ name: 'closed' }) || 'F') === 'T';
      const allLocked =
        String(first.getValue({ name: 'alllocked' }) || 'F') === 'T';
      return Boolean(closed || allLocked);
    } catch (e) {
      return false;
    }
  }

  function monthPlansReady(monthPlans) {
    const plans = Array.isArray(monthPlans) ? monthPlans : [];
    if (!plans.length) return false;
    const hasReady = plans.some(
      (plan) => String(plan?.status?.key || '').toLowerCase() === STATUS_READY,
    );
    if (!hasReady) return false;
    return plans.every((plan) => {
      const key = String(plan?.status?.key || '').toLowerCase();
      return key === STATUS_READY || key === STATUS_COMPLETED;
    });
  }

  function monthPlansReadyOrOpen(monthPlans) {
    const plans = Array.isArray(monthPlans) ? monthPlans : [];
    if (!plans.length) return false;
    const hasReadyOrOpen = plans.some((plan) => {
      const key = String(plan?.status?.key || '').toLowerCase();
      return key === STATUS_READY || key === STATUS_OPEN;
    });
    if (!hasReadyOrOpen) return false;
    return plans.every((plan) => {
      const key = String(plan?.status?.key || '').toLowerCase();
      return (
        key === STATUS_OPEN || key === STATUS_READY || key === STATUS_COMPLETED
      );
    });
  }

  function monthPlansCompleted(monthPlans) {
    const plans = Array.isArray(monthPlans) ? monthPlans : [];
    if (!plans.length) return false;
    return plans.every(
      (plan) =>
        String(plan?.status?.key || '').toLowerCase() === STATUS_COMPLETED,
    );
  }

  function monthPlansTotalAmount(monthPlans) {
    return (Array.isArray(monthPlans) ? monthPlans : []).reduce(
      (sum, plan) => sum + toNumber(plan?.qty) * toNumber(plan?.rate),
      0,
    );
  }

  function buildMonthWorkflowState({ key, plans, effectivePeriodKey } = {}) {
    const monthInfo = parseMonthKeyToInfo(key);
    const list = Array.isArray(plans) ? plans : [];
    const statusCounts = {};
    list.forEach((plan) => {
      const sk = String(plan?.status?.key || '').toLowerCase() || 'unknown';
      statusCounts[sk] = (statusCounts[sk] || 0) + 1;
    });

    const completed = monthPlansCompleted(list);
    const ready = monthPlansReady(list);
    const openEligible = monthPlansReadyOrOpen(list) && Boolean(statusCounts[STATUS_OPEN]);
    const hasOpen = Boolean(statusCounts[STATUS_OPEN]);
    const hasReady = Boolean(statusCounts[STATUS_READY]);
    const hasCompleted = Boolean(statusCounts[STATUS_COMPLETED]);
    const hasPlans = list.length > 0;
    const totalAmount = monthPlansTotalAmount(list);
    const zeroValue = Math.abs(totalAmount) <= 0.0001;
    const isCurrent = String(key || '') === String(effectivePeriodKey || '');
    const isPrior =
      monthKeyNumberFromKey(key) != null &&
      monthKeyNumberFromKey(effectivePeriodKey) != null &&
      monthKeyNumberFromKey(key) < monthKeyNumberFromKey(effectivePeriodKey);
    const locked = hasPlans ? isMonthLocked(monthInfo) : false;

    let stateKey = 'none';
    if (completed) stateKey = STATUS_COMPLETED;
    else if (ready) stateKey = STATUS_READY;
    else if (openEligible) stateKey = STATUS_OPEN;
    else if (hasPlans) stateKey = 'mixed';

    return {
      key,
      label: monthInfo?.label || key,
      monthInfo,
      planCount: list.length,
      statusCounts,
      hasOpen,
      hasReady,
      hasCompleted,
      hasPlans,
      totalAmount,
      zeroValue,
      locked,
      isCurrent,
      isPrior,
      completed,
      ready,
      open: openEligible,
      pending: hasPlans && !completed,
      stateKey,
    };
  }

  function buildRevRecWorkflowState({ projectId } = {}) {
    const pid = String(projectId || '').trim();
    if (!pid) {
      return {
        status: 'ERROR',
        name: 'BAD_REQUEST',
        message: 'projectId is required.',
      };
    }

    const effectivePeriod = getEffectivePeriodInfo({ projectId: pid });
    const planRows = getActualRevenuePlanRowsUpToPeriod(pid, effectivePeriod);
    const { lastPostedMonthKey, postedMonthKeys } = getLastPostedJournalInfo(pid);

    const monthPlans = {};
    planRows.forEach((row) => {
      if (!monthPlans[row.monthKey]) monthPlans[row.monthKey] = [];
      monthPlans[row.monthKey].push(row);
    });

    const allPlanMonthKeys = Object.keys(monthPlans)
      .filter(Boolean)
      .sort(
        (a, b) =>
          (monthKeyNumberFromKey(a) || 0) - (monthKeyNumberFromKey(b) || 0),
      );

    const monthStates = allPlanMonthKeys.map((key) =>
      buildMonthWorkflowState({
        key,
        plans: monthPlans[key] || [],
        effectivePeriodKey: effectivePeriod?.key || null,
      }),
    );

    const monthStateByKey = {};
    monthStates.forEach((row) => {
      monthStateByKey[row.key] = row;
    });
    const postedMonthKeySet = {};
    (Array.isArray(postedMonthKeys) ? postedMonthKeys : []).forEach((key) => {
      if (!key) return;
      postedMonthKeySet[String(key)] = true;
    });

    const currentMonth =
      monthStateByKey[effectivePeriod.key] ||
      buildMonthWorkflowState({
        key: effectivePeriod.key,
        plans: [],
        effectivePeriodKey: effectivePeriod.key,
      });

    const priorPendingMonths = monthStates.filter(
      (row) => row.isPrior && row.pending,
    );
    const priorOpenMonths = priorPendingMonths.filter((row) => row.open);
    const priorReadyMonths = priorPendingMonths.filter((row) => row.ready);
    const priorBlockedMonths = priorPendingMonths.filter(
      (row) => !row.open && !row.ready,
    );
    const hasLockedPriorPending = priorPendingMonths.some((row) => row.locked);
    const missingCompletedJournalMonths = monthStates.filter(
      (row) =>
        row.completed &&
        !row.zeroValue &&
        !postedMonthKeySet[String(row.key || '')],
    );

    const submitTargets = priorOpenMonths.length
      ? priorOpenMonths
      : currentMonth.open
        ? [currentMonth]
        : [];
    const submitLockedTargets = submitTargets.filter((row) => row.locked);

    const generateTargets = priorReadyMonths.length
      ? priorReadyMonths
      : !priorPendingMonths.length && currentMonth.ready
        ? [currentMonth]
        : [];
    const generateLockedTargets = generateTargets.filter((row) => row.locked);

    const submitReason = submitTargets.length
      ? submitLockedTargets.length
        ? `Target month period is locked/closed (${submitLockedTargets
            .map((row) => row.label)
            .join(', ')}). Reopen the period first.`
        : null
      : priorBlockedMonths.length
        ? `Some previous month rev plans are not in an actionable state (${priorBlockedMonths
            .map((row) => row.label)
            .join(', ')}).`
        : currentMonth.completed
          ? 'Current month rev plans are already completed.'
          : 'No rev plan allocations are Open for submission.'

    const generateReason = generateTargets.length
      ? generateLockedTargets.length
        ? `Target month period is locked/closed (${generateLockedTargets
            .map((row) => row.label)
            .join(', ')}). Reopen the period first.`
        : null
      : priorOpenMonths.length
        ? `Previous month rev plans must be submitted to finance first (${priorOpenMonths
            .map((row) => row.label)
            .join(', ')}).`
        : priorBlockedMonths.length
          ? `Some previous month rev plans are not in an actionable state (${priorBlockedMonths
              .map((row) => row.label)
              .join(', ')}).`
          : currentMonth.completed
            ? 'A rev rec journal already exists for the effective current month. No new current-month journal can be generated.'
            : 'No rev plans are Rev Rec Ready for generation.'

    return {
      status: 'SUCCESS',
      projectId: pid,
      effectivePeriod,
      lastPostedMonthKey: lastPostedMonthKey || null,
      postedMonthKeys,
      allPlanMonthKeys,
      monthStates,
      currentMonth,
      priorPendingMonths,
      priorOpenMonths,
      priorReadyMonths,
      priorBlockedMonths,
      missingCompletedJournalMonths,
      hasLockedPriorPending,
      submitToFinanceAction: {
        visible: submitTargets.length > 0,
        enabled: submitTargets.length > 0 && !submitLockedTargets.length,
        reason: submitReason,
        targetMonthKeys: submitTargets.map((row) => row.key),
        targetMonthLabels: submitTargets.map((row) => row.label),
        targetsCurrentMonth: submitTargets.some((row) => row.isCurrent),
      },
      generateJournalAction: {
        visible: generateTargets.length > 0,
        enabled: generateTargets.length > 0 && !generateLockedTargets.length,
        reason: generateReason,
        targetMonthKeys: generateTargets.map((row) => row.key),
        targetMonthLabels: generateTargets.map((row) => row.label),
        targetsCurrentMonth: generateTargets.some((row) => row.isCurrent),
      },
      hasMissingCompletedJournals: missingCompletedJournalMonths.length > 0,
      missingCompletedJournalMonthKeys: missingCompletedJournalMonths.map(
        (row) => row.key,
      ),
      missingCompletedJournalMonthLabels: missingCompletedJournalMonths.map(
        (row) => row.label,
      ),
    };
  }

  function buildRevRecGenerationPreview({ projectId } = {}) {
    const workflow = buildRevRecWorkflowState({ projectId });
    if (workflow?.status === 'ERROR') return workflow;

    log?.audit?.({
      title: 'REV_REC_PREVIEW_START',
      details: {
        projectId: workflow.projectId,
        effectivePeriodKey: workflow?.effectivePeriod?.key || null,
        effectivePeriodLabel: workflow?.effectivePeriod?.label || null,
        effectivePeriodSource: workflow?.effectivePeriod?.source || null,
        effectivePeriodRawOverride: workflow?.effectivePeriod?.raw || null,
      },
    });

    const missingMonths = workflow.priorPendingMonths.map((row) => ({
      key: row.key,
      label: row.label,
      locked: Boolean(row.locked),
      ready: Boolean(row.ready),
      planCount: Number(row.planCount || 0),
      statusCounts: row.statusCounts || {},
      hasReady: Boolean(row.hasReady),
      hasCompleted: Boolean(row.hasCompleted),
      hasOpen: Boolean(row.hasOpen),
      stateKey: row.stateKey,
      zeroValue: Boolean(row.zeroValue),
    }));
    const currentReady = Boolean(workflow?.currentMonth?.ready);
    const currentAlreadyGenerated = Boolean(workflow?.currentMonth?.completed);
    const missingAllReady =
      missingMonths.length > 0 && missingMonths.every((row) => row.ready);
    const missingAnyNotReady = missingMonths.some((row) => !row.ready);
    const hasLockedMissing = missingMonths.some((row) => row.locked);

    let promptType = null;
    if (missingMonths.length) {
      if (missingAllReady) promptType = 'missing_only_current_not_ready';
      else promptType = 'missing_not_ready_blocked';
    } else if (currentReady) {
      promptType = 'current_ready';
    }

    log?.audit?.({
      title: 'REV_REC_PREVIEW_MONTH_ANALYSIS',
      details: {
        projectId: workflow.projectId,
        lastPostedMonthKey: workflow.lastPostedMonthKey || null,
        postedMonthKeys: workflow.postedMonthKeys || [],
        monthStates: (workflow.monthStates || []).map((row) => ({
          key: row.key,
          label: row.label,
          stateKey: row.stateKey,
          locked: Boolean(row.locked),
          planCount: Number(row.planCount || 0),
          statusCounts: row.statusCounts || {},
        })),
        submitToFinanceAction: workflow.submitToFinanceAction,
        generateJournalAction: workflow.generateJournalAction,
      },
    });

    log?.audit?.({
      title: 'REV_REC_PREVIEW_DECISION',
      details: {
        projectId: workflow.projectId,
        currentMonthKey: workflow?.effectivePeriod?.key || null,
        hasMissingMonths: missingMonths.length > 0,
        hasLockedMissing,
        currentReady,
        currentAlreadyGenerated,
        missingAllReady,
        missingAnyNotReady,
        promptType: promptType || null,
        canGenerateNow: Boolean(workflow?.generateJournalAction?.enabled),
      },
    });

    const generateTargetKeys = Array.isArray(
      workflow?.generateJournalAction?.targetMonthKeys,
    )
      ? workflow.generateJournalAction.targetMonthKeys
      : [];
    const allPlansUpToEffective = getActualRevenuePlanRowsUpToPeriod(
      workflow.projectId,
      workflow.effectivePeriod,
    );
    const previewFinancials = getProjectFinancials(workflow.projectId) || null;
    const salesOrderIds = Array.isArray(
      previewFinancials?.salesOrderIds,
    )
      ? previewFinancials.salesOrderIds
      : getSalesOrderIds(workflow.projectId);
    const zeroValueCompletionMonthLabels = [];
    const zeroValueCompletionMonthKeys = [];
    generateTargetKeys.forEach((key) => {
      const monthInfo = parseMonthKeyToInfo(key);
      if (!monthInfo) return;
      const plansUpToMonth = allPlansUpToEffective.filter((plan) => {
        const pNum = monthKeyNumberFromKey(plan.monthKey);
        const kNum = monthKeyNumberFromKey(key);
        return pNum != null && kNum != null && pNum <= kNum;
      });
      const fundingContext = getProjectFundingContextAsOf({
        projectId: workflow.projectId,
        salesOrderIds,
        cutoffDate: monthInfo.monthEnd,
      });
      const lines = buildJournalLinesFromPlans(plansUpToMonth, fundingContext);
      if (lines.length) return;
      zeroValueCompletionMonthKeys.push(String(key));
      zeroValueCompletionMonthLabels.push(String(monthInfo.label || key));
    });

    return {
      status: 'SUCCESS',
      projectId: workflow.projectId,
      effectivePeriod: workflow.effectivePeriod,
      lastPostedMonthKey: workflow.lastPostedMonthKey || null,
      postedMonthKeys: workflow.postedMonthKeys || [],
      monthStates: workflow.monthStates || [],
      submitToFinanceAction: workflow.submitToFinanceAction,
      generateJournalAction: workflow.generateJournalAction,
      missingMonths,
      hasMissingMonths: missingMonths.length > 0,
      hasMissingCompletedJournals: Boolean(
        workflow?.hasMissingCompletedJournals,
      ),
      missingCompletedJournalMonthKeys: Array.isArray(
        workflow?.missingCompletedJournalMonthKeys,
      )
        ? workflow.missingCompletedJournalMonthKeys
        : [],
      missingCompletedJournalMonthLabels: Array.isArray(
        workflow?.missingCompletedJournalMonthLabels,
      )
        ? workflow.missingCompletedJournalMonthLabels
        : [],
      hasLockedMissing,
      currentMonthKey: workflow.effectivePeriod.key,
      currentReady,
      currentAlreadyGenerated,
      missingAllReady,
      missingAnyNotReady,
      promptType,
      canGenerateNow: Boolean(workflow?.generateJournalAction?.enabled),
      zeroValueCompletionMonthKeys,
      zeroValueCompletionMonthLabels,
    };
  }

  function getSalesOrderIds(projectId) {
    const fin = getProjectFinancials(projectId) || {};
    return Array.isArray(fin?.salesOrderIds) ? fin.salesOrderIds : [];
  }

  function getBilledToDateAsOf({ salesOrderIds, cutoffDate }) {
    const ids = (Array.isArray(salesOrderIds) ? salesOrderIds : [])
      .filter(Boolean)
      .map((id) => Number(id))
      .filter((id) => !Number.isNaN(id));
    if (!ids.length) return 0;
    const cutoff = toSqlDateLiteral(cutoffDate);
    if (!cutoff) return 0;

    const idList = ids.join(',');
    const invoiceSql = `
      SELECT
        COALESCE(SUM(inv.total - COALESCE(tax.tax_total, 0)), 0) AS invoice_total
      FROM transaction inv
      JOIN transactionLine tl
        ON tl.transaction = inv.id
        AND tl.mainline = 'T'
      LEFT JOIN (
        SELECT transaction, SUM(foreignamount * -1) AS tax_total
        FROM transactionLine
        WHERE taxline = 'T'
        GROUP BY transaction
      ) tax ON tax.transaction = inv.id
      WHERE inv.type = 'CustInvc'
        AND inv.trandate <= TO_DATE('${cutoff}', 'YYYY-MM-DD')
        AND tl.createdfrom IN (${idList})
    `;
    const invoiceRows =
      query.runSuiteQL({ query: invoiceSql }).asMappedResults() || [];
    const invoiceTotal = toNumber(invoiceRows?.[0]?.invoice_total || 0);
    const creditTotal = toNumber(
      getCreditMemoAppliedAmountAsOf({ salesOrderIds: ids, cutoffDate }),
    );
    const billedToDate = invoiceTotal - creditTotal;
    log.audit({
      title: 'REV_REC_BILLED_TO_DATE_BREAKDOWN',
      details: toLogDetails({
        salesOrderIds: ids.map(String),
        cutoffDate: cutoff,
        invoiceTotal,
        creditTotal,
        billedToDate,
      }),
    });
    return billedToDate;
  }

  function getCreditMemoAppliedAmountAsOf({ salesOrderIds, cutoffDate } = {}) {
    const ids = Array.isArray(salesOrderIds)
      ? salesOrderIds.filter(Boolean).map(String)
      : [];
    if (!ids.length) return 0;
    if (!(cutoffDate instanceof Date) || Number.isNaN(cutoffDate.getTime()))
      return 0;

    const nsDate = toNsDateFilter(cutoffDate);

    try {
      const suiteSearch = search.create({
        type: 'transaction',
        settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
        filters: [
          ['mainline', 'is', 'T'],
          'AND',
          ['type', 'anyof', 'CustCred'],
          'AND',
          ['trandate', 'onorbefore', nsDate],
          'AND',
          [
            ['createdfrom.createdfrom', 'anyof', ...ids],
            'OR',
            ['appliedtotransaction.createdfrom', 'anyof', ...ids],
          ],
        ],
        columns: [
          search.createColumn({ name: 'internalid' }),
          search.createColumn({ name: 'tranid' }),
          search.createColumn({
            name: 'formulatext',
            formula: "TO_CHAR({trandate}, 'DD/MM/YYYY')",
          }),
          search.createColumn({ name: 'appliedtolinkamount' }),
          search.createColumn({ name: 'appliedtoforeignamount' }),
        ],
      });

      let totalApplied = 0;
      const creditMemoRows = [];
      const tranDateCol = suiteSearch.columns[2];
      getAllResults(suiteSearch).forEach((res) => {
        const cmId = String(res.getValue({ name: 'internalid' }) || '').trim();
        const tranId = String(res.getValue({ name: 'tranid' }) || '').trim();
        const tranDate = String(res.getValue(tranDateCol) || '').trim();
        const raw =
          res.getValue({ name: 'appliedtolinkamount' }) ??
          res.getValue({ name: 'appliedtoforeignamount' });
        const applied = Math.abs(toNumber(raw));
        totalApplied += applied;
        if (creditMemoRows.length < 30) {
          creditMemoRows.push({
            id: cmId || null,
            tranId: tranId || null,
            tranDate: tranDate || null,
            applied,
          });
        }
      });
      log.audit({
        title: 'REV_REC_CREDIT_MEMO_APPLIED_ROWS',
        details: toLogDetails({
          salesOrderIds: ids,
          cutoffDate:
            cutoffDate instanceof Date && !Number.isNaN(cutoffDate.getTime())
              ? cutoffDate.toISOString()
              : String(cutoffDate || ''),
          rowCount: creditMemoRows.length,
          rows: creditMemoRows,
          totalApplied,
        }),
      });
      return totalApplied;
    } catch (e) {
      log.error({
        title: 'REV_REC_GET_CREDIT_MEMO_APPLIED_AS_OF_FAILED',
        details: e,
      });
      return 0;
    }
  }

  function getRecognizedToDateAsOf({ projectId, cutoffDate }) {
    const projectName = String(getProjectNameById(projectId) || '').trim();
    if (!projectName) return 0;

    const revenueAccountIds = getProjectRevenueAccountIds(projectId, {
      includeCurrent: true,
    });
    if (!revenueAccountIds.length) return 0;

    const cutoff = toSqlDateLiteral(cutoffDate);
    if (!cutoff) return 0;

    const safeName = toSqlTextLiteral(projectName.toLowerCase());
    const accountFilter = revenueAccountIds
      .map((id) => String(id).trim())
      .filter((id) => /^\d+$/.test(id))
      .join(',');
    if (!accountFilter) return 0;

    const sql = `
      SELECT
        COALESCE(SUM(NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)), 0) AS recognized_amount
      FROM transaction t
      INNER JOIN transactionline tl ON tl.transaction = t.id
      WHERE
        t.type = 'Journal'
        AND tl.expenseaccount IN (${accountFilter})
        AND LOWER(BUILTIN.DF(t.cseg_project_seg)) = '${safeName}'
        AND (t.isreversal = 'F' OR t.isreversal IS NULL)
        AND (t.voided = 'F' OR t.voided IS NULL)
        AND t.trandate <= TO_DATE('${cutoff}', 'YYYY-MM-DD')
    `;

    const rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
    return toNumber(rows?.[0]?.recognized_amount || 0);
  }

  function getProjectFundingContextAsOf({
    projectId,
    salesOrderIds,
    cutoffDate,
  }) {
    const billedToDate = toNumber(
      getBilledToDateAsOf({ salesOrderIds, cutoffDate }),
    );
    const recognizedToDate = toNumber(
      getRecognizedToDateAsOf({ projectId, cutoffDate }),
    );
    // Journals created by this flow are auto-reversing, so each new month run
    // should treat funding as if no prior recognition is currently active.
    // Use billed-to-date directly as deferred pool instead of netting off
    // historical recognized amounts.
    const deferredAvailable = Math.max(0, billedToDate);
    log.audit({
      title: 'REV_REC_FUNDING_CONTEXT',
      details: toLogDetails({
        projectId: String(projectId || ''),
        salesOrderIds: (Array.isArray(salesOrderIds) ? salesOrderIds : []).map(
          String,
        ),
        cutoffDate:
          cutoffDate instanceof Date && !Number.isNaN(cutoffDate.getTime())
            ? cutoffDate.toISOString()
            : String(cutoffDate || ''),
        billedToDate,
        recognizedToDate,
        deferredAvailable,
      }),
    });
    return { billedToDate, recognizedToDate, deferredAvailable };
  }

  function buildJournalLinesFromPlans(plans, fundingContext) {
    const accounts = getConfiguredAccounts();
    const revenueAccountId = String(accounts?.REVENUE || '').trim();
    const deferredAccountId = String(accounts?.DEFERRED_REVENUE || '').trim();
    const unbilledReceivableAccountId = String(
      accounts?.UNBILLED_RECEIVABLE || '',
    ).trim();
    if (!revenueAccountId || !deferredAccountId) {
      throw new Error('Revenue/Deferred revenue accounts are not configured.');
    }

    const byPhase = {};
    plans.forEach((plan) => {
      const phaseId = String(plan?.phaseId || '');
      if (!phaseId) return;
      const amount = toNumber(plan?.qty) * toNumber(plan?.rate);
      if (!amount) return;
      if (!byPhase[phaseId]) {
        byPhase[phaseId] = {
          phaseId,
          departmentId: String(plan?.departmentId || ''),
          phaseTitle: String(plan?.phaseTitle || '').trim(),
          milestoneDesc: String(plan?.milestoneDesc || '').trim(),
          amount: 0,
        };
      }
      if (!byPhase[phaseId].phaseTitle) {
        byPhase[phaseId].phaseTitle = String(plan?.phaseTitle || '').trim();
      }
      if (!byPhase[phaseId].milestoneDesc) {
        byPhase[phaseId].milestoneDesc = String(
          plan?.milestoneDesc || '',
        ).trim();
      }
      byPhase[phaseId].amount += amount;
    });

    const deferredStartPool = Math.max(
      0,
      toNumber(fundingContext?.deferredAvailable || 0),
    );
    log.audit({
      title: 'REV_REC_BUILD_LINES_START',
      details: toLogDetails({
        planCount: Array.isArray(plans) ? plans.length : 0,
        deferredStartPool,
        fundingContext,
      }),
    });
    let deferredPool = deferredStartPool;
    let deferredDebitTotal = 0;
    let unbilledDebitTotal = 0;
    let deferredCreditTotal = 0;
    const revenueLines = [];

    Object.values(byPhase).forEach((row) => {
      const amount = toNumber(row?.amount);
      if (!amount) return;

      if (amount > 0) {
        const deferredPart = Math.min(amount, deferredPool);
        const unbilledPart = amount - deferredPart;
        deferredPool -= deferredPart;
        deferredDebitTotal += deferredPart;
        unbilledDebitTotal += unbilledPart;
        log.audit({
          title: 'REV_REC_BUILD_LINES_SPLIT',
          details: toLogDetails({
            phaseId: row?.phaseId || null,
            phaseTitle: row?.phaseTitle || null,
            milestoneDesc: row?.milestoneDesc || null,
            amount,
            deferredPart,
            unbilledPart,
            deferredPoolAfter: deferredPool,
          }),
        });
      } else {
        deferredCreditTotal += Math.abs(amount);
      }

      revenueLines.push({
        accountId: revenueAccountId,
        debit: amount < 0 ? Math.abs(amount) : 0,
        credit: amount > 0 ? amount : 0,
        isRevenue: true,
        phaseId: row.phaseId,
        departmentId: row.departmentId,
        memo: String(
          [row.milestoneDesc, row.phaseTitle].filter(Boolean).join(' - '),
        )
          .trim()
          .slice(0, 300),
      });
    });

    if (unbilledDebitTotal > 0 && !unbilledReceivableAccountId) {
      throw new Error(
        'Unbilled receivable account is not configured in script parameters.',
      );
    }

    const lines = [];
    if (deferredDebitTotal > 0) {
      lines.push({
        accountId: deferredAccountId,
        debit: deferredDebitTotal,
        credit: 0,
        isRevenue: false,
        phaseId: '',
        departmentId: '',
      });
    }
    if (unbilledDebitTotal > 0) {
      lines.push({
        accountId: unbilledReceivableAccountId,
        debit: unbilledDebitTotal,
        credit: 0,
        isRevenue: false,
        phaseId: '',
        departmentId: '',
      });
    }
    if (deferredCreditTotal > 0) {
      lines.push({
        accountId: deferredAccountId,
        debit: 0,
        credit: deferredCreditTotal,
        isRevenue: false,
        phaseId: '',
        departmentId: '',
      });
    }

    lines.push(...revenueLines);
    log.audit({
      title: 'REV_REC_BUILD_LINES_RESULT',
      details: toLogDetails({
        deferredDebitTotal,
        unbilledDebitTotal,
        deferredCreditTotal,
        revenueLinesCount: revenueLines.length,
        lines,
      }),
    });
    return lines;
  }

  function createProjectJournal({
    projectId,
    lines,
    targetDate,
    reversalDate,
    revenueAccountIdUsed,
  }) {
    const rec = record.create({
      type: record.Type.JOURNAL_ENTRY,
      isDynamic: true,
    });

    const subsidiary = String(pmConfig?.SUBSIDIARY || '').trim();
    if (subsidiary) {
      try {
        rec.setValue({ fieldId: 'subsidiary', value: Number(subsidiary) });
      } catch (e) {
        // ignore in single-subsidiary accounts
      }
    }

    if (targetDate instanceof Date && !Number.isNaN(targetDate.getTime())) {
      try {
        rec.setValue({ fieldId: 'trandate', value: targetDate });
      } catch (e) {
        // ignore
      }
    }

    if (reversalDate instanceof Date && !Number.isNaN(reversalDate.getTime())) {
      try {
        rec.setValue({ fieldId: 'reversaldate', value: reversalDate });
      } catch (e) {
        // ignore when field is unavailable
      }
    }
    try {
      rec.setValue({ fieldId: 'reversaldefer', value: true });
    } catch (e) {
      // ignore when field is unavailable
    }

    try {
      rec.setValue({ fieldId: 'custbody_pm_iscreatedbyportal', value: true });
    } catch (e) {
      // custom field may not be available in all accounts
    }

    const projectName = getProjectNameById(projectId);
    let projectSegmentValueId = '';
    const areaSegment = getProjectAreaSegment(projectId);
    const customerId = String(areaSegment?.customerId || '').trim();
    if (projectName) {
      projectSegmentValueId = String(
        getProjectSegmentValueIdByName(projectName) || '',
      ).trim();
      if (projectSegmentValueId) {
        try {
          rec.setValue({
            fieldId: 'cseg_project_seg',
            value: Number(projectSegmentValueId),
          });
        } catch (e) {
          // fallback to text assignment below
        }
      }
      try {
        rec.setText({ fieldId: 'cseg_project_seg', text: String(projectName) });
      } catch (e) {
        // ignore
      }
    }
    if (areaSegment.id) {
      try {
        rec.setValue({ fieldId: 'cseg_area', value: Number(areaSegment.id) });
      } catch (e) {
        try {
          if (areaSegment.text) {
            rec.setText({
              fieldId: 'cseg_area',
              text: String(areaSegment.text),
            });
          }
        } catch (e2) {
          // ignore
        }
      }
    }

    rec.setValue({
      fieldId: 'memo',
      value: `PM Rev Rec Journal - Project ${String(projectId)}`,
    });

    lines.forEach((line) => {
      rec.selectNewLine({ sublistId: 'line' });
      rec.setCurrentSublistValue({
        sublistId: 'line',
        fieldId: 'account',
        value: Number(line.accountId),
      });
      if (projectSegmentValueId) {
        try {
          rec.setCurrentSublistValue({
            sublistId: 'line',
            fieldId: 'cseg_project_seg',
            value: Number(projectSegmentValueId),
          });
        } catch (e) {
          // ignore when line-level project segment is unavailable
        }
      }
      if (customerId) {
        try {
          rec.setCurrentSublistValue({
            sublistId: 'line',
            fieldId: 'entity',
            value: Number(customerId),
          });
        } catch (e) {
          // ignore when line-level entity is unavailable/restricted
        }
      }

      if (line.debit > 0) {
        rec.setCurrentSublistValue({
          sublistId: 'line',
          fieldId: 'debit',
          value: Number(line.debit),
        });
      }
      if (line.credit > 0) {
        rec.setCurrentSublistValue({
          sublistId: 'line',
          fieldId: 'credit',
          value: Number(line.credit),
        });
      }

      if (line.isRevenue) {
        if (line.departmentId) {
          rec.setCurrentSublistValue({
            sublistId: 'line',
            fieldId: 'department',
            value: Number(line.departmentId),
          });
        }
        const lineMemo = String(line?.memo || '').trim();
        if (lineMemo) {
          rec.setCurrentSublistValue({
            sublistId: 'line',
            fieldId: 'memo',
            value: lineMemo,
          });
        }
        rec.setCurrentSublistValue({
          sublistId: 'line',
          fieldId: 'custcol_pm_projectphase_jnl',
          value: Number(line.phaseId),
        });
      }
      rec.commitLine({ sublistId: 'line' });
    });

    const savedId = rec.save({
      enableSourcing: false,
      ignoreMandatoryFields: false,
    });
    upsertProjectRevenueAccountsUsed(projectId, revenueAccountIdUsed);
    return savedId;
  }

  function markRevenuePlansCompleted({ projectId, planIds, journalId }) {
    const completedStatusId =
      pmConfig?.LIST_IDS?.REV_PLAN_STATUS?.COMPLETED != null
        ? String(pmConfig.LIST_IDS.REV_PLAN_STATUS.COMPLETED)
        : '4';
    const actualTypeId =
      pmConfig?.LIST_IDS?.REV_PLAN_TYPE?.ACTUAL != null
        ? Number(pmConfig.LIST_IDS.REV_PLAN_TYPE.ACTUAL)
        : 1;

    const pid = String(projectId || '').trim();
    if (!pid) return;

    const targetPlanIds = new Set(
      (Array.isArray(planIds) ? planIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    );
    if (!targetPlanIds.size) return;

    const project = record.load({
      type: 'customrecord_pm_projects',
      id: pid,
      isDynamic: false,
    });

    const lineCount =
      project.getLineCount({
        sublistId: 'recmachcustrecord_pm_revplan_project',
      }) || 0;

    const completedStatusNumber = Number(completedStatusId);
    const canSetStatusByValue = Number.isFinite(completedStatusNumber);
    const hasJournalId =
      journalId != null && String(journalId).trim() !== '';
    let canSetJournalField = hasJournalId;
    let changed = false;

    for (let line = 0; line < lineCount; line++) {
      const linePlanId = String(
        project.getSublistValue({
          sublistId: 'recmachcustrecord_pm_revplan_project',
          fieldId: 'id',
          line,
        }) || '',
      ).trim();
      if (!linePlanId || !targetPlanIds.has(linePlanId)) continue;

      if (canSetStatusByValue) {
        project.setSublistValue({
          sublistId: 'recmachcustrecord_pm_revplan_project',
          fieldId: 'custrecord_pm_revplan_status',
          line,
          value: completedStatusNumber,
        });
      } else {
        project.setSublistText({
          sublistId: 'recmachcustrecord_pm_revplan_project',
          fieldId: 'custrecord_pm_revplan_status',
          line,
          text: 'Completed',
        });
      }

      project.setSublistValue({
        sublistId: 'recmachcustrecord_pm_revplan_project',
        fieldId: 'custrecord_pm_revplan_type',
        line,
        value: actualTypeId,
      });

      if (canSetJournalField) {
        try {
          project.setSublistValue({
            sublistId: 'recmachcustrecord_pm_revplan_project',
            fieldId: 'custrecord_pm_revplan_journal',
            line,
            value: Number(journalId),
          });
        } catch (e) {
          canSetJournalField = false;
        }
      }

      changed = true;
    }

    if (changed) {
      project.save({ enableSourcing: false, ignoreMandatoryFields: true });
    }
  }

  function resolveMode({ mode, preview }) {
    const requested = String(mode || 'auto')
      .trim()
      .toLowerCase();
    if (requested && requested !== 'auto') return requested;

    const targetKeys = Array.isArray(preview?.generateJournalAction?.targetMonthKeys)
      ? preview.generateJournalAction.targetMonthKeys
      : [];
    if (!targetKeys.length) return 'current_only';
    return targetKeys.includes(preview?.currentMonthKey) ? 'current_only' : 'missing_only';
  }

  function getTargetMonthKeys({ mode, preview }) {
    const missingKeys = (preview?.missingMonths || [])
      .filter((m) => Boolean(m?.ready))
      .map((m) => m.key);
    const missingCompletedJournalKeys = Array.isArray(
      preview?.missingCompletedJournalMonthKeys,
    )
      ? preview.missingCompletedJournalMonthKeys
      : [];
    const currentKey = preview?.currentMonthKey || null;
    const actionKeys = Array.isArray(preview?.generateJournalAction?.targetMonthKeys)
      ? preview.generateJournalAction.targetMonthKeys
      : [];
    const actionTargetsCurrent = Boolean(
      preview?.generateJournalAction?.targetsCurrentMonth,
    );

    if (actionKeys.length && (!mode || mode === 'auto')) return actionKeys;
    if (actionKeys.length && mode === 'current_only') {
      return actionTargetsCurrent ? actionKeys : [];
    }
    if (actionKeys.length && mode === 'missing_only') {
      return actionTargetsCurrent ? [] : actionKeys;
    }
    if (actionKeys.length && mode === 'missing_and_current') return actionKeys;
    if (mode === 'completed_missing_journals_only')
      return missingCompletedJournalKeys;

    if (mode === 'missing_only') return missingKeys;
    if (mode === 'current_only') return currentKey ? [currentKey] : [];
    if (mode === 'missing_and_current') return actionKeys.length ? actionKeys : missingKeys;
    return [];
  }

  function generateRevRecJournal({
    projectId,
    mode = 'auto',
    forceMissingOpen = false,
  } = {}) {
    try {
      const pid = String(projectId || '').trim();
      if (!pid) {
        log?.audit?.({
          title: 'REV_REC_GENERATE_BLOCKED',
          details: { reason: 'projectId is required' },
        });
        return { status: 'ERROR', message: 'projectId is required' };
      }

      log?.audit?.({
        title: 'REV_REC_GENERATE_START',
        details: {
          projectId: pid,
          requestedMode: String(mode || 'auto'),
          forceMissingOpen: Boolean(forceMissingOpen),
        },
      });

      const financials = getProjectFinancials(pid);
      const eligibilityErr = validateProjectRevRecEligibility({
        projectId: pid,
        financials,
      });
      if (eligibilityErr?.status === 'ERROR') {
        log?.audit?.({
          title: 'REV_REC_GENERATE_BLOCKED',
          details: {
            projectId: pid,
            reason: eligibilityErr?.message || 'Eligibility failed',
            name: eligibilityErr?.name || null,
          },
        });
        return eligibilityErr;
      }

      const preview = buildRevRecGenerationPreview({ projectId: pid });
      if (preview?.status === 'ERROR') {
        log?.audit?.({
          title: 'REV_REC_GENERATE_BLOCKED',
          details: {
            projectId: pid,
            reason: preview?.message || 'Preview failed',
            name: preview?.name || null,
          },
        });
        return {
          status: 'ERROR',
          message:
            preview?.message || 'Failed to compute rev rec generation preview.',
        };
      }

      const resolvedMode = resolveMode({ mode, preview });
      const isCompletedMissingJournalsMode =
        resolvedMode === 'completed_missing_journals_only';

      if (
        !isCompletedMissingJournalsMode &&
        preview?.generateJournalAction?.visible &&
        !preview?.generateJournalAction?.enabled
      ) {
        const lockedMonths = (preview.missingMonths || [])
          .filter((m) => m.locked)
          .map((m) => m.label || m.key);
        log?.audit?.({
          title: 'REV_REC_GENERATE_BLOCKED',
          details: {
            projectId: pid,
            reason:
              preview?.generateJournalAction?.reason ||
              'Target months are in locked/closed periods',
            lockedMonths,
          },
        });
        return {
          status: 'ERROR',
          name: 'LOCKED_PERIOD',
          message:
            preview?.generateJournalAction?.reason ||
            'One or more target months are in locked/closed periods. Reopen the period first, then retry.',
          details: {
            lockedMonths,
          },
        };
      }

      const targetKeys = getTargetMonthKeys({ mode: resolvedMode, preview });
      log?.debug?.({
        title: 'REV_REC_GENERATE_SCOPE',
        details: {
          projectId: pid,
          requestedMode: String(mode || 'auto'),
          resolvedMode,
          effectivePeriod:
            preview?.effectivePeriod?.label || preview?.effectivePeriod?.key,
          lastPostedMonthKey: preview?.lastPostedMonthKey || null,
          targetKeys,
          missingMonthKeys: (preview?.missingMonths || []).map((m) => m.key),
          currentMonthKey: preview?.currentMonthKey || null,
          currentReady: Boolean(preview?.currentReady),
          missingAllReady: Boolean(preview?.missingAllReady),
          missingAnyNotReady: Boolean(preview?.missingAnyNotReady),
          currentAlreadyGenerated: Boolean(preview?.currentAlreadyGenerated),
          forceMissingOpen: Boolean(forceMissingOpen),
        },
      });
      if (!targetKeys.length) {
        log?.audit?.({
          title: 'REV_REC_GENERATE_BLOCKED',
          details: {
            projectId: pid,
            reason: 'No eligible months found for selected scope',
            resolvedMode,
          },
        });
        return {
          status: 'ERROR',
          message:
            isCompletedMissingJournalsMode
              ? 'No completed months with missing journals were found.'
              : preview?.generateJournalAction?.reason ||
                'No eligible months found to generate rev rec journals.',
        };
      }

      if (
        isCompletedMissingJournalsMode &&
        !(preview?.hasMissingCompletedJournals || false)
      ) {
        return {
          status: 'ERROR',
          message: 'No completed months with missing journals were found.',
        };
      }

      if (
        isCompletedMissingJournalsMode &&
        (preview?.missingCompletedJournalMonthKeys || []).some((key) =>
          targetKeys.includes(key),
        ) === false
      ) {
        return {
          status: 'ERROR',
          message: 'No completed months with missing journals were found.',
        };
      }

      if (
        isCompletedMissingJournalsMode &&
        (preview?.missingMonths || []).some((m) => targetKeys.includes(m.key))
      ) {
        return {
          status: 'ERROR',
          message:
            'Completed missing-journal regeneration cannot include pending backlog months.',
        };
      }

      if (
        targetKeys.includes(preview.currentMonthKey) &&
        preview.currentAlreadyGenerated &&
        !isCompletedMissingJournalsMode
      ) {
        log?.audit?.({
          title: 'REV_REC_GENERATE_BLOCKED',
          details: {
            projectId: pid,
            reason: 'Effective current month already generated',
            currentMonthKey: preview?.currentMonthKey || null,
          },
        });
        return {
          status: 'ERROR',
          message:
            'A rev rec journal already exists for the effective current month. No new current-month journal can be generated.',
        };
      }

      const effectivePeriod = preview.effectivePeriod;
      const allPlansUpToEffective = getActualRevenuePlanRowsUpToPeriod(
        pid,
        effectivePeriod,
      );

      const monthPlansMap = {};
      allPlansUpToEffective.forEach((plan) => {
        if (!monthPlansMap[plan.monthKey]) monthPlansMap[plan.monthKey] = [];
        monthPlansMap[plan.monthKey].push(plan);
      });

      const salesOrderIds = Array.isArray(financials?.salesOrderIds)
        ? financials.salesOrderIds
        : getSalesOrderIds(pid);
      const revenueAccountIdUsed = String(
        getConfiguredAccounts()?.REVENUE || '',
      ).trim();

      const targetSorted = [...targetKeys].sort(
        (a, b) =>
          (monthKeyNumberFromKey(a) || 0) - (monthKeyNumberFromKey(b) || 0),
      );

      const generated = [];
      const completedWithoutJournal = [];
      const skipped = [];
      for (const key of targetSorted) {
        const monthInfo = parseMonthKeyToInfo(key);
        if (!monthInfo) {
          skipped.push({
            monthKey: key,
            reason: 'MONTH_INFO_UNRESOLVED',
          });
          log?.debug?.({
            title: 'REV_REC_GENERATE_MONTH_SKIPPED',
            details: {
              projectId: pid,
              monthKey: key,
              reason: 'MONTH_INFO_UNRESOLVED',
            },
          });
          continue;
        }

        const plansUpToMonth = allPlansUpToEffective.filter((plan) => {
          const pNum = monthKeyNumberFromKey(plan.monthKey);
          const kNum = monthKeyNumberFromKey(key);
          return pNum != null && kNum != null && pNum <= kNum;
        });

        const monthPlans = monthPlansMap[key] || [];
        if (!plansUpToMonth.length) {
          skipped.push({
            monthKey: key,
            monthLabel: monthInfo.label,
            reason: 'NO_PLANS_UP_TO_MONTH',
          });
          log?.debug?.({
            title: 'REV_REC_GENERATE_MONTH_SKIPPED',
            details: {
              projectId: pid,
              monthKey: key,
              monthLabel: monthInfo.label,
              reason: 'NO_PLANS_UP_TO_MONTH',
            },
          });
          continue;
        }
        if (!monthPlans.length) {
          skipped.push({
            monthKey: key,
            monthLabel: monthInfo.label,
            reason: 'NO_TARGET_MONTH_PLANS',
          });
          log?.debug?.({
            title: 'REV_REC_GENERATE_MONTH_SKIPPED',
            details: {
              projectId: pid,
              monthKey: key,
              monthLabel: monthInfo.label,
              reason: 'NO_TARGET_MONTH_PLANS',
            },
          });
          continue;
        }

        if (isCompletedMissingJournalsMode) {
          const completedCheck = monthPlansCompleted(monthPlans);
          if (!completedCheck) {
            return {
              status: 'ERROR',
              name: 'REV_PLAN_NOT_COMPLETED',
              message: `Revenue plans for ${monthInfo.label} are not Completed.`,
            };
          }
        } else {
          const readyCheck = monthPlansReady(monthPlans);
          if (!readyCheck) {
            log?.audit?.({
              title: 'REV_REC_GENERATE_BLOCKED',
              details: {
                projectId: pid,
                reason: 'Target month rev plans are not ready',
                monthKey: key,
                monthLabel: monthInfo.label,
              },
            });
            return {
              status: 'ERROR',
              name: 'REV_PLAN_NOT_READY',
              message: `Revenue plans for ${monthInfo.label} are not Rev Rec Ready.`,
            };
          }

          const readyInTargetMonth = monthPlans.some(
            (plan) =>
              String(plan?.status?.key || '').toLowerCase() === STATUS_READY,
          );
          if (!readyInTargetMonth) {
            log?.audit?.({
              title: 'REV_REC_GENERATE_BLOCKED',
              details: {
                projectId: pid,
                reason: 'Target month has no Rev Rec Ready plans',
                monthKey: key,
                monthLabel: monthInfo.label,
              },
            });
            return {
              status: 'ERROR',
              name: 'REV_PLAN_NOT_READY',
              message: `Revenue plans for ${monthInfo.label} are not Rev Rec Ready.`,
            };
          }
        }

        const fundingContext = getProjectFundingContextAsOf({
          projectId: pid,
          salesOrderIds,
          cutoffDate: monthInfo.monthEnd,
        });
        log?.debug?.({
          title: 'REV_REC_GENERATE_MONTH_CONTEXT',
          details: {
            projectId: pid,
            monthKey: key,
            monthLabel: monthInfo.label,
            monthEnd: toSqlDateLiteral(monthInfo.monthEnd),
            plansUpToMonthCount: plansUpToMonth.length,
            targetMonthPlanCount: monthPlans.length,
            fundingContext,
          },
        });

        const lines = buildJournalLinesFromPlans(
          plansUpToMonth,
          fundingContext,
        );
        if (!lines.length) {
          markRevenuePlansCompleted({
            projectId: pid,
            planIds: monthPlans.map((row) => row.revPlanId),
            journalId: null,
          });
          completedWithoutJournal.push({
            monthKey: key,
            monthLabel: monthInfo.label,
            planCount: monthPlans.length,
            reason: 'ZERO_VALUE_COMPLETED_WITHOUT_JOURNAL',
          });
          log?.audit?.({
            title: 'REV_REC_GENERATE_MONTH_COMPLETED_WITHOUT_JOURNAL',
            details: {
              projectId: pid,
              monthKey: key,
              monthLabel: monthInfo.label,
              planCount: monthPlans.length,
              reason: 'NO_JOURNAL_LINES_COMPUTED',
            },
          });
          continue;
        }

        const reversalDate = new Date(monthInfo.year, monthInfo.month + 1, 0);
        const journalId = createProjectJournal({
          projectId: pid,
          lines,
          targetDate: monthInfo.monthEnd,
          reversalDate,
          revenueAccountIdUsed,
        });

        markRevenuePlansCompleted({
          projectId: pid,
          planIds: monthPlans.map((row) => row.revPlanId),
          journalId,
        });

        generated.push({
          monthKey: key,
          monthLabel: monthInfo.label,
          journalId: String(journalId),
          planCount: monthPlans.length,
          lineCount: lines.length,
        });
        log?.audit?.({
          title: 'REV_REC_GENERATE_MONTH_SUCCESS',
          details: {
            projectId: pid,
            monthKey: key,
            monthLabel: monthInfo.label,
            journalId: String(journalId),
            planCount: monthPlans.length,
            lineCount: lines.length,
          },
        });
      }

      if (!generated.length && !completedWithoutJournal.length) {
        log?.audit?.({
          title: 'REV_REC_GENERATE_BLOCKED',
          details: {
            projectId: pid,
            reason: 'No journals generated after evaluating target months',
            resolvedMode,
            targetSorted,
            skipped,
          },
        });
        return {
          status: 'ERROR',
          message: 'No rev rec journals were generated for the selected scope.',
          details: {
            projectId: pid,
            reason: 'NO_JOURNALS_GENERATED',
            resolvedMode,
            targetSorted,
            skipped,
          },
        };
      }

      log?.audit?.({
        title: 'REV_REC_GENERATE_SUCCESS',
        details: {
          projectId: pid,
          resolvedMode,
          generatedCount: generated.length,
          completedWithoutJournalCount: completedWithoutJournal.length,
          journalIds: generated.map((row) => row.journalId),
        },
      });

      return {
        status: 'SUCCESS',
        projectId: pid,
        mode: resolvedMode,
        generated,
        completedWithoutJournal,
        journalId: generated[generated.length - 1]?.journalId || null,
        targetMonthKeys: [
          ...generated.map((row) => row.monthKey),
          ...completedWithoutJournal.map((row) => row.monthKey),
        ],
        targetMonthLabels: [
          ...generated.map((row) => row.monthLabel),
          ...completedWithoutJournal.map((row) => row.monthLabel),
        ],
      };
    } catch (e) {
      if (e?.name === 'STATUS_MAPPING_MISSING') throw e;
      log?.error?.({
        title: 'GENERATE_REV_REC_JOURNAL_FAILED',
        details: { message: e?.message || String(e), stack: e?.stack || null },
      });
      return {
        status: 'ERROR',
        message: e?.message || String(e),
      };
    }
  }

  function lockProjectsForJournalProcessing({
    projectIds,
    taskId,
    logMessage = '',
  } = {}) {
    const ids = normalizeProjectIds(projectIds);
    const taskIdText = String(taskId || '').trim();
    if (!ids.length || !taskIdText) return { lockedProjectIds: [], failed: [] };

    const failed = [];
    const lockedProjectIds = [];
    ids.forEach((id) => {
      try {
        record.submitFields({
          type: 'customrecord_pm_projects',
          id,
          values: {
            custrecord_pm_project_taskforjnlproc: taskIdText,
            custrecord_pm_project_taskforjnlproc_log: String(logMessage || ''),
          },
          options: { enableSourcing: false, ignoreMandatoryFields: true },
        });
        lockedProjectIds.push(id);
      } catch (e) {
        failed.push({
          projectId: id,
          message: e?.message || String(e),
          name: e?.name || '',
        });
      }
    });

    return { lockedProjectIds, failed };
  }

  function clearProjectJournalProcessingLock({ projectId } = {}) {
    const pid = String(projectId || '').trim();
    if (!pid) return;
    record.submitFields({
      type: 'customrecord_pm_projects',
      id: pid,
      values: {
        custrecord_pm_project_taskforjnlproc: '',
        custrecord_pm_project_taskforjnlproc_log: '',
      },
      options: { enableSourcing: false, ignoreMandatoryFields: true },
    });
  }

  function markProjectJournalProcessingFailed({
    projectId,
    taskId,
    error,
  } = {}) {
    const pid = String(projectId || '').trim();
    if (!pid) return;
    let taskIdText = String(taskId || '').trim();
    if (!taskIdText) {
      try {
        const looked = search.lookupFields({
          type: 'customrecord_pm_projects',
          id: pid,
          columns: ['custrecord_pm_project_taskforjnlproc'],
        });
        taskIdText = String(
          looked?.custrecord_pm_project_taskforjnlproc || '',
        ).trim();
      } catch (e) {
        // ignore
      }
    }
    const errText =
      typeof error === 'string'
        ? error
        : error?.message || JSON.stringify(error || {});
    const message = `Task ${taskIdText || 'N/A'} failed: ${String(errText || '')
      .trim()
      .slice(0, 900)}`;

    record.submitFields({
      type: 'customrecord_pm_projects',
      id: pid,
      values: {
        custrecord_pm_project_taskforjnlproc: '',
        custrecord_pm_project_taskforjnlproc_log: message,
      },
      options: { enableSourcing: false, ignoreMandatoryFields: true },
    });
  }

  return {
    buildRevRecGenerationPreview,
    buildRevRecWorkflowState,
    generateRevRecJournal,
    getBilledToDateAsOf,
    getEffectivePeriodInfo,
    validateProjectRevRecEligibility,
    normalizeProjectIds,
    lockProjectsForJournalProcessing,
    clearProjectJournalProcessingLock,
    markProjectJournalProcessingFailed,
  };
});
