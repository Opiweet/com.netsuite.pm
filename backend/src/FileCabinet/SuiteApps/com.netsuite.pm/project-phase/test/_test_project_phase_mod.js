/**
 * Replicated from `modules/project_phase_mod.js` (define -> require).
 * This is meant to be loaded in Chrome console with RequireJS.
 *
 * After load:
 *   window.pm_project_phase_mod.getProjectLoad(projectId)
 */
/* global require */
require(["N/search", "N/query", "N/record"], (search, query, record) => {
  // NOTE: This module is used both for listing and for Suitelet mutations (create/update),
  // so keep dependencies minimal.
  function getAllResults(suiteSearch) {
    const results = [];
    const paged = suiteSearch.runPaged({ pageSize: 1000 });
    paged.pageRanges.forEach((range) => {
      const page = paged.fetch({ index: range.index });
      page.data.forEach((res) => results.push(res));
    });
    return results;
  }

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function monthToNumber(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const asNum = parseInt(raw, 10);
    if (!isNaN(asNum) && asNum >= 1 && asNum <= 12) return asNum;

    const key = raw.slice(0, 3).toLowerCase();
    const map = {
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
    return map[key] ?? null;
  }

  function normalizeSalesOrderLabel(value) {
    if (!value) return value;
    return String(value)
      .replace(/^Sales Order\s*#\s*/i, "")
      .trim();
  }

  function safeSetValue(rec, fieldId, value) {
    try {
      rec.setValue({ fieldId, value: value == null ? null : value });
    } catch (e) {
      // ignore
    }
  }

  function getProjectName(projectId) {
    if (!projectId) return null;
    try {
      const fields = search.lookupFields({
        type: "customrecord_pm_projects",
        id: String(projectId),
        columns: ["name"],
      });
      const name = String(fields?.name || "").trim();
      return name || null;
    } catch (e) {
      return null;
    }
  }

  function savePhase({ projectId, phase } = {}) {
    if (!projectId) throw new Error("projectId is required");
    if (!phase || typeof phase !== "object")
      throw new Error("phase payload is required");

    const isUpdate = Boolean(phase.id);
    const rec = isUpdate
      ? record.load({
          type: "customrecord_pm_project_phase",
          id: String(phase.id),
        })
      : record.create({ type: "customrecord_pm_project_phase" });

    if (!isUpdate)
      safeSetValue(rec, "custrecord_pm_phase_parent", String(projectId));

    if (phase.name != null)
      safeSetValue(rec, "name", String(phase.name || "").trim());
    if ("departmentId" in phase)
      safeSetValue(rec, "custrecord_pm_phase_dept", phase.departmentId);
    if ("milestoneId" in phase)
      safeSetValue(rec, "custrecord_pm_phase_milestone", phase.milestoneId);
    if ("milestoneDesc" in phase)
      safeSetValue(
        rec,
        "custrecord_pm_phase_milestone_desc",
        String(phase.milestoneDesc || "").trim(),
      );
    if ("statusId" in phase)
      safeSetValue(rec, "custrecord_pm_phase_status", phase.statusId);
    if ("definedQty" in phase)
      safeSetValue(rec, "custrecord_pm_phase_qty", phase.definedQty);
    if ("rate" in phase)
      safeSetValue(rec, "custrecord_pm_phase_rate", phase.rate);

    const id = rec.save();
    return { projectId: String(projectId), phaseId: String(id) };
  }

  function savePhases({ projectId, phases } = {}) {
    if (!projectId) throw new Error("projectId is required");
    const rows = Array.isArray(phases) ? phases : [];
    const saved = [];
    rows.forEach((phase) => saved.push(savePhase({ projectId, phase })));
    return { projectId: String(projectId), saved };
  }

  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function parseDateAny(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

    const raw = String(value).trim();
    if (!raw) return null;

    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      let day = a;
      let month = b;
      if (a <= 12 && b > 12) {
        day = b;
        month = a;
      }
      const d = new Date(year, month - 1, day);
      return isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  function monthsBetweenInclusive(startDate, endDate) {
    const s = parseDateAny(startDate);
    const e = parseDateAny(endDate);
    if (!s || !e) return 0;
    const diff =
      (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    if (diff < 0) return 0;
    return diff + 1;
  }

  function getCompanyTimeZone() {
    // Test stub: logic is exercised elsewhere; default to local timezone.
    return null;
  }

  function getYearMonthInTimeZone(date, timeZone) {
    const d = date instanceof Date ? date : new Date();
    if (!timeZone) return { year: d.getFullYear(), month: d.getMonth() + 1 };
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(d);
      const year = parseInt(
        parts.find((p) => p.type === "year")?.value || "",
        10,
      );
      const month = parseInt(
        parts.find((p) => p.type === "month")?.value || "",
        10,
      );
      if (Number.isFinite(year) && Number.isFinite(month))
        return { year, month };
    } catch (e) {
      // fall back
    }
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function getCurrentCompanyMonthYear() {
    return getYearMonthInTimeZone(new Date(), getCompanyTimeZone());
  }

  function getProjectInfo(projectId) {
    try {
      const fields = search.lookupFields({
        type: "customrecord_pm_projects",
        id: String(projectId),
        columns: [
          "custrecord_pm_project_startdate",
          "custrecord_pm_project_enddate",
          "custrecord_pm_project_status",
        ],
      });

      const rawStatusName =
        fields?.custrecord_pm_project_status?.[0]?.text ||
        fields?.custrecord_pm_project_status?.[0]?.value ||
        null;

      return {
        startDate: fields?.custrecord_pm_project_startdate || null,
        endDate: fields?.custrecord_pm_project_enddate || null,
        statusName: normalizeProjectStatus(rawStatusName),
        rawStatusName,
      };
    } catch (e) {
      return {
        startDate: null,
        endDate: null,
        statusName: null,
        rawStatusName: null,
      };
    }
  }

  function normalizeProjectStatus(statusName) {
    const raw = String(statusName || "").trim();
    const key = raw.toLowerCase();

    if (!key) return "Draft";
    if (key.includes("draft")) return "Draft";
    if (key.includes("active")) return "Active";
    if (key.includes("completed")) return "Completed";
    if (key.includes("close")) return "Close";
    if (key.includes("closed")) return "Close";

    if (key.includes("approved")) return "Active";
    if (key.includes("pending")) return "Draft";
    if (key.includes("reject")) return "Draft";

    return "Draft";
  }

  function getProjectPhaseRollups() {
    const contractValueCol = search.createColumn({
      name: "formulanumeric",
      summary: search.Summary.SUM,
      formula:
        "(CASE WHEN {custrecord_pm_phase_qty} IS NULL THEN 0 ELSE {custrecord_pm_phase_qty} END) * (CASE WHEN {custrecord_pm_phase_rate} IS NULL THEN 0 ELSE {custrecord_pm_phase_rate} END)",
    });
    const totalQtyCol = search.createColumn({
      name: "formulanumeric",
      summary: search.Summary.SUM,
      formula:
        "(CASE WHEN {custrecord_pm_phase_qty} IS NULL THEN 0 ELSE {custrecord_pm_phase_qty} END)",
    });

    const suiteSearch = search.create({
      type: "customrecord_pm_project_phase",
      filters: [
        ["isinactive", "is", "F"],
        "AND",
        ["custrecord_pm_phase_parent", "noneof", "@NONE@"],
      ],
      columns: [
        search.createColumn({
          name: "custrecord_pm_phase_parent",
          summary: search.Summary.GROUP,
        }),
        search.createColumn({
          name: "internalid",
          summary: search.Summary.COUNT,
        }),
        contractValueCol,
        totalQtyCol,
      ],
    });

    const rollupsByProjectId = {};
    getAllResults(suiteSearch).forEach((res) => {
      const projectId = res.getValue({
        name: "custrecord_pm_phase_parent",
        summary: search.Summary.GROUP,
      });
      if (!projectId) return;
      const phaseCountRaw = res.getValue({
        name: "internalid",
        summary: search.Summary.COUNT,
      });
      const contractValueRaw = res.getValue(contractValueCol);
      const totalQtyRaw = res.getValue(totalQtyCol);

      rollupsByProjectId[String(projectId)] = {
        phasesCount: Math.max(
          0,
          parseInt(String(phaseCountRaw || "0"), 10) || 0,
        ),
        contractValue: toNumber(contractValueRaw),
        totalQty: toNumber(totalQtyRaw),
      };
    });

    return rollupsByProjectId;
  }

  function getProjectActualRevPlanRollups() {
    const current = getCurrentCompanyMonthYear();
    const currentMonth = current?.month ?? null;
    const currentYear = current?.year ?? null;
    const companyTz = getCompanyTimeZone();

    const columns = [
      search.createColumn({
        name: "custrecord_pm_phase_parent",
        join: "custrecord_pm_revplan_parent",
        summary: search.Summary.GROUP,
      }),
      search.createColumn({
        name: "custrecord_pm_revplan_period",
        summary: search.Summary.GROUP,
      }),
      search.createColumn({
        name: "custrecord_pm_revplan_type",
        summary: search.Summary.GROUP,
      }),
      search.createColumn({
        name: "custrecord_pm_revplan_qty",
        summary: search.Summary.SUM,
      }),
      search.createColumn({
        name: "formulanumeric",
        summary: search.Summary.SUM,
        formula:
          "(CASE WHEN {custrecord_pm_revplan_qty} IS NULL THEN 0 ELSE {custrecord_pm_revplan_qty} END) * (CASE WHEN {custrecord_pm_revplan_parent.custrecord_pm_phase_rate} IS NULL THEN 0 ELSE {custrecord_pm_revplan_parent.custrecord_pm_phase_rate} END)",
      }),
    ];

    const baseFilters = [["isinactive", "is", "F"]];
    const filterVariants = [
      [...baseFilters, "AND", ["custrecord_pm_revplan_type", "is", "Actual"]],
      baseFilters,
    ];

    let results = [];
    for (const filters of filterVariants) {
      try {
        const suiteSearch = search.create({
          type: "customrecord_pm_revenue_plan",
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
        name: "custrecord_pm_phase_parent",
        join: "custrecord_pm_revplan_parent",
        summary: search.Summary.GROUP,
      });
      if (!projectId) return;

      const typeText =
        res.getText?.({
          name: "custrecord_pm_revplan_type",
          summary: search.Summary.GROUP,
        }) ||
        res.getValue({
          name: "custrecord_pm_revplan_type",
          summary: search.Summary.GROUP,
        }) ||
        "";
      if (String(typeText).toLowerCase() !== "actual") return;

      const periodRaw = res.getValue({
        name: "custrecord_pm_revplan_period",
        summary: search.Summary.GROUP,
      });
      const periodDate = parseDateAny(periodRaw);
      const ym = periodDate
        ? getYearMonthInTimeZone(periodDate, companyTz)
        : null;
      const month = ym?.month ?? null;
      const year = ym?.year ?? null;

      const qtySum = toNumber(
        res.getValue({
          name: "custrecord_pm_revplan_qty",
          summary: search.Summary.SUM,
        }),
      );
      const amountSum = toNumber(
        res.getValue({ name: "formulanumeric", summary: search.Summary.SUM }),
      );

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

    return rollupsByProjectId;
  }

  function getProjects() {
    const rollupsByProjectId = getProjectPhaseRollups();
    const actualRevPlanRollupsByProjectId = getProjectActualRevPlanRollups();

    const suiteSearch = search.create({
      type: "customrecord_pm_projects",
      filters: [["isinactive", "is", "F"]],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "name", sort: search.Sort.ASC }),
        // Project title is stored in the record `name` now (no altname field).
        search.createColumn({ name: "custrecord_pm_project_desc" }),
        search.createColumn({ name: "custrecord_pm_project_customer" }),
        search.createColumn({ name: "custrecord_pm_project_manager" }),
        search.createColumn({ name: "custrecord_pm_project_status" }),
        search.createColumn({ name: "custrecord_pm_project_startdate" }),
        search.createColumn({ name: "custrecord_pm_project_enddate" }),
        search.createColumn({ name: "lastmodified" }),
      ],
    });

    return getAllResults(suiteSearch).map((res) => {
      const id = String(res.getValue({ name: "internalid" }));
      const rollup = rollupsByProjectId[id] || {
        phasesCount: 0,
        contractValue: 0,
        totalQty: 0,
      };
      const actualRollup = actualRevPlanRollupsByProjectId[id] || {
        qtyCompleted: 0,
        recognizedPrev: 0,
        recognizedThisMonth: 0,
      };

      const title = res.getValue({ name: "name" }) || "";
      const rawStatusName =
        res.getText({ name: "custrecord_pm_project_status" }) || null;
      const statusName = normalizeProjectStatus(rawStatusName);

      return {
        id,
        // Deprecated: keep `ref` for backward compatibility but it mirrors title.
        ref: title,
        title,
        description:
          res.getValue({ name: "custrecord_pm_project_desc" }) || null,
        customerId:
          res.getValue({ name: "custrecord_pm_project_customer" }) || null,
        customerName:
          res.getText({ name: "custrecord_pm_project_customer" }) || null,
        projectManagerId:
          res.getValue({ name: "custrecord_pm_project_manager" }) || null,
        projectManagerName:
          res.getText({ name: "custrecord_pm_project_manager" }) || null,
        statusId:
          res.getValue({ name: "custrecord_pm_project_status" }) || null,
        statusName,
        rawStatusName,
        startDate:
          res.getValue({ name: "custrecord_pm_project_startdate" }) || null,
        endDate:
          res.getValue({ name: "custrecord_pm_project_enddate" }) || null,
        lastModified: res.getValue({ name: "lastmodified" }) || null,
        phasesCount: rollup.phasesCount,
        contractValue: rollup.contractValue,
        totalQty: rollup.totalQty,
        qtyCompleted: actualRollup.qtyCompleted,
        recognizedPrev: actualRollup.recognizedPrev,
        recognizedThisMonth: actualRollup.recognizedThisMonth,
      };
    });
  }

  function getProjectPhases(projectId) {
    if (!projectId) return [];
    const projectInfo = getProjectInfo(projectId);
    const desiredPlansPerPhase = monthsBetweenInclusive(
      projectInfo.startDate,
      projectInfo.endDate,
    );

    const suiteSearch = search.create({
      type: "customrecord_pm_project_phase",
      filters: [
        ["isinactive", "is", "F"],
        "AND",
        ["custrecord_pm_phase_parent", "anyof", String(projectId)],
      ],
      columns: [
        search.createColumn({ name: "internalid" }),
        search.createColumn({ name: "name", sort: search.Sort.ASC }),
        search.createColumn({ name: "custrecord_pm_phase_dept" }),
        search.createColumn({ name: "custrecord_pm_phase_status" }),
        search.createColumn({ name: "custrecord_pm_phase_milestone" }),
        search.createColumn({ name: "custrecord_pm_phase_milestone_desc" }),
        search.createColumn({ name: "custrecord_pm_phase_note" }),
        search.createColumn({ name: "custrecord_pm_phase_qty" }),
        search.createColumn({ name: "custrecord_pm_phase_rate" }),
        search.createColumn({ name: "lastmodified" }),
      ],
    });

    const results = getAllResults(suiteSearch);
    const phaseIds = results
      .map((r) => r.getValue({ name: "internalid" }))
      .filter(Boolean)
      .map(String);

    const revPlanCountByPhaseId = {};
    if (phaseIds.length) {
      const chunks = chunkArray(phaseIds, 900);
      chunks.forEach((ids) => {
        const planSearch = search.create({
          type: "customrecord_pm_revenue_plan",
          filters: [["custrecord_pm_revplan_parent", "anyof", ...ids]],
          columns: [
            search.createColumn({
              name: "custrecord_pm_revplan_parent",
              summary: search.Summary.GROUP,
            }),
            search.createColumn({
              name: "internalid",
              summary: search.Summary.COUNT,
            }),
          ],
        });

        getAllResults(planSearch).forEach((res) => {
          const pid = res.getValue({
            name: "custrecord_pm_revplan_parent",
            summary: search.Summary.GROUP,
          });
          const cnt = res.getValue({
            name: "internalid",
            summary: search.Summary.COUNT,
          });
          if (!pid) return;
          revPlanCountByPhaseId[String(pid)] =
            (revPlanCountByPhaseId[String(pid)] ?? 0) +
            (parseInt(String(cnt || "0"), 10) || 0);
        });
      });
    }

    return results.map((res) => {
      const id = String(res.getValue({ name: "internalid" }));
      const numOfPlans = revPlanCountByPhaseId[id] ?? 0;
      const numOfMissingPlans = Math.max(0, desiredPlansPerPhase - numOfPlans);
      const milestoneDesc = String(
        res.getValue({ name: "custrecord_pm_phase_milestone_desc" }) || "",
      ).trim();
      const milestoneText =
        milestoneDesc ||
        res.getText({ name: "custrecord_pm_phase_milestone" }) ||
        null;
      const note = String(
        res.getValue({ name: "custrecord_pm_phase_note" }) || "",
      ).trim();
      return {
        id,
        name: res.getValue({ name: "name" }) || "",
        departmentId:
          res.getValue({ name: "custrecord_pm_phase_dept" }) || null,
        department: res.getText({ name: "custrecord_pm_phase_dept" }) || null,
        statusId: res.getValue({ name: "custrecord_pm_phase_status" }) || null,
        status: res.getText({ name: "custrecord_pm_phase_status" }) || null,
        milestoneId:
          res.getValue({ name: "custrecord_pm_phase_milestone" }) || null,
        milestone: milestoneText,
        milestoneDesc: milestoneDesc || null,
        note: note || null,
        definedQty: res.getValue({ name: "custrecord_pm_phase_qty" }) || null,
        rate: res.getValue({ name: "custrecord_pm_phase_rate" }) || null,
        // Not stored on the record type currently; keep for UI compatibility.
        startDate: null,
        endDate: null,
        recognizedPct: 0,
        lastModified: res.getValue({ name: "lastmodified" }) || null,
        // For existing UI which shows `milestone || serviceItem`
        serviceItem: milestoneText,
        revPlansCount: numOfPlans,
        numOfPlans,
        numOfMissingPlans,
        desiredPlansPerPhase,
      };
    });
  }

  function monthKey(year, month) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return "";
    return `${String(y)}-${String(m).padStart(2, "0")}`;
  }

  function monthLabel(year, month) {
    const names = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const idx = Number(month) - 1;
    const name = idx >= 0 && idx < names.length ? names[idx] : String(month);
    return `${name} ${String(year)}`;
  }

  function iterateMonthsInclusive(startDate, endDate) {
    const s = parseDateAny(startDate);
    const e = parseDateAny(endDate);
    if (!s || !e) return [];

    const start = new Date(s.getFullYear(), s.getMonth(), 1);
    const end = new Date(e.getFullYear(), e.getMonth(), 1);
    const out = [];

    if (start.getTime() > end.getTime()) return out;

    const cur = new Date(start);
    while (cur.getTime() <= end.getTime()) {
      out.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }

  function getProjectRevPlans(projectId) {
    if (!projectId) return null;

    const projectInfo = getProjectInfo(projectId);
    const current = getCurrentCompanyMonthYear();
    const companyTz = getCompanyTimeZone();

    const expectedMonths = iterateMonthsInclusive(
      projectInfo?.startDate,
      projectInfo?.endDate,
    );
    const expectedKeys = new Set(
      expectedMonths.map((m) => monthKey(m.year, m.month)).filter(Boolean),
    );

    const phases = getProjectPhases(projectId);
    const phaseIds = phases
      .map((p) => p?.id)
      .filter(Boolean)
      .map(String);

    const normalizeRevPlanStatusKey = (value) => {
      const raw = String(value || "")
        .trim()
        .toLowerCase();
      if (!raw) return "";
      const cleaned = raw
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_");
      if (cleaned === "revrec_ready") return "rev_rec_ready";
      return cleaned;
    };

    const statusRank = {
      open: 1,
      rev_rec_ready: 2,
      completed: 3,
      cancelled: 4,
    };

    const statusLabelForKey = (key) => {
      if (key === "open") return "Open";
      if (key === "rev_rec_ready") return "Rev Rec Ready";
      if (key === "completed") return "Completed";
      if (key === "cancelled") return "Cancelled";
      return String(key || "").trim() || "Open";
    };

    const byPhaseMonth = {};
    const monthHasActual = {};
    const monthHasForecast = {};
    const monthStatusByKey = {};
    const actualQtyByPhaseId = {};
    let monthMismatch = false;

    if (phaseIds.length) {
      const chunks = chunkArray(phaseIds, 900);
      chunks.forEach((ids) => {
        const suiteSearch = search.create({
          type: "customrecord_pm_revenue_plan",
          filters: [
            ["isinactive", "is", "F"],
            "AND",
            ["custrecord_pm_revplan_parent", "anyof", ...ids],
          ],
          columns: [
            search.createColumn({ name: "custrecord_pm_revplan_parent" }),
            search.createColumn({ name: "custrecord_pm_revplan_period" }),
            search.createColumn({ name: "custrecord_pm_revplan_status" }),
            search.createColumn({ name: "custrecord_pm_revplan_type" }),
            search.createColumn({ name: "custrecord_pm_revplan_qty" }),
          ],
        });

        getAllResults(suiteSearch).forEach((res) => {
          const phaseId = res.getValue({
            name: "custrecord_pm_revplan_parent",
          });
          if (!phaseId) return;

          const periodRaw = res.getValue({
            name: "custrecord_pm_revplan_period",
          });
          const periodDate = parseDateAny(periodRaw);
          const ym = periodDate
            ? getYearMonthInTimeZone(periodDate, companyTz)
            : null;
          const key = ym ? monthKey(ym.year, ym.month) : "";
          if (!key) return;

          if (expectedKeys.size && !expectedKeys.has(key)) monthMismatch = true;

          const statusText =
            res.getText?.({ name: "custrecord_pm_revplan_status" }) ||
            res.getValue({ name: "custrecord_pm_revplan_status" }) ||
            "";
          const statusKeyRaw = normalizeRevPlanStatusKey(statusText);
          const statusKey = statusRank[statusKeyRaw] ? statusKeyRaw : "";
          if (statusKey) {
            const prev = monthStatusByKey[key] || "open";
            const prevRank = statusRank[prev] || 0;
            const curRank = statusRank[statusKey] || 0;
            if (curRank > prevRank) monthStatusByKey[key] = statusKey;
          }

          const typeText =
            res.getText?.({ name: "custrecord_pm_revplan_type" }) ||
            res.getValue({ name: "custrecord_pm_revplan_type" }) ||
            "";
          const isActual = String(typeText).toLowerCase() === "actual";

          const qty = toNumber(
            res.getValue({ name: "custrecord_pm_revplan_qty" }),
          );

          const pid = String(phaseId);
          if (!byPhaseMonth[pid]) byPhaseMonth[pid] = {};
          if (!byPhaseMonth[pid][key])
            byPhaseMonth[pid][key] = { actual: 0, planned: 0 };
          if (isActual) {
            byPhaseMonth[pid][key].actual += qty;
            actualQtyByPhaseId[pid] = (actualQtyByPhaseId[pid] || 0) + qty;
            monthHasActual[key] = true;
          } else {
            byPhaseMonth[pid][key].planned += qty;
            monthHasForecast[key] = true;
          }
        });
      });
    }

    const months = expectedMonths
      .map((m) => {
        const key = monthKey(m.year, m.month);
        const isCurrent =
          current?.year === m.year && current?.month === m.month;
        const type = monthHasActual[key] ? "actual" : "forecast";
        const statusKey = monthStatusByKey[key] || "open";
        return {
          key,
          year: m.year,
          month: m.month,
          label: monthLabel(m.year, m.month),
          statusKey,
          statusLabel: statusLabelForKey(statusKey),
          status: statusLabelForKey(statusKey),
          type,
          isCurrent,
        };
      })
      .filter((m) => m.key);

    const rows = [];
    let totalAmount = 0;
    let recognizedToDate = 0;

    phases.forEach((phase) => {
      const pid = String(phase?.id || "");
      const qty = toNumber(phase?.definedQty);
      const rate = toNumber(phase?.rate);
      const monthsMap = {};

      months.forEach((m) => {
        const bucket = byPhaseMonth?.[pid]?.[m.key] || {
          actual: 0,
          planned: 0,
        };
        const value = m.type === "actual" ? bucket.actual : bucket.planned;
        monthsMap[m.key] = Number.isFinite(value) ? value : 0;
      });

      const milestoneDesc =
        phase?.milestoneDesc || phase?.milestone || phase?.serviceItem || "";
      const phaseTotal = qty * rate;
      const recognizedQty = toNumber(actualQtyByPhaseId[pid] || 0);
      const phaseRecognized = recognizedQty * rate;

      totalAmount += phaseTotal;
      recognizedToDate += phaseRecognized;

      rows.push({
        phaseId: pid,
        department: phase?.department || "Unassigned",
        milestone: String(milestoneDesc || "—"),
        phase: phase?.name || "",
        qty,
        rate,
        total: phaseTotal,
        notes: phase?.note || "",
        months: monthsMap,
      });
    });

    const sumInvoiceTotalsForSalesOrders = (salesOrderIds) => {
      const ids = Array.isArray(salesOrderIds)
        ? salesOrderIds
            .filter(Boolean)
            .map((id) => Number(id))
            .filter((id) => !Number.isNaN(id))
        : [];

      if (!ids.length) return 0;

      const idList = ids.join(",");

      const sql = `
        SELECT
          COALESCE(SUM(inv_sums.invoice_total), 0)
          - COALESCE(SUM(cm_sums.credit_memo_total), 0) AS net_total
        FROM transaction so
        JOIN transactionLine so_tl
          ON so_tl.transaction = so.id
          AND so_tl.mainline = 'T'
        LEFT JOIN (
          SELECT
            tl.createdfrom AS so_id,
            SUM(inv.total - COALESCE(tax.tax_total, 0)) AS invoice_total
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
          GROUP BY tl.createdfrom
        ) inv_sums ON inv_sums.so_id = so.id
        LEFT JOIN (
          SELECT
            inv_tl.createdfrom AS so_id,
            SUM(cm.total - COALESCE(tax.tax_total, 0)) AS credit_memo_total
          FROM transaction cm
          JOIN transactionLine cm_tl
            ON cm_tl.transaction = cm.id
            AND cm_tl.mainline = 'T'
          JOIN transaction inv
            ON inv.id = cm_tl.createdfrom
            AND inv.type = 'CustInvc'
          JOIN transactionLine inv_tl
            ON inv_tl.transaction = inv.id
            AND inv_tl.mainline = 'T'
          LEFT JOIN (
            SELECT transaction, SUM(foreignamount * -1) AS tax_total
            FROM transactionLine
            WHERE taxline = 'T'
            GROUP BY transaction
          ) tax ON tax.transaction = cm.id
          WHERE cm.type = 'CustCred'
          GROUP BY inv_tl.createdfrom
        ) cm_sums ON cm_sums.so_id = so.id
        WHERE so.type = 'SalesOrd'
          AND so.id IN (${idList})
      `;

      const res = query.runSuiteQL({ query: sql }).asMappedResults();

      return toNumber(res?.[0]?.net_total);
    };

    const salesOrderIds = getProjectSalesOrderIds(projectId);
    const billedToDate = sumInvoiceTotalsForSalesOrders(salesOrderIds);
    const remaining = totalAmount - recognizedToDate;

    return {
      projectId: String(projectId),
      months,
      rows,
      monthMismatch: Boolean(monthMismatch),
      summary: {
        totalAmount,
        billedToDate,
        recognizedToDate,
        remaining,
      },
    };
  }

  function getPhaseTotal(projectId) {
    if (!projectId) return 0;

    const suiteSearch = search.create({
      type: "customrecord_pm_project_phase",
      filters: [
        ["isinactive", "is", "F"],
        "AND",
        ["custrecord_pm_phase_parent", "anyof", String(projectId)],
      ],
      columns: [
        search.createColumn({
          name: "formulanumeric",
          summary: search.Summary.SUM,
          formula:
            "(CASE WHEN {custrecord_pm_phase_qty} IS NULL THEN 0 ELSE {custrecord_pm_phase_qty} END) * (CASE WHEN {custrecord_pm_phase_rate} IS NULL THEN 0 ELSE {custrecord_pm_phase_rate} END)",
        }),
      ],
    });

    const first = suiteSearch.run().getRange({ start: 0, end: 1 })?.[0] || null;
    if (!first) return 0;
    return toNumber(
      first.getValue({ name: "formulanumeric", summary: search.Summary.SUM }),
    );
  }

  function getPhaseTotalsByMilestone(projectId) {
    const totalsByKey = {};
    if (!projectId) return totalsByKey;

    const suiteSearch = search.create({
      type: "customrecord_pm_project_phase",
      filters: [
        ["isinactive", "is", "F"],
        "AND",
        ["custrecord_pm_phase_parent", "anyof", String(projectId)],
      ],
      columns: [
        search.createColumn({
          name: "custrecord_pm_phase_milestone",
          summary: search.Summary.GROUP,
        }),
        search.createColumn({
          name: "custrecord_pm_phase_milestone_desc",
          summary: search.Summary.GROUP,
        }),
        search.createColumn({
          name: "formulanumeric",
          summary: search.Summary.SUM,
          formula:
            "(CASE WHEN {custrecord_pm_phase_qty} IS NULL THEN 0 ELSE {custrecord_pm_phase_qty} END) * (CASE WHEN {custrecord_pm_phase_rate} IS NULL THEN 0 ELSE {custrecord_pm_phase_rate} END)",
        }),
      ],
    });

    getAllResults(suiteSearch).forEach((res) => {
      const itemId = res.getValue({
        name: "custrecord_pm_phase_milestone",
        summary: search.Summary.GROUP,
      });
      const memoRaw = res.getValue({
        name: "custrecord_pm_phase_milestone_desc",
        summary: search.Summary.GROUP,
      });
      const memo = String(memoRaw || "").trim();
      if (!itemId || !memo) return;
      const total = toNumber(
        res.getValue({ name: "formulanumeric", summary: search.Summary.SUM }),
      );
      const key = `${String(itemId)}|||${memo}`;
      totalsByKey[key] = (totalsByKey[key] ?? 0) + total;
    });

    return totalsByKey;
  }

  function getProjectSalesOrderIds(projectId) {
    if (!projectId) return [];
    const projectName = getProjectName(projectId);
    if (!projectName) return [];

    const suiteSearch = search.create({
      type: "salesorder",
      filters: [
        search.createFilter({
          name: "formulatext",
          formula: "LOWER({cseg_project_seg})",
          operator: search.Operator.IS,
          values: String(projectName).toLowerCase(),
        }),
        "AND",
        ["mainline", "is", "T"],
      ],
      columns: [search.createColumn({ name: "internalid" })],
    });

    const used = new Set();
    getAllResults(suiteSearch).forEach((res) => {
      const soId = res.getValue({ name: "internalid" });
      if (soId) used.add(String(soId));
    });
    return Array.from(used);
  }

  function getSalesOrderLineTotal(salesOrderIds) {
    if (!salesOrderIds || !salesOrderIds.length) return 0;
    const chunks = chunkArray(salesOrderIds.map(String), 900);

    const trySearch = (amountField) => {
      let total = 0;
      chunks.forEach((ids) => {
        const suiteSearch = search.create({
          type: "salesorder",
          filters: [
            ["internalid", "anyof", ...ids],
            "AND",
            ["mainline", "is", "F"],
            "AND",
            ["taxline", "is", "F"],
            "AND",
            ["shipping", "is", "F"],
          ],
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
        total += toNumber(value);
      });
      return total;
    };

    try {
      return trySearch("amount");
    } catch (e) {
      return trySearch("netamount");
    }
  }

  function getSalesOrderLineTotalsByMilestone(salesOrderIds) {
    const totalsByKey = {};
    if (!salesOrderIds || !salesOrderIds.length) return totalsByKey;

    const chunks = chunkArray(salesOrderIds.map(String), 900);

    const trySearch = (amountField, memoField, { serviceOnly = true } = {}) => {
      chunks.forEach((ids) => {
        const suiteSearch = search.create({
          type: "salesorder",
          filters: [
            ["internalid", "anyof", ...ids],
            "AND",
            ["mainline", "is", "F"],
            "AND",
            ["taxline", "is", "F"],
            "AND",
            ["shipping", "is", "F"],
            "AND",
            [String(memoField || "memo"), "isnotempty", ""],
            ...(serviceOnly ? ["AND", ["itemtype", "anyof", "Service"]] : []),
          ],
          columns: [
            search.createColumn({
              name: "item",
              summary: search.Summary.GROUP,
            }),
            search.createColumn({
              name: String(memoField || "memo"),
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
            name: "item",
            summary: search.Summary.GROUP,
          });
          const memoRaw = res.getValue({
            name: String(memoField || "memo"),
            summary: search.Summary.GROUP,
          });
          const memo = String(memoRaw || "").trim();
          if (!itemId || !memo) return;
          const total = toNumber(
            res.getValue({ name: amountField, summary: search.Summary.SUM }),
          );
          const key = `${String(itemId)}|||${memo}`;
          totalsByKey[key] = (totalsByKey[key] ?? 0) + total;
        });
      });
    };

    const memoFields = ["memo", "description"];
    const attempts = [
      { amountField: "amount", serviceOnly: true },
      { amountField: "amount", serviceOnly: false },
      { amountField: "netamount", serviceOnly: true },
      { amountField: "netamount", serviceOnly: false },
    ];
    for (const attempt of attempts) {
      for (const memoField of memoFields) {
        try {
          trySearch(attempt.amountField, memoField, attempt);
          return totalsByKey;
        } catch (e) {
          Object.keys(totalsByKey).forEach((k) => delete totalsByKey[k]);
        }
      }
    }

    return totalsByKey;
  }

  function getProjectFinancials(projectId) {
    if (!projectId) return null;
    const salesOrderIds = getProjectSalesOrderIds(projectId);
    const projectTotal = getPhaseTotal(projectId);
    const soTotal = getSalesOrderLineTotal(salesOrderIds);

    const phaseByMilestone = getPhaseTotalsByMilestone(projectId);
    const soByMilestone = getSalesOrderLineTotalsByMilestone(salesOrderIds);
    const allKeys = new Set([
      ...Object.keys(phaseByMilestone),
      ...Object.keys(soByMilestone),
    ]);
    const milestoneSummary = Array.from(allKeys).map((key) => {
      const parts = String(key || "").split("|||");
      const itemId = parts.length ? parts[0] : "";
      const memo = parts.length > 1 ? parts.slice(1).join("|||") : "";
      const phase = toNumber(phaseByMilestone[key] ?? 0);
      const so = toNumber(soByMilestone[key] ?? 0);
      return {
        key: String(key),
        itemId: itemId || null,
        memo: memo || "",
        label: memo || "Unassigned",
        phaseTotal: phase,
        soTotal: so,
        variance: phase - so,
      };
    });

    milestoneSummary.sort((a, b) =>
      String(a.label).localeCompare(String(b.label)),
    );

    return {
      projectId: String(projectId),
      totals: {
        projectTotal,
        soTotal,
        variance: projectTotal - soTotal,
      },
      deptSummary: [],
      milestoneSummary,
      salesOrderIds,
    };
  }

  function getProjectLoad(projectId) {
    if (!projectId) return null;

    const projectInfo = getProjectInfo(projectId);
    const phases = getProjectPhases(projectId);
    const financials = getProjectFinancials(projectId);

    const eps = 0.005;
    const hasNoVariance =
      Math.abs(toNumber(financials?.totals?.variance || 0)) <= eps;
    const hasVariance = !hasNoVariance;

    const normalizedStatus = normalizeProjectStatus(
      projectInfo?.statusName || projectInfo?.rawStatusName || "",
    );
    const isActive = normalizedStatus === "Active";
    const isDraft = normalizedStatus === "Draft";
    const isEditableStatus = isActive || isDraft;

    const pending = phases.filter(
      (p) => String(p?.status || "").toLowerCase() === "pending",
    );
    const numOfPlansToCreate = pending.reduce(
      (sum, p) =>
        sum +
        Math.max(0, parseInt(String(p?.numOfMissingPlans || "0"), 10) || 0),
      0,
    );

    const canCreatePlan =
      isActive && hasNoVariance && phases.length > 0 && numOfPlansToCreate > 0;
    const canCreatePhase = isEditableStatus;

    return {
      projectId: String(projectId),
      statusName: normalizedStatus,
      rawStatusName: projectInfo?.rawStatusName || null,
      hasNoVariance,
      hasVariance,
      canCreatePhase,
      canCreatePlan,
      numOfPlansToCreate,
      phases,
      financials,
    };
  }

  const exported = {
    getProjects,
    getProjectPhases,
    getProjectFinancials,
    getProjectLoad,
    getProjectRevPlans,
    savePhase,
    savePhases,
  };

  if (typeof window !== "undefined") window.pm_project_phase_mod = exported;
  console.log("Loaded pm_project_phase_mod", exported);
});
