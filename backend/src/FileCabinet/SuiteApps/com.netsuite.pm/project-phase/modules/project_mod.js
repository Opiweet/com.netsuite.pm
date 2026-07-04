/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
  'N/search',
  'N/record',
  'N/log',
  'N/query',
  '../../pm_config',
  '../core/helper',
  '../core/statuses',
  './project_financials_mod',
  './project_phase_mod',
  './rev_plan_mod',
  './rev_rec_mod',
  './project_month_context_mod',
  '../core/validator',
], (
  search,
  record,
  log,
  query,
  pmConfig,
  helper,
  statuses,
  projectFinancialsMod,
  projectPhaseMod,
  revPlanMod,
  revRecMod,
  projectMonthContextMod,
  validator,
) => {
  const { formatDateForSQL, getAllResults, toNumber } = helper;
  const {
    getProjectFinancials,
    getGrossInvoicedAmountForSalesOrders,
    getNetInvoicedAmountForSalesOrders,
  } = projectFinancialsMod;
  const MONEY_TOLERANCE = 0.005;

  function isAmountAtLeastTarget(amount, target, tolerance = MONEY_TOLERANCE) {
    return toNumber(amount) + Number(tolerance || 0) >= toNumber(target);
  }

  function isAmountEqualTarget(amount, target, tolerance = MONEY_TOLERANCE) {
    return (
      Math.abs(toNumber(amount) - toNumber(target)) <= Number(tolerance || 0)
    );
  }

  function parseDateAny(value) {
    if (!value) return null;
    if (value instanceof Date) return value;

    const raw = String(value).trim();
    if (!raw) return null;

    // Prefer date-only parsing to avoid timezone day-shifts (NetSuite DATE fields are date-only).
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const day = parseInt(m[3], 10);
      return new Date(year, month - 1, day);
    }

    return new Date(raw);
  }

  function getProjectStatusListValueId(statusLabel) {
    const label = String(statusLabel || '').trim();
    if (!label) return null;

    const suiteSearch = search.create({
      type: 'customlist_pm_project_status',
      filters: [['isinactive', 'is', 'F'], 'AND', ['name', 'is', label]],
      columns: [search.createColumn({ name: 'internalid' })],
    });

    const first = getAllResults(suiteSearch)?.[0] || null;
    const id = first?.getValue({ name: 'internalid' }) || null;
    return id != null ? String(id) : null;
  }

  function resolveProjectStatusByLabelStrict(statusLabel) {
    const label = String(statusLabel || '').trim();
    if (!label) return null;
    const statusId = getProjectStatusListValueId(label);
    if (!statusId) return null;
    return statuses.mapNetSuiteStatusStrict(statuses.ENTITY_TYPES.PROJECT, {
      id: statusId,
      text: label,
      logger: log,
      logTitle: 'STATUS_MAPPING_UNKNOWN_READ',
    });
  }

  function getDefaultDraftProjectStatusIdStrict() {
    const draftStatus = resolveProjectStatusByLabelStrict('Draft');
    if (!draftStatus?.id) {
      throw new Error(
        'Unable to resolve the default Draft project status from customlist_pm_project_status.',
      );
    }
    return String(draftStatus.id);
  }

  function getProjectBasics(projectId) {
    const pid = String(projectId || '').trim();
    if (!pid || !/^\d+$/.test(pid)) return null;
    try {
      const sql = `
        SELECT
          TO_CHAR(custrecord_pm_project_startdate, 'DD/MM/YYYY') AS startdate,
          TO_CHAR(custrecord_pm_project_enddate, 'DD/MM/YYYY') AS enddate,
          custrecord_pm_project_status AS statusid,
          BUILTIN.DF(custrecord_pm_project_status) AS statustext,
          custrecord_pm_project_taskforjnlproc AS jnlproctaskid,
          custrecord_pm_project_taskforjnlproc_log AS jnlproclog
        FROM customrecord_pm_projects
        WHERE id = ${pid}
      `;
      const rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
      const row = rows[0] || null;
      if (!row) return null;

      const rawStatusId = row?.statusid != null ? String(row.statusid) : '';
      const rawStatusName =
        row?.statustext != null ? String(row.statustext) : null;
      const mapped = statuses.mapNetSuiteStatusStrict(
        statuses.ENTITY_TYPES.PROJECT,
        {
          id: rawStatusId,
          text: rawStatusName,
          logger: log,
          logTitle: 'STATUS_MAPPING_UNKNOWN_READ',
        },
      );

      return {
        projectId: pid,
        startDate: row?.startdate ? String(row.startdate) : null,
        endDate: row?.enddate ? String(row.enddate) : null,
        status: mapped,
        jnlProcTaskId: String(row?.jnlproctaskid || '').trim(),
        jnlProcLog: String(row?.jnlproclog || '').trim(),
      };
    } catch (e) {
      if (e?.name === 'STATUS_MAPPING_MISSING') throw e;
      return null;
    }
  }

  function activateProject({ projectId } = {}) {
    const pid = projectId != null ? String(projectId) : '';
    if (!pid) {
      return {
        status: 'ERROR',
        name: 'BAD_REQUEST',
        message: 'projectId is required.',
      };
    }

    const mutableErr = ensureProjectMutable({
      projectId: pid,
      actionLabel: 'Project activation',
    });
    if (mutableErr?.status === 'ERROR') return mutableErr;

    const basics = getProjectBasics(pid);
    if (!basics) {
      return {
        status: 'ERROR',
        name: 'NOT_FOUND',
        message: `Project ${pid} was not found or could not be loaded.`,
      };
    }

    const projectStatusValueKey = String(basics?.status?.key || '');
    if (projectStatusValueKey === statuses.PROJECT_STATUS_KEYS.ACTIVE) {
      return {
        status: 'ERROR',
        name: 'ALREADY_ACTIVE',
        message: 'Project is already Active.',
      };
    }

    if (statuses.isTerminalProjectStatus(projectStatusValueKey)) {
      return {
        status: 'ERROR',
        name: 'PROJECT_FROZEN',
        message: 'Completed or Closed project cannot be activated.',
      };
    }

    // "On Hold" is informational only. Allow resuming to Active directly.
    if (projectStatusValueKey === statuses.PROJECT_STATUS_KEYS.ON_HOLD) {
      const activeStatus = resolveProjectStatusByLabelStrict('Active');
      if (!activeStatus?.id) {
        return {
          status: 'ERROR',
          name: 'STATUS_LOOKUP_FAILED',
          message:
            "Cannot activate project: could not resolve the 'Active' status value.",
        };
      }
      try {
        record.submitFields({
          type: 'customrecord_pm_projects',
          id: pid,
          values: {
            custrecord_pm_project_status: activeStatus.id,
          },
          options: { enableSourcing: true, ignoreMandatoryFields: true },
        });
        return {
          status: 'OK',
          projectId: pid,
          status: activeStatus,
          message: 'Project activated successfully.',
        };
      } catch (e) {
        log.error({ title: 'ACTIVATE_PROJECT_SUBMIT_FAILED', details: e });
        return {
          status: 'ERROR',
          name: 'SAVE_FAILED',
          message: 'Failed to activate project. Please try again.',
        };
      }
    }

    // 1) Must have phases
    const phaseResult = projectPhaseMod.getProjectPhases(pid);
    const phases = Array.isArray(phaseResult) ? phaseResult : [];
    if (!phases.length) {
      return {
        status: 'ERROR',
        name: 'NO_PHASES',
        message: 'Cannot activate project: at least one phase is required.',
      };
    }

    // 2) No variance
    let financials = null;
    try {
      financials = getProjectFinancials(pid);
    } catch (e) {
      log.error({
        title: 'ACTIVATE_PROJECT_FINANCIALS_FAILED',
        details: { projectId: pid, error: e },
      });
      return {
        status: 'ERROR',
        name: 'FINANCIALS_FAILED',
        message:
          'Cannot activate project: variance could not be calculated. Please try again.',
      };
    }

    const varianceCheck = validator.isVarianceWithinTolerance(financials);
    const hasNoVariance = varianceCheck.ok;
    log.audit({
      title: 'PM_ACTIVATE_VARIANCE_CHECK',
      details: {
        projectId: pid,
        variance: toNumber(financials?.totals?.variance || 0),
        varianceAbs: varianceCheck.variance,
        effectiveTolerance: varianceCheck.tolerance?.effectiveTolerance || null,
        selectedSource: varianceCheck.tolerance?.selectedSource || null,
        hasNoVariance,
      },
    });
    if (!hasNoVariance) {
      return {
        status: 'ERROR',
        name: 'HAS_VARIANCE',
        message:
          'Cannot activate project: there’s a mismatch between the project and the sales order amount(s). Please resolve the discrepancy first.',
        details: {
          variance: toNumber(financials?.totals?.variance || 0),
          varianceTolerance: varianceCheck.tolerance,
        },
      };
    }

    const activeStatus = resolveProjectStatusByLabelStrict('Active');
    if (!activeStatus?.id) {
      return {
        status: 'ERROR',
        name: 'STATUS_LOOKUP_FAILED',
        message:
          "Cannot activate project: could not resolve the 'Active' status value.",
      };
    }

    try {
      record.submitFields({
        type: 'customrecord_pm_projects',
        id: pid,
        values: {
          custrecord_pm_project_status: activeStatus.id,
        },
        options: { enableSourcing: true, ignoreMandatoryFields: true },
      });
    } catch (e) {
      log.error({ title: 'ACTIVATE_PROJECT_SUBMIT_FAILED', details: e });
      return {
        status: 'ERROR',
        name: 'SAVE_FAILED',
        message: 'Failed to activate project. Please try again.',
      };
    }

    return {
      status: 'OK',
      projectId: pid,
      status: activeStatus,
      message: 'Project activated successfully.',
    };
  }

  function getProjectCompletionEligibility({ projectId } = {}) {
    const pid = projectId != null ? String(projectId).trim() : '';
    if (!pid) {
      return {
        canComplete: false,
        reason: 'projectId is required.',
        details: null,
      };
    }

    const fetchedPhases = projectPhaseMod.getProjectPhases(pid);
    const phases = Array.isArray(fetchedPhases) ? fetchedPhases : [];
    const phaseTotalQty = phases.reduce(
      (sum, row) => sum + toNumber(row?.definedQty || 0),
      0,
    );
    const actualQtyCompleted = toNumber(
      revPlanMod.getProjectActualRevPlanRollups({ projectId: pid })?.[pid]
        ?.qtyCompleted || 0,
    );

    const financials = getProjectFinancials(pid) || null;
    const contractValue = toNumber(financials?.totals?.projectTotal || 0);
    const netInvoicedAmount = getNetInvoicedAmountForSalesOrders(
      financials?.salesOrderIds || [],
    );
    const grossInvoicedAmount = getGrossInvoicedAmountForSalesOrders(
      financials?.salesOrderIds || [],
    );
    const recognizedAmount = toNumber(
      financials?.revenueRecognition?.amount ||
        financials?.totals?.recognizedAmount ||
        0,
    );

    const qtyMatch = Math.abs(actualQtyCompleted - phaseTotalQty) <= 0.0001;
    const recognizedAmountMatch = isAmountAtLeastTarget(
      recognizedAmount,
      contractValue,
    );
    const grossInvoicedAmountMatch = isAmountAtLeastTarget(
      grossInvoicedAmount,
      contractValue,
    );
    const canComplete = recognizedAmountMatch;
    const canClose = recognizedAmountMatch && grossInvoicedAmountMatch;

    return {
      canComplete,
      canClose,
      reason: canComplete
        ? null
        : 'Recognized amount must be at least the project total.',
      details: {
        phaseTotalQty,
        actualQtyCompleted,
        qtyMatch,
        contractValue,
        invoicedAmount: netInvoicedAmount,
        grossInvoicedAmount,
        grossInvoicedAmountMatch,
        recognizedAmount,
        recognizedAmountMatch,
      },
    };
  }

  function setProjectStatusByLabel({ projectId, statusLabel } = {}) {
    const pid = projectId != null ? String(projectId).trim() : '';
    const label = String(statusLabel || '').trim();
    if (!pid) {
      return {
        status: 'ERROR',
        name: 'BAD_REQUEST',
        message: 'projectId is required.',
      };
    }
    if (!label) {
      return {
        status: 'ERROR',
        name: 'BAD_REQUEST',
        message: 'statusLabel is required.',
      };
    }

    const mappedStatus = resolveProjectStatusByLabelStrict(label);
    if (!mappedStatus?.id) {
      return {
        status: 'ERROR',
        name: 'STATUS_LOOKUP_FAILED',
        message: `Could not resolve project status '${label}'.`,
      };
    }

    try {
      record.submitFields({
        type: 'customrecord_pm_projects',
        id: pid,
        values: {
          custrecord_pm_project_status: mappedStatus.id,
        },
        options: { enableSourcing: true, ignoreMandatoryFields: true },
      });
      return {
        status: 'OK',
        projectId: pid,
        status: mappedStatus,
        message: `Project status updated to ${label}.`,
      };
    } catch (e) {
      log.error({ title: 'SET_PROJECT_STATUS_FAILED', details: e });
      return {
        status: 'ERROR',
        name: 'SAVE_FAILED',
        message: 'Failed to update project status.',
      };
    }
  }

  function transitionProjectStatus({ projectId, transition } = {}) {
    const pid = projectId != null ? String(projectId).trim() : '';
    const key = String(transition || '')
      .trim()
      .toLowerCase();
    if (!pid) {
      return {
        status: 'ERROR',
        name: 'BAD_REQUEST',
        message: 'projectId is required.',
      };
    }

    const mutableErr = ensureProjectMutable({
      projectId: pid,
      actionLabel: 'Project status transition',
      allowCompleted: key === 'close',
    });
    if (mutableErr?.status === 'ERROR') return mutableErr;

    const basics = getProjectBasics(pid);
    if (!basics) {
      return {
        status: 'ERROR',
        name: 'NOT_FOUND',
        message: `Project ${pid} was not found or could not be loaded.`,
      };
    }

    if (key === 'activate') return activateProject({ projectId: pid });

    const projectStatusValueKey = String(basics?.status?.key || '');
    if (key === 'on_hold') {
      const violation = statuses.getProjectTransitionViolation(
        projectStatusValueKey,
        key,
      );
      if (violation === 'Completed or Closed project cannot be put On Hold.') {
        return {
          status: 'ERROR',
          name: 'INVALID_TRANSITION',
          message: violation,
        };
      }
      if (violation === 'Project is already On Hold.') {
        return {
          status: 'ERROR',
          name: 'ALREADY_ON_HOLD',
          message: violation,
        };
      }
      if (violation) {
        return {
          status: 'ERROR',
          name: 'INVALID_TRANSITION',
          message: violation,
        };
      }
      return setProjectStatusByLabel({
        projectId: pid,
        statusLabel: 'On Hold',
      });
    }

    if (key === 'complete') {
      const violation = statuses.getProjectTransitionViolation(
        projectStatusValueKey,
        key,
      );
      if (violation) {
        return {
          status: 'ERROR',
          name: 'ALREADY_COMPLETED',
          message: violation,
        };
      }
      const eligibility = getProjectCompletionEligibility({ projectId: pid });
      if (!eligibility.canComplete) {
        return {
          status: 'ERROR',
          name: 'COMPLETE_CRITERIA_NOT_MET',
          message:
            eligibility.reason ||
            'Project does not satisfy completion criteria.',
          details: eligibility.details || null,
        };
      }
      return setProjectStatusByLabel({
        projectId: pid,
        statusLabel: 'Completed',
      });
    }

    if (key === 'close') {
      const violation = statuses.getProjectTransitionViolation(
        projectStatusValueKey,
        key,
      );
      if (violation) {
        return {
          status: 'ERROR',
          name: 'ALREADY_CLOSED',
          message: violation,
        };
      }
      const eligibility = getProjectCompletionEligibility({ projectId: pid });
      if (!eligibility.canClose) {
        return {
          status: 'ERROR',
          name: 'CLOSE_CRITERIA_NOT_MET',
          message:
            'Project cannot be closed until recognized amount reaches the project total and gross invoiced amount is at least the project total.',
          details: eligibility.details || null,
        };
      }
      return setProjectStatusByLabel({
        projectId: pid,
        statusLabel: 'Closed',
      });
    }

    return {
      status: 'ERROR',
      name: 'BAD_REQUEST',
      message: statuses.getProjectTransitionViolation(
        projectStatusValueKey,
        key,
      ),
    };
  }

  function ensureProjectMutable({
    projectId,
    actionLabel,
    allowCompleted = false,
  } = {}) {
    const pid = projectId != null ? String(projectId).trim() : '';
    if (!pid) {
      return {
        status: 'ERROR',
        name: 'BAD_REQUEST',
        message: 'projectId is required.',
      };
    }

    const basics = getProjectBasics(pid);
    if (!basics) {
      return {
        status: 'ERROR',
        name: 'NOT_FOUND',
        message: `Project ${pid} was not found or could not be loaded.`,
      };
    }

    const projectStatusValueKey = String(basics?.status?.key || '');
    const allowCompletedTransition =
      Boolean(allowCompleted) &&
      statuses.isCompletedProjectStatus(projectStatusValueKey);
    if (
      statuses.isTerminalProjectStatus(projectStatusValueKey) &&
      !allowCompletedTransition
    ) {
      return {
        status: 'ERROR',
        name: 'PROJECT_FROZEN',
        message: actionLabel
          ? `Project is Completed or Closed. ${actionLabel} is not allowed.`
          : 'Project is Completed or Closed.',
        details: { projectId: pid, status: basics.status || null },
      };
    }

    if (String(basics.jnlProcTaskId || '').trim()) {
      return {
        status: 'ERROR',
        name: 'PROJECT_JNLPROC_LOCKED',
        message: actionLabel
          ? `Project is locked for journal processing. ${actionLabel} is not allowed.`
          : 'Project is locked for journal processing.',
        details: {
          projectId: pid,
          taskId: basics.jnlProcTaskId || null,
          log: basics.jnlProcLog || null,
        },
      };
    }

    return null;
  }

  /**
   * Check the start date cannot be changed once set.
   * @param {number|string} projectId - Internal ID of the project
   * @param {string|Date} newStartDate - New start date to validate
   * @returns {{status: 'SUCCESS'|'ERROR', code?: string, message?: string}}
   */
  function validateStartDateAdvanced(projectId, newStartDate) {
    try {
      const pid = parseInt(projectId, 10);

      const project = record.load({
        type: 'customrecord_pm_projects',
        id: pid,
      });

      const oldStartDate = project.getValue('custrecord_pm_project_startdate');
      if (!oldStartDate) return { status: 'SUCCESS' };

      const newStart = parseDateAny(newStartDate);
      const oldStart = new Date(oldStartDate);

      if (!newStart || Number.isNaN(newStart.getTime())) {
        return {
          status: 'ERROR',
          code: 'START_DATE_REQUIRED',
          message: 'Start Date is required',
        };
      }

      if (newStart.getTime() !== oldStart.getTime()) {
        return {
          status: 'ERROR',
          code: 'START_DATE_BLOCKED',
          message: 'Start Date cannot be changed once set',
        };
      }

      return { status: 'SUCCESS' };
    } catch (e) {
      return { status: 'ERROR', message: e?.message || e };
    }
  }

  /**
   * Check end date reduction rules: block if actual exists after new end date; otherwise warn with plans to delete.
   * @param {number|string} projectId - Internal ID of the project
   * @param {string|Date} newEndDate - New end date to validate
   * @returns {{status: 'SUCCESS'|'WARNING'|'ERROR', message?: string, data?: {plansToDelete: Array<string|number>}}}
   */
  function validateEndDateAdvanced(projectId, newEndDate) {
    try {
      const pid = parseInt(projectId, 10);

      const project = record.load({
        type: 'customrecord_pm_projects',
        id: pid,
      });

      const oldEndDate = project.getValue('custrecord_pm_project_enddate');
      if (!oldEndDate) return { status: 'SUCCESS' };

      const newEnd = parseDateAny(newEndDate);
      const oldEnd = new Date(oldEndDate);

      if (!newEnd || Number.isNaN(newEnd.getTime())) {
        return { status: 'ERROR', message: 'End Date is required' };
      }

      // Extension is always allowed
      if (newEnd > oldEnd) {
        return {
          status: 'SUCCESS',
          message: 'End date extended successfully',
        };
      }

      // Rev plan periods are stored as the last day of each month, so validations should be
      // based on month/year. If the end date changes within the same month, do not delete
      // any plans in that month.
      const oldYm = `${oldEnd.getFullYear()}-${oldEnd.getMonth() + 1}`;
      const newYm = `${newEnd.getFullYear()}-${newEnd.getMonth() + 1}`;
      if (oldYm === newYm) return { status: 'SUCCESS' };

      const endMonthLastDay = new Date(
        newEnd.getFullYear(),
        newEnd.getMonth() + 1,
        0,
      );
      const formattedEnd = formatDateForSQL(endMonthLastDay);

      const sql = `
          SELECT
            rp.id,
            rp.custrecord_pm_revplan_type as type
          FROM
            customrecord_pm_revenue_plan rp
          WHERE
            rp.custrecord_pm_revplan_project = ${pid}
            AND
            rp.custrecord_pm_revplan_period > TO_DATE('${formattedEnd}', 'YYYY-MM-DD')
        `;

      const results = query.runSuiteQL({ query: sql }).asMappedResults();
      if (!results.length) return { status: 'SUCCESS' };

      const actualTypeId =
        pmConfig?.LIST_IDS?.REV_PLAN_TYPE?.ACTUAL != null
          ? String(pmConfig.LIST_IDS.REV_PLAN_TYPE.ACTUAL)
          : '1';
      const hasActual = results.some((r) => String(r.type) === actualTypeId);
      if (hasActual) {
        return {
          status: 'ERROR',
          message:
            'Cannot reduce End Date: Actual revenue exists after selected date',
        };
      }

      return {
        status: 'WARNING',
        message: `${results.length} forecast plan(s) after end date will be deleted. Continue?`,
        data: { plansToDelete: results.map((r) => r.id) },
      };
    } catch (e) {
      return { status: 'ERROR', message: e?.message || e };
    }
  }

  /**
   * Create or update a Project (customrecord_pm_projects).
   * @param {Object} data - project payload
   * @returns {number|{status: string, message: string}} projectId or error payload
   */
  function upsertProject(data) {
    try {
      const projectId = data?.projectId || null;
      const isUpdate = !!projectId;
      if (isUpdate) {
        const mutableErr = ensureProjectMutable({
          projectId,
          actionLabel: 'Project edit',
        });
        if (mutableErr?.status === 'ERROR') return mutableErr;
      }

      if (isUpdate) {
        const values = {};

        if (data.name !== undefined)
          values.name = String(data.name || '').trim();

        if (data.description !== undefined)
          values.custrecord_pm_project_desc =
            data.description == null ? '' : String(data.description);

        if (data.startDate !== undefined)
          if (data.startDate) {
            const startValidation = validateStartDateAdvanced(
              projectId,
              data.startDate,
            );

            if (startValidation.status === 'ERROR') {
              return { status: 'ERROR', message: startValidation.message };
            }

            values.custrecord_pm_project_startdate = parseDateAny(
              data.startDate,
            );
          } else {
            // Allow clearing only if the field was never set; otherwise preserve the rule.
            const startValidation = validateStartDateAdvanced(projectId, null);
            if (startValidation.status === 'ERROR') {
              return { status: 'ERROR', message: startValidation.message };
            }
            values.custrecord_pm_project_startdate = null;
          }

        if (data.endDate !== undefined)
          if (data.endDate) {
            const endValidation = validateEndDateAdvanced(
              projectId,
              data.endDate,
            );

            if (endValidation.status === 'ERROR') return endValidation;

            if (endValidation.status === 'WARNING') {
              const plans = endValidation.data?.plansToDelete || [];
              if (plans.length) {
                plans.forEach((id) => {
                  record.delete({ type: 'customrecord_pm_revenue_plan', id });
                });
              }
            }

            values.custrecord_pm_project_enddate = parseDateAny(data.endDate);
          } else {
            values.custrecord_pm_project_enddate = null;
          }

        if (data.customer !== undefined)
          values.custrecord_pm_project_customer = data.customer;

        if (data.projectManager !== undefined)
          values.custrecord_pm_project_manager = data.projectManager || null;

        if (data.poRef !== undefined)
          values.custrecord_pm_project_po =
            data.poRef == null ? '' : String(data.poRef);

        if (data.department !== undefined)
          values.custrecord_pm_project_dept = data.department;

        if (data.status !== undefined)
          values.custrecord_pm_project_status = data.status;

        if (Object.keys(values).length > 0) {
          record.submitFields({
            type: 'customrecord_pm_projects',
            id: projectId,
            values,
            options: { enableSourcing: false, ignoreMandatoryFields: true },
          });
        }

        return projectId;
      }

      const rec = record.create({
        type: 'customrecord_pm_projects',
      });

      if (data.name !== undefined)
        rec.setValue({
          fieldId: 'name',
          value: String(data.name || '').trim(),
        });

      const subsidiaryToSet = String(pmConfig?.SUBSIDIARY || '').trim();
      if (subsidiaryToSet)
        rec.setValue({
          fieldId: 'custrecord_pm_project_subsidiary',
          value: subsidiaryToSet,
        });

      if (data.description !== undefined)
        rec.setValue({
          fieldId: 'custrecord_pm_project_desc',
          value: data.description,
        });

      if (data.startDate !== undefined)
        rec.setValue({
          fieldId: 'custrecord_pm_project_startdate',
          value: parseDateAny(data.startDate),
        });

      if (data.endDate !== undefined)
        rec.setValue({
          fieldId: 'custrecord_pm_project_enddate',
          value: parseDateAny(data.endDate),
        });

      if (data.customer !== undefined)
        rec.setValue({
          fieldId: 'custrecord_pm_project_customer',
          value: data.customer,
        });

      if (data.projectManager !== undefined)
        rec.setValue({
          fieldId: 'custrecord_pm_project_manager',
          value: data.projectManager || null,
        });

      if (data.poRef !== undefined)
        rec.setValue({
          fieldId: 'custrecord_pm_project_po',
          value: data.poRef == null ? '' : String(data.poRef),
        });

      if (data.department !== undefined)
        rec.setValue({
          fieldId: 'custrecord_pm_project_dept',
          value: data.department,
        });

      const incomingStatus =
        data?.status != null ? String(data.status).trim() : '';
      rec.setValue({
        fieldId: 'custrecord_pm_project_status',
        value: incomingStatus || getDefaultDraftProjectStatusIdStrict(),
      });

      const id = rec.save({
        enableSourcing: true,
        ignoreMandatoryFields: false,
      });
      return id;
    } catch (e) {
      log.error({ title: 'UPSERT PROJECT ERROR', details: e });
      throw e;
    }
  }

  function upsertProjectMonthSimulation({ projectId, simulatedPeriod } = {}) {
    const pid = String(projectId || '').trim();
    if (!pid) {
      return {
        status: 'ERROR',
        name: 'BAD_REQUEST',
        message: 'projectId is required.',
      };
    }

    const mutableErr = ensureProjectMutable({
      projectId: pid,
      actionLabel: 'Project month simulation',
    });
    if (mutableErr?.status === 'ERROR') return mutableErr;

    try {
      const raw = String(simulatedPeriod || '').trim();
      const parsed = raw
        ? projectMonthContextMod.parseSimulatedPeriod(raw)
        : null;
      if (raw && !parsed) {
        return {
          status: 'ERROR',
          name: 'BAD_REQUEST',
          message:
            'simulatedPeriod must use the mon-yyyy format, for example jul-2026.',
        };
      }

      const values = {
        custrecord_pm_project_sim_month: parsed?.raw || '',
      };

      record.submitFields({
        type: 'customrecord_pm_projects',
        id: pid,
        values,
        options: { enableSourcing: false, ignoreMandatoryFields: true },
      });

      const rolloverResult =
        revPlanMod.rollProjectCurrentMonthRevPlansActual({
          projectId: pid,
        }) || null;
      if (rolloverResult?.status === 'ERROR') {
        return rolloverResult;
      }

      return {
        status: 'OK',
        projectId: pid,
        simulatedPeriod: parsed?.raw || '',
        rolloverResult,
      };
    } catch (e) {
      log.error({ title: 'UPSERT PROJECT MONTH SIMULATION ERROR', details: e });
      throw e;
    }
  }

  function getRevRecGenerationGuard({
    projectId,
    financials,
    isLockedForJnlProc,
  } = {}) {
    const pid = String(projectId || '').trim();
    if (!pid) {
      return {
        canGenerateJournal: false,
        reason: 'Project id is required.',
        requiresForceMissingOpenConfirmation: false,
        showReadyToGenerateMessage: false,
      };
    }

    if (Boolean(isLockedForJnlProc)) {
      return {
        canGenerateJournal: false,
        reason:
          'Project is locked for Rev Rec journal background processing. Please wait until processing is completed.',
        requiresForceMissingOpenConfirmation: false,
        showReadyToGenerateMessage: false,
        submitToFinanceAction: {
          visible: false,
          enabled: false,
          targetMonthKeys: [],
          targetMonthLabels: [],
          reason:
            'Project is locked for Rev Rec journal background processing. Please wait until processing is completed.',
          targetsCurrentMonth: false,
        },
        generateJournalAction: {
          visible: false,
          enabled: false,
          targetMonthKeys: [],
          targetMonthLabels: [],
          reason:
            'Project is locked for Rev Rec journal background processing. Please wait until processing is completed.',
          targetsCurrentMonth: false,
        },
      };
    }

    const eligibilityErr = revRecMod.validateProjectRevRecEligibility({
      projectId: pid,
      financials,
    });
    if (eligibilityErr?.status === 'ERROR') {
      return {
        canGenerateJournal: false,
        reason: eligibilityErr?.message || 'Project is not eligible.',
        requiresForceMissingOpenConfirmation: false,
        showReadyToGenerateMessage: false,
        submitToFinanceAction: {
          visible: false,
          enabled: false,
          targetMonthKeys: [],
          targetMonthLabels: [],
          reason: eligibilityErr?.message || 'Project is not eligible.',
          targetsCurrentMonth: false,
        },
        generateJournalAction: {
          visible: false,
          enabled: false,
          targetMonthKeys: [],
          targetMonthLabels: [],
          reason: eligibilityErr?.message || 'Project is not eligible.',
          targetsCurrentMonth: false,
        },
      };
    }

    const preview = revRecMod.buildRevRecGenerationPreview({ projectId: pid });
    if (preview?.status === 'ERROR') {
      return {
        canGenerateJournal: false,
        reason:
          preview?.message || 'Failed to compute rev rec generation preview.',
        requiresForceMissingOpenConfirmation: false,
        showReadyToGenerateMessage: false,
        submitToFinanceAction: {
          visible: false,
          enabled: false,
          targetMonthKeys: [],
          targetMonthLabels: [],
          reason:
            preview?.message || 'Failed to compute rev rec generation preview.',
          targetsCurrentMonth: false,
        },
        generateJournalAction: {
          visible: false,
          enabled: false,
          targetMonthKeys: [],
          targetMonthLabels: [],
          reason:
            preview?.message || 'Failed to compute rev rec generation preview.',
          targetsCurrentMonth: false,
        },
      };
    }

    const submitToFinanceAction =
      preview?.submitToFinanceAction &&
      typeof preview.submitToFinanceAction === 'object'
        ? preview.submitToFinanceAction
        : {
            visible: false,
            enabled: false,
            targetMonthKeys: [],
            targetMonthLabels: [],
            reason: null,
            targetsCurrentMonth: false,
          };
    const generateJournalAction =
      preview?.generateJournalAction &&
      typeof preview.generateJournalAction === 'object'
        ? preview.generateJournalAction
        : {
            visible: false,
            enabled: false,
            targetMonthKeys: [],
            targetMonthLabels: [],
            reason: null,
            targetsCurrentMonth: false,
          };

    return {
      canGenerateJournal: Boolean(generateJournalAction?.enabled),
      reason: generateJournalAction?.reason || null,
      requiresForceMissingOpenConfirmation: false,
      showReadyToGenerateMessage: Boolean(generateJournalAction?.enabled),
      hasMissingCompletedJournals: Boolean(
        preview?.hasMissingCompletedJournals,
      ),
      missingCompletedJournalMonthKeys: Array.isArray(
        preview?.missingCompletedJournalMonthKeys,
      )
        ? preview.missingCompletedJournalMonthKeys
        : [],
      missingCompletedJournalMonthLabels: Array.isArray(
        preview?.missingCompletedJournalMonthLabels,
      )
        ? preview.missingCompletedJournalMonthLabels
        : [],
      submitToFinanceAction,
      generateJournalAction,
      preview: {
        hasMissingMonths: Boolean(preview?.hasMissingMonths),
        currentReady: Boolean(preview?.currentReady),
        missingAllReady: Boolean(preview?.missingAllReady),
        missingAnyNotReady: Boolean(preview?.missingAnyNotReady),
        currentAlreadyGenerated: Boolean(preview?.currentAlreadyGenerated),
        currentMonthKey: preview?.currentMonthKey || null,
        hasMissingCompletedJournals: Boolean(
          preview?.hasMissingCompletedJournals,
        ),
        missingCompletedJournalMonthKeys: Array.isArray(
          preview?.missingCompletedJournalMonthKeys,
        )
          ? preview.missingCompletedJournalMonthKeys
          : [],
        missingCompletedJournalMonthLabels: Array.isArray(
          preview?.missingCompletedJournalMonthLabels,
        )
          ? preview.missingCompletedJournalMonthLabels
          : [],
      },
    };
  }

  function getProjectLoad(projectId) {
    if (!projectId) return null;

    const pid = String(projectId);
    const monthContext = projectMonthContextMod.getEffectivePeriodInfo({
      projectId: pid,
    });
    const projectInfo = getProjectBasics(pid);
    const phases = projectPhaseMod.getProjectPhases(pid);
    const effectivePeriod = revRecMod.getEffectivePeriodInfo();
    const cutoffDate = effectivePeriod?.monthEnd || null;
    let financials = null;
    let financialsFailed = false;
    try {
      financials = getProjectFinancials(pid);
    } catch (e) {
      financialsFailed = true;
      log.error({
        title: 'GET_PROJECT_FINANCIALS_FAILED',
        details: { projectId: String(pid), error: e },
      });
      financials = null;
    }

    const varianceCheck = financials
      ? validator.isVarianceWithinTolerance(financials)
      : null;
    const hasNoVariance = financials ? Boolean(varianceCheck?.ok) : false;
    const hasVariance = financials ? !hasNoVariance : true;
    log.audit({
      title: 'PM_PROJECT_LOAD_VARIANCE_CHECK',
      details: {
        projectId: String(pid || ''),
        hasFinancials: Boolean(financials),
        variance: financials
          ? toNumber(financials?.totals?.variance || 0)
          : null,
        varianceAbs: varianceCheck?.variance ?? null,
        effectiveTolerance:
          varianceCheck?.tolerance?.effectiveTolerance ?? null,
        selectedSource: varianceCheck?.tolerance?.selectedSource ?? null,
        hasNoVariance,
      },
    });

    const normalizedStatus = String(projectInfo?.status?.label || '');
    const projectStatusValueKey = String(projectInfo?.status?.key || '');
    const isActive =
      projectStatusValueKey === statuses.PROJECT_STATUS_KEYS.ACTIVE;
    const isOnHold =
      projectStatusValueKey === statuses.PROJECT_STATUS_KEYS.ON_HOLD;
    const isOperationallyActive = statuses.isOperationalProjectStatus(
      projectStatusValueKey,
    );
    const isDraft =
      projectStatusValueKey === statuses.PROJECT_STATUS_KEYS.DRAFT;
    const isEditableStatus = isOperationallyActive || isDraft;
    const isCompleted = statuses.isCompletedProjectStatus(
      projectStatusValueKey,
    );
    const isClosed = statuses.isClosedProjectStatus(projectStatusValueKey);
    const isTerminal = statuses.isTerminalProjectStatus(projectStatusValueKey);
    const restrictExistingPhaseDetailsToRateQty = !isDraft;
    const jnlProcTaskId = String(projectInfo?.jnlProcTaskId || '').trim();
    const jnlProcLog = String(projectInfo?.jnlProcLog || '').trim();
    const isLockedForJnlProc = Boolean(jnlProcTaskId);
    const revRecGeneration = getRevRecGenerationGuard({
      projectId: pid,
      financials,
      isLockedForJnlProc,
    });

    const totalExistingPlans = phases.reduce(
      (sum, p) => sum + (parseInt(String(p?.numOfPlans || '0'), 10) || 0),
      0,
    );
    const totalMissingPlans = phases.reduce(
      (sum, p) =>
        sum +
        Math.max(0, parseInt(String(p?.numOfMissingPlans || '0'), 10) || 0),
      0,
    );

    const numOfPlansToCreate = totalMissingPlans;

    const canCreatePlan =
      !isLockedForJnlProc &&
      isOperationallyActive &&
      hasNoVariance &&
      phases.length > 0 &&
      totalMissingPlans > 0;
    const canCreatePhase = !isLockedForJnlProc && isEditableStatus;
    const canActivate =
      !isLockedForJnlProc &&
      !isTerminal &&
      (isOnHold ||
        (!isOperationallyActive && hasNoVariance && phases.length > 0));
    const hasSalesOrder =
      Array.isArray(financials?.salesOrderIds) &&
      financials.salesOrderIds.length > 0;
    const phaseTotalQty = phases.reduce(
      (sum, row) => sum + toNumber(row?.definedQty || 0),
      0,
    );
    const actualQtyCompleted = toNumber(
      revPlanMod.getProjectActualRevPlanRollups({ projectId: pid })?.[
        String(pid)
      ]?.qtyCompleted || 0,
    );
    const contractValue = toNumber(financials?.totals?.projectTotal || 0);
    const invoicedAmount = toNumber(
      revRecMod.getBilledToDateAsOf({
        salesOrderIds: financials?.salesOrderIds || [],
        cutoffDate,
      }) || 0,
    );
    const grossInvoicedAmount = toNumber(
      getGrossInvoicedAmountForSalesOrders(
        financials?.salesOrderIds || [],
        cutoffDate,
      ) || 0,
    );
    const recognizedAmount = toNumber(
      financials?.revenueRecognition?.amount ||
        financials?.totals?.recognizedAmount ||
        0,
    );
    const recognizedPct =
      contractValue > 0
        ? Math.max(
            0,
            Math.min(100, Math.round((recognizedAmount / contractValue) * 100)),
          )
        : 0;
    const recognizedComplete =
      contractValue > 0
        ? isAmountAtLeastTarget(recognizedAmount, contractValue)
        : false;
    const qtyMatch = Math.abs(actualQtyCompleted - phaseTotalQty) <= 0.0001;
    const amountMatch = isAmountEqualTarget(invoicedAmount, contractValue);
    const grossInvoicedAmountMatch = isAmountAtLeastTarget(
      grossInvoicedAmount,
      contractValue,
    );
    const hasPhases = phases.length > 0;
    const hasRevPlans = totalExistingPlans > 0;
    const canMarkComplete =
      !isLockedForJnlProc && !isTerminal && !isDraft && recognizedComplete;
    const canClose =
      !isLockedForJnlProc &&
      !isClosed &&
      !isDraft &&
      recognizedComplete &&
      grossInvoicedAmountMatch;

    const revPlansMeta = revPlanMod.getProjectRevPlans({
      projectId: pid,
      projectInfo,
      phases,
      source: 'project_load',
    });
    const monthMismatch = Boolean(revPlansMeta?.monthMismatch);
    const revPlanStatusConflict = Boolean(revPlansMeta?.revPlanStatusConflict);
    const revPlanStatusValueKey = String(revPlansMeta?.revPlanStatus?.key || '')
      .trim()
      .toLowerCase();
    const isPostJournalState = Boolean(revPlansMeta?.isPostJournalState);
    const hasEditableRevPlanMonth = Array.isArray(revPlansMeta?.months)
      ? revPlansMeta.months.some((month) => {
          if (!month || month.isEditable === false) return false;
          if (!isPostJournalState) return true;
          return String(month?.type || '').trim().toLowerCase() !== 'actual';
        })
      : false;
    const hasRevPlansMeta = Boolean(revPlansMeta?.hasRevPlans);
    const missingRevPlansCount = toNumber(
      revPlansMeta?.missingRevPlans?.count || 0,
    );
    const hasRevPlansFromMetaOrCount =
      hasRevPlansMeta || totalExistingPlans > 0;

    const hasPlanTallyMismatch = phases.length
      ? phases.some((phase) => {
          const desired = phase?.desiredPlansPerPhase;
          const actual = phase?.numOfPlans ?? phase?.revPlansCount;
          if (desired == null || actual == null) return false;
          return toNumber(desired) !== toNumber(actual);
        })
      : true;

    let revPlanBannerCode = null;
    let revPlanBannerVariant = 'success';
    let canEditRevPlan = true;
    let projectBannerCode = null;
    let projectBannerVariant = 'info';

    log.audit({
      title: 'PM_COMPLETE_GATE',
      details: {
        projectId: String(pid || ''),
        canMarkComplete: Boolean(canMarkComplete),
        checks: {
          notLockedForJnlProc: !isLockedForJnlProc,
          notTerminal: !isTerminal,
          notDraft: !isDraft,
          recognizedComplete: Boolean(recognizedComplete),
          grossInvoicedAmountMatch: Boolean(grossInvoicedAmountMatch),
        },
        values: {
          status: normalizedStatus,
          phaseCount: phases.length,
          totalExistingPlans,
          phaseTotalQty,
          actualQtyCompleted,
          contractValue,
          invoicedAmount,
          grossInvoicedAmount,
          recognizedAmount,
          recognizedPct,
        },
      },
    });
    const canPutOnHold =
      !isLockedForJnlProc && !isTerminal && !isOnHold && isActive;

    const variance = financials
      ? toNumber(financials?.totals?.variance || 0)
      : null;
    const relatedRecords = financials?.relatedRecords || {
      salesOrders: [],
      invoices: [],
      purchaseOrders: [],
      vendorBills: [],
      inventoryAdjustments: [],
      creditMemos: [],
      journals: [],
    };

    const hasStatusOrVarianceBlocker =
      !isOperationallyActive || financialsFailed || !hasNoVariance;
    const isPlanGenEligible =
      isOperationallyActive && hasNoVariance && phases.length > 0;

    const reasons = [];
    let planGenerationBlockedCode = null;

    if (hasStatusOrVarianceBlocker) {
      if (!isOperationallyActive && !financialsFailed && hasNoVariance) {
        reasons.push('Project is not active.');
        reasons.push('Please activate the project first.');
      } else if (isOperationallyActive && !financialsFailed && !hasNoVariance) {
        reasons.push(
          'There’s a mismatch between the project and the sales order amount(s).',
        );
        reasons.push('Please resolve the discrepancy first.');
      } else if (
        !isOperationallyActive &&
        !financialsFailed &&
        !hasNoVariance
      ) {
        reasons.push('Project is not active.');
        reasons.push('There’s a mismatch with the sales order amount(s).');
        reasons.push('Please fix the discrepancy and activate the project.');
      } else if (financialsFailed) {
        reasons.push('Project financials/variance could not be calculated.');
        reasons.push(
          'Please check script permissions/search configuration and try again.',
        );
      } else if (!isOperationallyActive) {
        reasons.push('Project is not active.');
        reasons.push('Please activate the project first.');
      } else if (!hasNoVariance) {
        reasons.push(
          'There’s a mismatch between the project and the sales order amount(s).',
        );
        reasons.push('Please resolve the discrepancy first.');
      }
    }

    if (!phases.length) {
      reasons.push('Project has no phases.');
    }

    const planGenerationBlocker = validator.resolvePlanGenerationBlocker({
      phasesCount: phases.length,
      isPlanGenEligible,
      totalMissingPlans,
      reasons,
      isOperationallyActive,
      financialsFailed,
      hasNoVariance,
    });
    planGenerationBlockedCode = planGenerationBlocker?.blockedCode || null;
    const planGenerationMessage = planGenerationBlocker?.message || null;

    const planGenerationNotice =
      isPlanGenEligible && totalMissingPlans > 0
        ? {
            show: true,
            key: totalExistingPlans > 0 ? 'missing' : 'ready',
            message:
              totalExistingPlans > 0
                ? 'There are some missing rev plans that need to be generated. Please click on Generate Revenue Plan button.'
                : 'Rev plans are ready to be generated.',
          }
        : { show: false, key: null, message: null };

    const revPlanBanner = validator.resolveRevPlanBanner({
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
      showRevRecReadyBanner: Boolean(
        revRecGeneration?.showReadyToGenerateMessage,
      ),
      missingRevPlansCount,
      planGenerationNotice,
    });
    revPlanBannerCode = revPlanBanner?.code || null;
    revPlanBannerVariant = revPlanBanner?.variant || 'warning';
    const isRevPlanStatusOpen = revPlanStatusValueKey === 'open';
    canEditRevPlan =
      !isLockedForJnlProc &&
      !isTerminal &&
      hasRevPlansFromMetaOrCount &&
      hasEditableRevPlanMonth &&
      (isPostJournalState ||
        isRevPlanStatusOpen ||
        Boolean(revRecGeneration?.submitToFinanceAction?.enabled));

    const projectBanner = validator.resolveProjectBanner({
      isLockedForJnlProc,
      isCompleted,
      isClosed,
      canActivate,
      canMarkComplete,
      canClose,
      hasSalesOrder,
      canCreatePhase,
      phasesCount: phases.length,
      planGenerationNotice,
    });
    projectBannerCode = projectBanner?.code || null;
    projectBannerVariant = projectBanner?.variant || 'info';

    return {
      projectId: String(pid),
      monthSimulation: {
        actual: monthContext?.actual || null,
        appSimulated: monthContext?.appSimulated || null,
        projectSimulated: monthContext?.projectSimulated || null,
        effective: monthContext?.effective || null,
        source: monthContext?.source || 'current',
      },
      status: projectInfo?.status || null,
      hasNoVariance,
      hasVariance,
      varianceTolerance: varianceCheck?.tolerance || null,
      canCreatePhase,
      restrictExistingPhaseDetailsToRateQty,
      canCreatePlan,
      canActivate,
      canPutOnHold,
      canMarkComplete,
      canClose,
      isCompleted,
      isClosed,
      isFrozen: isClosed || isLockedForJnlProc,
      isLockedForJnlProc,
      jnlProcTaskId: jnlProcTaskId || null,
      jnlProcLog: jnlProcLog || null,
      hasSalesOrder,
      relatedRecords,
      completionCheck: {
        phaseTotalQty,
        actualQtyCompleted,
        qtyMatch,
        contractValue,
        invoicedAmount,
        amountMatch,
        grossInvoicedAmount,
        grossInvoicedAmountMatch,
        recognizedAmount,
        recognizedPct,
        recognizedComplete,
        recognitionJournalId:
          financials?.revenueRecognition?.journalId != null
            ? String(financials.revenueRecognition.journalId)
            : null,
        recognitionJournalTranId:
          financials?.revenueRecognition?.tranId || null,
        recognitionJournalDate:
          financials?.revenueRecognition?.tranDate || null,
      },
      statusActions: {
        activate: {
          key: 'activate',
          label: 'Activate Project',
          allowed: Boolean(canActivate),
          reason: canActivate
            ? null
            : 'Project must be within variance tolerance and have at least one phase to activate.',
        },
        onHold: {
          key: 'on_hold',
          label: 'Put On Hold',
          allowed: Boolean(canPutOnHold),
          reason: canPutOnHold
            ? null
            : 'Only Active projects can be put On Hold.',
        },
        complete: {
          key: 'complete',
          label: 'Mark Complete',
          allowed: Boolean(canMarkComplete),
          reason: canMarkComplete
            ? null
            : 'Completion requires recognized amount to reach the project total.',
        },
        close: {
          key: 'close',
          label: 'Close Project',
          allowed: Boolean(canClose),
          reason: canClose
            ? null
            : 'Closing requires recognized amount to reach the project total and gross invoiced amount to be at least the project total.',
        },
      },
      planGeneration: {
        allowed: Boolean(canCreatePlan),
        message: planGenerationMessage,
        reasons,
        notice: planGenerationNotice,
        variance,
        numOfPlansToCreate,
        totalExistingPlans,
        totalMissingPlans,
      },
      revPlanBanner: {
        code: revPlanBannerCode,
        variant: revPlanBannerVariant,
      },
      projectBanner: {
        code: projectBannerCode,
        variant: projectBannerVariant,
      },
      canEditRevPlan,
      revRecGeneration,
      numOfPlansToCreate,
      phases,
      financials,
    };
  }

  return {
    activateProject,
    transitionProjectStatus,
    ensureProjectMutable,
    getProjectLoad,
    upsertProject,
    upsertProjectMonthSimulation,
  };
});
