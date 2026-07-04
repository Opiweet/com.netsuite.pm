/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(["N/runtime", "N/search", "./modules/rev_rec_mod"], (
  runtime,
  search,
  revRecMod,
) => {
  function parseProjectIds(raw) {
    const values = String(raw || "")
      .split(",")
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    return revRecMod.normalizeProjectIds(values);
  }

  function getParams() {
    const script = runtime.getCurrentScript();
    return {
      projectIds: parseProjectIds(
        script.getParameter({ name: "custscript_pm_bulk_jnl_project_ids" }),
      ),
    };
  }

  function getInputData() {
    const { projectIds } = getParams();
    if (!projectIds.length) {
      throw new Error("No project IDs provided for bulk rev rec generation.");
    }

    log.audit({
      title: "BULK_REV_REC_INPUT",
      details: { count: projectIds.length },
    });

    return search.create({
      type: "customrecord_pm_projects",
      filters: [["internalid", "anyof", ...projectIds]],
      columns: [search.createColumn({ name: "internalid" })],
    });
  }

  function extractId(rawValue) {
    try {
      const parsed = JSON.parse(rawValue || "{}");
      const id =
        parsed?.id ||
        parsed?.values?.internalid?.value ||
        parsed?.values?.internalid ||
        "";
      return String(id || "").trim();
    } catch (e) {
      return "";
    }
  }

  function map(context) {
    const projectId = extractId(context.value);
    if (!projectId) return;

    try {
      const result = revRecMod.generateRevRecJournal({ projectId });
      if (String(result?.status || "") !== "SUCCESS") {
        throw new Error(
          result?.message || "Failed to generate rev rec journal for project.",
        );
      }

      revRecMod.clearProjectJournalProcessingLock({ projectId });
      context.write({
        key: "success",
        value: JSON.stringify({
          projectId,
          journalId: result?.journalId || null,
        }),
      });
    } catch (e) {
      revRecMod.markProjectJournalProcessingFailed({
        projectId,
        error: e,
      });
      context.write({
        key: "error",
        value: JSON.stringify({
          projectId,
          message: e?.message || String(e),
        }),
      });
    }
  }

  function summarize(summary) {
    let successCount = 0;
    let errorCount = 0;
    const outputErrors = [];

    try {
      summary.output.iterator().each((key, value) => {
        if (key === "success") successCount++;
        if (key === "error") {
          errorCount++;
          outputErrors.push(value);
        }
        return true;
      });
    } catch (e) {
      // ignore
    }

    let mapErrors = 0;
    try {
      summary.mapSummary.errors.iterator().each((key, message) => {
        mapErrors++;
        log.error({
          title: "BULK_REV_REC_MAP_ERROR",
          details: { key, message },
        });
        return true;
      });
    } catch (e) {
      // ignore
    }

    log.audit({
      title: "BULK_REV_REC_SUMMARY",
      details: {
        successCount,
        errorCount,
        mapErrors,
        outputErrors,
      },
    });
  }

  return { getInputData, map, summarize };
});
