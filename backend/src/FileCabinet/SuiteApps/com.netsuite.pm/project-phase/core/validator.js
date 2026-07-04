/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/runtime', './helper', './user_types', './statuses'], (
  search,
  runtime,
  helper,
  user_types,
  statuses,
) => {
  const { iterateMonthsInclusive, monthKey, toNumber } = helper;

  function isFinanceUser(params) {
    try {
      return Boolean(user_types.getUserTypes()?.isFinanceUser);
    } catch (err) {
      log.error({
        title: 'Error checking finance permissions',
        details: err,
      });
      return false;
    }
  }

  function normalizeSegmentName(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  function getProjectNameById(projectId) {
    if (!projectId) return null;
    try {
      const fields = search.lookupFields({
        type: 'customrecord_pm_projects',
        id: String(projectId),
        columns: ['name'],
      });
      const name = String(fields?.name || '').trim();
      return name || null;
    } catch (e) {
      return null;
    }
  }

  function createProjectSegmentNameFilter(projectName) {
    const normalized = normalizeSegmentName(projectName);
    if (!normalized) return null;
    return ['formulatext: LOWER({cseg_project_seg})', 'is', normalized];
  }

  function resolveProjectIdBySegmentName(projectSegmentName) {
    const normalized = normalizeSegmentName(projectSegmentName);
    if (!normalized) return null;
    try {
      const suiteSearch = search.create({
        type: 'customrecord_pm_projects',

        filters: [['formulatext: LOWER({name})', 'is', normalized]],
        columns: [
          search.createColumn({ name: 'internalid', label: 'Internal ID' }),
        ],
      });
      const first =
        suiteSearch.run().getRange({ start: 0, end: 1 })?.[0] || null;
      const id = first?.getValue({ name: 'internalid' });
      return id != null ? String(id) : null;
    } catch (e) {
      return null;
    }
  }

  function getProjectSegmentValueIdByName(projectSegmentName) {
    const normalized = normalizeSegmentName(projectSegmentName);
    if (!normalized) return null;
    try {
      const suiteSearch = search.create({
        type: 'customrecord_cseg_project_seg',
        filters: [
          ['isinactive', 'is', 'F'],
          'AND',
          ['formulatext: LOWER({name})', 'is', normalized],
        ],
        columns: [
          search.createColumn({ name: 'internalid', label: 'Internal ID' }),
        ],
      });
      const first =
        suiteSearch.run().getRange({ start: 0, end: 1 })?.[0] || null;
      const id = first?.getValue({ name: 'internalid' });
      return id != null ? String(id) : null;
    } catch (e) {
      return null;
    }
  }

  function getExpectedProjectMonthsAndKeys(startDate, endDate) {
    const months = iterateMonthsInclusive(startDate, endDate);
    const keys = new Set(
      months.map((m) => monthKey(m.year, m.month)).filter(Boolean),
    );
    return { months, keys };
  }

  function isZeroVariance(financials, eps = 0.005) {
    const totalsVariance = Math.abs(
      toNumber(financials?.totals?.variance || 0),
    );
    return totalsVariance <= eps;
  }

  function getVarianceToleranceConfig(financials) {
    const script = runtime.getCurrentScript();
    const scriptId = script?.id || '';
    const deploymentId = script?.deploymentId || '';
    const projectId = financials?.projectId
      ? String(financials.projectId)
      : null;
    const parseParamNumber = (value) => {
      const raw = String(value == null ? '' : value).trim();
      if (!raw) return 0;
      const cleaned = raw
        .replace(/[%$]/g, '')
        .replace(/\s/g, '')
        .replace(',', '.');
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : 0;
    };
    const rawPercParam =
      script.getParameter({ name: 'custscript_pm_var_tolerance_perc' }) || '';
    const rawAbsParam =
      script.getParameter({ name: 'custscript_pm_var_tolerance' }) || '';
    const rawPerc = parseParamNumber(rawPercParam);
    const rawAbs = parseParamNumber(rawAbsParam);
    const percent =
      Number.isFinite(rawPerc) && rawPerc > 0
        ? rawPerc > 1
          ? rawPerc / 100
          : rawPerc
        : null;
    const absolute = Number.isFinite(rawAbs) && rawAbs > 0 ? rawAbs : null;
    const projectTotal = Math.abs(
      toNumber(
        financials?.totals?.projectTotal || financials?.totals?.soTotal || 0,
      ),
    );
    const percentAmount =
      percent != null && projectTotal > 0 ? projectTotal * percent : null;

    const candidates = [];
    if (absolute != null)
      candidates.push({ source: 'absolute', value: absolute });
    if (percentAmount != null)
      candidates.push({ source: 'percentage', value: percentAmount });

    let selected = null;
    if (candidates.length === 1) selected = candidates[0];
    if (candidates.length > 1) {
      selected =
        candidates[0].value <= candidates[1].value
          ? candidates[0]
          : candidates[1];
    }

    const epsilon = 0.005;
    const effectiveTolerance = selected ? selected.value : epsilon;
    const out = {
      absolute,
      percent,
      percentAmount,
      selectedSource: selected ? selected.source : 'default',
      effectiveTolerance,
      display:
        selected?.source === 'percentage' && percent != null
          ? `${(percent * 100).toFixed(2).replace(/\.00$/, '')}%`
          : selected?.source === 'absolute'
            ? `$${Number(selected.value).toFixed(2)}`
            : '$0.005',
    };
    log.audit({
      title: 'PM_TOLERANCE_CONFIG',
      details: {
        scriptId,
        deploymentId,
        projectId,
        rawPercentParam: rawPerc,
        rawPercentParamText: String(rawPercParam || ''),
        rawAbsoluteParam: rawAbs,
        rawAbsoluteParamText: String(rawAbsParam || ''),
        percentNormalized: percent,
        absolute,
        projectTotal,
        percentAmount,
        selectedSource: out.selectedSource,
        effectiveTolerance: out.effectiveTolerance,
        display: out.display,
      },
    });
    return out;
  }

  function isVarianceWithinTolerance(financials) {
    const variance = Math.abs(toNumber(financials?.totals?.variance || 0));
    const tolerance = getVarianceToleranceConfig(financials);
    const out = {
      ok: variance <= tolerance.effectiveTolerance,
      variance,
      tolerance,
    };
    log.audit({
      title: 'PM_TOLERANCE_CHECK',
      details: {
        projectId: financials?.projectId ? String(financials.projectId) : null,
        varianceAbs: variance,
        effectiveTolerance: tolerance.effectiveTolerance,
        selectedSource: tolerance.selectedSource,
        ok: out.ok,
      },
    });
    return out;
  }

  function validateActiveAndZeroVariance({
    status,
    statusValueKey,
    statusName,
    financials,
    message,
  } = {}) {
    const resolvedStatusKey =
      String(statusValueKey || '').trim() || String(status?.key || '').trim();
    const resolvedStatusLabel =
      String(statusName || '').trim() || String(status?.label || '').trim();
    const isOperationallyActive =
      statuses.isOperationalProjectStatus(resolvedStatusKey);
    const varianceCheck = isVarianceWithinTolerance(financials);
    const hasNoVariance = varianceCheck.ok;

    if (!isOperationallyActive || !hasNoVariance) {
      log.audit({
        title: 'PM_VARIANCE_GATE_BLOCKED',
        details: {
          status: status || null,
          statusValueKey: resolvedStatusKey || null,
          statusLabel: resolvedStatusLabel || null,
          isOperationallyActive,
          hasNoVariance,
          variance: varianceCheck.variance,
          effectiveTolerance:
            varianceCheck.tolerance?.effectiveTolerance || null,
          selectedSource: varianceCheck.tolerance?.selectedSource || null,
        },
      });
      return {
        status: 'ERROR',
        message:
          message ||
          'Project must be Active/On Hold and within variance tolerance before performing this action.',
        details: {
          status: status || null,
          statusValueKey: resolvedStatusKey || null,
          statusLabel: resolvedStatusLabel || null,
          hasNoVariance,
          variance: varianceCheck.variance,
          varianceTolerance: varianceCheck.tolerance,
        },
      };
    }
    log.audit({
      title: 'PM_VARIANCE_GATE_ALLOWED',
      details: {
        status: status || null,
        statusValueKey: resolvedStatusKey || null,
        statusLabel: resolvedStatusLabel || null,
        variance: varianceCheck.variance,
        effectiveTolerance: varianceCheck.tolerance?.effectiveTolerance || null,
        selectedSource: varianceCheck.tolerance?.selectedSource || null,
      },
    });

    return null;
  }

  function validatePhaseMonthKeysMatchExpected({
    expectedKeys,
    phaseMonthKeys,
  } = {}) {
    const expected =
      expectedKeys instanceof Set
        ? expectedKeys
        : new Set(Array.isArray(expectedKeys) ? expectedKeys : []);
    const byPhase =
      phaseMonthKeys && typeof phaseMonthKeys === 'object'
        ? phaseMonthKeys
        : {};

    const phaseIds = Object.keys(byPhase);
    if (!phaseIds.length) return null;

    const mismatchedPhases = phaseIds.reduce((out, phaseId) => {
      const actual =
        byPhase[phaseId] instanceof Set ? byPhase[phaseId] : new Set();

      const missingMonths = [];
      const extraMonths = [];

      expected.forEach((k) => {
        if (!actual.has(k)) missingMonths.push(k);
      });
      actual.forEach((k) => {
        if (!expected.has(k)) extraMonths.push(k);
      });

      if (missingMonths.length || extraMonths.length) {
        out.push({
          phaseId: String(phaseId),
          expectedMonths: expected.size,
          actualMonths: actual.size,
          missingMonths,
          extraMonths,
        });
      }
      return out;
    }, []);

    if (!mismatchedPhases.length) return null;

    return {
      status: 'ERROR',
      message:
        'Revenue plan months do not match the project start/end date range.',
      details: {
        expectedMonths: expected.size,
        mismatchedPhases,
      },
    };
  }

  function buildUpdateRevenuePlansUpdates({
    projectId,
    phasesData,
    phaseLineById,
    planInfoById,
  } = {}) {
    const safePhases = Array.isArray(phasesData) ? phasesData : [];
    if (!safePhases.length)
      return {
        status: 'ERROR',
        message: 'phasesData must be a non-empty array',
      };

    const updates = [];
    const seenPlanIds = new Set();
    const phasesById =
      phaseLineById && typeof phaseLineById === 'object' ? phaseLineById : {};
    const plansById =
      planInfoById && typeof planInfoById === 'object' ? planInfoById : {};

    for (const phaseRow of safePhases) {
      const payloadPhaseId = phaseRow?.phaseId ? String(phaseRow.phaseId) : '';
      if (!payloadPhaseId)
        return {
          status: 'ERROR',
          message: 'phaseId is required in phasesData',
        };
      if (phasesById[payloadPhaseId] == null) {
        return {
          status: 'ERROR',
          message: `Phase ${payloadPhaseId} not found on project ${String(projectId || '')}`,
        };
      }

      const plans = Array.isArray(phaseRow?.plans) ? phaseRow.plans : [];
      for (const plan of plans) {
        const planId = plan?.planId ? String(plan.planId) : '';
        if (!planId)
          return { status: 'ERROR', message: 'planId is required in plans[]' };
        if (seenPlanIds.has(planId))
          return {
            status: 'ERROR',
            message: `Duplicate planId in payload: ${planId}`,
          };
        seenPlanIds.add(planId);

        const info = plansById[planId];
        if (!info)
          return {
            status: 'ERROR',
            message: `Revenue plan ${planId} not found on project ${String(projectId || '')}`,
          };

        if (String(info.phaseId) !== payloadPhaseId) {
          return {
            status: 'ERROR',
            message: `Revenue plan ${planId} does not belong to phase ${payloadPhaseId}`,
            details: { actualPhaseId: info.phaseId },
          };
        }

        if (Boolean(info.isLockedForEdit)) {
          return {
            status: 'ERROR',
            message:
              info.lockReason ||
              `Revenue plan ${planId} is locked and cannot be modified`,
          };
        }

        if (String(info?.status?.key || '') === 'rev_rec_ready') {
          return {
            status: 'ERROR',
            message: `Revenue plan ${planId} is Rev Rec Ready and cannot be modified`,
          };
        }
        if (String(info?.status?.key || '') === 'completed') {
          return {
            status: 'ERROR',
            message: `Revenue plan ${planId} is Completed and cannot be modified`,
          };
        }

        const newQtyRaw = plan?.quantity;
        const newQty = Number(newQtyRaw);
        if (!Number.isFinite(newQty)) {
          return {
            status: 'ERROR',
            message: `Invalid quantity for plan ${planId}`,
          };
        }

        updates.push({
          phaseId: payloadPhaseId,
          planId,
          line: info.line,
          monthKey: info?.monthKey || '',
          oldQty: info.oldQty,
          newQty,
          oldStatusValueKey: info?.status?.key || null,
          isActual: Boolean(info.isActual),
          isCurrentMonth: Boolean(info.isCurrentMonth),
          isActualUpToCurrentMonth: Boolean(info.isActualUpToCurrentMonth),
        });
      }
    }

    if (!updates.length)
      return {
        status: 'WARNING',
        message: 'No plans provided',
        updated: 0,
        skipped: 0,
      };

    return { status: 'SUCCESS', updates };
  }

  function validatePhaseCumulativeQtyBounds({
    phaseId,
    planId,
    currentTotal,
    oldQty,
    newQty,
    maxQty,
  } = {}) {
    const simulatedTotal =
      toNumber(currentTotal) - toNumber(oldQty) + toNumber(newQty);
    const max = toNumber(maxQty);
    if (simulatedTotal < 0 || simulatedTotal > max) {
      return {
        status: 'ERROR',
        message: `Phase ${String(phaseId)} cumulative quantity would be out of bounds after updating plan ${String(planId)}`,
        details: { simulatedTotal, min: 0, max },
      };
    }

    return { status: 'SUCCESS', simulatedTotal };
  }

  function resolvePlanGenerationBlocker({
    phasesCount,
    isPlanGenEligible,
    totalMissingPlans,
    reasons,
    isOperationallyActive,
    financialsFailed,
    hasNoVariance,
  } = {}) {
    const phaseCount = Number(phasesCount || 0);
    const missingPlans = Number(totalMissingPlans || 0);
    const safeReasons = Array.isArray(reasons) ? reasons : [];

    if (!phaseCount) {
      return {
        blockedCode: 'plan_generation_blocked_no_phase',
        message:
          'Revenue plans can’t be generated because the project has no phases. Go to the Project page to add phases first.',
      };
    }
    if (Boolean(isPlanGenEligible) && missingPlans <= 0) {
      return { blockedCode: null, message: null };
    }
    if (!safeReasons.length) return { blockedCode: null, message: null };

    if (
      !Boolean(isOperationallyActive) &&
      !Boolean(financialsFailed) &&
      Boolean(hasNoVariance)
    ) {
      return {
        blockedCode: 'plan_generation_blocked_inactive',
        message:
          'Revenue plans can’t be generated because the project is not active. Please activate the project first.',
      };
    }
    if (
      Boolean(isOperationallyActive) &&
      !Boolean(financialsFailed) &&
      !Boolean(hasNoVariance)
    ) {
      return {
        blockedCode: 'plan_generation_blocked_financial_mismatch',
        message:
          'Revenue plans can’t be generated because there’s a mismatch between the project and the sales order amount(s). Please resolve the discrepancy first.',
      };
    }
    if (
      !Boolean(isOperationallyActive) &&
      !Boolean(financialsFailed) &&
      !Boolean(hasNoVariance)
    ) {
      return {
        blockedCode: 'plan_generation_blocked_inactive_financial_mismatch',
        message:
          'Revenue plans can’t be generated because the project is not active and there’s a mismatch with the sales order amount(s). Please fix the discrepancy and activate the project.',
      };
    }
    if (Boolean(financialsFailed)) {
      return {
        blockedCode: 'plan_generation_blocked_financial_error',
        message:
          'Revenue plans can’t be generated because project financials/variance could not be calculated. Please check configuration and try again.',
      };
    }
    return {
      blockedCode: 'plan_generation_blocked_other',
      message: `Revenue plans can’t be generated. ${safeReasons.join(' ')}`,
    };
  }

  function resolveRevPlanBanner({
    isLockedForJnlProc,
    isCompleted,
    isClosed,
    planGenerationMessage,
    planGenerationBlockedCode,
    hasVariance,
    hasRevPlansFromMetaOrCount,
    monthMismatch,
    hasPlanTallyMismatch,
    revPlanStatusConflict,
    isPostJournalState,
    revPlanStatusValueKey,
    canMarkComplete,
    canClose,
    showRevRecReadyBanner,
    missingRevPlansCount,
    planGenerationNotice,
  } = {}) {
    const notice =
      planGenerationNotice && typeof planGenerationNotice === 'object'
        ? planGenerationNotice
        : { show: false, key: null };
    let code = null;
    if (Boolean(isLockedForJnlProc)) {
      code = 'locked_for_jnl_proc';
    } else if (Boolean(isClosed)) {
      code = 'project_closed';
    } else if (Boolean(isCompleted)) {
      code = 'project_completed';
    } else if (String(planGenerationMessage || '').trim()) {
      code = planGenerationBlockedCode || 'plan_generation_blocked_other';
    } else if (Boolean(hasVariance)) {
      code = 'variance_mismatch';
    } else if (!Boolean(hasRevPlansFromMetaOrCount)) {
      code = 'no_rev_plans';
    } else if (Boolean(monthMismatch)) {
      code = 'month_mismatch';
    } else if (Boolean(hasPlanTallyMismatch)) {
      code = 'plan_tally_mismatch';
    } else if (Boolean(revPlanStatusConflict)) {
      code = 'revplan_status_conflict';
    } else if (
      !Boolean(isPostJournalState) &&
      String(revPlanStatusValueKey || '')
        .trim()
        .toLowerCase() === 'rev_rec_ready'
    ) {
      code = 'rev_rec_ready_locked';
    } else if (Boolean(canClose)) {
      code = 'close_ready_hint';
    } else if (Boolean(canMarkComplete)) {
      code = 'completion_ready_hint';
    } else if (Boolean(isPostJournalState)) {
      code = 'post_journal_forecast_only';
    } else if (Boolean(showRevRecReadyBanner)) {
      code = 'rev_rec_journal_ready';
    } else if (Number(missingRevPlansCount || 0) > 0) {
      code = 'missing_rev_plans_detected';
    } else if (
      Boolean(notice.show) &&
      String(notice.key || '').toLowerCase() === 'missing'
    ) {
      code = 'revplan_notice_missing_plans';
    } else if (
      Boolean(notice.show) &&
      String(notice.key || '').toLowerCase() === 'ready'
    ) {
      code = 'revplan_notice_ready_to_generate';
    }

    let variant = 'warning';
    if (
      String(code || '').indexOf('plan_generation_blocked_') === 0 ||
      code === 'variance_mismatch'
    ) {
      variant = 'error';
    } else if (
      code === 'completion_ready_hint' ||
      code === 'close_ready_hint' ||
      code === 'post_journal_forecast_only' ||
      code === 'rev_rec_journal_ready' ||
      code === 'revplan_notice_missing_plans' ||
      code === 'revplan_notice_ready_to_generate'
    ) {
      variant = 'info';
    } else if (
      code === 'project_completed' ||
      code === 'project_closed' ||
      !code
    ) {
      variant = 'success';
    }

    return { code, variant };
  }

  function resolveProjectBanner({
    isLockedForJnlProc,
    isCompleted,
    isClosed,
    canActivate,
    canMarkComplete,
    canClose,
    hasSalesOrder,
    canCreatePhase,
    phasesCount,
    planGenerationNotice,
  } = {}) {
    const notice =
      planGenerationNotice && typeof planGenerationNotice === 'object'
        ? planGenerationNotice
        : { show: false, key: null };

    if (Boolean(isLockedForJnlProc)) {
      return { code: 'locked_for_jnl_proc', variant: 'warning' };
    }
    if (Boolean(isClosed)) {
      return { code: 'project_closed_frozen', variant: 'success' };
    }
    if (Boolean(isCompleted)) {
      return { code: 'project_completed_frozen', variant: 'success' };
    }
    if (Boolean(canActivate)) return { code: 'activate_hint', variant: 'info' };
    if (Boolean(canClose)) return { code: 'close_ready_hint', variant: 'info' };
    if (Boolean(canMarkComplete))
      return { code: 'completion_ready_hint', variant: 'info' };
    if (!Boolean(hasSalesOrder)) {
      return { code: 'missing_sales_order', variant: 'warning' };
    }
    if (Boolean(canCreatePhase) && Number(phasesCount || 0) === 0) {
      return { code: 'no_phases_hint', variant: 'info' };
    }
    if (
      Boolean(notice.show) &&
      String(notice.key || '').toLowerCase() === 'missing'
    ) {
      return { code: 'revplan_notice_missing_plans', variant: 'info' };
    }
    if (
      Boolean(notice.show) &&
      String(notice.key || '').toLowerCase() === 'ready'
    ) {
      return { code: 'revplan_notice_ready_to_generate', variant: 'info' };
    }
    return { code: null, variant: 'info' };
  }

  return {
    isFinanceUser,
    getProjectNameById,
    createProjectSegmentNameFilter,
    resolveProjectIdBySegmentName,
    getProjectSegmentValueIdByName,
    getExpectedProjectMonthsAndKeys,
    isZeroVariance,
    getVarianceToleranceConfig,
    isVarianceWithinTolerance,
    validateActiveAndZeroVariance,
    validatePhaseMonthKeysMatchExpected,
    buildUpdateRevenuePlansUpdates,
    validatePhaseCumulativeQtyBounds,
    resolvePlanGenerationBlocker,
    resolveRevPlanBanner,
    resolveProjectBanner,
  };
});
