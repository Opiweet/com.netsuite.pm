/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/runtime', 'N/search', './modules/rev_plan_mod'], (
  runtime,
  search,
  revPlanMod,
) => {
  function parseCheckbox(value) {
    const raw = String(value || '')
      .trim()
      .toUpperCase();
    return raw === 'T' || raw === 'TRUE';
  }

  function getParams() {
    const script = runtime.getCurrentScript();
    const savedSearchId = String(
      script.getParameter({ name: 'custscript_pm_bulk_revplan_search_id' }) ||
        '',
    ).trim();
    const bypassVarianceCheck = parseCheckbox(
      script.getParameter({ name: 'custscript_pm_bulk_revplan_bypass_var' }),
    );

    return { savedSearchId, bypassVarianceCheck };
  }

  function getInputData() {
    const { savedSearchId, bypassVarianceCheck } = getParams();
    if (!savedSearchId) {
      throw new Error(`custscript_pm_bulk_revplan_search_id is required.`);
    }

    const suiteSearch = search.load({ id: savedSearchId });
    const paged = suiteSearch.runPaged({ pageSize: 1000 });
    const uniqueProjectIds = [];
    const seen = {};

    paged.pageRanges.forEach((range) => {
      const page = paged.fetch({ index: range.index });
      page.data.forEach((result) => {
        const projectId = String(result.id || '').trim();
        if (!projectId || seen[projectId]) return;
        seen[projectId] = true;
        uniqueProjectIds.push(projectId);
      });
    });

    if (!uniqueProjectIds.length) {
      throw new Error(`Saved search ${savedSearchId} returned no project ids.`);
    }

    log.audit({
      title: 'BULK_REVPLAN_INPUT',
      details: {
        savedSearchId,
        bypassVarianceCheck,
        projectCount: uniqueProjectIds.length,
      },
    });

    return uniqueProjectIds;
  }

  function map(context) {
    const projectId = String(context.value || '').trim();
    if (!projectId) return;

    context.write({
      key: projectId,
      value: projectId,
    });
  }

  function reduce(context) {
    const projectId = String(context.key || '').trim();
    if (!projectId) return;
    const { bypassVarianceCheck } = getParams();

    try {
      const result = revPlanMod.generateRevenuePlans({
        projectId,
        bypassVarianceCheck,
      });
      const status = String(result?.status || 'ERROR').toUpperCase();

      if (status === 'ERROR') {
        throw new Error(
          result?.message || 'Failed to generate revenue plans for project.',
        );
      }

      context.write({
        key: status === 'WARNING' ? 'warning' : 'success',
        value: JSON.stringify({
          projectId,
          status,
          type: result?.type || null,
          message: result?.message || '',
          createdCount: Number(result?.createdCount || 0),
          existingTotal: Number(result?.existingTotal || 0),
        }),
      });
    } catch (e) {
      log.error({
        title: 'BULK_REVPLAN_REDUCE_FAILED',
        details: {
          projectId,
          name: e?.name || '',
          message: e?.message || String(e),
        },
      });

      context.write({
        key: 'error',
        value: JSON.stringify({
          projectId,
          name: e?.name || '',
          message: e?.message || String(e),
        }),
      });
    }
  }

  function summarize(summary) {
    const counts = {
      success: 0,
      warning: 0,
      error: 0,
      mapErrors: 0,
      reduceErrors: 0,
    };
    const outputErrors = [];
    const outputWarnings = [];

    try {
      summary.output.iterator().each((key, value) => {
        if (key === 'success') counts.success++;
        if (key === 'warning') {
          counts.warning++;
          outputWarnings.push(value);
        }
        if (key === 'error') {
          counts.error++;
          outputErrors.push(value);
        }
        return true;
      });
    } catch (e) {
      // ignore
    }

    try {
      summary.mapSummary.errors.iterator().each((key, message) => {
        counts.mapErrors++;
        log.error({
          title: 'BULK_REVPLAN_MAP_ERROR',
          details: { key, message },
        });
        return true;
      });
    } catch (e) {
      // ignore
    }

    try {
      summary.reduceSummary.errors.iterator().each((key, message) => {
        counts.reduceErrors++;
        log.error({
          title: 'BULK_REVPLAN_REDUCE_SUMMARY_ERROR',
          details: { key, message },
        });
        return true;
      });
    } catch (e) {
      // ignore
    }

    log.audit({
      title: 'BULK_REVPLAN_SUMMARY',
      details: {
        ...counts,
        usage: summary.usage,
        seconds: summary.seconds,
        yields: summary.yields,
        outputWarnings,
        outputErrors,
      },
    });
  }

  return { getInputData, map, reduce, summarize };
});
