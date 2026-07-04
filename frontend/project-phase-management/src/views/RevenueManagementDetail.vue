<script setup>
import { computed, watchEffect, ref, watch, markRaw, onMounted } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useTopbarStore } from '@/stores/topbar'
import TableIcon from '@/components/icons/TableIcon.vue'
import RelatedRecordsIcon from '@/components/icons/RelatedRecordsIcon.vue'
import BriefcaseIcon from '@/components/icons/BriefcaseIcon.vue'
import NotebookPlusIcon from '@/components/icons/NotebookPlusIcon.vue'
import UnlockIcon from '@/components/icons/UnlockIcon.vue'
import TotalIcon from '@/components/icons/TotalIcon.vue'
import LabourIcon from '@/components/icons/LabourIcon.vue'
import BoxIcon from '@/components/icons/BoxIcon.vue'
import AppModal from '@/components/AppModal.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import ProjectBanner from '@/components/ProjectBanner.vue'
import BlockingOverlay from '@/components/BlockingOverlay.vue'
import RelatedRecordsPanel from '@/components/RelatedRecordsPanel.vue'
import ProjectMonthAdminPanel from '@/components/ProjectMonthAdminPanel.vue'
import ProjectNotesPanel from '@/components/ProjectNotesPanel.vue'
import RevPlanTable from '@/components/RevPlanTable.vue'
import Breakdowns from '@/components/Breakdowns.vue'
import ProgressBarMetric from '@/components/ProgressBarMetric.vue'
import RevenueReadinessCard from '@/components/RevenueReadinessCard.vue'
import UnsavedChangesModal from '@/components/UnsavedChangesModal.vue'
import { useRevRecGenerate } from '@/composables/useRevRecGenerate'
import { useAllocationUpdate } from '@/composables/useAllocationUpdate'
import { useAuthz } from '@/composables/useAuthz'
import { useProjectsStore } from '@/stores/projects'
import { useToastStore } from '@/stores/toast'
import { useProjects } from '@/composables/useProjects'
import SaveIcon from '@/components/icons/SaveIcon.vue'
import ConfirmIcon from '@/components/icons/ConfirmIcon.vue'
import { computeAllocationDirty, deepCloneJson, escapeHtml, joinLabels } from '@/util'
import { useBannerUi } from '@/composables/useBannerUi'
import ProjectStats from '@/components/ProjectStats.vue'

const route = useRoute()
const router = useRouter()
const topbar = useTopbarStore()
const projectsStore = useProjectsStore()
const toast = useToastStore()
const { fetchProjects } = useProjects()
onMounted(() => {
  Promise.all([projectsStore.fetchInitData().catch(() => {}), fetchProjects().catch(() => {})])
})

const projectId = computed(() => route.params.projectId || null)
const { resolveRevPlanBannerUi } = useBannerUi({ projectId })
const project = computed(
  () => projectsStore.projects.find((item) => item.id === projectId.value) || null,
)

const projectStatusBadgeColor = computed(() => {
  return project.value?.statusColor || '#6b7280'
})

const backendMonths = computed(() => {
  const pid = String(projectId.value || '')
  return projectsStore.backendMonthsByProject[pid] || []
})

const monthColumns = computed(() =>
  backendMonths.value.map((month) => ({
    ...month,
    statusKey: month.status?.key || '',
    statusLabel: month.isCurrent ? 'Current' : month.type === 'actual' ? 'Actual' : 'Forecast',
    monthStatusKey: month.status?.key || '',
    monthStatusLabel: month.status?.label || '—',
    monthTypeLabel: month.isCurrent ? 'Current' : month.type === 'actual' ? 'Actual' : 'Forecast',
  })),
)
const { fetchPreview, decideFromPreview, decideNormalGenerate, generateJournal } =
  useRevRecGenerate()
const { buildUpdateContext, submitUpdate } = useAllocationUpdate()
const { can } = useAuthz({ projectId })
const showRevenueReadyDeptDetails = ref(false)
const showRevRecConfirm = ref(false)
const showMissingCompletedJournalWarning = ref(false)
const showConfirmAllocation = ref(false)
const showReopenAllocationConfirm = ref(false)
const showGeneratePlanConfirm = ref(false)
const showBadAllocationWarning = ref(false)
const badAllocationWarningContext = ref('generate')
const isGeneratingRevPlans = ref(false)
const isUpdatingAllocation = ref(false)
const isReopeningAllocation = ref(false)
const isGeneratingRevRec = ref(false)
const revRecPreview = ref(null)
const revRecGenerateMode = ref('auto')
const revRecForceMissingOpen = ref(false)
const revRecConfirmSubtitle = ref('')
const missingCompletedJournalsSubtitle = ref('')
const updateAllocationMode = ref('save')
const editableRows = ref([])
const baselineRows = ref([])
const phaseOrderIndexById = computed(() => {
  const pid = String(projectId.value || '')
  const phases = Array.isArray(projectsStore.phasesByProject?.[pid])
    ? projectsStore.phasesByProject[pid]
    : []
  return new Map(
    phases.map((phase, index) => [String(phase?.id || ''), index]).filter(([id]) => id),
  )
})
function sortRowsByPhaseSequence(rows) {
  const list = Array.isArray(rows) ? rows.slice() : []
  const byId = phaseOrderIndexById.value
  return list.sort((a, b) => {
    const aId = String(a?.phaseId || '')
    const bId = String(b?.phaseId || '')
    const aIdx = byId.get(aId) ?? Number.MAX_SAFE_INTEGER
    const bIdx = byId.get(bId) ?? Number.MAX_SAFE_INTEGER
    return aIdx - bIdx
  })
}

function roundToTwoDp(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}

const tableRows = computed(() =>
  Array.isArray(editableRows.value) && editableRows.value.length
    ? sortRowsByPhaseSequence(editableRows.value)
    : Array.isArray(baselineRows.value)
      ? sortRowsByPhaseSequence(baselineRows.value)
      : [],
)
const hasUnsavedChanges = ref(false)
const showUnsavedLeaveConfirm = ref(false)
const pendingRouteNext = ref(null)
const showRelatedRecordsPanel = ref(false)
const showProjectNotesModal = ref(false)
const showProjectMonthAdminPanel = ref(false)
const revPlanTableRef = ref(null)

const currentMonthLabel = computed(
  () => monthColumns.value.find((month) => month.isCurrent)?.label || '—',
)

