/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/runtime", "N/search", "N/record", "N/log"], (runtime, search, record, log) => {
  const PARAMS = {
    PROJECT_ID: "custscript_pm_delrev_project_id",
  };

  function scriptParams() {
    const script = runtime.getCurrentScript();
    const projectIdRaw = script.getParameter({ name: PARAMS.PROJECT_ID });

    const projectId = projectIdRaw ? String(projectIdRaw).trim() : "";

    return { projectId };
  }

  function getAllIdsFromSearch(suiteSearch) {
    const ids = [];
    const paged = suiteSearch.runPaged({ pageSize: 1000 });
    paged.pageRanges.forEach((range) => {
      const page = paged.fetch({ index: range.index });
      page.data.forEach((res) => {
        if (res && res.id) ids.push(String(res.id));
      });
    });
    return ids;
  }

  function buildInputData(projectId) {
    const columns = [search.createColumn({ name: "internalid" })];

    const filterVariants = [
      [
        ["isinactive", "is", "F"],
        "AND",
        [
          "custrecord_pm_revplan_parent.custrecord_pm_phase_parent",
          "anyof",
          projectId,
        ],
      ],
      [
        [
          "custrecord_pm_revplan_parent.custrecord_pm_phase_parent",
          "anyof",
          projectId,
        ],
      ],
    ];

    let lastError = null;
    for (const filters of filterVariants) {
      try {
        const suiteSearch = search.create({
          type: "customrecord_pm_revenue_plan",
          filters,
          columns,
        });
        // Return the search itself so Map/Reduce can stream results without loading them all.
        return suiteSearch;
      } catch (e) {
        lastError = e;
      }
    }

    // Fallback: search phases by project, then search rev plan rows by phase ids.
    // This is less efficient but avoids join/filter edge cases in some accounts.
    try {
      const phaseSearch = search.create({
        type: "customrecord_pm_project_phase",
        filters: [
          ["isinactive", "is", "F"],
          "AND",
          ["custrecord_pm_phase_parent", "anyof", projectId],
        ],
        columns: [search.createColumn({ name: "internalid" })],
      });
      const phaseIds = getAllIdsFromSearch(phaseSearch);
      if (!phaseIds.length) return [];

      const revPlanIds = [];
      const chunkSize = 900;
      for (let i = 0; i < phaseIds.length; i += chunkSize) {
        const chunk = phaseIds.slice(i, i + chunkSize);
        const revPlanSearch = search.create({
          type: "customrecord_pm_revenue_plan",
          filters: [
            ["isinactive", "is", "F"],
            "AND",
            ["custrecord_pm_revplan_parent", "anyof", ...chunk],
          ],
          columns,
        });
        revPlanIds.push(...getAllIdsFromSearch(revPlanSearch));
      }

      log.audit({
        title: "REVPLAN_DELETE_INPUT_FALLBACK",
        details: {
          projectId,
          phaseCount: phaseIds.length,
          revPlanCount: revPlanIds.length,
          originalError: lastError?.message || String(lastError || ""),
        },
      });

      return revPlanIds;
    } catch (e) {
      throw lastError || e || new Error("Unable to build revenue plan input.");
    }
  }

  function getInputData() {
    const { projectId } = scriptParams();
    if (!projectId) throw new Error(`${PARAMS.PROJECT_ID} is required`);

    log.audit({
      title: "REVPLAN_DELETE_INPUT",
      details: { projectId },
    });

    return buildInputData(projectId);
  }

  function extractId(mapContext) {
    const raw = mapContext && typeof mapContext.value === "string" ? mapContext.value : "";
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string" || typeof parsed === "number")
        return String(parsed);
      if (parsed?.id) return String(parsed.id);
      const internal =
        parsed?.values?.internalid?.value ??
        parsed?.values?.internalid ??
        parsed?.values?.["internalid"]?.value ??
        parsed?.values?.["internalid"] ??
        null;
      return internal != null ? String(internal) : null;
    } catch (e) {
      // If for some reason NetSuite passes a plain id (unlikely), treat it as such.
      return String(raw).trim() || null;
    }
  }

  function map(context) {
    const id = extractId(context);
    if (!id) return;

    try {
      record.delete({ type: "customrecord_pm_revenue_plan", id });
      context.write({ key: "deleted", value: id });
    } catch (e) {
      log.error({
        title: "REVPLAN_DELETE_FAILED",
        details: { id, name: e?.name || null, message: e?.message || String(e) },
      });
      context.write({
        key: "error",
        value: JSON.stringify({
          id,
          name: e?.name || null,
          message: e?.message || String(e),
        }),
      });
    }
  }

  function summarize(summary) {
    const counts = {
      deleted: 0,
      output_errors: 0,
      map_errors: 0,
    };

    try {
      summary.output.iterator().each((key) => {
        if (key === "deleted") counts.deleted++;
        else if (key === "error") counts.output_errors++;
        return true;
      });
    } catch (e) {
      // ignore
    }

    try {
      summary.mapSummary.errors.iterator().each(() => {
        counts.map_errors++;
        return true;
      });
    } catch (e) {
      // ignore
    }

    log.audit({ title: "REVPLAN_DELETE_SUMMARY", details: counts });
  }

  return { getInputData, map, summarize };
});
