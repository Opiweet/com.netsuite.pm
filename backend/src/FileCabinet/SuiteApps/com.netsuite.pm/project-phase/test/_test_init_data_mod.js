/**
 * Replicated from `modules/init_data_mod.js` (define -> require).
 * This is meant to be loaded in Chrome console with RequireJS.
 *
 * After load:
 *   window.pm_init_data_mod.getInitData()
 *   window.pm_init_data_mod.getPhaseLookups(projectId)
 */
/* global require */
require(["N/runtime", "N/search"], (runtime, search) => {
  function dbg(enabled, ...args) {
    if (!enabled) return;
    try {
      console.log("[pm][init_data_mod]", ...args);
    } catch (e) {
      // ignore
    }
  }

  let DEBUG = false;
  let DID_DEBUG_HINT = false;

  function setDebugFromArgs(debug) {
    const globalDebug =
      typeof window !== "undefined" && !!window.PM_INIT_DATA_MOD_DEBUG;
    DEBUG = !!debug || globalDebug;
    if (!DEBUG && !DID_DEBUG_HINT) {
      DID_DEBUG_HINT = true;
      try {
        console.log(
          "[pm][init_data_mod] Debug is OFF. Enable via pm_init_data_mod.getPhaseLookups(<id>, { debug: true }) or set window.PM_INIT_DATA_MOD_DEBUG = true",
        );
      } catch (e) {
        // ignore
      }
    }
  }

  function getAllResults(suiteSearch) {
    const results = [];
    const paged = suiteSearch.runPaged({ pageSize: 1000 });
    dbg(DEBUG, "getAllResults pages", paged?.pageRanges?.length ?? 0);
    paged.pageRanges.forEach((range) => {
      const page = paged.fetch({ index: range.index });
      dbg(
        DEBUG,
        "getAllResults page",
        range.index,
        "rows",
        page?.data?.length ?? 0,
      );
      page.data.forEach((res) => results.push(res));
    });
    dbg(DEBUG, "getAllResults total", results.length);
    return results;
  }

  function mapIdName(res, idField = "internalid", nameField = "name") {
    return {
      id: res.getValue({ name: idField }),
      name: res.getValue({ name: nameField }),
    };
  }

  function getRoleName(roleId) {
    if (!roleId) return null;
    try {
      const fields = search.lookupFields({
        type: "role",
        id: String(roleId),
        columns: ["name"],
      });
      return fields?.name || null;
    } catch (e) {
      dbg(DEBUG, "getRoleName failed", roleId, e);
      return null;
    }
  }

  function getDepartments() {
    dbg(DEBUG, "getDepartments start");
    const suiteSearch = search.create({
      type: "department",
      filters: [["isinactive", "is", "F"]],
      columns: [
        search.createColumn({ name: "name", sort: search.Sort.ASC }),
        search.createColumn({ name: "internalid" }),
      ],
    });

    const rows = getAllResults(suiteSearch).map((res) => mapIdName(res));
    dbg(DEBUG, "getDepartments done", rows.length, rows.slice(0, 5));
    return rows;
  }

  function normalizeSalesOrderLabel(value) {
    if (!value) return value;
    return String(value)
      .replace(/^Sales Order\s*#\s*/i, "")
      .trim();
  }

  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
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
      dbg(DEBUG, "getProjectName failed", projectId, e);
      return null;
    }
  }

  function getProjectSalesOrders(projectId) {
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
      columns: [
        search.createColumn({ name: "tranid", sort: search.Sort.ASC }),
        search.createColumn({ name: "internalid" }),
      ],
    });

    return getAllResults(suiteSearch).map((res) => ({
      id: res.getValue({ name: "internalid" }),
      tranId: normalizeSalesOrderLabel(res.getValue({ name: "tranid" })),
    }));
  }

  function buildProjectMilestones(projectId) {
    const milestoneMap = {};

    dbg(DEBUG, "buildProjectMilestones start", { projectId });
    if (!projectId) return { milestones: [] };
    const projectName = getProjectName(projectId);
    if (!projectName) return { milestones: [] };

    let suiteSearch;
    try {
      suiteSearch = search.create({
        type: "salesorder",
        filters: [
          ["type", "anyof", "SalesOrd"],
          "AND",
          search.createFilter({
            name: "formulatext",
            formula: "LOWER({cseg_project_seg})",
            operator: search.Operator.IS,
            values: String(projectName).toLowerCase(),
          }),
          "AND",
          ["mainline", "is", "F"],
          "AND",
          ["taxline", "is", "F"],
          "AND",
          ["shipping", "is", "F"],
          "AND",
          ["memo", "isnotempty", ""],
        ],
        columns: [
          search.createColumn({ name: "item" }),
          search.createColumn({ name: "itemtype" }),
          search.createColumn({ name: "memo" }),
        ],
      });
    } catch (e) {
      dbg(DEBUG, "buildProjectMilestones search.create failed", e);
      return { milestones: [] };
    }

    let results = [];
    try {
      results = getAllResults(suiteSearch);
    } catch (e) {
      dbg(DEBUG, "buildProjectMilestones getAllResults failed", e);
      return { milestones: [] };
    }

    results.forEach((res) => {
      const itemType = res.getValue({ name: "itemtype" });
      if (itemType !== "Service") return;
      const itemId = res.getValue({ name: "item" }) || "";
      if (!itemId) return;
      const desc = String(res.getValue({ name: "memo" }) || "").trim();
      if (!desc) return;
      const key = `${String(itemId)}|||${desc}`;
      if (milestoneMap[key]) return;
      milestoneMap[key] = { key, label: desc, itemId: String(itemId), desc };
    });

    const milestones = Object.values(milestoneMap).sort((a, b) =>
      String(a?.label || "").localeCompare(String(b?.label || "")),
    );
    return { milestones };
  }

  function getActiveServiceItems() {
    const suiteSearch = search.create({
      type: "serviceitem",
      filters: [["isinactive", "is", "F"]],
      columns: [
        search.createColumn({ name: "itemid", sort: search.Sort.ASC }),
        search.createColumn({ name: "displayname" }),
        search.createColumn({ name: "internalid" }),
      ],
    });

    return getAllResults(suiteSearch).map((res) => {
      const itemId = res.getValue({ name: "itemid" });
      const displayName = res.getValue({ name: "displayname" });
      return {
        id: res.getValue({ name: "internalid" }),
        name: displayName || itemId,
        itemId,
      };
    });
  }

  function getCustomListValues(customListScriptId) {
    if (!customListScriptId) return [];

    const suiteSearch = search.create({
      type: String(customListScriptId),
      filters: [["isinactive", "is", "F"]],
      columns: [
        search.createColumn({ name: "name", sort: search.Sort.ASC }),
        search.createColumn({ name: "internalid" }),
      ],
    });

    return getAllResults(suiteSearch).map((res) => mapIdName(res));
  }

  function getInitData({ debug = false } = {}) {
    setDebugFromArgs(debug);
    const currentUser = runtime.getCurrentUser();
    const roleId = currentUser?.role ?? null;

    const safe = (label, fn, fallback) => {
      try {
        return fn();
      } catch (e) {
        dbg(DEBUG, `${label} failed`, e);
        return fallback;
      }
    };

    dbg(DEBUG, "getInitData user", {
      id: currentUser?.id ?? null,
      name: currentUser?.name ?? null,
      email: currentUser?.email ?? null,
      roleId,
    });

    return {
      user: {
        id: currentUser?.id ?? null,
        name: currentUser?.name ?? null,
        email: currentUser?.email ?? null,
        roleId,
        roleName: getRoleName(roleId),
      },
      access: {
        departments: safe("getDepartments", getDepartments, []),
      },
      serviceItems: safe("getActiveServiceItems", getActiveServiceItems, []),
      statuses: {
        projects: safe(
          "getCustomListValues(customlist_pm_project_status)",
          () => getCustomListValues("customlist_pm_project_status"),
          [],
        ),
        projectPhases: safe(
          "getCustomListValues(customlist_pm_projectphase_status)",
          () => getCustomListValues("customlist_pm_projectphase_status"),
          [],
        ),
        revPlans: safe(
          "getCustomListValues(customlist_pm_revplan_status)",
          () => getCustomListValues("customlist_pm_revplan_status"),
          [],
        ),
      },
    };
  }

  function getPhaseLookups(projectId, { debug = false } = {}) {
    setDebugFromArgs(debug);
    const safe = (label, fn, fallback) => {
      try {
        return fn();
      } catch (e) {
        dbg(DEBUG, `${label} failed`, e);
        return fallback;
      }
    };

    dbg(DEBUG, "getPhaseLookups projectId", projectId);

    const salesOrders = safe(
      "getProjectSalesOrders",
      () => getProjectSalesOrders(projectId),
      [],
    );
    const departments = safe("getDepartments", getDepartments, []);
    const { milestones } = safe(
      "buildProjectMilestones",
      () => buildProjectMilestones(projectId),
      { milestones: [] },
    );

    dbg(DEBUG, "phaseLookups counts", {
      salesOrders: Array.isArray(salesOrders) ? salesOrders.length : null,
      departments: Array.isArray(departments) ? departments.length : null,
      milestones: Array.isArray(milestones) ? milestones.length : null,
    });

    return { salesOrders, departments, milestonesByDept: {}, milestones };
  }

  const exported = { getInitData, getPhaseLookups };
  if (typeof window !== "undefined") window.pm_init_data_mod = exported;
  console.log("Loaded pm_init_data_mod", exported);
});