const currentMonthPill = computed(() => {
  const raw = String(currentMonthLabel.value || '').trim()
  if (!raw || raw === '—') return null
  if (raw.includes('-')) return raw
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]}-${parts[parts.length - 1]}`
  return raw
})
function openBulkUpload() {
  const pid = String(projectId.value || '').trim()
  if (!pid) return
  const resolved = router.resolve({ name: 'bulk-revplan-upload', query: { projectId: pid } })
  window.open(resolved.href, '_blank', 'noopener')
}

function formatTimelineDate(raw) {
  if (!raw) return '—'
  if (typeof projectsStore._formatDisplayDate === 'function') {
    return projectsStore._formatDisplayDate(raw) || '—'
  }
  const d = new Date(String(raw))
  if (Number.isNaN(d.getTime())) return String(raw)
  const month = d.toLocaleString('en-US', { month: 'short' })
  const day = String(d.getDate()).padStart(2, '0')
  const year = String(d.getFullYear())
  return `${month} ${day} ${year}`
}

const revenueSummary = computed(() => {
  const pid = String(projectId.value || '')
  return (
    projectsStore.revenueSummaryByProject[pid] || {
      totalAmount: 0,
      billedToDate: 0,
      recognizedToDate: 0,
      remaining: 0,
      subcontractorCost: 0,
      materialCost: 0,
      recognizedByDepartment: [],
      recognizedByPhase: [],
    }
  )
})

const subcontractorCost = computed(() => Number(revenueSummary.value?.subcontractorCost || 0))
const materialCost = computed(() => Number(revenueSummary.value?.materialCost || 0))
const totalCost = computed(() => Math.max(0, subcontractorCost.value + materialCost.value))
const netRevenueAmount = computed(() => recognizedAmount.value - totalCost.value)
const netRevenuePct = computed(() => {
  const recognized = Number(recognizedAmount.value || 0)
  if (!Number.isFinite(recognized) || recognized <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((netRevenueAmount.value / recognized) * 100)))
})
const costPctOfRecognized = computed(() => {
  const recognized = Number(recognizedAmount.value || 0)
  if (!Number.isFinite(recognized) || recognized <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((totalCost.value / recognized) * 100)))
})

const billedPct = computed(() => {
  const total = Number(revenueSummary.value?.totalAmount || 0)
  const billed = Number(revenueSummary.value?.billedToDate || 0)
  if (!Number.isFinite(total) || total <= 0) return 0
  const pct = (billed / total) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
})

const billedRemaining = computed(() => {
  const total = Number(revenueSummary.value?.totalAmount || 0)
  const billed = Number(revenueSummary.value?.billedToDate || 0)
  if (!Number.isFinite(total) || total <= 0) return 0
  if (!Number.isFinite(billed) || billed <= 0) return total
  return Math.max(0, total - billed)
})

const recognizedAmount = computed(() =>
  Number(projectLoad.value?.completionCheck?.recognizedAmount || 0),
)

const recognizedPct = computed(() => {
  const total = Number(revenueSummary.value?.totalAmount || 0)
  const recognized = Number(recognizedAmount.value || 0)
  if (!Number.isFinite(total) || total <= 0) return 0
  if (!Number.isFinite(recognized) || recognized <= 0) return 0
  const pct = (recognized / total) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
})

const recognizedRemaining = computed(() => {
  const total = Number(revenueSummary.value?.totalAmount || 0)
  const recognized = Number(recognizedAmount.value || 0)
  if (!Number.isFinite(total) || total <= 0) return 0
  if (!Number.isFinite(recognized) || recognized <= 0) return total
  return Math.max(0, total - recognized)
})

const projectStats = computed(() => [
  {
    label: 'Total Project Value',
    value: Number(revenueSummary.value?.totalAmount || 0),
    icon: markRaw(TotalIcon),
  },
  {
    label: 'Subcontractor Cost',
    value: subcontractorCost.value,
    icon: markRaw(LabourIcon),
  },
  {
    label: 'Material Cost',
    value: materialCost.value,
    icon: markRaw(BoxIcon),
  },
])

function revenueReadyForRow(row) {
  return Number(revPlanTableRef.value?.revenueReadyForRow?.(row) || 0)
}

const revenueReady = computed(() => {
  return Number(revPlanTableRef.value?.getRevenueReadyTotal?.() || 0)
})

const revenueNotInvoiced = computed(() => {
  const ready = Number(revenueReady.value || 0)
  const recognized = Number(recognizedAmount.value || 0)
  const billed = Number(revenueSummary.value?.billedToDate || 0)
  const totalRecognizedThroughCurrent = recognized + ready
  if (!Number.isFinite(totalRecognizedThroughCurrent) || totalRecognizedThroughCurrent <= 0)
    return 0
  if (!Number.isFinite(billed) || billed <= 0) return totalRecognizedThroughCurrent
  return Math.max(0, totalRecognizedThroughCurrent - billed)
})

const revenueBreakdownMode = ref('department')

const revenueBreakdownRows = computed(() => {
  const rows = tableRows.value
  const byGroup = {}
  const byPhase = revenueBreakdownMode.value === 'phase'

  const backendRecognized = byPhase
    ? Array.isArray(revenueSummary.value?.recognizedByPhase)
      ? revenueSummary.value.recognizedByPhase
      : []
    : Array.isArray(revenueSummary.value?.recognizedByDepartment)
      ? revenueSummary.value.recognizedByDepartment
      : []

  backendRecognized.forEach((row) => {
    const group = byPhase
      ? String(row?.phase || 'Unassigned')
      : String(row?.department || 'Unassigned')
    if (!byGroup[group]) {
      byGroup[group] = {
        group,
        revenueRecognized: 0,
        revenueReady: 0,
        revenueForecasted: 0,
        projectTotal: 0,
      }
    }
    byGroup[group].revenueRecognized += Number(row?.recognizedToDate || 0)
  })

  const forecastMonthKeys = monthColumns.value
    .filter((m) => String(m?.type || '').toLowerCase() === 'forecast')
    .map((m) => m.key)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const group = byPhase
      ? String(row?.phase || 'Unassigned')
      : String(row?.department || 'Unassigned')
    if (!byGroup[group]) {
      byGroup[group] = {
        group,
        revenueRecognized: 0,
        revenueReady: 0,
        revenueForecasted: 0,
        projectTotal: 0,
      }
    }
    const total = Number(row?.total || 0)
    if (Number.isFinite(total)) byGroup[group].projectTotal += total
    byGroup[group].revenueReady += revenueReadyForRow(row)

    const rate = Number(row?.rate || 0)
    const months = row?.months && typeof row.months === 'object' ? row.months : {}
    if (Number.isFinite(rate) && rate > 0) {
      const forecastedAmount = forecastMonthKeys.reduce((sum, key) => {
        const qty = Number(months?.[key] || 0)
        if (!Number.isFinite(qty) || qty === 0) return sum
        return sum + qty * rate
      }, 0)
      byGroup[group].revenueForecasted += forecastedAmount
    }
  }

  const rowsByGroup = Object.values(byGroup)
    .map((r) => {
      const recognized = Number(r.revenueRecognized || 0)
      const ready = Number(r.revenueReady || 0)
      const forecasted = Number(r.revenueForecasted || 0)
      const projectTotal = Number(r.projectTotal || 0)
      return {
        group: r.group,
        revenueTotal: roundToTwoDp(projectTotal),
        revenueRecognized: roundToTwoDp(recognized),
        revenueReady: roundToTwoDp(ready),
        revenueForecasted: roundToTwoDp(forecasted),
        revenueNotForecasted: roundToTwoDp(projectTotal - recognized - forecasted),
      }
    })
    .sort((a, b) => String(a.group || '').localeCompare(String(b.group || '')))

  const totalRow = rowsByGroup.reduce(
    (total, row) => ({
      group: 'Total',
      revenueTotal: roundToTwoDp(total.revenueTotal + Number(row.revenueTotal || 0)),
      revenueRecognized: roundToTwoDp(total.revenueRecognized + Number(row.revenueRecognized || 0)),
      revenueReady: roundToTwoDp(total.revenueReady + Number(row.revenueReady || 0)),
      revenueForecasted: roundToTwoDp(total.revenueForecasted + Number(row.revenueForecasted || 0)),
      revenueNotForecasted: roundToTwoDp(
        total.revenueNotForecasted + Number(row.revenueNotForecasted || 0),
      ),
    }),
    {
      group: 'Total',
      revenueTotal: 0,
      revenueRecognized: 0,
      revenueReady: 0,
      revenueForecasted: 0,
      revenueNotForecasted: 0,
    },
  )

  if (!rowsByGroup.length) return rowsByGroup
  return [totalRow, ...rowsByGroup]
})

const revenueBreakdownColumns = computed(() => [
  {
    key: 'group',
    label: revenueBreakdownMode.value === 'phase' ? 'Phase' : 'Department',
  },
  { key: 'revenueTotal', label: 'Total' },
  { key: 'revenueRecognized', label: 'Revenue Recognized' },
  { key: 'revenueReady', label: 'Revenue Ready' },
  { key: 'revenueForecasted', label: 'Revenue Forecasted' },
  { key: 'revenueNotForecasted', label: 'Revenue Not Forecasted' },
])

const revenueBreakdownTableRows = computed(() =>
  revenueBreakdownRows.value.map((row) => ({
    key: row.group,
    label: row.group || 'Unassigned',
    values: [
      row.revenueTotal,
      row.revenueRecognized,
      row.revenueReady,
      row.revenueForecasted,
      row.revenueNotForecasted,
    ],
    isTotal: row.group === 'Total',
  })),
)

const revRecGeneration = computed(
  () =>
    (projectLoad.value?.revRecGeneration && typeof projectLoad.value.revRecGeneration === 'object'
      ? projectLoad.value.revRecGeneration
      : null) || null,
)
const submitToFinanceAction = computed(
  () =>
    (revRecGeneration.value?.submitToFinanceAction &&
    typeof revRecGeneration.value.submitToFinanceAction === 'object'
      ? revRecGeneration.value.submitToFinanceAction
      : null) || null,
)
const generateJournalAction = computed(
  () =>
    (revRecGeneration.value?.generateJournalAction &&
    typeof revRecGeneration.value.generateJournalAction === 'object'
      ? revRecGeneration.value.generateJournalAction
      : null) || null,
)

const canGenerateRevRec = computed(
  () =>
    can('revrec.generate') &&
    project.value &&
    Boolean(generateJournalAction.value?.visible) &&
    Boolean(generateJournalAction.value?.enabled),
)
const canReopenAllocation = computed(
  () =>
    can('revplan.reopen') &&
    project.value &&
    revPlanStatusValueKey.value === 'rev_rec_ready' &&
    !isPostJournalState.value,
)

const projectLoad = computed(() => {
  const pid = String(projectId.value || '')
  return projectsStore.projectLoadByProject[pid] || null
})
const isProjectFrozen = computed(() => {
  const normalized = String(projectLoad.value?.status?.key || project.value?.status?.key || '')
    .trim()
    .toLowerCase()
  return (
    Boolean(projectLoad.value?.isFrozen) ||
    Boolean(projectLoad.value?.isClosed) ||
    normalized === 'closed'
  )
})
const isProjectLockedForJnlProc = computed(() => Boolean(projectLoad.value?.isLockedForJnlProc))

const canAllocationActions = computed(() => {
  return (
    can('revplan.update') && Boolean(project.value) && Boolean(projectLoad.value?.canEditRevPlan)
  )
})

const canConfirmAllocation = computed(
  () =>
    can('revplan.confirm') &&
    Boolean(project.value) &&
    !isPostJournalState.value &&
    Boolean(submitToFinanceAction.value?.visible) &&
    Boolean(submitToFinanceAction.value?.enabled),
)

const submitToFinanceTargetLabelsText = computed(() =>
  joinLabels(
    Array.isArray(submitToFinanceAction.value?.targetMonthLabels)
      ? submitToFinanceAction.value.targetMonthLabels
      : [],
  ),
)

const submitToFinanceTargetLabels = computed(() =>
  Array.isArray(submitToFinanceAction.value?.targetMonthLabels)
    ? submitToFinanceAction.value.targetMonthLabels.filter(Boolean)
    : [],
)

const submitToFinanceConfirmSubtitle = computed(() => {
  const labels = submitToFinanceTargetLabels.value
  const fallback = String(submitToFinanceTargetLabelsText.value || project.value?.name || '').trim()
  const body = labels.length
    ? `<ul class="month-lists"><li>${labels
        .map((label) => `<strong>${escapeHtml(label)}</strong>`)
        .join('</li><li>')}</li></ul>`
    : `<ul><li><strong>${escapeHtml(fallback)}</strong></li></ul>`
  return `This will submit rev plan to finance and set their status to <code>Rev Rec Ready</code> for:${body}Do you want to proceed?`
})

const canGeneratePlan = computed(
  () =>
    can('revplan.generate') &&
    !isProjectFrozen.value &&
    Boolean(projectLoad.value?.planGeneration?.allowed),
)
const canEditLines = computed(() => canAllocationActions.value)

const progressBarMetrics = computed(() => [
  {
    key: 'billed',
    label: 'Billed to date',
    value: Number(revenueSummary.value?.billedToDate || 0),
    percent: billedPct.value,
    ariaLabel: 'Billed to date progress',
    remainingLabel: 'Remaining',
    remainingValue: billedRemaining.value,
  },
  {
    key: 'recognized',
    label: 'Revenue Recognised',
    value: recognizedAmount.value,
    percent: recognizedPct.value,
    accent: true,
    ariaLabel: 'Amount recognised progress',
    remainingLabel: 'Remaining',
    remainingValue: recognizedRemaining.value,
  },
  {
    key: 'net',
    label: 'Net Revenue',
    value: netRevenueAmount.value,
    percent: netRevenuePct.value,
    accent: true,
    ariaLabel: 'Net revenue split progress',
    secondaryPercent: costPctOfRecognized.value,
    secondaryColor: 'cost',
    splitLeftLabel: 'Revenue',
    splitLeftValue: recognizedAmount.value,
    splitRightLabel: 'Cost',
    splitRightValue: totalCost.value,
  },
])

const progressBarMetricSkeletons = [
  { key: 'billed', label: 'Billed to date' },
  { key: 'recognized', label: 'Revenue Recognised' },
  { key: 'net', label: 'Net Revenue' },
]

const activeProjectBanner = computed(() => {
  const code = projectLoad.value?.revPlanBanner?.code || null
  const baseVariant = projectLoad.value?.revPlanBanner?.variant || 'success'
  if (code) {
    const ui = resolveRevPlanBannerUi(code)
    if (ui.message)
      return {
        variant: ui?.variant || baseVariant,
        message: ui.message,
        html: Boolean(ui.html),
      }
  }
  return null
})

const isProjectCardCollapsed = ref(false)

function toggleProjectCardCollapsed() {
  isProjectCardCollapsed.value = !isProjectCardCollapsed.value
}

function goToProjectDetail() {
  const pid = String(projectId.value || '')
  if (!pid) return
  router.push({ name: 'project-detail', params: { projectId: pid } })
}

function cloneRows(value) {
  return deepCloneJson(value, [])
}

function computeHasUnsavedChanges() {
  return computeAllocationDirty({
    baselineRows: baselineRows.value,
    currentRows: editableRows.value,
    monthColumns: monthColumns.value,
  })
}

function resetDraftRows() {
  baselineRows.value = cloneRows(revenueRows.value)
  editableRows.value = cloneRows(revenueRows.value)
  hasUnsavedChanges.value = false
}

function closeBadAllocationWarning() {
  showBadAllocationWarning.value = false
}

function openReopenAllocationConfirm() {
  if (!canReopenAllocation.value) return
  showReopenAllocationConfirm.value = true
}

function closeReopenAllocationConfirm() {
  showReopenAllocationConfirm.value = false
}

function confirmReopenAllocationUpdate() {
  if (!project.value) return
  closeReopenAllocationConfirm()
  isReopeningAllocation.value = true
  topbar.setActionLoading('reopen-allocation', true)
  projectsStore
    .reopenActualRevenuePlans({ projectId: String(project.value.id || '') })
    .then(() => resetDraftRows())
    .catch((e) => {
      toast.show({ message: e?.message || String(e), variant: 'error', durationMs: 6000 })
    })
    .finally(() => {
      topbar.setActionLoading('reopen-allocation', false)
      isReopeningAllocation.value = false
    })
}

function confirmAllocation() {
  if (allocationValidation.value.hasBadAllocation) {
    badAllocationWarningContext.value = 'confirm'
    showBadAllocationWarning.value = true
    return
  }
  showConfirmAllocation.value = true
}

function closeConfirmAllocation() {
  showConfirmAllocation.value = false
}

async function runUpdateRevenuePlans({ confirmed }) {
  const context = buildUpdateContext({
    project,
    canAllocationActions,
    allocationValidation,
    revPlanTableRef,
    allowWithoutEdit: Boolean(confirmed),
  })
  if (!context.ok) {
    if (context.reason === 'bad_allocation') {
      badAllocationWarningContext.value = confirmed ? 'confirm' : 'save'
      showBadAllocationWarning.value = true
    }
    return
  }

  isUpdatingAllocation.value = true
  updateAllocationMode.value = confirmed ? 'confirm' : 'save'
  topbar.setActionLoading(confirmed ? 'confirm-allocation' : 'save-revenue-lines', true)
  try {
    const result = await submitUpdate({
      projectsStore,
      projectId: context.projectId,
      confirmed: Boolean(confirmed),
      phasesData: context.phasesData,
    })
    const submittedTargetLabelsText = joinLabels(
      Array.isArray(result?.targetMonthLabels) ? result.targetMonthLabels : [],
    )
    hasUnsavedChanges.value = false
    toast.show({
      message: confirmed
        ? `Allocation confirmed${
            submittedTargetLabelsText
              ? ` for ${submittedTargetLabelsText}`
              : submitToFinanceTargetLabelsText.value
                ? ` for ${submitToFinanceTargetLabelsText.value}`
              : ''
          }.`
        : 'Allocation saved.',
      variant: 'success',
    })
    resetDraftRows()
  } catch (e) {
    toast.show({ message: e?.message || String(e), variant: 'error', durationMs: 6000 })
  } finally {
    topbar.setActionLoading(confirmed ? 'confirm-allocation' : 'save-revenue-lines', false)
    isUpdatingAllocation.value = false
  }
}

async function confirmAllocationUpdate() {
  if (!project.value) return
  if (allocationValidation.value.hasBadAllocation) {
    badAllocationWarningContext.value = 'confirm'
    showBadAllocationWarning.value = true
    closeConfirmAllocation()
    return
  }
  closeConfirmAllocation()
  await runUpdateRevenuePlans({ confirmed: true })
}

function generateMissingMonths() {
  if (!project.value) return
  const pid = String(project.value.id || '')
  if (!pid) return
  isGeneratingRevPlans.value = true
  topbar.setActionLoading('generate-rev-plan', true)
  projectsStore
    .generateRevPlans({ projectId: pid })
    .then(() => projectsStore.fetchProjectRevPlans({ projectId: pid, force: true }))
    .catch((e) => console.log('Failed to generate rev plans', e))
    .finally(() => {
      topbar.setActionLoading('generate-rev-plan', false)
      isGeneratingRevPlans.value = false
    })
}

function openGeneratePlanConfirm() {
  if (!canGeneratePlan.value) return
  showGeneratePlanConfirm.value = true
}

function closeGeneratePlanConfirm() {
  showGeneratePlanConfirm.value = false
}

function confirmGenerateMissingMonths() {
  closeGeneratePlanConfirm()
  generateMissingMonths()
}

function handleTableChange() {
  hasUnsavedChanges.value = computeHasUnsavedChanges()
}

const revenueRows = computed(() => {
  const pid = String(projectId.value || '')
  return projectsStore.revenueRowsByProject[pid] || []
})

const isRevPlansLoading = computed(() => {
  const pid = String(projectId.value || '')
  return Boolean(projectsStore.projectRevPlansInFlightByProject?.[pid])
})

const revPlansMeta = computed(() => {
  const pid = String(projectId.value || '')
  return projectsStore.projectRevPlansMetaByProject?.[pid] || null
})

const isPostJournalState = computed(() => Boolean(revPlansMeta.value?.isPostJournalState))

const revPlanStatusConflict = computed(() =>
  Boolean(revPlansMeta.value?.revPlanStatusConflict || project.value?.revPlanStatusConflict),
)

const revPlanStatusValueKey = computed(() => {
  if (revPlanStatusConflict.value) return 'mixed'
  return revPlansMeta.value?.revPlanStatus?.key || project.value?.revPlanStatus?.key || null
})
const revPlanStatusLabel = computed(() => {
  if (revPlanStatusConflict.value) return 'Mixed'
  return revPlansMeta.value?.revPlanStatus?.label || project.value?.revPlanStatus?.label || null
})
const revPlanStatusBadgeLabel = computed(() => {
  const key = String(revPlanStatusValueKey.value || '')
    .trim()
    .toLowerCase()
  if (!key) return null
  const label = String(revPlanStatusLabel.value || '').trim()
  if (!label) return null
  return label
})
const revPlanStatusBadgeColor = computed(() => {
  const key = String(revPlanStatusValueKey.value || '')
    .trim()
    .toLowerCase()
  // Keep consistent with list/table views (DatatableCust statusColorMap).
  if (key === 'open') return '#94a3b8'
  if (key === 'rev_rec_ready') return '#f59e0b'
  if (key === 'completed') return '#00a56a'
  if (key === 'cancelled') return '#dc2626'
  if (key === 'mixed') return '#f97316'
  return '#6b7280'
})

const hideProjectStatusBadge = computed(() => {
  const key = String(revPlanStatusValueKey.value || '')
    .trim()
    .toLowerCase()
  return key === 'rev_rec_ready'
})

const showProjectSkeleton = computed(() => !project.value)

const showRevPlansSkeleton = computed(() => {
  const monthsReady = Array.isArray(backendMonths.value) && backendMonths.value.length > 0
  const rowsReady = Array.isArray(editableRows.value) && editableRows.value.length > 0
  return isRevPlansLoading.value && (!monthsReady || !rowsReady)
})

const varianceValue = computed(() => {
  const pid = String(projectId.value || '')
  return Number(projectsStore.projectFinancialsByProject?.[pid]?.totals?.variance || 0)
})

watch(
  projectId,
  (val) => {
    const pid = String(val || '')
    if (!pid) return
    projectsStore.ensureHandlerUrl()
    if (!projectsStore.handlerUrl) return
    projectsStore.fetchProjectLoad({ projectId: pid }).catch((e) => {
      console.log('Failed to fetch project load', e)
    })
    projectsStore.fetchProjectPhases({ projectId: pid }).catch((e) => {
      console.log('Failed to fetch project phases', e)
    })
    projectsStore.fetchProjectRevPlans({ projectId: pid }).catch((e) => {
      console.log('Failed to fetch project rev plans', e)
    })
    showProjectNotesModal.value = false
  },
  { immediate: true },
)

const allocationValidation = computed(
  () =>
    revPlanTableRef.value?.getAllocationValidation?.({
      hasUnsavedChanges: hasUnsavedChanges.value,
    }) || {
      badAllocationCount: 0,
      hasBadAllocation: false,
      canSaveAllocation: false,
    },
)

function handleRevRecBadAllocation() {
  badAllocationWarningContext.value = 'generate'
  showBadAllocationWarning.value = true
}

function closeRevRecConfirm() {
  showRevRecConfirm.value = false
  showMissingCompletedJournalWarning.value = false
  revRecPreview.value = null
  revRecGenerateMode.value = 'auto'
  revRecForceMissingOpen.value = false
  revRecConfirmSubtitle.value = ''
  missingCompletedJournalsSubtitle.value = ''
}

function dismissMissingCompletedJournalWarning() {
  showMissingCompletedJournalWarning.value = false
  const preview = revRecPreview.value || null
  if (preview) {
    const decision = decideNormalGenerate(preview)
    revRecGenerateMode.value = decision.mode
    revRecForceMissingOpen.value = Boolean(decision.forceMissingOpen)
    revRecConfirmSubtitle.value = String(decision.subtitle || '')
  } else {
    revRecGenerateMode.value = 'current_only'
    revRecForceMissingOpen.value = false
    revRecConfirmSubtitle.value = ''
  }
  showRevRecConfirm.value = true
}

function runRevRecGenerate({ mode, forceMissingOpen }) {
  if (!project.value) return
  showRevRecConfirm.value = false
  showMissingCompletedJournalWarning.value = false
  isGeneratingRevRec.value = true
  topbar.setActionLoading('generate-rev-rec-journal', true)
  generateJournal({
    projectsStore,
    projectId: String(project.value.id || ''),
    mode: mode || 'auto',
    forceMissingOpen: Boolean(forceMissingOpen),
  })
    .then((result) => {
      const journaledLabels = Array.isArray(result?.generated)
        ? result.generated.map((row) => String(row?.monthLabel || '')).filter(Boolean)
        : []
      const completedWithoutJournalLabels = Array.isArray(result?.completedWithoutJournal)
        ? result.completedWithoutJournal
            .map((row) => String(row?.monthLabel || ''))
            .filter(Boolean)
        : []
      const generatedTargetLabelsText = joinLabels(journaledLabels)
      const completedWithoutJournalText = joinLabels(completedWithoutJournalLabels)
      const journalId = result?.journalId ? ` (${result.journalId})` : ''
      const generatedMessage = journaledLabels.length
        ? `Rev rec journal generated successfully${
            generatedTargetLabelsText ? ` for ${generatedTargetLabelsText}` : ''
          }${journalId}.`
        : ''
      const completedWithoutJournalMessage = completedWithoutJournalLabels.length
        ? `Zero-value month(s) were marked Completed without journal creation${
            completedWithoutJournalText ? `: ${completedWithoutJournalText}` : '.'
          }`
        : ''
      toast.show({
        message: [generatedMessage, completedWithoutJournalMessage].filter(Boolean).join(' '),
        variant: 'success',
        durationMs: 5000,
      })
    })
    .catch((e) => {
      toast.show({ message: e?.message || String(e), variant: 'error', durationMs: 6000 })
    })
    .finally(() => {
      topbar.setActionLoading('generate-rev-rec-journal', false)
      isGeneratingRevRec.value = false
      closeRevRecConfirm()
    })
}

function confirmRevRecGenerate() {
  closeRevRecConfirm()
  runRevRecGenerate({
    mode: revRecGenerateMode.value || 'auto',
    forceMissingOpen: Boolean(revRecForceMissingOpen.value),
  })
}

function confirmRegenerateMissingCompletedJournals() {
  closeRevRecConfirm()
  runRevRecGenerate({
    mode: 'completed_missing_journals_only',
    forceMissingOpen: false,
  })
}

function openRevRecConfirm() {
  if (!canGenerateRevRec.value) return
  if (allocationValidation.value.hasBadAllocation) {
    handleRevRecBadAllocation()
    return
  }
  const pid = String(project.value?.id || '')
  if (!pid) return

  isGeneratingRevRec.value = true
  let generationStarted = false
  fetchPreview({ projectsStore, projectId: pid })
    .then((preview) => {
      revRecPreview.value = preview || null
      const decision = decideFromPreview(preview || {})
      if (decision?.type === 'generate_now') {
        runRevRecGenerate({
          mode: decision.mode,
          forceMissingOpen: decision.forceMissingOpen,
        })
        generationStarted = true
        return
      }
      if (decision?.type === 'warn_missing_completed_journals') {
        revRecGenerateMode.value = decision.mode
        revRecForceMissingOpen.value = Boolean(decision.forceMissingOpen)
        missingCompletedJournalsSubtitle.value = String(decision.subtitle || '')
        showMissingCompletedJournalWarning.value = true
        return
      }
      revRecGenerateMode.value = decision.mode
      revRecForceMissingOpen.value = Boolean(decision.forceMissingOpen)
      revRecConfirmSubtitle.value = String(decision.subtitle || '')
      showRevRecConfirm.value = true
    })
    .catch((e) => {
      toast.show({
        message: e?.message || 'Failed to prepare rev rec generation.',
        variant: 'warning',
        durationMs: 8000,
      })
    })
    .finally(() => {
      if (!generationStarted) isGeneratingRevRec.value = false
    })
}

function saveRevenueChanges() {
  if (!canEditLines.value) return
  if (!project.value) return
  if (!hasUnsavedChanges.value) return
  if (allocationValidation.value.hasBadAllocation) {
    badAllocationWarningContext.value = 'save'
    showBadAllocationWarning.value = true
    return
  }

  runUpdateRevenuePlans({ confirmed: false })
}

watchEffect(() => {
  topbar.setTopbar({
    title: 'Revenue Plan',
    subtitle: 'Project phases revenue details and allocations.',
    backRouteName: 'revenue-list',
    actions: [
      ...(project.value
        ? [
            {
              key: 'related-records',
              label: 'Related Records',
              icon: markRaw(RelatedRecordsIcon),
              variant: 'secondary',
              loading: false,
              onClick: () => {
                showRelatedRecordsPanel.value = true
                },
            },
          ]
        : []),
      ...(project.value
        ? [
            {
              key: 'go-project',
              label: 'Go to Project',
              icon: markRaw(BriefcaseIcon),
              variant: 'outline',
              loading: false,
              onClick: goToProjectDetail,
            },
          ]
        : []),
      ...(allocationValidation.value.canSaveAllocation
        ? [
            {
              key: 'save-revenue-lines',
              label: 'Save Allocation',
              icon: markRaw(SaveIcon),
              variant: 'warning',
              loading: isUpdatingAllocation.value && updateAllocationMode.value === 'save',
              onClick: saveRevenueChanges,
            },
          ]
        : []),
      ...(canGeneratePlan.value
        ? [
            {
              key: 'generate-rev-plan',
              label: 'Generate Revenue Plan',
              icon: markRaw(TableIcon),
              variant: 'warning',
              loading: false,
              onClick: openGeneratePlanConfirm,
            },
          ]
        : []),
      ...(canConfirmAllocation.value
        ? [
            {
              key: 'confirm-allocation',
              label: 'Submit to Finance',
              icon: markRaw(ConfirmIcon),
              variant: 'primary',
              loading: isUpdatingAllocation.value && updateAllocationMode.value === 'confirm',
              onClick: confirmAllocation,
            },
          ]
        : []),
      ...(canReopenAllocation.value
        ? [
            {
              key: 'reopen-allocation',
              label: 'Reopen Allocation',
              icon: markRaw(UnlockIcon),
              variant: 'outline',
              loading: isReopeningAllocation.value,
              onClick: openReopenAllocationConfirm,
            },
          ]
        : []),
      ...(canGenerateRevRec.value
        ? [
            {
              key: 'generate-rev-rec-journal',
              label: 'Generate Rev Rec Journal',
              icon: markRaw(NotebookPlusIcon),
              variant: 'primary',
              loading: isGeneratingRevRec.value,
              onClick: openRevRecConfirm,
            },
          ]
        : []),
    ],
  })
})

watch(projectId, () => resetDraftRows(), { immediate: true })
watch(revenueRows, () => {
  if (hasUnsavedChanges.value) return
  resetDraftRows()
})

function openUnsavedLeaveConfirm(next) {
  if (showUnsavedLeaveConfirm.value) {
    next(false)
    return
  }
  pendingRouteNext.value = next
  showUnsavedLeaveConfirm.value = true
}

function stayOnPage() {
  const next = pendingRouteNext.value
  pendingRouteNext.value = null
  showUnsavedLeaveConfirm.value = false
  next?.(false)
}

function discardAndLeave() {
  const next = pendingRouteNext.value
  pendingRouteNext.value = null
  showUnsavedLeaveConfirm.value = false
  hasUnsavedChanges.value = false
  next?.()
}

function saveAndLeave() {
  saveRevenueChanges()
  const next = pendingRouteNext.value
  pendingRouteNext.value = null
  showUnsavedLeaveConfirm.value = false
  next?.()
}

onBeforeRouteLeave((to, from, next) => {
  if (!hasUnsavedChanges.value) return next()
  return openUnsavedLeaveConfirm(next)
})

onBeforeRouteUpdate((to, from, next) => {
  if (!hasUnsavedChanges.value) return next()
  return openUnsavedLeaveConfirm(next)
})
</script>

<template>
  <div class="page-wrap">
    <BlockingOverlay
      v-if="isGeneratingRevRec"
      title="Generating Rev Rec Journal…"
      subtitle="Please wait until the process finishes."
    />
    <BlockingOverlay
      v-else-if="isGeneratingRevPlans"
      title="Generating revenue plans…"
      subtitle="Please wait until the process finishes."
    />
    <BlockingOverlay
      v-else-if="isUpdatingAllocation"
      :title="updateAllocationMode === 'confirm' ? 'Confirming allocation…' : 'Saving allocation…'"
      subtitle="Please wait until the process finishes."
    />
    <BlockingOverlay
      v-else-if="isReopeningAllocation"
      title="Reopening allocation…"
      subtitle="Please wait until the process finishes."
    />
    <section class="page">
      <div v-if="showProjectSkeleton" class="project-card" aria-busy="true">
        <div class="project-card-layout">
          <div class="project-card-left">
            <div class="project-card-title-row">
              <div class="sk sk-h1"></div>
              <div class="sk sk-pill"></div>
            </div>

            <div class="sk sk-sub"></div>

            <div class="project-card-totals">
              <div style="width: 100%">
                <ProjectStats skeleton :skeleton-count="3" />
                <div class="project-card-total project-card-total--stack">
                  <div class="project-card-total-stack-grid">
                    <ProgressBarMetric
                      v-for="metric in progressBarMetricSkeletons"
                      :key="metric.key"
                      :label="metric.label"
                      skeleton
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside class="project-card-right" aria-label="Project timeline">
            <div class="project-card-right-body">
              <RevenueReadinessCard skeleton />
            </div>
          </aside>
        </div>
      </div>

      <div v-if="project" class="project-card">
        <button
          type="button"
          class="project-card-toggle"
          :aria-label="
            isProjectCardCollapsed ? 'Expand project summary' : 'Collapse project summary'
          "
          :title="isProjectCardCollapsed ? 'Expand' : 'Collapse'"
          @click="toggleProjectCardCollapsed"
        >
          <span class="project-card-toggle-icon" aria-hidden="true">{{
            isProjectCardCollapsed ? '+' : '–'
          }}</span>
        </button>

        <div class="project-card-layout" :class="{ 'is-collapsed': isProjectCardCollapsed }">
          <div class="project-card-left">
            <div class="project-card-title-row">
              <div class="project-card-title">{{ project.name }}</div>
              <StatusBadge
                v-if="!hideProjectStatusBadge"
                class="status-pill"
                :label="project.status?.label ?? 'Open'"
                :color="projectStatusBadgeColor"
              />
              <StatusBadge
                v-if="revPlanStatusBadgeLabel"
                class="status-pill"
                :label="revPlanStatusBadgeLabel"
                :color="revPlanStatusBadgeColor"
              />
              <StatusBadge
                v-if="currentMonthPill"
                class="status-pill status-pill--current"
                :label="`Current: ${currentMonthPill}`"
                color="#00a56a"
              />
              <span v-if="isProjectLockedForJnlProc" class="lock-pill">🔒 Processing</span>
            </div>

            <template v-if="!isProjectCardCollapsed">
              <div class="project-card-sub">
                {{ project.client }}
                <template v-if="project.department">
                  <span class="project-card-sub-sep">|</span>
                  <span>Dept: {{ project.department }}</span>
                </template>
                <template v-if="project.startDate || project.endDate">
                  <span class="project-card-sub-sep">|</span>
                  <span class="project-card-sub-dates">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      width="12"
                      height="12"
                      style="opacity: 0.5; flex-shrink: 0"
                    >
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <path d="M16 2v4M8 2v4M3 10h18" />
                    </svg>
                    {{ formatTimelineDate(project.startDate) }}
                    <span class="project-card-sub-to">to</span>
                    {{ formatTimelineDate(project.endDate) }}
                  </span>
                </template>
              </div>
              <ProjectBanner
                v-if="activeProjectBanner"
                :variant="activeProjectBanner.variant"
                class="project-banner-card"
              >
                <span v-if="activeProjectBanner.html" v-html="activeProjectBanner.message"></span>
                <span v-else>{{ activeProjectBanner.message }}</span>
              </ProjectBanner>

              <div class="project-card-totals">
                <div style="width: 100%">
                  <ProjectStats :stats="projectStats" />
                  <div class="project-card-total project-card-total--stack">
                    <div class="project-card-total-stack-grid">
                      <ProgressBarMetric
                        v-for="metric in progressBarMetrics"
                        :key="metric.key"
                        v-bind="metric"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <button
                v-if="revenueBreakdownRows.length"
                type="button"
                class="summary-toggle summary-toggle-hero summary-toggle--desktop"
                @click="showRevenueReadyDeptDetails = !showRevenueReadyDeptDetails"
              >
                <span>
                  {{ showRevenueReadyDeptDetails ? 'Hide breakdown' : 'Show revenue breakdown' }}
                </span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  width="16"
                  height="16"
                  :class="{ rotated: showRevenueReadyDeptDetails }"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </template>
          </div>

          <aside
            v-if="!isProjectCardCollapsed"
            class="project-card-right"
            aria-label="Project timeline"
          >
            <div class="project-card-right-body">
              <RevenueReadinessCard
                :revenue-ready="revenueReady"
                :unbilled-revenue="revenueNotInvoiced"
              />
            </div>
          </aside>

          <button
            v-if="!isProjectCardCollapsed && revenueBreakdownRows.length"
            type="button"
            class="summary-toggle summary-toggle-hero summary-toggle--mobile"
            @click="showRevenueReadyDeptDetails = !showRevenueReadyDeptDetails"
          >
            <span>
              {{ showRevenueReadyDeptDetails ? 'Hide breakdown' : 'Show department breakdown' }}
            </span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="16"
              height="16"
              :class="{ rotated: showRevenueReadyDeptDetails }"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
        <transition name="dept">
          <Breakdowns
            v-if="showRevenueReadyDeptDetails"
            :open="showRevenueReadyDeptDetails"
            :title="`Revenue Breakdown by ${revenueBreakdownMode === 'phase' ? 'Phase' : 'Dept'}`"
            :columns="revenueBreakdownColumns"
            :rows="revenueBreakdownTableRows"
            :show-mode-toggle="true"
            :mode="revenueBreakdownMode"
            @update:mode="revenueBreakdownMode = $event"
          />
        </transition>
      </div>

      <RevPlanTable
        ref="revPlanTableRef"
        :project="project"
        :show-skeleton="showRevPlansSkeleton"
        :month-columns="monthColumns"
        :plan-status-by-id="revPlansMeta?.planStatusById || {}"
        :rows="tableRows"
        :can-edit-lines="canEditLines"
        :is-post-journal-state="isPostJournalState"
        :on-upload-click="openBulkUpload"
        @table-change="handleTableChange"
      />
    </section>

    <AppModal
      v-model="showMissingCompletedJournalWarning"
      variant="error"
      title="Missing Completed Journals"
      icon="alert-circle-outline"
      :actions="[
        {
          label: 'Dismiss & continue',
          variant: 'ghost',
          onClick: dismissMissingCompletedJournalWarning,
          disabled: isGeneratingRevRec,
        },
        {
          label: isGeneratingRevRec ? 'Generating...' : 'Re-generate Missing Journals',
          variant: 'primary',
          onClick: confirmRegenerateMissingCompletedJournals,
          disabled: isGeneratingRevRec,
        },
      ]"
    >
      <template #subtitle>
        <span
          v-if="missingCompletedJournalsSubtitle"
          style="white-space: normal"
          v-html="missingCompletedJournalsSubtitle"
        ></span>
      </template>
    </AppModal>

    <AppModal
      v-model="showRevRecConfirm"
      variant="warning"
      title="Confirm Journal Generation"
      icon="notebook-plus-outline"
      :actions="[
        {
          label: 'Cancel',
          variant: 'ghost',
          onClick: closeRevRecConfirm,
          disabled: isGeneratingRevRec,
        },
        {
          label: isGeneratingRevRec ? 'Generating...' : 'Continue',
          variant: 'primary',
          onClick: confirmRevRecGenerate,
          disabled: isGeneratingRevRec,
        },
      ]"
    >
      <template #subtitle>
        <span
          v-if="revRecConfirmSubtitle"
          style="white-space: normal"
          v-html="revRecConfirmSubtitle"
        ></span>
        <span v-else>Proceed with rev rec journal generation for current month?</span>
      </template>
    </AppModal>

    <AppModal
      v-model="showBadAllocationWarning"
      variant="warning"
      title="Allocation mismatch"
      icon="alert-circle-outline"
      :actions="[{ label: 'OK', variant: 'warning', onClick: closeBadAllocationWarning }]"
    >
      <template #subtitle>
        Quantity allocation is incorrect on {{ allocationValidation.badAllocationCount }} line{{
          allocationValidation.badAllocationCount === 1 ? '' : 's'
        }}. Ensure for every line: <strong>Actual + Forecast + Contingency = Total Qty</strong>.
        {{
          badAllocationWarningContext === 'confirm'
            ? 'Please fix the allocation before confirming allocation.'
            : badAllocationWarningContext === 'save'
              ? 'Please fix the allocation before saving allocation.'
              : 'Please fix the allocation before generating the rev rec journal.'
        }}
      </template>
    </AppModal>

    <AppModal
      v-model="showGeneratePlanConfirm"
      title="Generate Revenue Plan"
      icon="calendar-plus-outline"
      :actions="[
        { label: 'Cancel', variant: 'ghost', onClick: closeGeneratePlanConfirm },
        { label: 'Generate', variant: 'primary', onClick: confirmGenerateMissingMonths },
      ]"
    >
      <template #subtitle>
        Generate the revenue plans for <strong>{{ project?.name }}</strong
        >?
      </template>
    </AppModal>

    <AppModal
      v-model="showConfirmAllocation"
      variant="warning"
      title="Confirm Submission to Finance"
      icon="check-circle-outline"
      :actions="[
        { label: 'Cancel', variant: 'ghost', onClick: closeConfirmAllocation },
        {
          label: isUpdatingAllocation ? 'Submitting...' : 'Continue',
          variant: 'primary',
          onClick: confirmAllocationUpdate,
          disabled: isUpdatingAllocation,
        },
      ]"
    >
      <template #subtitle>
        <span v-html="submitToFinanceConfirmSubtitle"></span>
      </template>
    </AppModal>

    <AppModal
      v-model="showReopenAllocationConfirm"
      variant="warning"
      title="Reopen Allocation"
      icon="lock-open-outline"
      :actions="[
        { label: 'Cancel', variant: 'ghost', onClick: closeReopenAllocationConfirm },
        { label: 'Reopen', variant: 'warning', onClick: confirmReopenAllocationUpdate },
      ]"
    >
      <template #subtitle>
        This will set <strong>{{ project?.name }}</strong> status back to <strong>Open</strong> and
        re-enable editing of the lines. Do you want to proceed?
      </template>
    </AppModal>

    <UnsavedChangesModal
      :model-value="showUnsavedLeaveConfirm"
      title="Unsaved changes"
      :subtitle="
        'You have unsaved changes' +
        (project?.name ? ` for ${project.name}` : '') +
        '. What would you like to do?'
      "
      icon="content-save-alert-outline"
      secondary-label="Stay"
      secondary-variant="ghost"
      :on-secondary="stayOnPage"
      tertiary-label="Leave without saving"
      tertiary-variant="error"
      :on-tertiary="discardAndLeave"
      primary-label="Save & Leave"
      primary-variant="primary"
      :on-primary="saveAndLeave"
      :on-close="stayOnPage"
    />
    <RelatedRecordsPanel
      v-model="showRelatedRecordsPanel"
      title="Related Records"
      :project-id="projectId"
    />
    <ProjectMonthAdminPanel
      v-model="showProjectMonthAdminPanel"
      :project-id="projectId"
      :can-edit="can('project.update')"
      :show-handle="can('project.update')"
    />
    <ProjectNotesPanel v-model="showProjectNotesModal" :project-id="projectId" />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

@keyframes shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
  color: var(--text-h, #243224);
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
}

.project-card {
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 5px;
  padding: 14px 14px 18px 14px;
  position: relative;
}
.project-card:has(.project-card-layout.is-collapsed) {
  padding: 1px 14px 1px;
}

.sk-h1 {
  width: min(320px, 68%);
  height: 34px;
}
.sk-pill {
  width: 120px;
  height: 28px;
  border-radius: 999px;
}
.sk-sub {
  width: min(380px, 78%);
  height: 16px;
}
.sk-total-k {
  width: 140px;
  height: 10px;
}
.sk-total-v {
  width: 160px;
  height: 34px;
  margin-top: 8px;
}
.sk-date-k {
  width: 80px;
  height: 10px;
}
.sk-date-v {
  width: 96px;
  height: 16px;
  margin-top: 6px;
}

.project-card-toggle {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  border-radius: 10px;
  border: 1px solid var(--border-strong, rgba(15, 23, 42, 0.12));
  background: var(--surface-2, rgba(15, 23, 42, 0.04));
  color: var(--text-h, #0f172a);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.project-card-toggle:hover {
  background: var(--surface-2, rgba(15, 23, 42, 0.06));
}
.project-card-toggle:focus-visible {
  outline: 2px solid rgba(0, 165, 106, 0.5);
  outline-offset: 2px;
}
.project-card-toggle-icon {
  font-size: 16px;
  line-height: 1;
  font-weight: 900;
  transform: translateY(-0.5px);
}

.project-card-layout {
  display: grid;
  grid-template-columns: minmax(350px, 1fr) auto;
  gap: 26px;
  align-items: stretch;
}
.project-card-layout.is-collapsed {
  grid-template-columns: 1fr;
}
.project-card-left {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.project-card-title-row {
  display: flex;
  align-items: start;
  column-gap: 12px;
  flex-wrap: wrap;
  margin-block: 10px;
}
.status-pill--current {
  background: rgba(0, 165, 106, 0.06) !important;
  color: rgba(0, 165, 106, 1) !important;
  border: 1px solid rgba(0, 165, 106, 0.85);
  padding: 7px 14px !important;
  font-weight: 600;
  letter-spacing: 0.03em;
}
.lock-pill {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(245, 158, 11, 0.45);
  background: rgba(245, 158, 11, 0.16);
  color: #d97706;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.project-card-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.1;
  font-weight: 500;
  color: var(--text-h, #0f172a);
  letter-spacing: -0.03em;
}

.project-card-sub {
  margin: 0;
  font-size: 13px;
  color: var(--text, #6b7280);
  line-height: 1.6;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.project-card-sub-sep {
  opacity: 0.35;
}
.project-card-sub-dates {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text, #6b7280);
}
.project-card-sub-to {
  opacity: 0.5;
  font-size: 11px;
}
.project-banner-card {
  margin-top: 10px;
}

.project-card-right {
  display: grid;
  grid-template-rows: auto;
  gap: 20px;
  align-content: stretch;
  align-self: center;
  padding-inline: 2rem;
}
.project-card-right-body {
  display: grid;
  grid-template-columns: minmax(180px, 1fr);
  gap: 20px;
  align-items: start;
  align-self: end;
}

.project-card-totals {
  margin-top: 1.5rem;
  display: flex;
  flex-direction: row;
  gap: 0;
  align-items: stretch;
}
.project-card-total {
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* padding: 0 10px; */
}
.project-card-total-stack-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  row-gap: 0.5rem;
  column-gap: 3rem;
  align-items: start;
}
.dept-enter-active,
.dept-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease,
    max-height 0.3s ease;
}
.dept-enter-from,
.dept-leave-to {
  opacity: 0;
  transform: translateY(-6px);
  max-height: 0;
}
.dept-enter-to,
.dept-leave-from {
  opacity: 1;
  transform: translateY(0);
  max-height: 400px;
}
.dept-leave-active {
  overflow: hidden;
}
.summary-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  border: none;
  background: transparent;
  cursor: pointer;
  margin-bottom: 0;
}
.summary-toggle--mobile {
  display: none;
}
.summary-toggle-hero {
  align-self: flex-start;
  margin-top: auto;
  padding-top: 14px;
}
.summary-toggle svg {
  transition: transform 0.2s ease;
}
.summary-toggle svg.rotated {
  transform: rotate(180deg);
}

@media (max-width: 896px) {
  .project-card-layout {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .project-card-right {
    grid-template-rows: auto;
    gap: 14px;
    padding-left: 0;
  }
  .project-card-right-body {
    grid-template-columns: 1fr;
    gap: 14px;
    align-self: stretch;
  }
  .project-card-right-sep {
    display: none;
  }
  .project-card-totals {
    flex-direction: column;
    align-items: start;
    max-width: 100%;
  }
  .project-card-total {
    padding: 0;
  }
  .project-card-total-stack-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .project-card-totalvalue {
    justify-self: start;
    text-align: left;
  }

  .summary-toggle--desktop {
    display: none;
  }
  .summary-toggle--mobile {
    display: inline-flex;
    padding-top: 6px;
  }
}
</style>
