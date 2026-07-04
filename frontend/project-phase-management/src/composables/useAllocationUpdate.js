export function useAllocationUpdate() {
  function buildUpdateContext({
    project,
    canAllocationActions,
    allocationValidation,
    revPlanTableRef,
    allowWithoutEdit = false,
  }) {
    if (!project?.value) return { ok: false, reason: 'no_project' }
    if (!allowWithoutEdit && !canAllocationActions?.value) {
      return { ok: false, reason: 'not_allowed' }
    }
    if (allocationValidation?.value?.hasBadAllocation) {
      return { ok: false, reason: 'bad_allocation' }
    }

    const phasesData = revPlanTableRef?.value?.buildUpdateRevenuePlansPhasesData?.() || []
    return {
      ok: true,
      projectId: String(project.value.id || ''),
      phasesData,
    }
  }

  async function submitUpdate({ projectsStore, projectId, confirmed, phasesData }) {
    return projectsStore.updateRevenuePlans({
      projectId,
      confirmed: Boolean(confirmed),
      phasesData,
    })
  }

  return {
    buildUpdateContext,
    submitUpdate,
  }
}
