/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([
  'N/search',
  'N/query',
  'N/format',
  'N/runtime',
  '../../pm_config',
  '../core/helper',
  '../core/validator',
  '../core/statuses',
  './project_month_context_mod',
], (
  search,
  query,
  format,
  runtime,
  pmConfig,
  helper,
  validator,
  statuses,
  projectMonthContextMod,
) => {
  const {
    getAllResults,
    normalizeLower,
    toNumber,
  } = helper;
  const { getEffectivePeriodInfo } = projectMonthContextMod;
  const { getProjectNameById, createProjectSegmentNameFilter } = validator;
  const PROJECT_REV_ACCOUNTS_FIELD = 'custrecord_pm_project_rev_accounts_used';

  function getCurrentScriptParam(name) {
    try {
      const script = runtime?.getCurrentScript?.();
      if (!script || !name) return '';
      return String(script.getParameter({ name }) || '').trim();
    } catch (e) {
      return '';
    }
  }

  function getRevenueAccountId() {
    return getCurrentScriptParam('custscript_pm_rev_acc');
  }

  function getEffectiveCutoffDate(projectId) {
    return getEffectivePeriodInfo({ projectId })?.effective?.monthEnd || null;
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
    if (includeCurrent) ids.push(String(getRevenueAccountId() || '').trim());
    return normalizeAccountIdList(ids);
  }

  function buildExpenseAccountFilterSql(
    accountIds,
    columnAlias = 'tl.expenseaccount',
  ) {
    const ids = normalizeAccountIdList(accountIds);
    if (!ids.length) return '';
    return `${columnAlias} IN (${ids.join(',')})`;
  }

  function getProjectStatus(projectId) {
    try {
      const fields = search.lookupFields({
        type: 'customrecord_pm_projects',
        id: String(projectId),
        columns: ['custrecord_pm_project_status'],
      });

      const rawStatusId =
        fields?.custrecord_pm_project_status?.[0]?.value ||
        fields?.custrecord_pm_project_status?.[0]?.id ||
        '';
      const rawStatusName =
        fields?.custrecord_pm_project_status?.[0]?.text ||
        fields?.custrecord_pm_project_status?.[0]?.value ||
        null;

      return statuses.mapNetSuiteStatusStrict(statuses.ENTITY_TYPES.PROJECT, {
        id: rawStatusId,
        text: rawStatusName,
        logger: log,
        logTitle: 'STATUS_MAPPING_UNKNOWN_READ',
      });
    } catch (e) {
      if (e?.name === 'STATUS_MAPPING_MISSING') throw e;
      return null;
    }
  }

  function toSqlDateLiteral(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function toNsDateFilter(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
    try {
      return format.format({
        value,
        type: format.Type.DATE,
      });
    } catch (e) {
      return null;
    }
  }

  function toLogDetails(value) {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }

  function dateTextToSortKey(value) {
    const raw = String(value || '').trim();
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return 0;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (
      !Number.isFinite(day) ||
      !Number.isFinite(month) ||
      !Number.isFinite(year) ||
      day < 1 ||
      day > 31 ||
      month < 1 ||
      month > 12
    ) {
      return 0;
    }
    return year * 10000 + month * 100 + day;
  }

  function getNormalizedSalesOrderIds(salesOrderIds) {
    return Array.isArray(salesOrderIds)
      ? salesOrderIds
          .filter(Boolean)
          .map((id) => Number(id))
          .filter((id) => !Number.isNaN(id))
      : [];
  }

  function getGrossInvoicedAmountForSalesOrders(salesOrderIds, cutoffDate) {
    const ids = getNormalizedSalesOrderIds(salesOrderIds);
    if (!ids.length) return 0;

    const idList = ids.join(',');
    const cutoffSql = toSqlDateLiteral(cutoffDate);
    const sql = `
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
        AND tl.createdfrom IN (${idList})
        ${cutoffSql ? `AND inv.trandate <= TO_DATE('${cutoffSql}', 'YYYY-MM-DD')` : ''}
    `;
    const rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
    return toNumber(rows?.[0]?.invoice_total || 0);
  }

  function getNetInvoicedAmountForSalesOrders(salesOrderIds, cutoffDate) {
    const ids = getNormalizedSalesOrderIds(salesOrderIds);
    if (!ids.length) return 0;

    const idList = ids.join(',');
    const cutoffSql = toSqlDateLiteral(cutoffDate);
    const debugInvoiceSql = `
      SELECT
        inv.id AS invoice_id,
        inv.tranid AS invoice_tranid,
        TO_CHAR(inv.trandate, 'DD/MM/YYYY') AS invoice_trandate,
        tl.createdfrom AS salesorder_id,
        (inv.total - COALESCE(tax.tax_total, 0)) AS invoice_net
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
        AND tl.createdfrom IN (${idList})
        ${cutoffSql ? `AND inv.trandate <= TO_DATE('${cutoffSql}', 'YYYY-MM-DD')` : ''}
      ORDER BY inv.trandate DESC, inv.id DESC
    `;
    const debugInvoiceRows =
      query.runSuiteQL({ query: debugInvoiceSql }).asMappedResults() || [];
    log.audit({
      title: 'PM_NET_INVOICED_DEBUG',
      details: toLogDetails({
        salesOrderIds: ids.map(String),
        cutoffSql: cutoffSql || null,
        invoiceRowsCount: debugInvoiceRows.length,
        invoiceRows: debugInvoiceRows.slice(0, 60),
      }),
    });
    const invoiceTotal = getGrossInvoicedAmountForSalesOrders(ids, cutoffDate);
    const creditMemoApplied = getCreditMemoApplicationsForSalesOrders(
      ids,
      cutoffDate,
    );
    return invoiceTotal - toNumber(creditMemoApplied?.totalApplied || 0);
  }

  function toSqlTextLiteral(value) {
    return String(value == null ? '' : value).replace(/'/g, "''");
  }

  function getCreditMemoApplicationsForSalesOrders(salesOrderIds, cutoffDate) {
    const ids = Array.isArray(salesOrderIds)
      ? salesOrderIds.filter(Boolean).map(String)
      : [];
    if (!ids.length) return { totalApplied: 0, creditMemos: [] };

    const nsDate = toNsDateFilter(cutoffDate);
    const soFilters = [
      ['mainline', 'is', 'T'],
      'AND',
      ['type', 'anyof', 'CustCred'],
      'AND',
      [
        ['createdfrom.createdfrom', 'anyof', ...ids],
        'OR',
        ['appliedtotransaction.createdfrom', 'anyof', ...ids],
      ],
    ];

    if (nsDate) {
      soFilters.push('AND', ['trandate', 'onorbefore', nsDate]);
    }

    log.audit('search filters', soFilters);

    const suiteSearch = search.create({
      type: 'transaction',
      settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
      filters: soFilters,
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

    const byCreditMemoId = {};
    let totalApplied = 0;

    getAllResults(suiteSearch).forEach((res) => {
      const id = res.getValue({ name: 'internalid' });
      if (!id) return;
      const key = String(id);

      const appliedRaw =
        res.getValue({ name: 'appliedtolinkamount' }) ??
        res.getValue({ name: 'appliedtoforeignamount' });
      const applied = Math.abs(toNumber(appliedRaw));
      totalApplied += applied;

      if (!byCreditMemoId[key]) {
        const tranDateCol = suiteSearch.columns[2];
        byCreditMemoId[key] = {
          id: key,
          tranId: String(res.getValue({ name: 'tranid' }) || ''),
          tranDate: String(res.getValue(tranDateCol) || ''),
          appliedAmount: 0,
        };
      }
      byCreditMemoId[key].appliedAmount += applied;
    });

    const creditMemos = Object.values(byCreditMemoId).sort((a, b) => {
      const dA = dateTextToSortKey(a.tranDate);
      const dB = dateTextToSortKey(b.tranDate);
      if (dA !== dB) return dB - dA;
      return String(a.id || '') < String(b.id || '') ? 1 : -1;
    });

    return { totalApplied, creditMemos };
  }

  function getProjectRevenueRecognitionFromJournals(projectId, options) {
    const opts = options || {};
    const projectName = getProjectNameById(projectId);
    const normalizedName = String(projectName || '').trim();
    if (!normalizedName) {
      return { amount: 0, journalId: null, tranId: null, tranDate: null };
    }

    const revenueAccountIds = getProjectRevenueAccountIds(projectId, {
      includeCurrent: true,
    });
    const accountFilterSql = buildExpenseAccountFilterSql(revenueAccountIds);
    if (!accountFilterSql) {
      return { amount: 0, journalId: null, tranId: null, tranDate: null };
    }

    const safeName = toSqlTextLiteral(normalizedName.toLowerCase());
    const cutoffSql = toSqlDateLiteral(opts.cutoffDate);

    // Revenue recognized for PM is read from the latest positive journal movement to the
    // configured revenue account for the project segment.
    // Reversal journals post the opposite sign; by selecting positive movement only,
    // we keep the original/main rev-rec journal amount and ignore reversal entries.
    const sql = `
      SELECT
        t.id AS id,
        t.tranid AS tranid,
        TO_CHAR(t.trandate, 'DD/MM/YYYY') AS trandate,
        SUM(
          NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)
        ) AS recognized_amount
      FROM transaction t
      INNER JOIN transactionline tl
        ON tl.transaction = t.id
      WHERE
        t.type = 'Journal'
        AND ${accountFilterSql}
        AND LOWER(BUILTIN.DF(t.cseg_project_seg)) = '${safeName}'
        AND (t.voided = 'F' OR t.voided IS NULL)
        ${cutoffSql ? `AND t.trandate <= TO_DATE('${cutoffSql}', 'YYYY-MM-DD')` : ''}
      GROUP BY t.id, t.tranid, t.trandate
      HAVING SUM(
        NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)
      ) > 0
      ORDER BY t.trandate DESC, id DESC
    `;

    const rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
    if (!rows.length) {
      log.audit({
        title: 'PM_PROJECT_RECOGNIZED_RESULT',
        details: toLogDetails({
          projectId: String(projectId || ''),
          cutoffDate: cutoffSql || null,
          journalId: null,
          tranId: null,
          tranDate: null,
          recognizedAmount: 0,
          matchedRows: 0,
        }),
      });
      return { amount: 0, journalId: null, tranId: null, tranDate: null };
    }

    const latest = rows[0] || {};
    const result = {
      amount: toNumber(latest?.recognized_amount),
      journalId: latest?.id != null ? String(latest.id) : null,
      tranId: latest?.tranid != null ? String(latest.tranid) : null,
      tranDate: latest?.trandate != null ? String(latest.trandate) : null,
    };
    log.audit({
      title: 'PM_PROJECT_RECOGNIZED_RESULT',
      details: toLogDetails({
        projectId: String(projectId || ''),
        cutoffDate: cutoffSql || null,
        journalId: result.journalId,
        tranId: result.tranId,
        tranDate: result.tranDate,
        recognizedAmount: result.amount,
        matchedRows: rows.length,
      }),
    });
    return {
      amount: result.amount,
      journalId: result.journalId,
      tranId: result.tranId,
      tranDate: result.tranDate,
    };
  }

  function buildInClause(values) {
    const list = Array.isArray(values) ? values : [];
    if (!list.length) return '';
    return list.map((v) => `'${toSqlTextLiteral(String(v || ''))}'`).join(', ');
  }

  function getProjectRevenueRecognitionFromJournalsByProject(projects, options) {
    const opts = options || {};
    const rows = Array.isArray(projects) ? projects : [];
    const resultByProjectId = {};
    const currentRevenueAccountId = String(getRevenueAccountId() || '').trim();

    const byAccountKey = {};
    rows.forEach((row) => {
      const projectId = String(row?.id || '').trim();
      const normalizedName = normalizeLower(row?.name);
      if (!projectId) return;
      resultByProjectId[projectId] = {
        amount: 0,
        journalId: null,
        tranId: null,
        tranDate: null,
      };
      if (!normalizedName) return;

      const accountIds = normalizeAccountIdList([
        ...parsePipeDelimitedAccountIds(row?.revAccountsUsed),
        currentRevenueAccountId,
      ]);
      const accountFilterSql = buildExpenseAccountFilterSql(accountIds);
      if (!accountFilterSql) return;
      const key = `${accountIds.join('|')}__${accountFilterSql}`;
      if (!byAccountKey[key]) {
        byAccountKey[key] = {
          accountFilterSql,
          names: [],
          projectIdsByName: {},
        };
      }
      if (!byAccountKey[key].projectIdsByName[normalizedName]) {
        byAccountKey[key].projectIdsByName[normalizedName] = [];
        byAccountKey[key].names.push(normalizedName);
      }
      byAccountKey[key].projectIdsByName[normalizedName].push(projectId);
    });

    const cutoffSql = toSqlDateLiteral(opts.cutoffDate);
    Object.keys(byAccountKey).forEach((groupKey) => {
      const group = byAccountKey[groupKey];
      const names = Array.isArray(group?.names) ? group.names : [];
      if (!names.length) return;
      const chunkSize = 25;
      for (let i = 0; i < names.length; i += chunkSize) {
        const chunk = names.slice(i, i + chunkSize);
        if (!chunk.length) continue;
        const namesInClause = buildInClause(chunk);
        const sql = `
          SELECT
            LOWER(BUILTIN.DF(t.cseg_project_seg)) AS project_key,
            t.id AS id,
            t.tranid AS tranid,
            TO_CHAR(t.trandate, 'DD/MM/YYYY') AS trandate,
            SUM(
              NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)
            ) AS recognized_amount
          FROM transaction t
          INNER JOIN transactionline tl
            ON tl.transaction = t.id
          WHERE
            t.type = 'Journal'
            AND ${group.accountFilterSql}
            AND LOWER(BUILTIN.DF(t.cseg_project_seg)) IN (${namesInClause})
            AND (t.voided = 'F' OR t.voided IS NULL)
            ${cutoffSql ? `AND t.trandate <= TO_DATE('${cutoffSql}', 'YYYY-MM-DD')` : ''}
          GROUP BY LOWER(BUILTIN.DF(t.cseg_project_seg)), t.id, t.tranid, t.trandate
          HAVING SUM(
            NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)
          ) > 0
          ORDER BY LOWER(BUILTIN.DF(t.cseg_project_seg)) ASC, t.trandate DESC, t.id DESC
        `;
        const queryRows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
        const seenNames = {};
        queryRows.forEach((r) => {
          const projectKey = normalizeLower(r?.project_key);
          if (!projectKey || seenNames[projectKey]) return;
          seenNames[projectKey] = true;
          const projectIds = group.projectIdsByName[projectKey] || [];
          const mapped = {
            amount: toNumber(r?.recognized_amount || 0),
            journalId: r?.id != null ? String(r.id) : null,
            tranId: r?.tranid != null ? String(r.tranid) : null,
            tranDate: r?.trandate != null ? String(r.trandate) : null,
          };
          projectIds.forEach((projectId) => {
            resultByProjectId[projectId] = mapped;
          });
        });
      }
    });

    return resultByProjectId;
  }

  function getLatestPositiveRevenueJournalId(
    projectName,
    revenueAccountIds,
    cutoffDate,
  ) {
    const normalizedName = String(projectName || '').trim();
    if (!normalizedName) return null;
    const accountFilterSql = buildExpenseAccountFilterSql(revenueAccountIds);
    if (!accountFilterSql) return null;

    const safeName = toSqlTextLiteral(normalizedName.toLowerCase());
    const cutoffSql = toSqlDateLiteral(cutoffDate);
    const latestJournalSql = `
      SELECT
        t.id AS id,
        TO_CHAR(t.trandate, 'DD/MM/YYYY') AS trandate,
        SUM(
          NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)
        ) AS recognized_amount
      FROM transaction t
      INNER JOIN transactionline tl
        ON tl.transaction = t.id
      WHERE
        t.type = 'Journal'
        AND ${accountFilterSql}
        AND LOWER(BUILTIN.DF(t.cseg_project_seg)) = '${safeName}'
        AND (t.voided = 'F' OR t.voided IS NULL)
        ${cutoffSql ? `AND t.trandate <= TO_DATE('${cutoffSql}', 'YYYY-MM-DD')` : ''}
      GROUP BY t.id, t.trandate
      HAVING SUM(
        NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)
      ) > 0
      ORDER BY t.trandate DESC, id DESC
    `;

    const latestRows =
      query.runSuiteQL({ query: latestJournalSql }).asMappedResults() || [];
    return latestRows?.[0]?.id != null ? String(latestRows[0].id) : null;
  }

  function getRevenueRecognizedByDepartment(projectId, options) {
    const opts = options || {};
    const projectName = getProjectNameById(projectId);
    const revenueAccountIds = getProjectRevenueAccountIds(projectId, {
      includeCurrent: true,
    });
    const accountFilterSql = buildExpenseAccountFilterSql(revenueAccountIds);
    if (!accountFilterSql) return [];
    const latestJournalId =
      getLatestPositiveRevenueJournalId(
        projectName,
        revenueAccountIds,
        opts.cutoffDate,
      ) || '';
    if (!latestJournalId) return [];

    const byDepartmentSql = `
      SELECT
        tl.department AS departmentid,
        BUILTIN.DF(tl.department) AS departmentname,
        SUM(
          NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)
        ) AS recognized_amount
      FROM transactionline tl
      WHERE
        tl.transaction = ${toSqlTextLiteral(latestJournalId)}
        AND ${accountFilterSql}
      GROUP BY tl.department, BUILTIN.DF(tl.department)
    `;

    const rows =
      query.runSuiteQL({ query: byDepartmentSql }).asMappedResults() || [];
    return rows
      .map((row) => ({
        departmentId:
          row?.departmentid != null ? String(row.departmentid) : null,
        department: String(row?.departmentname || 'Unassigned'),
        recognizedToDate: toNumber(row?.recognized_amount),
      }))
      .sort((a, b) =>
        String(a.department || '').localeCompare(String(b.department || '')),
      );
  }

  function getRevenueRecognizedByPhase(projectId, options) {
    const opts = options || {};
    const projectName = getProjectNameById(projectId);
    const revenueAccountIds = getProjectRevenueAccountIds(projectId, {
      includeCurrent: true,
    });
    const accountFilterSql = buildExpenseAccountFilterSql(revenueAccountIds);
    if (!accountFilterSql) return [];
    const latestJournalId =
      getLatestPositiveRevenueJournalId(
        projectName,
        revenueAccountIds,
        opts.cutoffDate,
      ) || '';
    if (!latestJournalId) return [];

    const byPhaseSql = `
      SELECT
        tl.custcol_pm_projectphase_jnl AS phaseid,
        BUILTIN.DF(tl.custcol_pm_projectphase_jnl) AS phasename,
        SUM(
          NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)
        ) AS recognized_amount
      FROM transactionline tl
      WHERE
        tl.transaction = ${toSqlTextLiteral(latestJournalId)}
        AND ${accountFilterSql}
        AND tl.custcol_pm_projectphase_jnl IS NOT NULL
      GROUP BY tl.custcol_pm_projectphase_jnl, BUILTIN.DF(tl.custcol_pm_projectphase_jnl)
    `;

    const rows =
      query.runSuiteQL({ query: byPhaseSql }).asMappedResults() || [];
    return rows
      .map((row) => ({
        phaseId: row?.phaseid != null ? String(row.phaseid) : null,
        phase: String(row?.phasename || 'Unassigned'),
        recognizedToDate: toNumber(row?.recognized_amount),
      }))
      .sort((a, b) =>
        String(a.phase || '').localeCompare(String(b.phase || '')),
      );
  }

  function getRelatedSalesOrdersInvoicesAndJournals(projectId, options) {
    const opts = options || {};
    const projectName = getProjectNameById(projectId);
    const normalizedName = String(projectName || '').trim();
    if (!normalizedName) {
      return {
        salesOrders: [],
        invoices: [],
        purchaseOrders: [],
        vendorBills: [],
        inventoryAdjustments: [],
        journals: [],
      };
    }
    const safeName = toSqlTextLiteral(normalizedName.toLowerCase());
    const cutoffSql = toSqlDateLiteral(opts.cutoffDate);

    const sql = `
      SELECT
        'SalesOrd' AS record_type,
        t.id AS id,
        t.tranid,
        TO_CHAR(t.trandate, 'DD/MM/YYYY') AS trandate,
        t.trandate AS actualdate,
        tl.netamount,
        NULL AS is_reversal,
        NULL AS is_voided,
        inv_tl.transaction AS inv_id,
        inv_t.tranid AS inv_tranid,
        TO_CHAR(inv_t.trandate, 'DD/MM/YYYY') AS inv_trandate,
        inv_tl.netamount AS inv_amt
      FROM transaction t
      INNER JOIN transactionline tl
        ON tl.transaction = t.id
        AND tl.mainline = 'T'
      LEFT JOIN transactionline inv_tl
        ON inv_tl.createdfrom = t.id
        AND inv_tl.mainline = 'T'
      LEFT JOIN transaction inv_t
        ON inv_t.id = inv_tl.transaction
        ${cutoffSql ? `AND inv_t.trandate <= TO_DATE('${cutoffSql}', 'YYYY-MM-DD')` : ''}
      WHERE
        t.type = 'SalesOrd'
        AND LOWER(BUILTIN.DF(t.cseg_project_seg)) = '${safeName}'

      UNION ALL

      SELECT
        'Journal' AS record_type,
        t.id AS id,
        t.tranid,
        TO_CHAR(t.trandate, 'DD/MM/YYYY') AS trandate,
        t.trandate AS actualdate,
        SUM(NVL(tl.debitforeignamount,0)) AS netamount,
        t.isreversal AS is_reversal,
        t.voided AS is_voided,
        NULL AS inv_id,
        NULL AS inv_tranid,
        NULL AS inv_trandate,
        NULL AS inv_amt
      FROM transaction t
      INNER JOIN transactionline tl
        ON tl.transaction = t.id
      WHERE
        t.type = 'Journal'
        AND LOWER(BUILTIN.DF(t.cseg_project_seg)) = '${safeName}'
        ${cutoffSql ? `AND t.trandate <= TO_DATE('${cutoffSql}', 'YYYY-MM-DD')` : ''}
      GROUP BY t.id, t.tranid, t.trandate, t.isreversal, t.voided
      ORDER BY actualdate DESC, id DESC
    `;
    const lineLinkedCostSql = `
      SELECT
        t.type AS record_type,
        t.id AS id,
        t.tranid,
        TO_CHAR(t.trandate, 'DD/MM/YYYY') AS trandate,
        t.trandate AS actualdate,
        SUM(NVL(tl.netamount, 0)) AS netamount
      FROM transaction t
      INNER JOIN transactionline tl
        ON tl.transaction = t.id
        AND tl.mainline = 'F'
      WHERE
        t.type IN ('PurchOrd', 'VendBill', 'InvAdjst')
        AND LOWER(BUILTIN.DF(tl.cseg_project_seg)) = '${safeName}'
        ${cutoffSql ? `AND t.trandate <= TO_DATE('${cutoffSql}', 'YYYY-MM-DD')` : ''}
      GROUP BY
        t.type, t.id, t.tranid, t.trandate
      ORDER BY actualdate DESC, id DESC
    `;
    const rows = [
      ...(query.runSuiteQL({ query: sql }).asMappedResults() || []),
      ...(query.runSuiteQL({ query: lineLinkedCostSql }).asMappedResults() ||
        []),
    ];
    const salesOrderById = {};
    const invoiceById = {};
    const purchaseOrderById = {};
    const vendorBillById = {};
    const inventoryAdjustmentById = {};
    const journalById = {};

    rows.forEach((row) => {
      const recordType = String(row?.record_type || '');
      const id = row?.id != null ? String(row.id) : '';
      if (!id) return;

      if (recordType === 'SalesOrd') {
        if (!salesOrderById[id]) {
          salesOrderById[id] = {
            id,
            tranId: row?.tranid != null ? String(row.tranid) : '',
            tranDate: row?.trandate != null ? String(row.trandate) : '',
            amount: toNumber(row?.netamount),
          };
        }

        const invId = row?.inv_id != null ? String(row.inv_id) : '';
        if (invId && !invoiceById[invId]) {
          invoiceById[invId] = {
            id: invId,
            tranId: row?.inv_tranid != null ? String(row.inv_tranid) : '',
            tranDate: row?.inv_trandate != null ? String(row.inv_trandate) : '',
            amount: toNumber(row?.inv_amt),
          };
        }
      } else if (recordType === 'PurchOrd') {
        if (!purchaseOrderById[id]) {
          const amount = toNumber(row?.netamount);
          purchaseOrderById[id] = {
            id,
            tranId: row?.tranid != null ? String(row.tranid) : '',
            tranDate: row?.trandate != null ? String(row.trandate) : '',
            amount,
          };
        }
      } else if (recordType === 'VendBill') {
        if (!vendorBillById[id]) {
          const amount = toNumber(row?.netamount);
          vendorBillById[id] = {
            id,
            tranId: row?.tranid != null ? String(row.tranid) : '',
            tranDate: row?.trandate != null ? String(row.trandate) : '',
            amount,
          };
        }
      } else if (recordType === 'InvAdjst') {
        if (!inventoryAdjustmentById[id]) {
          inventoryAdjustmentById[id] = {
            id,
            tranId: row?.tranid != null ? String(row.tranid) : '',
            tranDate: row?.trandate != null ? String(row.trandate) : '',
            amount: toNumber(row?.netamount) * -1,
          };
        }
      } else if (recordType === 'Journal') {
        if (!journalById[id]) {
          const rawIsReversal = String(row?.is_reversal || '')
            .trim()
            .toUpperCase();
          const rawIsVoided = String(row?.is_voided || '')
            .trim()
            .toUpperCase();
          journalById[id] = {
            id,
            tranId: row?.tranid != null ? String(row.tranid) : '',
            tranDate: row?.trandate != null ? String(row.trandate) : '',
            amount: toNumber(row?.netamount),
            isReversal: rawIsReversal === 'T' || rawIsReversal === 'TRUE',
            isVoided: rawIsVoided === 'T' || rawIsVoided === 'TRUE',
          };
        }
      }
    });

    const result = {
      salesOrders: Object.values(salesOrderById),
      invoices: Object.values(invoiceById),
      purchaseOrders: Object.values(purchaseOrderById),
      vendorBills: Object.values(vendorBillById),
      inventoryAdjustments: Object.values(inventoryAdjustmentById),
      journals: Object.values(journalById),
    };
    return result;
  }

  function getProjectStatusName(projectId) {
    const status = getProjectStatus(projectId);
    return status?.label || null;
  }

  function getProjectSalesOrderIds(projectId) {
    if (!projectId) return [];
    const projectName = getProjectNameById(projectId);
    const segmentFilter = createProjectSegmentNameFilter(projectName);

    if (!segmentFilter) return [];

    const suiteSearch = search.create({
      type: 'salesorder',
      filters: [segmentFilter, 'AND', ['mainline', 'is', 'T']],
      columns: [search.createColumn({ name: 'internalid' })],
    });

    const used = new Set();
    getAllResults(suiteSearch).forEach((res) => {
      const soId = res.getValue({ name: 'internalid' });
      if (soId) used.add(String(soId));
    });
    return Array.from(used);
  }

  function getProjectSalesOrderIdsByProject(projects) {
    const rows = Array.isArray(projects) ? projects : [];
    const out = {};
    const projectIdsByName = {};
    const names = [];

    rows.forEach((row) => {
      const projectId = String(row?.id || '').trim();
      const normalizedName = normalizeLower(row?.name);
      if (!projectId) return;
      if (!out[projectId]) out[projectId] = [];
      if (!normalizedName) return;
      if (!projectIdsByName[normalizedName]) {
        projectIdsByName[normalizedName] = [];
        names.push(normalizedName);
      }
      projectIdsByName[normalizedName].push(projectId);
    });

    if (!names.length) return out;

    const chunkSize = 25;
    for (let i = 0; i < names.length; i += chunkSize) {
      const chunk = names.slice(i, i + chunkSize);
      if (!chunk.length) continue;
      const soByProjectId = {};
      const namesInClause = buildInClause(chunk);
      const sql = `
        SELECT
          t.id AS salesorder_id,
          LOWER(BUILTIN.DF(t.cseg_project_seg)) AS project_key
        FROM transaction t
        INNER JOIN transactionline tl
          ON tl.transaction = t.id
          AND tl.mainline = 'T'
        WHERE t.type = 'SalesOrd'
          AND LOWER(BUILTIN.DF(t.cseg_project_seg)) IN (${namesInClause})
      `;
      const rows = query.runSuiteQL({ query: sql }).asMappedResults() || [];
      rows.forEach((row) => {
        const soId = String(row?.salesorder_id || '').trim();
        const segmentName = normalizeLower(row?.project_key);
        if (!soId || !segmentName) return;
        const projectIds = projectIdsByName[segmentName] || [];
        projectIds.forEach((projectId) => {
          if (!soByProjectId[projectId]) soByProjectId[projectId] = new Set();
          soByProjectId[projectId].add(soId);
        });
      });

      Object.keys(soByProjectId).forEach((projectId) => {
        const existing = new Set(out[projectId] || []);
        soByProjectId[projectId].forEach((id) => existing.add(String(id)));
        out[projectId] = Array.from(existing);
      });
    }

    return out;
  }

  function getBilledToDateByProject({
    salesOrderIdsByProject,
    cutoffDate,
  } = {}) {
    const map = salesOrderIdsByProject && typeof salesOrderIdsByProject === 'object'
      ? salesOrderIdsByProject
      : {};
    const projectIds = Object.keys(map);
    const out = {};
    projectIds.forEach((projectId) => {
      out[String(projectId)] = 0;
    });
    if (!projectIds.length) return out;

    const soToProjectIds = {};
    const allSoIds = new Set();
    projectIds.forEach((projectId) => {
      const ids = Array.isArray(map[projectId]) ? map[projectId] : [];
      ids.forEach((raw) => {
        const soId = String(raw || '').trim();
        if (!/^\d+$/.test(soId)) return;
        if (!soToProjectIds[soId]) soToProjectIds[soId] = [];
        soToProjectIds[soId].push(String(projectId));
        allSoIds.add(soId);
      });
    });
    if (!allSoIds.size) return out;

    const cutoffSql = toSqlDateLiteral(cutoffDate);
    if (!cutoffSql) return out;

    const soIds = Array.from(allSoIds);
    const chunkSize = 900;
    const invoiceBySo = {};
    const creditBySo = {};

    for (let i = 0; i < soIds.length; i += chunkSize) {
      const chunk = soIds.slice(i, i + chunkSize);
      if (!chunk.length) continue;
      const inClause = chunk.join(',');

      const invoiceSql = `
        SELECT
          tl.createdfrom AS salesorder_id,
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
          AND inv.trandate <= TO_DATE('${cutoffSql}', 'YYYY-MM-DD')
          AND tl.createdfrom IN (${inClause})
        GROUP BY tl.createdfrom
      `;
      const invoiceRows = query.runSuiteQL({ query: invoiceSql }).asMappedResults() || [];
      invoiceRows.forEach((row) => {
        const soId = String(row?.salesorder_id || '').trim();
        if (!soId) return;
        invoiceBySo[soId] = toNumber(invoiceBySo[soId] || 0) + toNumber(row?.invoice_total || 0);
      });

      const nsDate = toNsDateFilter(cutoffDate);
      const cmSearch = search.create({
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
            ['createdfrom.createdfrom', 'anyof', ...chunk],
            'OR',
            ['appliedtotransaction.createdfrom', 'anyof', ...chunk],
          ],
        ],
        columns: [
          search.createColumn({
            name: 'formulatext',
            formula:
              "NVL({createdfrom.createdfrom}, {appliedtotransaction.createdfrom})",
          }),
          search.createColumn({ name: 'appliedtolinkamount' }),
          search.createColumn({ name: 'appliedtoforeignamount' }),
        ],
      });

      getAllResults(cmSearch).forEach((res) => {
        const soId = String(
          res.getValue({
            name: 'formulatext',
            formula:
              "NVL({createdfrom.createdfrom}, {appliedtotransaction.createdfrom})",
          }) || '',
        ).trim();
        if (!soId) return;
        const appliedRaw =
          res.getValue({ name: 'appliedtolinkamount' }) ??
          res.getValue({ name: 'appliedtoforeignamount' });
        const applied = Math.abs(toNumber(appliedRaw));
        creditBySo[soId] = toNumber(creditBySo[soId] || 0) + applied;
      });
    }

    Object.keys(soToProjectIds).forEach((soId) => {
      const delta = toNumber(invoiceBySo[soId] || 0) - toNumber(creditBySo[soId] || 0);
      (soToProjectIds[soId] || []).forEach((projectId) => {
        out[projectId] = toNumber(out[projectId] || 0) + delta;
      });
    });

    return out;
  }

  function getPhaseTotal(projectId) {
    if (!projectId) return 0;

    const suiteSearch = search.create({
      type: 'customrecord_pm_project_phase',
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        ['custrecord_pm_phase_parent', 'anyof', String(projectId)],
      ],
      columns: [
        search.createColumn({
          name: 'formulanumeric',
          summary: search.Summary.SUM,
          formula:
            '(CASE WHEN {custrecord_pm_phase_qty} IS NULL THEN 0 ELSE {custrecord_pm_phase_qty} END) * (CASE WHEN {custrecord_pm_phase_rate} IS NULL THEN 0 ELSE {custrecord_pm_phase_rate} END)',
        }),
      ],
    });

    const first = suiteSearch.run().getRange({ start: 0, end: 1 })?.[0] || null;
    return first
      ? toNumber(
          first.getValue({
            name: 'formulanumeric',
            summary: search.Summary.SUM,
          }),
        )
      : 0;
  }

  function getPhaseTotalsByMilestone(projectId) {
    const totalsByKey = {};
    if (!projectId) return totalsByKey;

    const suiteSearch = search.create({
      type: 'customrecord_pm_project_phase',
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        ['custrecord_pm_phase_parent', 'anyof', String(projectId)],
      ],
      columns: [
        search.createColumn({
          name: 'custrecord_pm_phase_milestone',
          summary: search.Summary.GROUP,
        }),
        search.createColumn({
          name: 'custrecord_pm_phase_milestone_desc',
          summary: search.Summary.GROUP,
        }),
        search.createColumn({
          name: 'formulanumeric',
          summary: search.Summary.SUM,
          formula:
            '(CASE WHEN {custrecord_pm_phase_qty} IS NULL THEN 0 ELSE {custrecord_pm_phase_qty} END) * (CASE WHEN {custrecord_pm_phase_rate} IS NULL THEN 0 ELSE {custrecord_pm_phase_rate} END)',
        }),
      ],
    });

    getAllResults(suiteSearch).forEach((res) => {
      const itemId = res.getValue({
        name: 'custrecord_pm_phase_milestone',
        summary: search.Summary.GROUP,
      });
      const memoRaw = res.getValue({
        name: 'custrecord_pm_phase_milestone_desc',
        summary: search.Summary.GROUP,
      });
      const memo = String(memoRaw || '').trim();
      if (!itemId || !memo) return;

      const total = toNumber(
        res.getValue({
          name: 'formulanumeric',
          summary: search.Summary.SUM,
        }),
      );
      const key = `${String(itemId)}|||${memo}`;
      totalsByKey[key] = (totalsByKey[key] ?? 0) + total;
    });

    return totalsByKey;
  }

  function getSalesOrderLineTotal({ salesOrderIds } = {}) {
    const ids = Array.isArray(salesOrderIds)
      ? salesOrderIds.filter(Boolean).map(String)
      : [];
    if (!ids.length) return 0;

    const trySearch = (amountField) => {
      const filters = [
        ['internalid', 'anyof', ...ids],
        'AND',
        ['mainline', 'is', 'F'],
        'AND',
        ['taxline', 'is', 'F'],
        'AND',
        ['shipping', 'is', 'F'],
      ];

      const suiteSearch = search.create({
        type: 'salesorder',
        filters,
        columns: [
          search.createColumn({
            name: amountField,
            summary: search.Summary.SUM,
          }),
        ],
      });

      const first =
        suiteSearch.run().getRange({ start: 0, end: 1 })?.[0] || null;
      const value = first
        ? first.getValue({ name: amountField, summary: search.Summary.SUM })
        : null;
      return toNumber(value);
    };

    try {
      return trySearch('amount');
    } catch (e) {
      return trySearch('netamount');
    }
  }

  function getSalesOrderLineTotalsByMilestone({ salesOrderIds } = {}) {
    const totalsByKey = {};
    const ids = Array.isArray(salesOrderIds)
      ? salesOrderIds.filter(Boolean).map(String)
      : [];
    if (!ids.length) return totalsByKey;

    const milestoneProductFamilyId =
      pmConfig?.LIST_IDS?.ITEM_PRODUCT_FAMILY?.MILESTONE != null
        ? String(pmConfig.LIST_IDS.ITEM_PRODUCT_FAMILY.MILESTONE).trim()
        : '6';
    if (!milestoneProductFamilyId) return totalsByKey;

    const trySearch = (
      amountField,
      memoField,
      { familyFilterMode = 'join' } = {},
    ) => {
      const filters = [
        ['internalid', 'anyof', ...ids],
        'AND',
        ['mainline', 'is', 'F'],
        'AND',
        ['taxline', 'is', 'F'],
        'AND',
        ['shipping', 'is', 'F'],
        'AND',
        [String(memoField || 'memo'), 'isnotempty', ''],
      ];
      if (familyFilterMode === 'formula') {
        filters.push('AND', [
          'formulatext: {item.custitem_product_family}',
          'is',
          milestoneProductFamilyId,
        ]);
      } else {
        filters.push('AND', [
          'item.custitem_product_family',
          'anyof',
          milestoneProductFamilyId,
        ]);
      }

      const suiteSearch = search.create({
        type: 'salesorder',
        filters,
        columns: [
          search.createColumn({
            name: 'item',
            summary: search.Summary.GROUP,
          }),
          search.createColumn({
            name: String(memoField || 'memo'),
            summary: search.Summary.GROUP,
          }),
          search.createColumn({
            name: amountField,
            summary: search.Summary.SUM,
          }),
        ],
      });

      getAllResults(suiteSearch).forEach((res) => {
        const itemId = res.getValue({
          name: 'item',
          summary: search.Summary.GROUP,
        });
        const memoRaw = res.getValue({
          name: String(memoField || 'memo'),
          summary: search.Summary.GROUP,
        });
        const memo = String(memoRaw || '').trim();
        if (!itemId || !memo) return;

        const total = toNumber(
          res.getValue({ name: amountField, summary: search.Summary.SUM }),
        );
        const key = `${String(itemId)}|||${memo}`;
        totalsByKey[key] = (totalsByKey[key] ?? 0) + total;
      });
    };

    // Memo field differs across accounts sometimes; try both.
    const memoFields = ['memo', 'description'];
    const attempts = [
      { amountField: 'amount', familyFilterMode: 'join' },
      { amountField: 'amount', familyFilterMode: 'formula' },
      { amountField: 'netamount', familyFilterMode: 'join' },
      { amountField: 'netamount', familyFilterMode: 'formula' },
    ];
    for (const attempt of attempts) {
      for (const memoField of memoFields) {
        try {
          trySearch(attempt.amountField, memoField, attempt);
          return totalsByKey;
        } catch (e) {
          Object.keys(totalsByKey).forEach((k) => delete totalsByKey[k]);
          // try next
        }
      }
    }

    return totalsByKey;
  }

  function buildMilestoneKey(itemId, memo) {
    const item = itemId != null ? String(itemId) : '';
    const desc = String(memo || '').trim();
    if (!item || !desc) return '';
    return `${item}|||${desc}`;
  }

  function getRevenueAmountByMilestone(projectId, { cutoffDate } = {}) {
    const phaseById = {};
    const phaseSearch = search.create({
      type: 'customrecord_pm_project_phase',
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        ['custrecord_pm_phase_parent', 'anyof', String(projectId)],
      ],
      columns: [
        search.createColumn({ name: 'internalid' }),
        search.createColumn({ name: 'custrecord_pm_phase_milestone' }),
        search.createColumn({ name: 'custrecord_pm_phase_milestone_desc' }),
      ],
    });

    getAllResults(phaseSearch).forEach((res) => {
      const phaseId = res.getValue({ name: 'internalid' });
      const itemId = res.getValue({ name: 'custrecord_pm_phase_milestone' });
      const memo = res.getValue({ name: 'custrecord_pm_phase_milestone_desc' });
      const key = buildMilestoneKey(itemId, memo);
      if (!phaseId || !key) return;
      phaseById[String(phaseId)] = key;
    });

    if (!Object.keys(phaseById).length) return {};

    const projectName = getProjectNameById(projectId);
    const normalizedName = String(projectName || '').trim();
    if (!normalizedName) return {};

    const revenueAccountIds = getProjectRevenueAccountIds(projectId, {
      includeCurrent: true,
    });
    const accountFilterSql = buildExpenseAccountFilterSql(revenueAccountIds);
    if (!accountFilterSql) return {};

    const safeName = toSqlTextLiteral(normalizedName.toLowerCase());
    const cutoffSql = toSqlDateLiteral(cutoffDate);

    // Reuse the same principle as recognized amount:
    // pick latest positive (main) rev-rec journal for the project and ignore reversal entries.
    const latestJournalSql = `
      SELECT
        t.id AS id,
        TO_CHAR(t.trandate, 'DD/MM/YYYY') AS trandate,
        SUM(
          NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)
        ) AS recognized_amount
      FROM transaction t
      INNER JOIN transactionline tl
        ON tl.transaction = t.id
      WHERE
        t.type = 'Journal'
        AND ${accountFilterSql}
        AND LOWER(BUILTIN.DF(t.cseg_project_seg)) = '${safeName}'
        AND (t.voided = 'F' OR t.voided IS NULL)
        ${cutoffSql ? `AND t.trandate <= TO_DATE('${cutoffSql}', 'YYYY-MM-DD')` : ''}
      GROUP BY t.id, t.trandate
      HAVING SUM(
        NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)
      ) > 0
      ORDER BY t.trandate DESC, id DESC
    `;

    const latestRows =
      query.runSuiteQL({ query: latestJournalSql }).asMappedResults() || [];
    const latestJournalId =
      latestRows?.[0]?.id != null ? String(latestRows[0].id) : '';
    if (!latestJournalId) return {};

    const latestJournalByPhaseSql = `
      SELECT
        tl.custcol_pm_projectphase_jnl AS phaseid,
        SUM(
          NVL(tl.creditforeignamount, 0) - NVL(tl.debitforeignamount, 0)
        ) AS amount
      FROM transactionline tl
      WHERE
        tl.transaction = ${toSqlTextLiteral(latestJournalId)}
        AND ${accountFilterSql}
        AND tl.custcol_pm_projectphase_jnl IS NOT NULL
      GROUP BY tl.custcol_pm_projectphase_jnl
    `;

    const phaseRows =
      query.runSuiteQL({ query: latestJournalByPhaseSql }).asMappedResults() ||
      [];
    const totalsByMilestone = {};
    phaseRows.forEach((row) => {
      const phaseId = row?.phaseid != null ? String(row.phaseid) : '';
      if (!phaseId) return;
      const milestoneKey = phaseById[phaseId];
      if (!milestoneKey) return;
      const amount = toNumber(row?.amount);
      totalsByMilestone[milestoneKey] =
        toNumber(totalsByMilestone[milestoneKey]) + amount;
    });

    return totalsByMilestone;
  }

  function getInvoiceLineTotalsByMilestone({ salesOrderIds, cutoffDate } = {}) {
    const totalsByKey = {};
    const ids = Array.isArray(salesOrderIds)
      ? salesOrderIds.filter(Boolean).map(String)
      : [];
    if (!ids.length) return totalsByKey;

    const nsDate = toNsDateFilter(cutoffDate);

    const trySearch = (amountField, memoField) => {
      const filters = [
        ['mainline', 'is', 'F'],
        'AND',
        ['taxline', 'is', 'F'],
        'AND',
        ['shipping', 'is', 'F'],
        'AND',
        ['item', 'noneof', '@NONE@'],
        'AND',
        ['type', 'anyof', 'CustInvc'],
      ];
      if (nsDate) {
        filters.push('AND', ['trandate', 'onorbefore', nsDate]);
      }
      filters.push('AND', ['createdfrom', 'anyof', ...ids]);

      const suiteSearch = search.create({
        type: 'transaction',
        filters: [
          ...filters,
          'AND',
          [String(memoField || 'memo'), 'isnotempty', ''],
        ],
        columns: [
          search.createColumn({
            name: 'item',
            summary: search.Summary.GROUP,
          }),
          search.createColumn({
            name: String(memoField || 'memo'),
            summary: search.Summary.GROUP,
          }),
          search.createColumn({
            name: amountField,
            summary: search.Summary.SUM,
          }),
        ],
      });

      getAllResults(suiteSearch).forEach((res) => {
        const itemId = res.getValue({
          name: 'item',
          summary: search.Summary.GROUP,
        });
        const memo = res.getValue({
          name: String(memoField || 'memo'),
          summary: search.Summary.GROUP,
        });
        const key = buildMilestoneKey(itemId, memo);
        if (!key) return;
        const total = Math.abs(
          toNumber(
            res.getValue({ name: amountField, summary: search.Summary.SUM }),
          ),
        );
        totalsByKey[key] = toNumber(totalsByKey[key]) + total;
      });
    };

    const memoFields = ['memo', 'description'];
    const amountFields = ['amount', 'netamount'];
    for (const amountField of amountFields) {
      for (const memoField of memoFields) {
        try {
          trySearch(amountField, memoField);
          return totalsByKey;
        } catch (e) {
          Object.keys(totalsByKey).forEach((k) => delete totalsByKey[k]);
        }
      }
    }
    return totalsByKey;
  }

  function getCreditMemoLineTotalsByMilestone({
    salesOrderIds,
    cutoffDate,
  } = {}) {
    const totalsByKey = {};
    const ids = Array.isArray(salesOrderIds)
      ? salesOrderIds.filter(Boolean).map(String)
      : [];
    if (!ids.length) return totalsByKey;

    const nsDate = toNsDateFilter(cutoffDate);

    const trySearch = (amountField, memoField) => {
      const filters = [
        ['mainline', 'is', 'F'],
        'AND',
        ['taxline', 'is', 'F'],
        'AND',
        ['shipping', 'is', 'F'],
        'AND',
        ['item', 'noneof', '@NONE@'],
        'AND',
        ['type', 'anyof', 'CustCred'],
      ];
      if (nsDate) {
        filters.push('AND', ['trandate', 'onorbefore', nsDate]);
      }
      filters.push(
        'AND',
        [
          ['createdfrom.createdfrom', 'anyof', ...ids],
          'OR',
          ['appliedtotransaction.createdfrom', 'anyof', ...ids],
        ],
        'AND',
        [String(memoField || 'memo'), 'isnotempty', ''],
      );

      const suiteSearch = search.create({
        type: 'transaction',
        settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
        filters,
        columns: [
          search.createColumn({
            name: 'item',
            summary: search.Summary.GROUP,
          }),
          search.createColumn({
            name: String(memoField || 'memo'),
            summary: search.Summary.GROUP,
          }),
          search.createColumn({
            name: amountField,
            summary: search.Summary.SUM,
          }),
        ],
      });

      getAllResults(suiteSearch).forEach((res) => {
        const itemId = res.getValue({
          name: 'item',
          summary: search.Summary.GROUP,
        });
        const memo = res.getValue({
          name: String(memoField || 'memo'),
          summary: search.Summary.GROUP,
        });
        const key = buildMilestoneKey(itemId, memo);
        if (!key) return;
        const total = Math.abs(
          toNumber(
            res.getValue({ name: amountField, summary: search.Summary.SUM }),
          ),
        );
        totalsByKey[key] = toNumber(totalsByKey[key]) + total;
      });
    };

    const memoFields = ['memo', 'description'];
    const amountFields = ['amount', 'netamount'];
    for (const amountField of amountFields) {
      for (const memoField of memoFields) {
        try {
          trySearch(amountField, memoField);
          return totalsByKey;
        } catch (e) {
          Object.keys(totalsByKey).forEach((k) => delete totalsByKey[k]);
        }
      }
    }
    return totalsByKey;
  }

  function getProjectFinancials(projectId, options) {
    if (!projectId) return null;

    const opts = options || {};
    const salesOrderIds = getProjectSalesOrderIds(projectId);
    const cutoffDate =
      opts.cutoffDate || getEffectiveCutoffDate(projectId) || getEffectiveCutoffDate();

    const projectTotal = getPhaseTotal(projectId);
    const soTotal = getSalesOrderLineTotal({ salesOrderIds });

    const phaseByMilestone = getPhaseTotalsByMilestone(projectId);
    const soByMilestone = getSalesOrderLineTotalsByMilestone({ salesOrderIds });
    const revenueByMilestone = getRevenueAmountByMilestone(projectId, {
      cutoffDate,
    });
    const invoiceByMilestone = getInvoiceLineTotalsByMilestone({
      salesOrderIds,
      cutoffDate,
    });
    const creditMemoByMilestone = getCreditMemoLineTotalsByMilestone({
      salesOrderIds,
      cutoffDate,
    });

    const allMilestoneKeys = new Set([
      ...Object.keys(phaseByMilestone),
      ...Object.keys(soByMilestone),
      ...Object.keys(revenueByMilestone),
      ...Object.keys(invoiceByMilestone),
      ...Object.keys(creditMemoByMilestone),
    ]);
    const milestoneSummary = Array.from(allMilestoneKeys).map((key) => {
      const parts = String(key || '').split('|||');
      const itemId = parts.length ? parts[0] : '';
      const memo = parts.length > 1 ? parts.slice(1).join('|||') : '';
      const phase = toNumber(phaseByMilestone[key] ?? 0);
      const so = toNumber(soByMilestone[key] ?? 0);
      const revenueAmount = toNumber(revenueByMilestone[key] ?? 0);
      const invoicedAmount =
        toNumber(invoiceByMilestone[key] ?? 0) -
        toNumber(creditMemoByMilestone[key] ?? 0);
      return {
        key: String(key),
        itemId: itemId || null,
        memo: memo || '',
        label: memo || 'Unassigned',
        phaseTotal: phase,
        soTotal: so,
        revenueAmount,
        invoicedAmount,
        variance: phase - so,
      };
    });

    milestoneSummary.sort((a, b) =>
      String(a.label || '').localeCompare(String(b.label || '')),
    );

    const relatedBase = getRelatedSalesOrdersInvoicesAndJournals(projectId, {});
    const relatedSalesOrders = relatedBase.salesOrders || [];
    const relatedInvoices = relatedBase.invoices || [];
    const relatedPurchaseOrders = relatedBase.purchaseOrders || [];
    const relatedVendorBills = relatedBase.vendorBills || [];
    const relatedInventoryAdjustments = relatedBase.inventoryAdjustments || [];
    const relatedCreditMemos = getCreditMemoApplicationsForSalesOrders(
      relatedSalesOrders.map((row) => row.id),
    ).creditMemos;
    const relatedJournals = relatedBase.journals || [];
    const revenueRecognition = getProjectRevenueRecognitionFromJournals(
      projectId,
      { cutoffDate },
    );

    return {
      projectId: String(projectId),
      totals: {
        projectTotal,
        soTotal,
        variance: projectTotal - soTotal,
        recognizedAmount: toNumber(revenueRecognition?.amount || 0),
      },
      revenueRecognition,
      deptSummary: [],
      milestoneSummary,
      salesOrderIds,
      relatedRecords: {
        salesOrders: relatedSalesOrders,
        invoices: relatedInvoices,
        purchaseOrders: relatedPurchaseOrders,
        vendorBills: relatedVendorBills,
        inventoryAdjustments: relatedInventoryAdjustments,
        creditMemos: relatedCreditMemos,
        journals: relatedJournals,
      },
    };
  }

  function getProjectCostTotals(projectId, options) {
    if (!projectId) return { subcontractorCost: 0, materialCost: 0 };
    const related = getRelatedSalesOrdersInvoicesAndJournals(
      projectId,
      options || {},
    );
    const subcontractorCost = (
      Array.isArray(related?.vendorBills) ? related.vendorBills : []
    ).reduce((sum, row) => sum + toNumber(row?.amount || 0), 0);
    const materialCost = (
      Array.isArray(related?.inventoryAdjustments)
        ? related.inventoryAdjustments
        : []
    ).reduce((sum, row) => sum + toNumber(row?.amount || 0), 0);
    return {
      subcontractorCost: toNumber(subcontractorCost),
      materialCost: toNumber(materialCost),
    };
  }

  return {
    getProjectStatus,
    getProjectStatusName,
    getProjectSalesOrderIds,
    getProjectSalesOrderIdsByProject,
    getProjectRevenueRecognitionFromJournalsByProject,
    getBilledToDateByProject,
    getProjectFinancials,
    getProjectCostTotals,
    getGrossInvoicedAmountForSalesOrders,
    getNetInvoicedAmountForSalesOrders,
    getProjectRevenueRecognitionFromJournals,
    getRevenueRecognizedByDepartment,
    getRevenueRecognizedByPhase,
    toNsDateFilter,
  };
});
