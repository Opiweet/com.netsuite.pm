/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
  'N/search',
  'N/query',
  'N/record',
  '../../pm_config',
  '../core/helper',
  '../core/validator',
  '../core/statuses',
  './rev_plan_mod',
  './rev_rec_mod',
  './project_financials_mod',
], (
  search,
  query,
  record,
  pmConfig,
  helper,
  validator,
  statuses,
  revPlanMod,
  revRecMod,
  projectFinancialsMod,
) => {
  // TIMEZONE NOTE:
  // We intentionally use the company preference timezone (not user preference timezone)
  // when determining the "current month" for revenue recognition logic.
  // This avoids edge cases where users in different timezones see different "current months"
  // around month boundaries.

  const {
    chunkArray,
    getAllResults,
    getLastHierarchyPart,
    monthsBetweenInclusive,
    normalizeIdOrNull,
    normalizeNumberOrNull,
    normalizeText,
    safeSetValue,
    toNumber,
  } = helper;

  const {
    getProjectSalesOrderIdsByProject: getProjectSalesOrderIdsByProjectFromMod,
    getProjectRevenueRecognitionFromJournalsByProject:
      getProjectRevenueRecognitionFromJournalsByProjectFromMod,
    getBilledToDateByProject: getBilledToDateByProjectFromMod,
  } = projectFinancialsMod;

  function mapProjectStatusStrict({ id, text }) {
    return statuses.mapNetSuiteStatusStrict(statuses.ENTITY_TYPES.PROJECT, {
      id: String(id || ''),
      text: String(text || ''),
      logger: log,
      logTitle: 'STATUS_MAPPING_UNKNOWN_READ',
    });
  }

  function mapPhaseStatusStrict({ id, text }) {
    return statuses.mapNetSuiteStatusStrict(statuses.ENTITY_TYPES.PHASE, {
      id: String(id || ''),
      text: String(text || ''),
      logger: log,
      logTitle: 'STATUS_MAPPING_UNKNOWN_READ',
    });
  }

  function upsertProjectsPhases(projectsData) {
    function toLogDetails(value) {
      try {
        return JSON.stringify(value);
      } catch (e) {
        return String(value);
      }
    }

    log.audit({
      title: 'PHASES_UPSERT_START',
      details: toLogDetails({
        payloadType: Array.isArray(projectsData)
          ? 'array'
          : typeof projectsData,
        hasPhase: Boolean(projectsData && projectsData.phase),
        hasPhases: Boolean(projectsData && Array.isArray(projectsData.phases)),
        projectId: projectsData?.projectId
          ? String(projectsData.projectId)
          : null,
        phasesCount: Array.isArray(projectsData?.phases)
          ? projectsData.phases.length
          : 0,
      }),
    });

    function getPhaseUniqueKey(phase) {
      const normalized = normalizePhasePayload(phase);
      return normalizeText(normalized?.name).toLowerCase();
    }

    function assertUniquePhaseForProject({ projectId, phase, existingPhases }) {
      const normalized = normalizePhasePayload(phase);
      const phaseName = normalizeText(normalized?.name);
      const uniqueKey = getPhaseUniqueKey(normalized);
      if (!uniqueKey) throw new Error('Phase name is required');

      const currentId = normalized?.id ? String(normalized.id) : null;
      const duplicate = (
        Array.isArray(existingPhases) ? existingPhases : []
      ).find(
        (p) =>
          getPhaseUniqueKey(p) === uniqueKey &&
          String(p?.id || '') !== String(currentId || ''),
      );

      if (duplicate) {
        throw new Error(
          `Phase "${phaseName}" already exists for this project. Phase name must be unique.`,
        );
      }
    }

    function getPhaseRevPlansQtyTotal(phaseId) {
      const pid = String(phaseId || '').trim();
      if (!pid) return 0;

      const suiteSearch = search.create({
        type: 'customrecord_pm_revenue_plan',
        filters: [
          ['isinactive', 'is', 'F'],
          'AND',
          ['custrecord_pm_revplan_parent', 'anyof', pid],
        ],
        columns: [
          search.createColumn({
            name: 'formulanumeric',
            summary: search.Summary.SUM,
            formula:
              'CASE WHEN {custrecord_pm_revplan_qty} IS NULL THEN 0 ELSE {custrecord_pm_revplan_qty} END',
          }),
        ],
      });

      const first = suiteSearch.run().getRange({ start: 0, end: 1 }) || [];
      if (!first.length) return 0;
      return toNumber(
        first[0].getValue({
          name: 'formulanumeric',
          summary: search.Summary.SUM,
        }) || 0,
      );
    }

    function assertRestrictedExistingPhaseChanges({
      projectId,
      phase,
      existingPhaseById,
      restrictExistingPhaseFields,
    }) {
      if (!restrictExistingPhaseFields) return;
      if (!phase?.id) return;

      const current = existingPhaseById[String(phase.id)] || null;
      if (!current) {
        throw new Error(
          `Phase ${String(phase.id)} was not found for project ${String(projectId)}.`,
        );
      }

      const changedProtectedFields = [];

      if (
        'name' in phase &&
        normalizeText(phase.name) !== normalizeText(current.name)
      ) {
        changedProtectedFields.push('name');
      }

      if (
        'departmentId' in phase &&
        normalizeIdOrNull(phase.departmentId) !==
          normalizeIdOrNull(current.departmentId)
      ) {
        changedProtectedFields.push('departmentId');
      }

      if (
        'milestoneId' in phase &&
        normalizeIdOrNull(phase.milestoneId) !==
          normalizeIdOrNull(current.milestoneId)
      ) {
        changedProtectedFields.push('milestoneId');
      }

      if (
        'milestoneDesc' in phase &&
        normalizeText(phase.milestoneDesc) !==
          normalizeText(
            current.milestoneDesc || current.milestone || current.serviceItem,
          )
      ) {
        changedProtectedFields.push('milestoneDesc');
      }

      if (
        'statusId' in phase &&
        normalizeIdOrNull(phase.statusId) !==
          normalizeIdOrNull(current.statusId)
      ) {
        changedProtectedFields.push('statusId');
      }

      if (
        'sequence' in phase &&
        normalizeNumberOrNull(phase.sequence) !==
          normalizeNumberOrNull(current.sequence)
      ) {
        changedProtectedFields.push('sequence');
      }

      if (changedProtectedFields.length) {
        throw new Error(
          `Only quantity and rate can be updated for existing phases when the project is not in Draft. Restricted fields changed: ${changedProtectedFields.join(
            ', ',
          )}.`,
        );
      }
    }

    function normalizePhasePayload(payload) {
      const phase =
        payload && typeof payload === 'object' ? { ...payload } : {};

      if (phase.name == null && phase.phaseName != null)
        phase.name = phase.phaseName;
      if (phase.milestoneId == null && phase.milestone != null)
        phase.milestoneId = phase.milestone;
      if (phase.milestoneDesc == null && phase.description != null)
        phase.milestoneDesc = phase.description;
      if (phase.definedQty == null && phase.quantity != null)
        phase.definedQty = phase.quantity;

      return phase;
    }

    function upsertPhaseForProject({
      projectId,
      phase,
      skipRestrictedFieldValidation = false,
    } = {}) {
      if (!projectId) throw new Error('projectId is required');
      if (!phase || typeof phase !== 'object')
        throw new Error('phase payload is required');

      const normalized = normalizePhasePayload(phase);
      log.audit({
        title: 'PHASES_UPSERT_ROW_NORMALIZED',
        details: toLogDetails({
          projectId: String(projectId || ''),
          phaseId: normalized?.id ? String(normalized.id) : null,
          name: normalized?.name || null,
          departmentId: normalized?.departmentId || null,
          milestoneId: normalized?.milestoneId || null,
          definedQty: normalized?.definedQty ?? null,
          rate: normalized?.rate ?? null,
          sequence: normalized?.sequence ?? null,
          skipRestrictedFieldValidation: Boolean(skipRestrictedFieldValidation),
        }),
      });
      const isUpdate = Boolean(normalized.id);
      const projectInfo = getProjectInfo(projectId);
      const statusValueKey = String(projectInfo?.status?.key || '');

      if (statuses.isTerminalProjectStatus(statusValueKey)) {
        throw new Error(
          'Project is Completed or Closed. Phase updates are not allowed.',
        );
      }

      if (!skipRestrictedFieldValidation && isUpdate) {
        const restrictExistingPhaseFields =
          statusValueKey !== statuses.PROJECT_STATUS_KEYS.DRAFT;
        const existingPhases = getProjectPhases(String(projectId));
        const existingPhaseById = existingPhases.reduce((acc, item) => {
          if (!item?.id) return acc;
          acc[String(item.id)] = item;
          return acc;
        }, {});
        assertRestrictedExistingPhaseChanges({
          projectId,
          phase: normalized,
          existingPhaseById,
          restrictExistingPhaseFields,
        });
      }

      // Enforce project-level phase uniqueness (case-insensitive by phase name)
      // so repeated bulk uploads cannot create duplicates.
      assertUniquePhaseForProject({
        projectId,
        phase: normalized,
        existingPhases: getProjectPhases(String(projectId)),
      });

      if (
        isUpdate &&
        'definedQty' in normalized &&
        normalized.definedQty != null
      ) {
        const newDefinedQty = toNumber(normalized.definedQty);
        const revPlansQtyTotal = getPhaseRevPlansQtyTotal(normalized.id);
        if (newDefinedQty + 0.0001 < revPlansQtyTotal) {
          throw new Error(
            `Phase quantity cannot be lower than total rev plan quantity. New phase qty: ${newDefinedQty}, rev plans total qty: ${revPlansQtyTotal}.`,
          );
        }
      }

      const rec = isUpdate
        ? record.load({
            type: 'customrecord_pm_project_phase',
            id: String(normalized.id),
          })
        : record.create({ type: 'customrecord_pm_project_phase' });

      if (!isUpdate)
        safeSetValue(rec, 'custrecord_pm_phase_parent', String(projectId));

      if (normalized.name != null)
        safeSetValue(rec, 'name', String(normalized.name || '').trim());
      if ('departmentId' in normalized)
        safeSetValue(rec, 'custrecord_pm_phase_dept', normalized.departmentId);
      if ('milestoneId' in normalized)
        safeSetValue(
          rec,
          'custrecord_pm_phase_milestone',
          normalized.milestoneId,
        );
      if ('milestoneDesc' in normalized)
        safeSetValue(
          rec,
          'custrecord_pm_phase_milestone_desc',
          String(normalized.milestoneDesc || '').trim(),
        );
      if ('statusId' in normalized)
        safeSetValue(rec, 'custrecord_pm_phase_status', normalized.statusId);
      if ('definedQty' in normalized)
        safeSetValue(rec, 'custrecord_pm_phase_qty', normalized.definedQty);
      if ('rate' in normalized)
        safeSetValue(rec, 'custrecord_pm_phase_rate', normalized.rate);
      if ('sequence' in normalized && normalized.sequence != null)
        safeSetValue(rec, 'custrecord_pm_phase_sequence', normalized.sequence);

      const id = rec.save();
      log.audit({
        title: 'PHASES_UPSERT_ROW_SAVED',
        details: toLogDetails({
          projectId: String(projectId || ''),
          phaseId: String(id),
          mode: isUpdate ? 'update' : 'create',
        }),
      });
      return { projectId: String(projectId), phaseId: String(id) };
    }

    function upsertPhasesForProject({ projectId, phases } = {}) {
      if (!projectId) throw new Error('projectId is required');
      const rows = Array.isArray(phases) ? phases : [];
      log.audit({
        title: 'PHASES_UPSERT_PROJECT_ROWS',
        details: toLogDetails({
          projectId: String(projectId || ''),
          rowsCount: rows.length,
          sample: rows.slice(0, 3),
        }),
      });
      const saved = [];
      const errors = [];
      const projectInfo = getProjectInfo(projectId);
      const statusValueKey = String(projectInfo?.status?.key || '');
      if (statuses.isTerminalProjectStatus(statusValueKey)) {
        throw new Error(
          'Project is Completed or Closed. Phase updates are not allowed.',
        );
      }
      const restrictExistingPhaseFields =
        statusValueKey !== statuses.PROJECT_STATUS_KEYS.DRAFT;

      // Compute max existing sequence so new phases get sequential numbers.
      const existingPhases = getProjectPhases(String(projectId));
      const existingPhaseById = existingPhases.reduce((acc, item) => {
        if (!item?.id) return acc;
        acc[String(item.id)] = item;
        return acc;
      }, {});
      const seenUniqueKeysInPayload = new Set();
      let nextSequence =
        existingPhases.reduce((max, p) => Math.max(max, p.sequence || 0), 0) +
        1;

      rows.forEach((phase, index) => {
        try {
          log.audit({
            title: 'PHASES_UPSERT_ROW_PROCESS',
            details: toLogDetails({
              projectId: String(projectId || ''),
              rowIndex: index,
              phaseId: phase?.id ? String(phase.id) : null,
              phaseName: phase?.name || phase?.phaseName || null,
            }),
          });
          const normalized = normalizePhasePayload(phase);
          assertRestrictedExistingPhaseChanges({
            projectId,
            phase: normalized,
            existingPhaseById,
            restrictExistingPhaseFields,
          });

          assertUniquePhaseForProject({
            projectId,
            phase: normalized,
            existingPhases,
          });

          const uniqueKey = getPhaseUniqueKey(normalized);
          if (!normalized.id) {
            if (seenUniqueKeysInPayload.has(uniqueKey)) {
              throw new Error(
                `Duplicate phase "${String(normalized?.name || '').trim()}" found in the same CSV upload.`,
              );
            }
            seenUniqueKeysInPayload.add(uniqueKey);
          }

          const normalizedForSave = { ...normalized };
          if (!normalizedForSave.id) {
            // Always assign sequence from the server-computed counter for new
            // phases — never trust the client-provided value.
            normalizedForSave.sequence = nextSequence;
            nextSequence += 1;
          }
          saved.push(
            upsertPhaseForProject({
              projectId,
              phase: normalizedForSave,
              skipRestrictedFieldValidation: true,
            }),
          );
        } catch (e) {
          log.error({
            title: 'PHASES_UPSERT_ROW_ERROR',
            details: toLogDetails({
              projectId: String(projectId || ''),
              rowIndex: index,
              phase,
              message: e?.message || String(e),
            }),
          });
          errors.push({
            phase,
            message: e?.message || e,
          });
        }
      });

      log.audit({
        title: 'PHASES_UPSERT_PROJECT_RESULT',
        details: toLogDetails({
          projectId: String(projectId || ''),
          savedCount: saved.length,
          errorCount: errors.length,
          saved,
          errors,
        }),
      });

      if (errors.length) {
        return {
          projectId: String(projectId),
          saved,
          errors,
        };
      }

      return { projectId: String(projectId), saved };
    }

    if (Array.isArray(projectsData)) {
      const results = projectsData.map((row) => upsertPhasesForProject(row));
      log.audit({
        title: 'PHASES_UPSERT_MULTI_RESULT',
        details: toLogDetails({
          projectsCount: projectsData.length,
          results,
        }),
      });
      return { results };
    }

    if (
      projectsData &&
      typeof projectsData === 'object' &&
      'phase' in projectsData
    ) {
      const single = upsertPhaseForProject(projectsData);
      log.audit({
        title: 'PHASE_UPSERT_SINGLE_RESULT',
        details: toLogDetails(single),
      });
      return single;
    }

    const bulk = upsertPhasesForProject(projectsData);
    log.audit({
      title: 'PHASES_UPSERT_BULK_RESULT',
      details: toLogDetails(bulk),
    });
    return bulk;
  }

  function getProjectInfo(projectId) {
    try {
      const pid = String(projectId || '').trim();
      if (!/^\d+$/.test(pid)) {
        return {
          startDate: null,
          status: null,
          endDate: null,
          jnlProcTaskId: '',
          jnlProcLog: '',
        };
      }

      const sql = `
        SELECT
          TO_CHAR(custrecord_pm_project_startdate, 'DD/MM/YYYY') AS startdate,
          TO_CHAR(custrecord_pm_project_enddate, 'DD/MM/YYYY') AS enddate,
          custrecord_pm_project_status AS statusid,
          BUILTIN.DF(custrecord_pm_project_status) AS statusname,
          custrecord_pm_project_taskforjnlproc AS jnlproctaskid,
          custrecord_pm_project_taskforjnlproc_log AS jnlproclog
        FROM customrecord_pm_projects
        WHERE id = ${pid}
      `;
      const rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
      const row = rows[0] || {};
      const statusIdRaw = row?.statusid != null ? String(row.statusid) : '';
      const statusTextRaw = row?.statusname ? String(row.statusname) : null;
      const mappedStatus = mapProjectStatusStrict({
        id: statusIdRaw,
        text: statusTextRaw,
      });
      const startDate = row?.startdate ? String(row.startdate) : null;
      const endDate = row?.enddate ? String(row.enddate) : null;
      log.audit({
        title: 'PM_PROJECT_INFO_DATES',
        details: {
          projectId: pid,
          sqlDateStart: startDate,
          sqlDateEnd: endDate,
          statusText: statusTextRaw,
          hasRow: Boolean(rows.length),
        },
      });

      return {
        startDate,
        endDate,
        status: mappedStatus,
        jnlProcTaskId: String(row?.jnlproctaskid || '').trim(),
        jnlProcLog: String(row?.jnlproclog || '').trim(),
      };
    } catch (e) {
      if (e?.name === 'STATUS_MAPPING_MISSING') throw e;
      return {
        startDate: null,
        endDate: null,
        status: null,
        jnlProcTaskId: '',
        jnlProcLog: '',
      };
    }
  }

  function getProjectPhaseRollups() {
    const contractValueCol = search.createColumn({
      name: 'formulanumeric',
      summary: search.Summary.SUM,
      formula:
        '(CASE WHEN {custrecord_pm_phase_qty} IS NULL THEN 0 ELSE {custrecord_pm_phase_qty} END) * (CASE WHEN {custrecord_pm_phase_rate} IS NULL THEN 0 ELSE {custrecord_pm_phase_rate} END)',
    });

    const suiteSearch = search.create({
      type: 'customrecord_pm_project_phase',
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        ['custrecord_pm_phase_parent', 'noneof', '@NONE@'],
      ],
      columns: [
        search.createColumn({
          name: 'custrecord_pm_phase_parent',
          summary: search.Summary.GROUP,
        }),
        search.createColumn({
          name: 'internalid',
          summary: search.Summary.COUNT,
        }),
        contractValueCol,
      ],
    });

    const rollupsByProjectId = {};
    getAllResults(suiteSearch).forEach((res) => {
      const projectId = res.getValue({
        name: 'custrecord_pm_phase_parent',
        summary: search.Summary.GROUP,
      });
      if (!projectId) return;
      const phaseCountRaw = res.getValue({
        name: 'internalid',
        summary: search.Summary.COUNT,
      });
      const contractValueRaw = res.getValue(contractValueCol);

      rollupsByProjectId[String(projectId)] = {
        phasesCount: Math.max(
          0,
          parseInt(String(phaseCountRaw || '0'), 10) || 0,
        ),
        contractValue: toNumber(contractValueRaw),
      };
    });

    return rollupsByProjectId;
  }

  function getProjects() {
    const startedAt = Date.now();
    const rollupsByProjectId = getProjectPhaseRollups();
    const revenueReadyRollupsByProjectId =
      revPlanMod.getProjectRevenueReadyRollups();
    const revPlanStatusByProjectId =
      revPlanMod.getProjectRevPlanStatusRollups();
    const effectivePeriod = revRecMod.getEffectivePeriodInfo();
    const cutoffDate = effectivePeriod?.monthEnd || null;

    const configuredSubsidiaryId = String(pmConfig?.SUBSIDIARY || '').trim();
    const projectFilters = [['isinactive', 'is', 'F']];
    if (configuredSubsidiaryId) {
      projectFilters.push('AND', [
        'custrecord_pm_project_subsidiary',
        'anyof',
        configuredSubsidiaryId,
      ]);
    }

    const constStartDateCol = search.createColumn({
      name: 'formulatext',
      formula: "TO_CHAR({custrecord_pm_project_startdate}, 'DD/MM/YYYY')",
    });
    const constEndDateCol = search.createColumn({
      name: 'formulatext',
      formula: "TO_CHAR({custrecord_pm_project_enddate}, 'DD/MM/YYYY')",
    });

    const suiteSearch = search.create({
      type: 'customrecord_pm_projects',
      filters: projectFilters,
      columns: [
        constStartDateCol,
        constEndDateCol,
        search.createColumn({ name: 'internalid' }),
        search.createColumn({ name: 'name', sort: search.Sort.ASC }),
        // Project title is stored in the record `name` now (no altname field).
        search.createColumn({ name: 'custrecord_pm_project_desc' }),
        search.createColumn({ name: 'custrecord_pm_project_customer' }),
        search.createColumn({ name: 'custrecord_pm_project_manager' }),
        search.createColumn({ name: 'custrecord_pm_project_dept' }),
        search.createColumn({ name: 'custrecord_pm_project_po' }),
        search.createColumn({ name: 'custrecord_pm_project_status' }),
        search.createColumn({ name: 'custrecord_pm_project_taskforjnlproc' }),
        search.createColumn({
          name: 'custrecord_pm_project_taskforjnlproc_log',
        }),
        search.createColumn({
          name: 'custrecord_pm_project_rev_accounts_used',
        }),
        search.createColumn({ name: 'lastmodified' }),
      ],
    });

    const projectRows = getAllResults(suiteSearch) || [];
    const afterBaseRowsAt = Date.now();
    const projectMeta = projectRows.map((res) => ({
      id: String(res.getValue({ name: 'internalid' }) || '').trim(),
      name: String(res.getValue({ name: 'name' }) || '').trim(),
      revAccountsUsed: String(
        res.getValue({ name: 'custrecord_pm_project_rev_accounts_used' }) || '',
      ).trim(),
    }));
    const salesOrderIdsByProject =
      getProjectSalesOrderIdsByProjectFromMod(projectMeta) || {};
    const afterSalesOrdersAt = Date.now();
    const recognizedByProject =
      getProjectRevenueRecognitionFromJournalsByProjectFromMod(projectMeta, {
        cutoffDate,
      }) || {};
    const afterRecognizedAt = Date.now();
    const invoicedToDateByProject = getBilledToDateByProjectFromMod({
      salesOrderIdsByProject,
      cutoffDate,
    });
    const afterBilledAt = Date.now();

    const shaped = projectRows.map((res) => {
      const id = String(res.getValue({ name: 'internalid' }));
      const rollup = rollupsByProjectId[id] || {
        phasesCount: 0,
        contractValue: 0,
      };
      const revPlanStatus = revPlanStatusByProjectId[id] || {
        revPlanStatus: {
          id: '',
          key: statuses.REVPLAN_STATUS_KEYS.OPEN,
          label: statuses.statusLabelForKey(
            statuses.ENTITY_TYPES.REVPLAN,
            statuses.REVPLAN_STATUS_KEYS.OPEN,
          ),
        },
        revPlanStatusMonthKey: null,
      };
      const recognizedFromJournal = recognizedByProject[id] || {};
      const invoicedToDate = toNumber(invoicedToDateByProject?.[id] || 0);

      const recognizedToDate = toNumber(recognizedFromJournal?.amount || 0);
      const contractValue = toNumber(rollup.contractValue);
      const recognizedToDatePct =
        contractValue > 0
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round((recognizedToDate / contractValue) * 100),
              ),
            )
          : 0;

      const title = res.getValue({ name: 'name' }) || '';
      const statusIdRaw =
        res.getValue({ name: 'custrecord_pm_project_status' }) || '';
      const statusTextRaw =
        res.getText({ name: 'custrecord_pm_project_status' }) || null;
      const mappedStatus = mapProjectStatusStrict({
        id: statusIdRaw,
        text: statusTextRaw,
      });
      const jnlProcTaskId = String(
        res.getValue({ name: 'custrecord_pm_project_taskforjnlproc' }) || '',
      ).trim();
      const jnlProcLog = String(
        res.getValue({ name: 'custrecord_pm_project_taskforjnlproc_log' }) ||
          '',
      ).trim();
      const isLockedForJnlProc = Boolean(jnlProcTaskId);

      return {
        id,
        // Deprecated: keep `ref` for backward compatibility but it mirrors title.
        ref: title,
        title,
        description:
          res.getValue({ name: 'custrecord_pm_project_desc' }) || null,
        customerId:
          res.getValue({ name: 'custrecord_pm_project_customer' }) || null,
        customerName:
          res.getText({ name: 'custrecord_pm_project_customer' }) || null,
        projectManagerId:
          res.getValue({ name: 'custrecord_pm_project_manager' }) || null,
        projectManagerName:
          res.getText({ name: 'custrecord_pm_project_manager' }) || null,
        departmentId:
          res.getValue({ name: 'custrecord_pm_project_dept' }) || null,
        department:
          getLastHierarchyPart(
            res.getText({ name: 'custrecord_pm_project_dept' }),
          ) || null,
        poRef: res.getValue({ name: 'custrecord_pm_project_po' }) || null,
        status: mappedStatus,
        startDate: res.getValue(constStartDateCol) || null,
        endDate: res.getValue(constEndDateCol) || null,
        lastModified: res.getValue({ name: 'lastmodified' }) || null,
        jnlProcTaskId: jnlProcTaskId || null,
        jnlProcLog: jnlProcLog || null,
        isLockedForJnlProc,
        phasesCount: rollup.phasesCount,
        contractValue,
        invoicedToDate,
        lastJournalPostedDate: recognizedFromJournal?.tranDate || null,
        revenueReady: toNumber(revenueReadyRollupsByProjectId[id] || 0),
        recognizedToDate,
        recognizedToDatePct,
        ...revPlanStatus,
      };
    });
    const finishedAt = Date.now();
    log.audit({
      title: 'PM_PROJECTS_LIST_TIMING',
      details: {
        totalMs: finishedAt - startedAt,
        baseRowsMs: afterBaseRowsAt - startedAt,
        salesOrdersBatchMs: afterSalesOrdersAt - afterBaseRowsAt,
        recognizedBatchMs: afterRecognizedAt - afterSalesOrdersAt,
        billedBatchMs: afterBilledAt - afterRecognizedAt,
        shapeMs: finishedAt - afterBilledAt,
        rowsCount: projectRows.length,
      },
    });
    return shaped;
  }

  function getProjectPhases(projectId) {
    if (!projectId) return [];
    const projectInfo = getProjectInfo(projectId);
    const desiredPlansPerPhase = monthsBetweenInclusive(
      projectInfo.startDate,
      projectInfo.endDate,
    );

    const suiteSearch = search.create({
      type: 'customrecord_pm_project_phase',
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        ['custrecord_pm_phase_parent', 'anyof', String(projectId)],
      ],
      columns: [
        search.createColumn({ name: 'internalid' }),
        search.createColumn({ name: 'name' }),
        search.createColumn({
          name: 'custrecord_pm_phase_sequence',
          sort: search.Sort.ASC,
        }),
        search.createColumn({ name: 'custrecord_pm_phase_dept' }),
        search.createColumn({ name: 'custrecord_pm_phase_status' }),
        search.createColumn({ name: 'custrecord_pm_phase_milestone' }),
        search.createColumn({ name: 'custrecord_pm_phase_milestone_desc' }),
        search.createColumn({ name: 'custrecord_pm_phase_note' }),
        search.createColumn({ name: 'custrecord_pm_phase_qty' }),
        search.createColumn({ name: 'custrecord_pm_phase_ctg_qty' }),
        search.createColumn({ name: 'custrecord_pm_phase_rate' }),
        search.createColumn({ name: 'lastmodified' }),
      ],
    });

    const results = getAllResults(suiteSearch);
    const phaseIds = results
      .map((r) => r.getValue({ name: 'internalid' }))
      .filter(Boolean)
      .map(String);

    const revPlanCountByPhaseId = {};
    const revPlanQtyByTypeByPhaseId = {};
    if (phaseIds.length) {
      const actualTypeId =
        pmConfig?.LIST_IDS?.REV_PLAN_TYPE?.ACTUAL != null
          ? String(pmConfig.LIST_IDS.REV_PLAN_TYPE.ACTUAL)
          : '1';
      const forecastTypeId =
        pmConfig?.LIST_IDS?.REV_PLAN_TYPE?.FORECAST != null
          ? String(pmConfig.LIST_IDS.REV_PLAN_TYPE.FORECAST)
          : '2';
      const chunks = chunkArray(phaseIds, 900);
      chunks.forEach((ids) => {
        const planSearch = search.create({
          type: 'customrecord_pm_revenue_plan',
          filters: [['custrecord_pm_revplan_parent', 'anyof', ...ids]],
          columns: [
            search.createColumn({
              name: 'custrecord_pm_revplan_parent',
              summary: search.Summary.GROUP,
            }),
            search.createColumn({
              name: 'internalid',
              summary: search.Summary.COUNT,
            }),
          ],
        });

        getAllResults(planSearch).forEach((res) => {
          const pid = res.getValue({
            name: 'custrecord_pm_revplan_parent',
            summary: search.Summary.GROUP,
          });
          const cnt = res.getValue({
            name: 'internalid',
            summary: search.Summary.COUNT,
          });
          if (!pid) return;
          revPlanCountByPhaseId[String(pid)] =
            (revPlanCountByPhaseId[String(pid)] ?? 0) +
            (parseInt(String(cnt || '0'), 10) || 0);
        });

        const planQtyByTypeSearch = search.create({
          type: 'customrecord_pm_revenue_plan',
          filters: [['custrecord_pm_revplan_parent', 'anyof', ...ids]],
          columns: [
            search.createColumn({
              name: 'custrecord_pm_revplan_parent',
              summary: search.Summary.GROUP,
            }),
            search.createColumn({
              name: 'custrecord_pm_revplan_type',
              summary: search.Summary.GROUP,
            }),
            search.createColumn({
              name: 'custrecord_pm_revplan_qty',
              summary: search.Summary.SUM,
            }),
          ],
        });

        getAllResults(planQtyByTypeSearch).forEach((res) => {
          const pid = res.getValue({
            name: 'custrecord_pm_revplan_parent',
            summary: search.Summary.GROUP,
          });
          if (!pid) return;
          const key = String(pid);
          if (!revPlanQtyByTypeByPhaseId[key]) {
            revPlanQtyByTypeByPhaseId[key] = { actual: 0, forecast: 0 };
          }

          const typeValue = String(
            res.getValue({
              name: 'custrecord_pm_revplan_type',
              summary: search.Summary.GROUP,
            }) || '',
          ).trim();
          const typeText = String(
            res.getText?.({
              name: 'custrecord_pm_revplan_type',
              summary: search.Summary.GROUP,
            }) || '',
          )
            .trim()
            .toLowerCase();
          const qty = toNumber(
            res.getValue({
              name: 'custrecord_pm_revplan_qty',
              summary: search.Summary.SUM,
            }) || 0,
          );

          const isActual =
            typeValue === actualTypeId || typeText.indexOf('actual') !== -1;
          const isForecast =
            typeValue === forecastTypeId || typeText.indexOf('forecast') !== -1;
          if (isActual) revPlanQtyByTypeByPhaseId[key].actual += qty;
          else if (isForecast) revPlanQtyByTypeByPhaseId[key].forecast += qty;
        });
      });
    }

    return results.map((res) => {
      const id = String(res.getValue({ name: 'internalid' }));
      const numOfPlans = revPlanCountByPhaseId[id] ?? 0;
      const numOfMissingPlans = Math.max(0, desiredPlansPerPhase - numOfPlans);
      const milestoneDesc = String(
        res.getValue({ name: 'custrecord_pm_phase_milestone_desc' }) || '',
      ).trim();
      const milestoneText =
        milestoneDesc ||
        res.getText({ name: 'custrecord_pm_phase_milestone' }) ||
        null;
      const note = String(
        res.getValue({ name: 'custrecord_pm_phase_note' }) || '',
      ).trim();
      const sequence =
        parseInt(
          String(res.getValue({ name: 'custrecord_pm_phase_sequence' }) || ''),
          10,
        ) || 0;
      const qtyByType = revPlanQtyByTypeByPhaseId[id] || {
        actual: 0,
        forecast: 0,
      };
      const mappedPhaseStatus = mapPhaseStatusStrict({
        id: res.getValue({ name: 'custrecord_pm_phase_status' }) || '',
        text: res.getText({ name: 'custrecord_pm_phase_status' }) || '',
      });
      return {
        id,
        name: res.getValue({ name: 'name' }) || '',
        sequence,
        departmentId:
          res.getValue({ name: 'custrecord_pm_phase_dept' }) || null,
        department:
          getLastHierarchyPart(
            res.getText({ name: 'custrecord_pm_phase_dept' }),
          ) || null,
        status: mappedPhaseStatus,
        milestoneId:
          res.getValue({ name: 'custrecord_pm_phase_milestone' }) || null,
        milestone: milestoneText,
        milestoneDesc: milestoneDesc || null,
        note: note || null,
        definedQty: res.getValue({ name: 'custrecord_pm_phase_qty' }) || null,
        contingency:
          res.getValue({ name: 'custrecord_pm_phase_ctg_qty' }) != null
            ? Number(res.getValue({ name: 'custrecord_pm_phase_ctg_qty' }) || 0)
            : 0,
        rate: res.getValue({ name: 'custrecord_pm_phase_rate' }) || null,
        // Not stored on the record type currently; keep for UI compatibility.
        startDate: null,
        endDate: null,
        recognizedPct: 0,
        lastModified: res.getValue({ name: 'lastmodified' }) || null,
        // For existing UI which shows `milestone || serviceItem`
        serviceItem: milestoneText,
        revPlansCount: numOfPlans,
        numOfPlans,
        numOfMissingPlans,
        desiredPlansPerPhase,
        totalActualQty: toNumber(qtyByType.actual || 0),
        totalForecastQty: toNumber(qtyByType.forecast || 0),
      };
    });
  }

  function deleteProjectPhase({ projectId, phaseId } = {}) {
    const pid = String(projectId || '').trim();
    const phid = String(phaseId || '').trim();
    if (!pid) throw new Error('projectId is required');
    if (!phid) throw new Error('phaseId is required');

    const projectInfo = getProjectInfo(pid);
    const projectStatusValueKey = String(projectInfo?.status?.key || '');
    if (statuses.isTerminalProjectStatus(projectStatusValueKey)) {
      throw new Error(
        'Project is Completed or Closed. Phase deletion is not allowed.',
      );
    }

    const phaseRec = record.load({
      type: 'customrecord_pm_project_phase',
      id: phid,
      isDynamic: false,
    });
    const phaseProjectId = String(
      phaseRec.getValue({ fieldId: 'custrecord_pm_phase_parent' }) || '',
    ).trim();
    if (!phaseProjectId || phaseProjectId !== pid) {
      throw new Error('Phase does not belong to the provided project.');
    }

    const revPlanSublistId = 'recmachcustrecord_pm_revplan_parent';
    const revPlanQtyFieldId = 'custrecord_pm_revplan_qty';
    const lineCount = Number(
      phaseRec.getLineCount({ sublistId: revPlanSublistId }) || 0,
    );
    let hasDefinedQty = false;

    for (let i = 0; i < lineCount; i += 1) {
      const rawQty = phaseRec.getSublistValue({
        sublistId: revPlanSublistId,
        fieldId: revPlanQtyFieldId,
        line: i,
      });
      const rawText = String(rawQty == null ? '' : rawQty).trim();
      if (!rawText) continue;

      const qty = Number(rawText);
      if (!Number.isFinite(qty) || Math.abs(qty) > 0.0000001) {
        hasDefinedQty = true;
        break;
      }
    }

    if (hasDefinedQty) {
      return {
        success: false,
        projectId: pid,
        phaseId: phid,
        deletedRevPlansCount: 0,
        message:
          'Phase cannot be deleted because one or more rev plans have defined allocation quantity.',
      };
    }

    let removedLines = 0;
    for (let i = lineCount - 1; i >= 0; i -= 1) {
      phaseRec.removeLine({ sublistId: revPlanSublistId, line: i });
      removedLines += 1;
    }
    phaseRec.save({ enableSourcing: false, ignoreMandatoryFields: true });

    record.delete({ type: 'customrecord_pm_project_phase', id: phid });

    return {
      success: true,
      projectId: pid,
      phaseId: phid,
      deletedRevPlansCount: removedLines,
    };
  }

  return {
    getProjectPhases,
    upsertProjectsPhases,
    deleteProjectPhase,
  };
});
