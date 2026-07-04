/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
  'N/search',
  'N/log',
  '../../pm_config',
  '../core/helper',
  '../core/statuses',
  './rev_plan_mod',
  './rev_rec_mod',
  './project_financials_mod',
], (
  search,
  log,
  pmConfig,
  helper,
  statuses,
  revPlanMod,
  revRecMod,
  projectFinancialsMod,
) => {
  const { getAllResults, getLastHierarchyPart, toNumber } = helper;
  const {
    getProjectSalesOrderIdsByProject,
    getProjectRevenueRecognitionFromJournalsByProject,
    getBilledToDateByProject,
  } = projectFinancialsMod;

  function mapProjectStatusStrict({ id, text }) {
    return statuses.mapNetSuiteStatusStrict(statuses.ENTITY_TYPES.PROJECT, {
      id: String(id || ''),
      text: String(text || ''),
      logger: log,
      logTitle: 'STATUS_MAPPING_UNKNOWN_READ',
    });
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

  function toPositiveInt(value, fallback, { min = 1, max = 1000 } = {}) {
    const n = parseInt(String(value == null ? '' : value), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function toSortDirection(value) {
    return String(value || '').toLowerCase() === 'desc'
      ? search.Sort.DESC
      : search.Sort.ASC;
  }

  function buildProjectColumns(sortBy, sortDir) {
    const startDateCol = search.createColumn({
      name: 'formulatext',
      formula: "TO_CHAR({custrecord_pm_project_startdate}, 'DD/MM/YYYY')",
    });
    const endDateCol = search.createColumn({
      name: 'formulatext',
      formula: "TO_CHAR({custrecord_pm_project_enddate}, 'DD/MM/YYYY')",
    });

    const sortMap = {
      title: 'name',
      name: 'name',
      customerName: 'custrecord_pm_project_customer',
      projectManagerName: 'custrecord_pm_project_manager',
      department: 'custrecord_pm_project_dept',
      status: 'custrecord_pm_project_status',
      startDate: 'custrecord_pm_project_startdate',
      endDate: 'custrecord_pm_project_enddate',
      lastModified: 'lastmodified',
    };
    const sortField = sortMap[String(sortBy || '').trim()] || 'name';
    const direction = toSortDirection(sortDir);

    const baseColumns = [
      startDateCol,
      endDateCol,
      search.createColumn({ name: 'internalid' }),
      search.createColumn({ name: 'name' }),
      search.createColumn({ name: 'custrecord_pm_project_desc' }),
      search.createColumn({ name: 'custrecord_pm_project_customer' }),
      search.createColumn({ name: 'custrecord_pm_project_manager' }),
      search.createColumn({ name: 'custrecord_pm_project_dept' }),
      search.createColumn({ name: 'custrecord_pm_project_po' }),
      search.createColumn({ name: 'custrecord_pm_project_status' }),
      search.createColumn({ name: 'custrecord_pm_project_taskforjnlproc' }),
      search.createColumn({ name: 'custrecord_pm_project_taskforjnlproc_log' }),
      search.createColumn({ name: 'custrecord_pm_project_rev_accounts_used' }),
      search.createColumn({ name: 'lastmodified' }),
    ];

    // Keep deterministic fallback sort by internalid ascending.
    const sortColumns = [
      search.createColumn({ name: sortField, sort: direction }),
      search.createColumn({ name: 'internalid', sort: search.Sort.ASC }),
    ];
    return {
      startDateCol,
      endDateCol,
      columns: [...sortColumns, ...baseColumns],
    };
  }

  function buildProjectFilters(params, options = {}) {
    const includeStatusFilter = options?.includeStatusFilter !== false;
    const configuredSubsidiaryId = String(pmConfig?.SUBSIDIARY || '').trim();
    const filters = [['isinactive', 'is', 'F']];

    if (configuredSubsidiaryId) {
      filters.push('AND', [
        'custrecord_pm_project_subsidiary',
        'anyof',
        configuredSubsidiaryId,
      ]);
    }

    const searchTerm = String(params?.search || '').trim();
    if (searchTerm) {
      filters.push('AND', [
        [
          ['name', 'contains', searchTerm],
          'OR',
          ['custrecord_pm_project_desc', 'contains', searchTerm],
        ],
        'OR',
        ['custrecord_pm_project_po', 'contains', searchTerm],
      ]);
    }

    const customerId = String(params?.customerId || '').trim();
    if (customerId) {
      filters.push('AND', ['custrecord_pm_project_customer', 'anyof', customerId]);
    }

    const projectManagerId = String(params?.projectManagerId || '').trim();
    if (projectManagerId) {
      filters.push('AND', ['custrecord_pm_project_manager', 'anyof', projectManagerId]);
    }

    const departmentId = String(params?.departmentId || '').trim();
    if (departmentId) {
      filters.push('AND', ['custrecord_pm_project_dept', 'anyof', departmentId]);
    }

    return filters;
  }

  function getProjectStatusCounters(params) {
    const filters = buildProjectFilters(params, { includeStatusFilter: false });
    const grouped = search.create({
      type: 'customrecord_pm_projects',
      filters,
      columns: [
        search.createColumn({
          name: 'custrecord_pm_project_status',
          summary: search.Summary.GROUP,
        }),
        search.createColumn({
          name: 'internalid',
          summary: search.Summary.COUNT,
        }),
      ],
    });

    const counters = { all: 0 };
    const rows = getAllResults(grouped) || [];
    rows.forEach((res) => {
      const countRaw = res.getValue({
        name: 'internalid',
        summary: search.Summary.COUNT,
      });
      const count = Math.max(0, parseInt(String(countRaw || '0'), 10) || 0);
      if (!count) return;
      counters.all += count;
      const mappedStatus = mapProjectStatusStrict({
        id:
          res.getValue({
            name: 'custrecord_pm_project_status',
            summary: search.Summary.GROUP,
          }) || '',
        text:
          res.getText({
            name: 'custrecord_pm_project_status',
            summary: search.Summary.GROUP,
          }) || '',
      });
      const key = String(mappedStatus?.key || '').trim().toLowerCase();
      if (!key) return;
      counters[key] = (Number(counters[key] || 0) || 0) + count;
    });
    return counters;
  }

  function getRevPlanStatusKeyFromRollup(rollup) {
    const item = rollup && typeof rollup === 'object' ? rollup : {};
    return String(item?.revPlanStatus?.key || statuses.REVPLAN_STATUS_KEYS.OPEN)
      .trim()
      .toLowerCase();
  }

  function getRevPlanStatusCountersForProjectIds({
    projectIds,
    revPlanStatusByProjectId,
  } = {}) {
    const ids = Array.isArray(projectIds) ? projectIds : [];
    const counters = { all: 0 };
    ids.forEach((id) => {
      const pid = String(id || '').trim();
      if (!pid) return;
      counters.all += 1;
      const key = getRevPlanStatusKeyFromRollup(revPlanStatusByProjectId?.[pid] || {});
      if (!key) return;
      counters[key] = (Number(counters[key] || 0) || 0) + 1;
    });
    return counters;
  }

  function shapeProjects({
    projectRows,
    startDateCol,
    endDateCol,
    rollupsByProjectId,
    revenueReadyRollupsByProjectId,
    revPlanStatusByProjectId,
    cutoffDate,
  }) {
    const projectMeta = projectRows.map((res) => ({
      id: String(res.getValue({ name: 'internalid' }) || '').trim(),
      name: String(res.getValue({ name: 'name' }) || '').trim(),
      revAccountsUsed: String(
        res.getValue({ name: 'custrecord_pm_project_rev_accounts_used' }) || '',
      ).trim(),
    }));

    const salesOrderIdsByProject = getProjectSalesOrderIdsByProject(projectMeta) || {};
    const recognizedByProject =
      getProjectRevenueRecognitionFromJournalsByProject(projectMeta, {
        cutoffDate,
      }) || {};
    const invoicedToDateByProject = getBilledToDateByProject({
      salesOrderIdsByProject,
      cutoffDate,
    });

    return projectRows.map((res) => {
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
        ref: title,
        title,
        description: res.getValue({ name: 'custrecord_pm_project_desc' }) || null,
        customerId:
          res.getValue({ name: 'custrecord_pm_project_customer' }) || null,
        customerName:
          res.getText({ name: 'custrecord_pm_project_customer' }) || null,
        projectManagerId:
          res.getValue({ name: 'custrecord_pm_project_manager' }) || null,
        projectManagerName:
          res.getText({ name: 'custrecord_pm_project_manager' }) || null,
        departmentId: res.getValue({ name: 'custrecord_pm_project_dept' }) || null,
        department:
          getLastHierarchyPart(
            res.getText({ name: 'custrecord_pm_project_dept' }),
          ) || null,
        poRef: res.getValue({ name: 'custrecord_pm_project_po' }) || null,
        status: mappedStatus,
        startDate: res.getValue(startDateCol) || null,
        endDate: res.getValue(endDateCol) || null,
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
  }

  function getProjectsPaginated(params = {}) {
    const startedAt = Date.now();
    const page = toPositiveInt(params?.page, 1, { min: 1, max: 100000 });
    const pageSize = toPositiveInt(params?.pageSize, 25, { min: 1, max: 200 });

    const rollupsByProjectId = getProjectPhaseRollups();
    const revenueReadyRollupsByProjectId =
      revPlanMod.getProjectRevenueReadyRollups();
    const revPlanStatusByProjectId =
      revPlanMod.getProjectRevPlanStatusRollups();
    const effectivePeriod = revRecMod.getEffectivePeriodInfo();
    const cutoffDate = effectivePeriod?.monthEnd || null;
    const projectFilters = buildProjectFilters(params);
    const statusCounters = getProjectStatusCounters(params);
    const revPlanStatusKeys = (Array.isArray(params?.revPlanStatusKeys)
      ? params.revPlanStatusKeys
      : []
    )
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    const projectStatusKeys = (Array.isArray(params?.statusKeys)
      ? params.statusKeys
      : []
    )
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    const includeRevPlanCounters = Boolean(params?.includeRevPlanCounters);
    const revPlanStatusConflictOnly = Boolean(params?.revPlanStatusConflictOnly);
    const { startDateCol, endDateCol, columns } = buildProjectColumns(
      params?.sortBy,
      params?.sortDir,
    );

    const suiteSearch = search.create({
      type: 'customrecord_pm_projects',
      filters: projectFilters,
      columns,
    });
    let totalCount = 0;
    let totalPages = 1;
    let safePage = 1;
    let projectRows = [];
    let revPlanStatusCounters = null;

    if (
      projectStatusKeys.length ||
      revPlanStatusKeys.length ||
      includeRevPlanCounters ||
      revPlanStatusConflictOnly
    ) {
      const allRows = getAllResults(suiteSearch) || [];
      const allIds = allRows
        .map((res) => String(res.getValue({ name: 'internalid' }) || '').trim())
        .filter(Boolean);
      revPlanStatusCounters = getRevPlanStatusCountersForProjectIds({
        projectIds: allIds,
        revPlanStatusByProjectId,
      });
      let filteredRows = allRows;
      if (projectStatusKeys.length) {
        filteredRows = filteredRows.filter((res) => {
          const mappedStatus = mapProjectStatusStrict({
            id: res.getValue({ name: 'custrecord_pm_project_status' }) || '',
            text: res.getText({ name: 'custrecord_pm_project_status' }) || '',
          });
          const key = String(mappedStatus?.key || '').trim().toLowerCase();
          return key && projectStatusKeys.includes(key);
        });
      }
      if (revPlanStatusKeys.length) {
        filteredRows = filteredRows.filter((res) => {
            const id = String(res.getValue({ name: 'internalid' }) || '').trim();
            if (!id) return false;
            const key = getRevPlanStatusKeyFromRollup(
              revPlanStatusByProjectId?.[id] || {},
            );
            return revPlanStatusKeys.includes(key);
          });
      }
      if (revPlanStatusConflictOnly) {
        filteredRows = filteredRows.filter((res) => {
          const id = String(res.getValue({ name: 'internalid' }) || '').trim();
          if (!id) return false;
          return Boolean(revPlanStatusByProjectId?.[id]?.revPlanStatusConflict);
        });
      }
      totalCount = filteredRows.length;
      totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      safePage = Math.min(page, totalPages);
      const start = Math.max(0, (safePage - 1) * pageSize);
      projectRows = filteredRows.slice(start, start + pageSize);
    } else {
      const paged = suiteSearch.runPaged({ pageSize });
      totalCount = Number(paged.count || 0);
      totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      safePage = Math.min(page, totalPages);
      const pageIndex = Math.max(0, safePage - 1);
      const pageData = paged.pageRanges.length
        ? paged.fetch({ index: pageIndex }).data
        : [];
      projectRows = Array.isArray(pageData) ? pageData : [];
    }
    const afterBaseRowsAt = Date.now();
    const shaped = shapeProjects({
      projectRows,
      startDateCol,
      endDateCol,
      rollupsByProjectId,
      revenueReadyRollupsByProjectId,
      revPlanStatusByProjectId,
      cutoffDate,
    });
    const afterShapeAt = Date.now();

    const finishedAt = Date.now();
    log.audit({
      title: 'PM_PROJECTS_LIST_TIMING',
      details: {
        totalMs: finishedAt - startedAt,
        baseRowsMs: afterBaseRowsAt - startedAt,
        enrichAndShapeMs: afterShapeAt - afterBaseRowsAt,
        responseMs: finishedAt - afterShapeAt,
        rowsCount: projectRows.length,
        page: safePage,
        pageSize,
        totalCount,
        totalPages,
      },
    });
    return {
      projects: shaped,
      statusCounters,
      revPlanStatusCounters,
      pagination: {
        page: safePage,
        pageSize,
        totalCount,
        totalPages,
        hasPrev: safePage > 1,
        hasNext: safePage < totalPages,
      },
    };
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
    const { startDateCol, endDateCol, columns } = buildProjectColumns(
      'name',
      'asc',
    );
    const suiteSearch = search.create({
      type: 'customrecord_pm_projects',
      filters: buildProjectFilters({}),
      columns,
    });
    const projectRows = getAllResults(suiteSearch) || [];
    const afterBaseRowsAt = Date.now();
    const projects = shapeProjects({
      projectRows,
      startDateCol,
      endDateCol,
      rollupsByProjectId,
      revenueReadyRollupsByProjectId,
      revPlanStatusByProjectId,
      cutoffDate,
    });
    const finishedAt = Date.now();
    log.audit({
      title: 'PM_PROJECTS_LIST_TIMING',
      details: {
        totalMs: finishedAt - startedAt,
        baseRowsMs: afterBaseRowsAt - startedAt,
        enrichAndShapeMs: finishedAt - afterBaseRowsAt,
        rowsCount: projectRows.length,
      },
    });
    return projects;
  }

  return {
    getProjects,
    getProjectsPaginated,
  };
});
