<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick, markRaw, reactive } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import DatePicker from 'primevue/datepicker'
import Menu from 'primevue/menu'
import { useTopbarStore } from '@/stores/topbar'
import { useProjectsStore } from '@/stores/projects'
import { useToastStore } from '@/stores/toast'
import StatusBadge from '@/components/StatusBadge.vue'
import AppModal from '@/components/AppModal.vue'
import ProjectBanner from '@/components/ProjectBanner.vue'
import BlockingOverlay from '@/components/BlockingOverlay.vue'
import RelatedRecordsPanel from '@/components/RelatedRecordsPanel.vue'
import ProjectMonthAdminPanel from '@/components/ProjectMonthAdminPanel.vue'
import TableIcon from '@/components/icons/TableIcon.vue'
import RelatedRecordsIcon from '@/components/icons/RelatedRecordsIcon.vue'
import EditIcon from '@/components/icons/EditIcon.vue'
import LabourIcon from '@/components/icons/LabourIcon.vue'
import BoxIcon from '@/components/icons/BoxIcon.vue'
import ProjectDocumentsSection from '@/components/ProjectDocumentsSection.vue'
import ProjectNotesPanel from '@/components/ProjectNotesPanel.vue'
import UnsavedChangesModal from '@/components/UnsavedChangesModal.vue'
import Breakdowns from '@/components/Breakdowns.vue'
import ProjectPhasesSection from '@/components/ProjectPhasesSection.vue'
import { formatMoney, formatMoneyCompact } from '@/common'
import { useAuthz } from '@/composables/useAuthz'
import { useBannerUi } from '@/composables/useBannerUi'
import ProjectStats from '@/components/ProjectStats.vue'

const route = useRoute()
const router = useRouter()
const topbar = useTopbarStore()
const projectsStore = useProjectsStore()
const toast = useToastStore()
const projectId = computed(() => route.params.projectId)
const { can } = useAuthz({ projectId })
const { resolveProjectBannerUi } = useBannerUi({ projectId })
const project = computed(
  () => projectsStore.projects.find((item) => item.id === projectId.value) || null,
)
const phases = computed(() => projectsStore.phasesByProject[projectId.value] || [])
const projectLoad = computed(
  () => projectsStore.projectLoadByProject[String(projectId.value || '')] || null,
)
const projectLoadLoading = computed(() =>
  Boolean(projectsStore.projectLoadInFlightByProject[String(projectId.value || '')]),
)
const initDataReady = computed(() => Boolean(projectsStore.initData.fetchedAt))
const phaseLookupsReady = computed(
  () =>
    Boolean(projectsStore.phaseLookups.fetchedAt) &&
    String(projectsStore.phaseLookups.projectId || '') === String(projectId.value || ''),
)

const showDeptDetails = ref(false)
const showFullDescription = ref(false)
const statusActionsMenuRef = ref(null)
const statusActionLoadingKey = ref('')
const showEditProjectModal = ref(false)
const isSavingProject = ref(false)
const showProjectNotesModal = ref(false)
const showProjectMonthAdminPanel = ref(false)
const donutMounted = ref(false)
const isDeletingPhase = ref(false)
const showUnsavedDocsModal = ref(false)
const pendingRoutePath = ref('')
const docsSectionRef = ref(null)
const descRef = ref(null)
const descriptionOverflows = ref(false)
const showRelatedRecordsPanel = ref(false)
const descriptionText = computed(() => String(projectMeta.value?.description || ''))
const hasHandledMissingProject = ref(false)

const phaseDrafts = ref([])
const hasUnsavedPhaseChanges = ref(false)
const hasUnsavedStagedDocuments = ref(false)
const restrictExistingPhaseDetailsToRateQty = computed(() =>
  Boolean(projectLoad.value?.restrictExistingPhaseDetailsToRateQty),
)
const isProjectClosed = computed(() => {
  const normalized = String(projectLoad.value?.status?.key || project.value?.status?.key || '')
    .trim()
    .toLowerCase()
  return normalized === 'closed'
})
const isProjectCompleted = computed(() => {
  const normalized = String(projectLoad.value?.status?.key || project.value?.status?.key || '')
    .trim()
    .toLowerCase()
  return normalized === 'completed'
})
const isProjectLockedForJnlProc = computed(() => Boolean(projectLoad.value?.isLockedForJnlProc))
const isProjectReadOnly = computed(
  () =>
    isProjectLockedForJnlProc.value ||
    Boolean(projectLoad.value?.isCompleted) ||
    Boolean(projectLoad.value?.isClosed) ||
    isProjectCompleted.value ||
    isProjectClosed.value,
)
const isProjectFrozen = computed(
  () =>
    Boolean(projectLoad.value?.isFrozen) ||
    isProjectLockedForJnlProc.value ||
    Boolean(projectLoad.value?.isClosed) ||
    isProjectClosed.value,
)

const isEditingProject = computed(
  () => Boolean(showEditProjectModal.value) || Boolean(isSavingProject.value),
)

function showFrozenToast() {
  toast.show({
    message: isProjectLockedForJnlProc.value
      ? 'Project is locked for journal processing. Please wait until processing is completed.'
      : isProjectFrozen.value
        ? 'Project is Closed and frozen. Editing is no longer allowed.'
        : 'Project is Completed. Allocation editing is no longer allowed.',
    variant: 'warning',
    durationMs: 6000,
  })
}

const showPageSkeleton = computed(() => {
  const pid = String(projectId.value || '')
  const projectsLoading =
    Boolean(projectsStore.projectsInFlight) && !projectsStore.projectsFetchedAt
  const projectMissing = !project.value
  const loadColdLoading =
    Boolean(projectLoadLoading.value) && !projectsStore.projectLoadFetchedAtByProject?.[pid]

  return projectsLoading || projectMissing || loadColdLoading
})

const shouldRedirectMissingProject = computed(() => {
  const pid = String(projectId.value || '').trim()
  if (!pid) return false
  if (hasHandledMissingProject.value) return false
  if (projectsStore.projectsInFlight) return false
  if (!projectsStore.projectsFetchedAt) return false
  return !project.value
})

async function recalcDescriptionOverflow() {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const el = descRef.value
  if (!el) {
    descriptionOverflows.value = false
    return
  }
  // Only meaningful when the text is in the collapsed state (max-height applied).
  if (showFullDescription.value) {
    descriptionOverflows.value = true
    return
  }
  descriptionOverflows.value = el.scrollHeight > el.clientHeight + 1
}

function toggleDescription() {
  showFullDescription.value = !showFullDescription.value
  recalcDescriptionOverflow()
}

const projectMeta = computed(() => {
  if (!project.value) return null
  return {
    owner: project.value.pm || '—',
    contractValue: project.value.budget ?? '$0',
    description: project.value.description || '—',
  }
})

const projectStatusPill = computed(() => {
  return String(project.value?.status?.label ?? '—')
})

const projectStatusBadgeColor = computed(() => {
  return project.value?.statusColor || '#6b7280'
})

function formatDisplayDate(value) {
  if (!value) return '—'
  if (typeof projectsStore._formatDisplayDate === 'function') {
    return projectsStore._formatDisplayDate(value) || '—'
  }
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    .format(parsed)
    .replace(',', '')
}

const timelineStart = computed(() => formatDisplayDate(project.value?.startDate))
const timelineEnd = computed(() => formatDisplayDate(project.value?.endDate))

function parseDateValue(value) {
  if (!value) return null
  const raw = String(value).trim()
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const year = parseInt(iso[1], 10)
    const month = parseInt(iso[2], 10)
    const day = parseInt(iso[3], 10)
    const parsed = new Date(year, month - 1, day)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  let parsed = null
  if (m) {
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    const year = parseInt(m[3], 10)
    let day = a
    let month = b
    if (a <= 12 && b > 12) {
      day = b
      month = a
    }
    parsed = new Date(year, month - 1, day)
  } else {
    parsed = new Date(raw)
  }
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

const timelineProgressPct = computed(() => {
  const recognized = Number(projectLoad.value?.completionCheck?.recognizedAmount || 0)
  const contract = Number(projectLoad.value?.completionCheck?.contractValue || 0)
  if (!Number.isFinite(contract) || contract <= 0) return 0
  if (!Number.isFinite(recognized) || recognized <= 0) return 0
  const pct = (recognized / contract) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
})

const DONUT_CIRCUMFERENCE = 188.5
const donutAnimOffset = computed(() =>
  donutMounted.value
    ? DONUT_CIRCUMFERENCE * (1 - timelineProgressPct.value / 100)
    : DONUT_CIRCUMFERENCE,
)
const recognizedAmountForCompletion = computed(() =>
  Number(projectLoad.value?.completionCheck?.recognizedAmount || 0),
)
const completionTargetAmount = computed(() =>
  Number(projectLoad.value?.completionCheck?.contractValue || 0),
)

const milestoneSummary = computed(
  () =>
    projectsStore.projectFinancialsByProject[String(projectId.value || '')]?.milestoneSummary || [],
)
const deptTotals = computed(
  () =>
    projectsStore.projectFinancialsByProject[String(projectId.value || '')]?.totals || {
      projectTotal: 0,
      soTotal: 0,
      variance: 0,
    },
)

function phaseLineTotal(phase) {
  const qty = Number(phase?.definedQty || 0)
  const rate = Number(phase?.rate || 0)
  if (!Number.isFinite(qty) || !Number.isFinite(rate)) return 0
  return qty * rate
}

const draftProjectTotal = computed(() =>
  phaseDrafts.value.reduce((sum, phase) => sum + phaseLineTotal(phase), 0),
)

const deptTotalsDisplay = computed(() => {
  const soTotal = Number(deptTotals.value?.soTotal || 0)
  const projectTotal = draftProjectTotal.value
  return {
    projectTotal,
    soTotal,
    variance: projectTotal - soTotal,
  }
})

const subcontractorCost = computed(() => {
  const rows = Array.isArray(projectLoad.value?.relatedRecords?.vendorBills)
    ? projectLoad.value.relatedRecords.vendorBills
    : []
  return rows.reduce((sum, row) => sum + Number(row?.amount || 0), 0)
})

const materialCost = computed(() => {
  const rows = Array.isArray(projectLoad.value?.relatedRecords?.inventoryAdjustments)
    ? projectLoad.value.relatedRecords.inventoryAdjustments
    : []
  return rows.reduce((sum, row) => sum + Number(row?.amount || 0), 0)
})

const projectStats = computed(() => [
  {
    label: 'Subcontractor Cost',
    value: Number(subcontractorCost.value || 0),
    icon: markRaw(LabourIcon),
  },
  {
    label: 'Material Cost',
    value: Number(materialCost.value || 0),
    icon: markRaw(BoxIcon),
  },
])

const milestoneSummaryDisplay = computed(() => {
  const base = Array.isArray(milestoneSummary.value) ? milestoneSummary.value : []
  const soByKey = {}
  base.forEach((row) => {
    const key = row?.key != null ? String(row.key) : ''
    if (!key) return
    soByKey[key] = {
      key,
      itemId: row?.itemId != null ? String(row.itemId) : null,
      label: row?.label || row?.memo || '',
      memo: row?.memo || '',
      soTotal: Number(row?.soTotal || 0),
      revenueAmount: Number(row?.revenueAmount || 0),
      invoicedAmount: Number(row?.invoicedAmount || 0),
    }
  })

  const phaseByKey = {}
  phaseDrafts.value.forEach((phase) => {
    const key = milestoneValueForPhase(phase)
    if (!key) return
    phaseByKey[key] = (phaseByKey[key] ?? 0) + phaseLineTotal(phase)
  })

  const allKeys = new Set([...Object.keys(soByKey), ...Object.keys(phaseByKey)])
  const rows = Array.from(allKeys).map((key) => {
    const baseRow = soByKey[key] || {}
    const parts = String(key || '').split('|||')
    const itemId = parts.length ? parts[0] : ''
    const memo = parts.length > 1 ? parts.slice(1).join('|||') : ''
    const soTotal = Number(baseRow.soTotal || 0)
    const revenueAmount = Number(baseRow.revenueAmount || 0)
    const invoicedAmount = Number(baseRow.invoicedAmount || 0)
    const phaseTotal = Number(phaseByKey[key] || 0)
    const label = baseRow.label || memo || 'Unassigned'
    return {
      key,
      itemId: baseRow.itemId || (itemId ? String(itemId) : null),
      memo: baseRow.memo || memo || '',
      label,
      phaseTotal,
      revenueAmount,
      soTotal,
      invoicedAmount,
      variance: phaseTotal - soTotal,
      isTotal: false,
    }
  })

  rows.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')))
  if (!rows.length) return rows

  const totalRow = rows.reduce(
    (acc, row) => ({
      key: '__total__',
      itemId: null,
      memo: '',
      label: 'Total',
      phaseTotal: Number(acc.phaseTotal || 0) + Number(row.phaseTotal || 0),
      revenueAmount: Number(acc.revenueAmount || 0) + Number(row.revenueAmount || 0),
      soTotal: Number(acc.soTotal || 0) + Number(row.soTotal || 0),
      invoicedAmount: Number(acc.invoicedAmount || 0) + Number(row.invoicedAmount || 0),
      variance: Number(acc.variance || 0) + Number(row.variance || 0),
      isTotal: true,
    }),
    {
      key: '__total__',
      itemId: null,
      memo: '',
      label: 'Total',
      phaseTotal: 0,
      revenueAmount: 0,
      soTotal: 0,
      invoicedAmount: 0,
      variance: 0,
      isTotal: true,
    },
  )

  return [totalRow, ...rows]
})

const milestoneBreakdownColumns = computed(() => [
  { key: 'label', label: 'Milestone' },
  { key: 'phaseTotal', label: 'Project Total' },
  { key: 'revenueAmount', label: 'Revenue Amount' },
  { key: 'soTotal', label: 'SO Total' },
  { key: 'invoicedAmount', label: 'Invoiced Amount' },
])

const milestoneBreakdownRows = computed(() =>
  milestoneSummaryDisplay.value.map((row) => ({
    key: row.key || row.label,
    label: row.label,
    values: [row.phaseTotal, row.revenueAmount, row.soTotal, row.invoicedAmount],
    isTotal: Boolean(row.isTotal),
  })),
)

const varianceValue = computed(() => {
  return Number(deptTotalsDisplay.value.variance || 0)
})

const varianceToleranceAmount = computed(() => {
  const fromLoad = Number(projectLoad.value?.varianceTolerance?.effectiveTolerance)
  if (Number.isFinite(fromLoad) && fromLoad > 0) return fromLoad

  const s = projectsStore.initData?.settings || {}
  const percRaw = Number(s?.varianceTolerancePercent)
  const perc =
    Number.isFinite(percRaw) && percRaw > 0 ? (percRaw > 1 ? percRaw / 100 : percRaw) : NaN
  const abs = Number(s?.varianceToleranceAbsolute)
  const projectTotal = Math.abs(Number(deptTotalsDisplay.value?.projectTotal || 0))
  const candidates = []
  if (Number.isFinite(abs) && abs > 0) candidates.push(abs)
  if (Number.isFinite(perc) && perc > 0 && projectTotal > 0) candidates.push(projectTotal * perc)
  if (candidates.length) return Math.min(...candidates)
  return 0.005
})
const hasVariance = computed(
  () => Math.abs(varianceValue.value) - varianceToleranceAmount.value > 1e-9,
)
const varianceWithinTolerance = computed(
  () => Math.abs(varianceValue.value) > 0 && !hasVariance.value,
)
const varianceToleranceBadgeLabel = computed(() => {
  const cfg = projectLoad.value?.varianceTolerance || null
  if (cfg && cfg.selectedSource && cfg.selectedSource !== 'default') {
    const amount = Number(cfg.effectiveTolerance)
    if (Number.isFinite(amount) && amount > 0) return `Tolerance: ${formatMoney(amount)}`
  }
  const s = projectsStore.initData?.settings || {}
  const percRaw = Number(s?.varianceTolerancePercent)
  const perc =
    Number.isFinite(percRaw) && percRaw > 0 ? (percRaw > 1 ? percRaw / 100 : percRaw) : NaN
  const abs = Number(s?.varianceToleranceAbsolute)
  const projectTotal = Math.abs(Number(deptTotalsDisplay.value?.projectTotal || 0))
  const hasPerc = Number.isFinite(perc) && perc > 0
  const hasAbs = Number.isFinite(abs) && abs > 0
  const percentAmount = hasPerc && projectTotal > 0 ? projectTotal * perc : null
  if (hasPerc && hasAbs && Number.isFinite(percentAmount) && percentAmount != null) {
    return `Tolerance: ${formatMoney(Math.min(percentAmount, abs))}`
  }
  if (hasPerc && Number.isFinite(percentAmount) && percentAmount != null)
    return `Tolerance: ${formatMoney(percentAmount)}`
  if (hasAbs) return `Tolerance: ${formatMoney(abs)}`
  return ''
})

function formatToleranceAmountCompact(value) {
  const n = Math.abs(Number(value || 0))
  if (!Number.isFinite(n) || n <= 0) return '$0'
  if (n < 1) return `$${n.toFixed(2)}`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 100) return `$${n.toFixed(2).replace(/\.00$/, '')}`
  return `$${n.toFixed(0)}`
}

const varianceToleranceInlineLabel = computed(() => {
  const cfg = projectLoad.value?.varianceTolerance || null
  if (cfg && cfg.selectedSource && cfg.selectedSource !== 'default') {
    return `Tol ±${formatToleranceAmountCompact(cfg.effectiveTolerance)}`
  }

  const s = projectsStore.initData?.settings || {}
  const percRaw = Number(s?.varianceTolerancePercent)
  const perc =
    Number.isFinite(percRaw) && percRaw > 0 ? (percRaw > 1 ? percRaw / 100 : percRaw) : NaN
  const abs = Number(s?.varianceToleranceAbsolute)
  const projectTotal = Math.abs(Number(deptTotalsDisplay.value?.projectTotal || 0))
  const hasPerc = Number.isFinite(perc) && perc > 0
  const hasAbs = Number.isFinite(abs) && abs > 0
  const percentAmount = hasPerc && projectTotal > 0 ? projectTotal * perc : null
  if (hasPerc && hasAbs && Number.isFinite(percentAmount)) {
    return `Tol ±${formatToleranceAmountCompact(Math.min(percentAmount, abs))}`
  }
  if (hasPerc && Number.isFinite(percentAmount))
    return `Tol ±${formatToleranceAmountCompact(percentAmount)}`
  if (hasAbs) return `Tol ±${formatToleranceAmountCompact(abs)}`
  return ''
})

const shouldWarnAddPhase = computed(() => {
  return (
    can('phase.upsert') &&
    Boolean(projectLoad.value) &&
    Boolean(projectLoad.value?.canCreatePhase) &&
    !Boolean(projectLoad.value?.hasVariance) &&
    !hasVariance.value &&
    phases.value.length > 0
  )
})
const addPhaseConfirmSubtitle = computed(() => {
  if (varianceWithinTolerance.value) {
    return `The current Project vs Sales Order variance is within tolerance (${varianceToleranceBadgeLabel.value || 'configured tolerance'}). Adding another phase may push it outside tolerance. Do you want to proceed?`
  }
  return 'The Project total currently matches the Sales Order(s) total. Adding another phase will likely create a mismatch. Do you want to proceed?'
})

const statusActionEntries = computed(() => {
  const actions = projectLoad.value?.statusActions || {}
  const load = projectLoad.value || {}
  const blockedByFreeze = isProjectFrozen.value
  return [
    {
      key: 'activate',
      transition: 'activate',
      label: actions?.activate?.label || 'Activate Project',
      allowed:
        (can('project.activate') || can('project.status.transition')) &&
        !blockedByFreeze &&
        Boolean(actions?.activate?.allowed ?? load.canActivate),
      reason: blockedByFreeze
        ? 'Project is Closed and frozen.'
        : actions?.activate?.reason || '',
    },
    {
      key: 'on_hold',
      transition: 'on_hold',
      label: actions?.onHold?.label || 'Put On Hold',
      allowed:
        (can('project.hold') || can('project.status.transition')) &&
        !blockedByFreeze &&
        Boolean(actions?.onHold?.allowed ?? load.canPutOnHold),
      reason: blockedByFreeze ? 'Project is Closed and frozen.' : actions?.onHold?.reason || '',
    },
    {
      key: 'complete',
      transition: 'complete',
      label: actions?.complete?.label || 'Mark Complete',
      allowed:
        (can('project.complete') || can('project.status.transition')) &&
        !blockedByFreeze &&
        Boolean(actions?.complete?.allowed ?? load.canMarkComplete),
      reason: blockedByFreeze
        ? 'Project is Closed and frozen.'
        : actions?.complete?.reason || '',
    },
    {
      key: 'close',
      transition: 'close',
      label: actions?.close?.label || 'Close Project',
      allowed:
        (can('project.close') || can('project.status.transition')) &&
        !blockedByFreeze &&
        Boolean(actions?.close?.allowed ?? load.canClose),
      reason: blockedByFreeze
        ? 'Project is Closed and frozen.'
        : actions?.close?.reason || '',
    },
  ]
})

const projectBannerUi = computed(() => {
  const banner = projectLoad.value?.projectBanner
  if (!banner || typeof banner !== 'object') return null
  const code = banner?.code || null
  if (!code) return null
  const ui = resolveProjectBannerUi(code)
  if (!ui?.message) return null
  const variant = ui?.variant || banner?.variant || 'info'
  return {
    variant,
    message: ui.message,
    html: Boolean(ui.html),
    role: variant === 'warning' || variant === 'error' ? 'alert' : 'status',
  }
})

function goToRevPlan() {
  router
    .push({ name: 'revenue-detail', params: { projectId: String(projectId.value || '') } })
    .catch(() => {})
}

const projectEditForm = reactive({
  name: '',
  description: '',
  startDate: null,
  endDate: null,
  customerId: '',
  projectManagerId: '',
  departmentId: '',
  poRef: '',
})

const projectEditLookupsLoading = ref(false)
const projectEditSubmitAttempted = ref(false)

const canSubmitProjectEdit = computed(() => {
  const nameOk = Boolean(String(projectEditForm.name || '').trim())
  const startOk =
    projectEditForm.startDate instanceof Date && !Number.isNaN(projectEditForm.startDate.getTime())
  const endOk =
    projectEditForm.endDate instanceof Date && !Number.isNaN(projectEditForm.endDate.getTime())
  const customerOk = Boolean(String(projectEditForm.customerId || '').trim())
  const pmOk = Boolean(String(projectEditForm.projectManagerId || '').trim())
  const rangeOk =
    startOk && endOk
      ? projectEditForm.endDate.getTime() >= projectEditForm.startDate.getTime()
      : true
  return (
    can('project.update') &&
    nameOk &&
    startOk &&
    endOk &&
    customerOk &&
    pmOk &&
    rangeOk &&
    !projectEditLookupsLoading.value &&
    !isSavingProject.value
  )
})

const projectEditNameMissing = computed(() => !String(projectEditForm.name || '').trim())
const projectEditStartDateMissing = computed(
  () =>
    !(
      projectEditForm.startDate instanceof Date &&
      !Number.isNaN(projectEditForm.startDate.getTime())
    ),
)
const projectEditEndDateMissing = computed(
  () =>
    !(projectEditForm.endDate instanceof Date && !Number.isNaN(projectEditForm.endDate.getTime())),
)
const projectEditCustomerMissing = computed(() => !String(projectEditForm.customerId || '').trim())
const projectEditPmMissing = computed(() => !String(projectEditForm.projectManagerId || '').trim())
const projectEditMissingRequiredFields = computed(
  () =>
    projectEditNameMissing.value ||
    projectEditStartDateMissing.value ||
    projectEditEndDateMissing.value ||
    projectEditCustomerMissing.value ||
    projectEditPmMissing.value,
)

const projectEditDateRangeInvalid = computed(() => {
  const startOk =
    projectEditForm.startDate instanceof Date && !Number.isNaN(projectEditForm.startDate.getTime())
  const endOk =
    projectEditForm.endDate instanceof Date && !Number.isNaN(projectEditForm.endDate.getTime())
  if (!startOk || !endOk) return false
  return projectEditForm.endDate.getTime() < projectEditForm.startDate.getTime()
})

const customerOptions = computed(() => {
  const rows = Array.isArray(projectsStore.projectEditLookups?.customers)
    ? projectsStore.projectEditLookups.customers
    : []
  const opts = rows
    .map((c) => ({ value: c?.id != null ? String(c.id) : '', label: c?.name || '' }))
    .filter((o) => o.value && o.label)
  const selected = projectEditForm.customerId ? String(projectEditForm.customerId) : ''
  if (selected && !opts.some((o) => o.value === selected)) {
    opts.unshift({ value: selected, label: project.value?.client || `Customer ${selected}` })
  }
  return opts
})

const projectManagerOptions = computed(() => {
  const rows = Array.isArray(projectsStore.projectEditLookups?.projectManagers)
    ? projectsStore.projectEditLookups.projectManagers
    : []
  const opts = rows
    .map((e) => ({ value: e?.id != null ? String(e.id) : '', label: e?.name || '' }))
    .filter((o) => o.value && o.label)
  const selected = projectEditForm.projectManagerId ? String(projectEditForm.projectManagerId) : ''
  if (selected && !opts.some((o) => o.value === selected)) {
    opts.unshift({ value: selected, label: project.value?.pm || `Employee ${selected}` })
  }
  return opts
})

const projectDepartmentOptions = computed(() => {
  const rows = Array.isArray(projectsStore.projectEditLookups?.departments)
    ? projectsStore.projectEditLookups.departments
    : []
  const opts = rows
    .map((d) => ({ value: d?.id != null ? String(d.id) : '', label: d?.name || '' }))
    .filter((o) => o.value && o.label)
  const selected = projectEditForm.departmentId ? String(projectEditForm.departmentId) : ''
  if (selected && !opts.some((o) => o.value === selected)) {
    opts.unshift({ value: selected, label: project.value?.department || `Department ${selected}` })
  }
  return opts
})

function hydrateProjectEditForm() {
  projectEditForm.name = String(project.value?.name || '').trim()
  projectEditForm.description = String(project.value?.description || '')
  projectEditForm.startDate = parseDateValue(project.value?.startDate)
  projectEditForm.endDate = parseDateValue(project.value?.endDate)
  projectEditForm.customerId =
    project.value?.customerId != null ? String(project.value.customerId) : ''
  projectEditForm.projectManagerId =
    project.value?.projectManagerId != null ? String(project.value.projectManagerId) : ''
  projectEditForm.departmentId =
    project.value?.departmentId != null ? String(project.value.departmentId) : ''
  projectEditForm.poRef = String(project.value?.poRef || '')
}

async function openEditProjectModal() {
  if (!projectId.value) return
  if (isProjectReadOnly.value) {
    showFrozenToast()
    return
  }
  if (isEditingPhase.value) {
    toast.show({ message: 'Finish editing phases before editing the project.', variant: 'info' })
    return
  }
  hydrateProjectEditForm()
  projectEditSubmitAttempted.value = false
  showEditProjectModal.value = true

  if (initDataReady.value) return
  projectEditLookupsLoading.value = true
  try {
    await projectsStore.fetchInitData()
  } catch {
    // ignore (modal can still be used even if lookups fail to load)
  } finally {
    projectEditLookupsLoading.value = false
  }
}

function closeEditProjectModal() {
  if (isSavingProject.value) return
  showEditProjectModal.value = false
  projectEditSubmitAttempted.value = false
}

async function handleSubmitProjectEditClick() {
  projectEditSubmitAttempted.value = true
  if (!canSubmitProjectEdit.value) {
    toast.show({ message: 'Please fill in all required fields marked with *.', variant: 'warning' })
    return
  }
  await submitProjectEdit()
}

async function submitProjectEdit() {
  if (!projectId.value) return
  const name = String(projectEditForm.name || '').trim()
  if (!name) {
    toast.show({ message: 'Project name is required.', variant: 'error' })
    return
  }
  if (
    !(projectEditForm.startDate instanceof Date) ||
    Number.isNaN(projectEditForm.startDate.getTime())
  ) {
    toast.show({ message: 'Start date is required.', variant: 'error' })
    return
  }
  if (
    !(projectEditForm.endDate instanceof Date) ||
    Number.isNaN(projectEditForm.endDate.getTime())
  ) {
    toast.show({ message: 'End date is required.', variant: 'error' })
    return
  }
  if (projectEditForm.endDate.getTime() < projectEditForm.startDate.getTime()) {
    toast.show({ message: 'End date cannot be before start date.', variant: 'error' })
    return
  }
  if (!String(projectEditForm.customerId || '').trim()) {
    toast.show({ message: 'Customer is required.', variant: 'error' })
    return
  }
  if (!String(projectEditForm.projectManagerId || '').trim()) {
    toast.show({ message: 'Project manager is required.', variant: 'error' })
    return
  }

  showEditProjectModal.value = false
  isSavingProject.value = true
  try {
    const endDate =
      projectEditForm.endDate instanceof Date && !Number.isNaN(projectEditForm.endDate.getTime())
        ? `${projectEditForm.endDate.getFullYear()}-${String(projectEditForm.endDate.getMonth() + 1).padStart(2, '0')}-${String(projectEditForm.endDate.getDate()).padStart(2, '0')}`
        : null

    await projectsStore.upsertProject({
      projectId: projectId.value,
      project: {
        name,
        description: String(projectEditForm.description || ''),
        // Start date is disabled in UI; omit to avoid "cannot change" validation edge cases.
        endDate,
        customer: projectEditForm.customerId || null,
        projectManager: projectEditForm.projectManagerId || null,
        department: projectEditForm.departmentId || null,
        poRef: String(projectEditForm.poRef || ''),
      },
    })
    toast.show({ message: 'Project updated successfully.', variant: 'success' })
  } catch (e) {
    showEditProjectModal.value = true
    toast.show({ message: e?.message || String(e), variant: 'error', durationMs: 6000 })
  } finally {
    isSavingProject.value = false
  }
}

function openStatusActionsMenu(event) {
  statusActionsMenuRef.value?.toggle(event)
}

const hasAvailableStatusAction = computed(() =>
  statusActionEntries.value.some((action) => action.allowed && action.key !== 'on_hold'),
)

const statusActionMenuItems = computed(() =>
  statusActionEntries.value.map((action) => ({
    label: action.label,
    disabled: !action.allowed || Boolean(statusActionLoadingKey.value),
    command: () => applyProjectStatusTransition(action.transition),
  })),
)

async function applyProjectStatusTransition(transition) {
  const pid = String(projectId.value || '')
  const action = String(transition || '')
  if (!pid || !action) return
  statusActionLoadingKey.value = action
  try {
    const res = await projectsStore.transitionProjectStatus({
      projectId: pid,
      transition: action,
    })
    toast.show({
      message: res?.message || 'Project status updated.',
      variant: 'success',
    })
  } catch (e) {
    toast.show({ message: e?.message || String(e), variant: 'error', durationMs: 6000 })
  } finally {
    statusActionLoadingKey.value = ''
  }
}

const phasesMaximized = ref(false)
const bulkEditMode = ref(false)

const isEditingPhase = computed(() => Boolean(bulkEditMode.value))

function milestoneValueForPhase(phase) {
  const desc = phase?.milestoneDesc || phase?.milestone || phase?.serviceItem || ''
  if (!phase?.milestoneId || !desc) return ''
  return `${String(phase.milestoneId)}|||${String(desc)}`
}

watch(
  () => String(projectId.value || ''),
  () => {
    hasHandledMissingProject.value = false
    showProjectNotesModal.value = false
    showUnsavedDocsModal.value = false
  },
  { immediate: true },
)

watch(
  shouldRedirectMissingProject,
  (shouldRedirect) => {
    if (!shouldRedirect) return
    hasHandledMissingProject.value = true
    router.replace({ name: 'projects' }).catch(() => {})
    toast.show({ message: 'Page cannot be found.', variant: 'error', durationMs: 10000 })
  },
  { immediate: true },
)

onMounted(() => {
  projectsStore.fetchProjects().catch(() => {})

  // Ensure phase lookups are loading early on page load (not when opening the modal).
  if (projectId.value && !phaseLookupsReady.value) {
    projectsStore
      .fetchPhaseLookupsForProject({ projectId: projectId.value })
      .catch((e) => console.log('Failed to preload phase lookups', e))
  }

  if (projectId.value) {
    projectsStore
      .fetchProjectLoad({ projectId: projectId.value })
      .catch((e) => console.log('Failed to preload project load', e))
  }

  recalcDescriptionOverflow()
  window.addEventListener('resize', recalcDescriptionOverflow)
  window.addEventListener('beforeunload', handleBeforeUnload)

  // Trigger donut draw-in animation after first paint
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      donutMounted.value = true
    }),
  )
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', recalcDescriptionOverflow)
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

onBeforeRouteLeave((to) => {
  if (isDeletingPhase.value) {
    toast.show({
      message: 'Phase deletion in progress. Please wait.',
      variant: 'warning',
      durationMs: 4000,
    })
    return false
  }
  if (hasUnsavedPhaseChanges.value) {
    return true
  }
  if (hasUnsavedStagedDocuments.value) {
    openUnsavedDocsModal({ routePath: to.fullPath || '' })
    return false
  }
  return true
})

function openUnsavedDocsModal({ routePath = '' } = {}) {
  pendingRoutePath.value = String(routePath || '')
  showUnsavedDocsModal.value = true
}

function continueWithStagedDocs() {
  pendingRoutePath.value = ''
  showUnsavedDocsModal.value = false
}

function discardStagedDocsAndContinue() {
  docsSectionRef.value?.clearStagedFiles?.()
  const target = String(pendingRoutePath.value || '')
  pendingRoutePath.value = ''
  showUnsavedDocsModal.value = false
  if (target) router.push(target).catch(() => {})
}

function handleBeforeUnload(e) {
  if (isDeletingPhase.value) {
    e.preventDefault()
    e.returnValue = ''
    return ''
  }
  if (!hasUnsavedStagedDocuments.value) return
  e.preventDefault()
  e.returnValue = ''
  return ''
}

watch(descriptionText, () => {
  showFullDescription.value = false
  recalcDescriptionOverflow()
})

watch(
  () => phasesMaximized.value,
  () => {
    recalcDescriptionOverflow()
  },
)

function updateTopbar() {
  const actions = []

  actions.push({
    key: 'related-records',
    label: 'Related Records',
    icon: markRaw(RelatedRecordsIcon),
    variant: 'secondary',
    loading: false,
    onClick: () => {
      showRelatedRecordsPanel.value = true
    },
  })

  actions.push({
    key: 'go-rev-plan',
    label: isProjectFrozen.value ? 'View Rev Plans' : 'Manage Rev Plan',
    icon: markRaw(TableIcon),
    variant: 'outline',
    loading: false,
    onClick: goToRevPlan,
  })

  if (!isEditingPhase.value && !isProjectReadOnly.value && can('project.update')) {
    actions.push({
      key: 'edit-project',
      label: 'Edit Project',
      icon: markRaw(EditIcon),
      variant: 'primary',
      loading: isSavingProject.value,
      onClick: openEditProjectModal,
    })
  }

  topbar.setTopbar({
    title: 'Project Phases',
    subtitle: 'Create and update project phases.',
    backRouteName: 'projects',
    actions,
  })
}

watch(
  [
    statusActionEntries,
    statusActionLoadingKey,
    isSavingProject,
    isProjectFrozen,
    isProjectReadOnly,
    bulkEditMode,
    phases,
    projectId,
  ],
  () => updateTopbar(),
  { immediate: true },
)
</script>

<template>
  <section class="page">
    <BlockingOverlay
      v-if="isSavingProject"
      title="Saving project…"
      subtitle="Please wait while we update the project."
    />
    <BlockingOverlay
      v-else-if="statusActionLoadingKey"
      title="Applying status change…"
      subtitle="Please wait while we update the project status."
    />
    <BlockingOverlay
      v-else-if="isDeletingPhase"
      title="Deleting phase…"
      subtitle="Please wait while we delete the phase and related rev plans."
    />
    <div v-if="showPageSkeleton" class="project-skeleton">
      <div class="sk-hero">
        <div>
          <div class="sk-row">
            <div class="sk sk-title"></div>
            <div class="sk sk-pill"></div>
            <div class="sk sk-pill"></div>
          </div>
          <div class="sk sk-desc"></div>
          <div class="sk sk-desc sk-desc--2"></div>
          <div class="sk sk-desc sk-desc--3"></div>
          <ProjectStats skeleton :skeleton-count="3" />
        </div>

        <div class="sk-info-card">
          <div class="flex-between">
            <div class="sk sk-customer"></div>
            <div class="sk sk-customer"></div>
          </div>

          <hr class="green-divider" />

          <div class="green-timeline-head">
            <div class="sk sk-desc sk-desc--3"></div>
          </div>

          <div class="green-rev-layout">
            <div class="sk-rev-dates">
              <div class="sk sk-dates"></div>
              <div class="sk sk-dates"></div>
            </div>

            <div class="sk sk-donut"></div>
          </div>
        </div>
      </div>

      <ProjectPhasesSection
        skeleton
        :project-id="String(projectId || '')"
        :phases="[]"
        :project-load-loading="true"
        :is-project-frozen="false"
        :is-project-locked-for-jnl-proc="false"
        :is-editing-project="false"
        :restrict-existing-phase-details-to-rate-qty="false"
        :should-warn-add-phase="false"
        :add-phase-confirm-subtitle="''"
        :phases-maximized="false"
      />

      <ProjectDocumentsSection skeleton />
    </div>

    <template v-else>
      <transition name="overview">
        <div v-if="!phasesMaximized" class="project-overview">
          <div class="project-hero">
            <div class="project-hero-main">
              <div class="project-title-row">
                <h2 class="project-title">{{ project?.name ?? 'Project' }}</h2>
                <StatusBadge
                  class="status-pill"
                  :label="projectStatusPill"
                  :color="projectStatusBadgeColor"
                />
                <span v-if="isProjectLockedForJnlProc" class="lock-pill">🔒 Processing</span>
                <span v-if="project?.poRef" class="po-pill" :title="`PO# ${String(project.poRef)}`">
                  PO# {{ project.poRef }}
                </span>
                <span
                  v-if="project?.department"
                  class="department-pill"
                  :title="`Department ${String(project.department)}`"
                >
                  Dept: {{ project.department }}
                </span>
                <span
                  v-if="!isEditingPhase && !isProjectFrozen && statusActionEntries.length"
                  class="pj-status-menu-wrap"
                >
                  <button
                    type="button"
                    class="pj-status-menu-btn"
                    :class="{ 'pj-status-menu-btn--dot': hasAvailableStatusAction }"
                    :disabled="Boolean(statusActionLoadingKey)"
                    @click="openStatusActionsMenu($event)"
                  >
                    <svg
                      v-if="!statusActionLoadingKey"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      width="16"
                      height="16"
                    >
                      <circle cx="12" cy="5" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="12" cy="19" r="1.5" />
                    </svg>
                    <span v-else class="pj-status-menu-spinner"></span>
                  </button>
                  <span class="pj-status-menu-tooltip" role="tooltip">Change project status</span>
                </span>
                <Menu ref="statusActionsMenuRef" :model="statusActionMenuItems" popup />
              </div>
              <p ref="descRef" class="project-desc" :class="{ expanded: showFullDescription }">
                {{ projectMeta?.description }}
              </p>
              <span
                v-if="descriptionOverflows && !showFullDescription"
                class="project-desc-ellipsis"
                aria-hidden="true"
                >...</span
              >
              <button
                v-if="descriptionOverflows"
                type="button"
                class="read-more"
                @click="toggleDescription"
              >
                {{ showFullDescription ? 'Read less' : 'Read more' }}
              </button>

              <ProjectBanner
                v-if="projectBannerUi"
                :variant="projectBannerUi.variant"
                :role="projectBannerUi.role"
                class="project-banner-hero"
              >
                <span v-if="projectBannerUi.html" v-html="projectBannerUi.message"></span>
                <span v-else>{{ projectBannerUi.message }}</span>
              </ProjectBanner>

              <ProjectStats :stats="projectStats" />

              <hr class="project-divider" />
              <div class="project-totals">
                <div class="project-total-stat">
                  <span>Project Total</span>
                  <strong :title="formatMoney(deptTotalsDisplay.projectTotal)">{{
                    formatMoneyCompact(deptTotalsDisplay.projectTotal)
                  }}</strong>
                </div>
                <div class="project-total-stat">
                  <span>SO Total</span>
                  <strong :title="formatMoney(deptTotalsDisplay.soTotal)">{{
                    formatMoneyCompact(deptTotalsDisplay.soTotal)
                  }}</strong>
                </div>
                <div
                  class="project-total-stat"
                  :class="{
                    'project-total-stat--variance': hasVariance,
                    'project-total-stat--within': varianceWithinTolerance,
                  }"
                >
                  <span>
                    Variance
                    <em v-if="varianceToleranceInlineLabel" class="variance-tol-inline">
                      ({{ varianceToleranceInlineLabel }})
                    </em>
                  </span>
                  <strong :title="formatMoney(deptTotalsDisplay.variance)">{{
                    formatMoneyCompact(deptTotalsDisplay.variance)
                  }}</strong>
                  <small v-if="varianceWithinTolerance" class="variance-note"
                    >Within tolerance</small
                  >
                </div>
              </div>
              <button
                type="button"
                class="summary-toggle summary-toggle-hero"
                @click="showDeptDetails = !showDeptDetails"
              >
                <span>{{ showDeptDetails ? 'Hide breakdown' : 'Show milestone breakdown' }}</span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  width="16"
                  height="16"
                  :class="{ rotated: showDeptDetails }"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
            <div class="project-info-card">
              <div class="green-two-col">
                <div class="green-row">
                  <div class="green-icon">
                    <i class="mdi mdi-office-building-outline"></i>
                  </div>
                  <div class="green-body">
                    <div class="green-label">Customer</div>
                    <div class="green-value">{{ project?.client ?? '—' }}</div>
                  </div>
                </div>

                <div class="green-row green-row-owner">
                  <div class="green-icon">
                    <i class="mdi mdi-account-outline"></i>
                  </div>
                  <div class="green-body">
                    <div>
                      <div class="green-label">Project Manager</div>
                      <div class="green-value">{{ project?.pm ?? '—' }}</div>
                    </div>
                  </div>
                </div>
              </div>

              <hr class="green-divider" />

              <div class="green-timeline-head">
                <span class="green-timeline-icon" aria-hidden="true">
                  <i class="mdi mdi-clock-outline"></i>
                </span>
                <span class="green-timeline-title">Project Timeline & Completion</span>
              </div>

              <div class="green-rev-layout">
                <!-- Left: dates stacked -->
                <div class="green-rev-dates">
                  <div class="green-rev-date-item">
                    <div class="green-timeline-k">Start Date</div>
                    <div class="green-timeline-v">{{ timelineStart }}</div>
                  </div>
                  <div class="green-rev-date-divider"></div>
                  <div class="green-rev-date-item">
                    <div class="green-timeline-k">End Date</div>
                    <div class="green-timeline-v">{{ timelineEnd }}</div>
                  </div>
                </div>

                <!-- Right: donut -->
                <div class="green-rev-donut-wrap">
                  <svg class="green-rev-donut" viewBox="0 0 80 80" aria-hidden="true">
                    <circle
                      cx="40"
                      cy="40"
                      r="30"
                      fill="none"
                      stroke="rgba(0,165,106,0.18)"
                      stroke-width="8"
                      class="green-rev-donut-track"
                    />
                    <circle
                      cx="40"
                      cy="40"
                      r="30"
                      fill="none"
                      stroke="#00a56a"
                      stroke-width="8"
                      stroke-linecap="round"
                      class="green-rev-donut-arc"
                      :stroke-dasharray="DONUT_CIRCUMFERENCE"
                      :stroke-dashoffset="donutAnimOffset"
                      transform="rotate(-90 40 40)"
                    />
                  </svg>
                  <!-- Default label: percentage -->
                  <div class="green-rev-donut-label green-rev-donut-label--default">
                    <div class="green-rev-donut-pct">{{ timelineProgressPct }}%</div>
                    <div class="green-rev-donut-sub">Completed</div>
                  </div>
                  <!-- Hover label: recognized amount -->
                  <div class="green-rev-donut-label green-rev-donut-label--hover">
                    <div
                      class="green-rev-donut-pct green-rev-donut-pct--amount"
                      :title="formatMoney(recognizedAmountForCompletion)"
                    >
                      {{ formatMoneyCompact(recognizedAmountForCompletion) }}
                    </div>
                    <div class="green-rev-donut-sub">Recognized</div>
                  </div>
                  <div class="green-rev-donut-amounts">
                    <span
                      class="green-rev-donut-recognized"
                      :title="formatMoney(recognizedAmountForCompletion)"
                    >
                      {{ formatMoneyCompact(recognizedAmountForCompletion) }}
                    </span>
                    <span class="green-rev-donut-sep">/</span>
                    <span
                      class="green-rev-donut-total"
                      :title="formatMoney(completionTargetAmount)"
                    >
                      {{ formatMoneyCompact(completionTargetAmount) }} RECOGNISED
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <transition name="dept">
            <Breakdowns
              v-if="showDeptDetails"
              :open="showDeptDetails"
              title="Totals Breakdown by Milestone"
              :columns="milestoneBreakdownColumns"
              :rows="milestoneBreakdownRows"
            />
          </transition>
        </div>
      </transition>

      <ProjectPhasesSection
        :project-id="projectId"
        :phases="phases"
        :project-load-loading="projectLoadLoading"
        :is-project-frozen="isProjectReadOnly || !can('phase.upsert')"
        :is-project-locked-for-jnl-proc="isProjectLockedForJnlProc"
        :is-editing-project="isEditingProject"
        :restrict-existing-phase-details-to-rate-qty="restrictExistingPhaseDetailsToRateQty"
        :should-warn-add-phase="shouldWarnAddPhase"
        :add-phase-confirm-subtitle="addPhaseConfirmSubtitle"
        :phases-maximized="phasesMaximized"
        @update:phases-maximized="phasesMaximized = $event"
        @update:is-deleting-phase="isDeletingPhase = $event"
        @update:is-editing-phase="bulkEditMode = $event"
        @update:has-unsaved-phase-changes="hasUnsavedPhaseChanges = $event"
        @update:phase-drafts="phaseDrafts = $event"
        @request-collapse-side-panels="showDeptDetails = false"
      />

      <ProjectDocumentsSection
        ref="docsSectionRef"
        :project-id="projectId"
        :hidden="phasesMaximized"
        @update:has-unsaved-staged-documents="hasUnsavedStagedDocuments = $event"
      />

      <AppModal
        v-model="showEditProjectModal"
        title="Edit project"
        subtitle="Update the project details."
        width="min(720px, 92vw)"
        :actions="[
          {
            label: 'Cancel',
            variant: 'ghost',
            disabled: isSavingProject,
            onClick: closeEditProjectModal,
          },
          {
            label: 'Save',
            variant: 'primary',
            disabled: isSavingProject || projectEditLookupsLoading,
            onClick: handleSubmitProjectEditClick,
          },
        ]"
      >
        <div class="project-edit-form">
          <label class="project-edit-field">
            <span class="project-edit-label"
              >Name <span class="project-edit-required" aria-hidden="true">*</span></span
            >
            <InputText
              v-model="projectEditForm.name"
              :class="[
                'form-ctrl',
                { 'form-ctrl--invalid': projectEditSubmitAttempted && projectEditNameMissing },
              ]"
            />
          </label>

          <label class="project-edit-field">
            <span class="project-edit-label">Description</span>
            <textarea
              v-model="projectEditForm.description"
              class="project-edit-textarea"
              rows="3"
            />
          </label>

          <div class="project-edit-row">
            <label class="project-edit-field">
              <span class="project-edit-label"
                >Start date <span class="project-edit-required" aria-hidden="true">*</span></span
              >
              <DatePicker
                v-model="projectEditForm.startDate"
                :class="[
                  'form-ctrl form-ctrl--readonly',
                  {
                    'form-ctrl--invalid':
                      projectEditSubmitAttempted && projectEditStartDateMissing,
                  },
                ]"
                date-format="yy-mm-dd"
                show-icon
                :show-clear="false"
                disabled
              />
            </label>
            <label class="project-edit-field">
              <span class="project-edit-label"
                >End date <span class="project-edit-required" aria-hidden="true">*</span></span
              >
              <DatePicker
                v-model="projectEditForm.endDate"
                :class="[
                  'form-ctrl',
                  {
                    'form-ctrl--invalid':
                      projectEditDateRangeInvalid ||
                      (projectEditSubmitAttempted && projectEditEndDateMissing),
                  },
                ]"
                date-format="yy-mm-dd"
                show-icon
                :show-clear="false"
                :min-date="projectEditForm.startDate || undefined"
              />
            </label>
          </div>

          <p v-if="projectEditDateRangeInvalid" class="project-edit-error">
            End date cannot be before start date.
          </p>

          <div class="project-edit-row">
            <label class="project-edit-field">
              <span class="project-edit-label"
                >Customer <span class="project-edit-required" aria-hidden="true">*</span></span
              >
              <Select
                v-model="projectEditForm.customerId"
                :options="customerOptions"
                option-label="label"
                option-value="value"
                placeholder="Select a customer"
                filter
                :loading="projectEditLookupsLoading"
                :class="[
                  'form-ctrl',
                  {
                    'form-ctrl--invalid':
                      projectEditSubmitAttempted && projectEditCustomerMissing,
                  },
                ]"
              />
            </label>

            <label class="project-edit-field">
              <span class="project-edit-label"
                >Project manager
                <span class="project-edit-required" aria-hidden="true">*</span></span
              >
              <Select
                v-model="projectEditForm.projectManagerId"
                :options="projectManagerOptions"
                option-label="label"
                option-value="value"
                placeholder="Select a project manager"
                filter
                :loading="projectEditLookupsLoading"
                :class="[
                  'form-ctrl',
                  { 'form-ctrl--invalid': projectEditSubmitAttempted && projectEditPmMissing },
                ]"
              />
            </label>
          </div>
          <div class="project-edit-row">
            <label class="project-edit-field">
              <span class="project-edit-label">Department</span>
              <Select
                v-model="projectEditForm.departmentId"
                :options="projectDepartmentOptions"
                option-label="label"
                option-value="value"
                placeholder="Select a department"
                filter
                :loading="projectEditLookupsLoading"
                class="form-ctrl"
              />
            </label>
            <label class="project-edit-field">
              <span class="project-edit-label">PO ref</span>
              <InputText v-model="projectEditForm.poRef" class="form-ctrl" />
            </label>
          </div>

          <p class="project-edit-help">
            <span class="project-edit-required" aria-hidden="true">*</span> Required fields. Start
            Date cannot be changed once set.
          </p>
          <p
            v-if="projectEditSubmitAttempted && projectEditMissingRequiredFields"
            class="project-edit-error"
          >
            Please fill in all required fields marked with *.
          </p>
        </div>
      </AppModal>

      <ProjectNotesPanel v-model="showProjectNotesModal" :project-id="projectId" />
      <ProjectMonthAdminPanel
        v-model="showProjectMonthAdminPanel"
        :project-id="projectId"
        :can-edit="can('project.update')"
        :show-handle="can('project.update')"
      />

      <UnsavedChangesModal
        :model-value="showUnsavedDocsModal"
        title="Unsaved files"
        subtitle="You have files staged for upload that are not uploaded yet."
        variant="warning"
        secondary-label="Continue editing"
        secondary-variant="ghost"
        :on-secondary="continueWithStagedDocs"
        primary-label="Discard staged files"
        primary-variant="primary"
        :on-primary="discardStagedDocsAndContinue"
        :on-close="continueWithStagedDocs"
      />
      <RelatedRecordsPanel
        v-model="showRelatedRecordsPanel"
        title="Related Records"
        :project-id="projectId"
      />
    </template>
  </section>
</template>

<style scoped>
/* ── Project status actions menu button ──────────────────── */
.pj-status-menu-wrap {
  position: relative;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
}

.pj-status-menu-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--border-strong, #e1e6dc);
  background: var(--surface-1, #fff);
  color: var(--text, #6b7280);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
}

.pj-status-menu-btn:hover:not(:disabled) {
  background: var(--surface-2, #f7faf8);
  border-color: var(--accent, #00a56a);
  color: var(--accent, #00a56a);
}

.pj-status-menu-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pj-status-menu-btn--dot::after {
  content: '';
  position: absolute;
  top: 3px;
  right: 3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent, #00a56a);
  border: 1.5px solid var(--surface-1, #fff);
  animation: pj-dot-pulse 2s ease-in-out infinite;
}

@keyframes pj-dot-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(0, 165, 106, 0.6);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(0, 165, 106, 0);
  }
}

.pj-status-menu-spinner {
  display: inline-block;
  width: 13px;
  height: 13px;
  border: 2px solid var(--border-strong, #e1e6dc);
  border-top-color: var(--accent, #00a56a);
  border-radius: 50%;
  animation: pj-spin 0.7s linear infinite;
}

.pj-status-menu-tooltip {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translate(-50%, -4px);
  opacity: 0;
  pointer-events: none;
  white-space: nowrap;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--tooltip-border, rgba(255, 255, 255, 0.08));
  background: var(--tooltip-bg, var(--sidebar-tooltip-bg, #1f2b1f));
  color: var(--tooltip-fg, #ffffff);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  box-shadow: var(--tooltip-shadow, 0 8px 18px rgba(15, 23, 42, 0.18));
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  z-index: 20;
}

.pj-status-menu-wrap:hover .pj-status-menu-tooltip,
.pj-status-menu-btn:focus-visible + .pj-status-menu-tooltip {
  opacity: 1;
  transform: translate(-50%, 0);
}

@keyframes pj-spin {
  to {
    transform: rotate(360deg);
  }
}

.project-edit-form {
  display: grid;
  gap: 12px;
  padding-top: 2px;
  max-height: calc(100vh - 13rem);
  overflow: auto;
}

.project-edit-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (width<=640px) {
  .project-edit-row {
    grid-template-columns: 1fr;
  }
}

.project-edit-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  color: var(--text, #5b6b5b);
}

.project-edit-textarea {
  width: 100%;
}

.project-edit-textarea {
  border: 1px solid var(--border-strong, #e1e6dc);
  background: var(--surface-2, #f7fafc);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--text-h, #243224);
  font-size: 13px;
  line-height: 1.4;
  resize: vertical;
}

.project-edit-textarea:focus-visible {
  outline: none;
  border-color: var(--accent, #00a56a);
}

.project-edit-help {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text, rgba(15, 23, 42, 0.65));
}

.project-edit-error {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.35;
  color: var(--red, #ef4444);
}

.project-edit-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.project-edit-required {
  color: var(--accent, #00a56a);
  font-weight: 800;
}

:deep(.p-select-overlay) {
  border-radius: 12px;
  border: 1px solid var(--border-strong, #e1e6dc);
  background: var(--surface-1, #ffffff) !important;
  color: var(--text-h, #243224);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
}
:deep(.p-select-list-container),
:deep(.p-select-list) {
  background: var(--surface-1, #ffffff) !important;
  padding: 6px 0;
}
:deep(.p-select-option) {
  font-size: 13px;
  color: var(--text-h, #243224);
  padding: 8px 12px;
}
:deep(.p-select-option-label) {
  font-size: 13px;
}
:deep(.p-select-option.p-highlight) {
  background: var(--accent-bg, #e8f6ef);
  color: var(--text-h, #1f2b1f);
}
:deep(.p-select-filter-container) {
  padding: 8px 10px 6px;
}
:deep(.p-select-filter) {
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--border-strong, #e1e6dc);
  padding: 0 32px 0 10px;
  font-size: 13px;
  color: var(--text-h, #243224);
  background: var(--surface-2, #f7fafc) !important;
}
:deep(.p-select-filter-icon) {
  color: var(--text, #6b7768);
}

.project-skeleton {
  display: grid;
  grid-template-columns: 1fr;
  gap: 22px;
  align-items: start;
}
.sk-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sk-pill {
  width: 120px;
  height: 34px;
  border-radius: 999px;
}
.sk-title {
  width: 240px;
  height: 38px;
}
.sk-desc {
  margin-top: 10px;
  width: 100%;
  height: 18px;
}
.sk-desc--2 {
  width: 92%;
}
.sk-desc--3 {
  width: 78%;
}
.sk-customer {
  width: 160px;
  height: 60px;
}
.sk-rev-dates {
  margin-top: 1rem;
  gap: 1.5rem;
}
.sk-dates {
  width: 160px;
  height: 40px;
}
.sk-donut {
  width: 140px;
  height: 140px;
  border-radius: 50%;
}
.overview-enter-active,
.overview-leave-active {
  overflow: hidden;
  transition:
    opacity 0.22s ease,
    transform 0.22s ease,
    max-height 0.32s ease;
}
.overview-enter-from,
.overview-leave-to {
  opacity: 0;
  transform: translateY(-8px);
  max-height: 0;
}
.overview-enter-to,
.overview-leave-from {
  opacity: 1;
  transform: translateY(0);
  max-height: 1200px;
}

.project-overview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.project-hero,
.sk-hero {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(400px, 1fr);
  gap: 16px;
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border-strong, #e9efe4);
  border-radius: 5px;
  padding: 14px;
  /* box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06); */
}
.project-hero-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
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
.project-title-row {
  display: flex;
  align-items: start;
  column-gap: 12px;
  flex-wrap: wrap;
  margin-block: 10px;
}
.po-pill {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border-strong, #eef2ea);
  background: var(--surface-2, #f6f7f5);
  color: var(--text-h, #0f172a);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
}
.department-pill {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border-strong, #eef2ea);
  background: var(--surface-2, #f6f7f5);
  color: var(--text-h, #0f172a);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
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
.project-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.1;
  color: var(--text-h, #0f172a);
  letter-spacing: -0.03em;
}
.project-desc {
  margin: 0;
  color: var(--text, #6b7280);
  font-size: 13px;
  line-height: 1.6;
  max-width: 800px;
  max-height: 4.9em;
  overflow: hidden;
}
.project-desc.expanded {
  max-height: none;
}
.project-desc-ellipsis {
  display: inline-block;
  margin-top: -2px;
  color: var(--text, #6b7280);
  font-size: 13px;
  line-height: 1;
}
.read-more {
  background: none;
  border: none;
  color: var(--accent);
  font-weight: 600;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  text-align: start;
}
.project-divider {
  width: 100%;
  border: none;
  border-top: 1px solid var(--border-strong, #eef2ea);
  margin: 12px 0 10px;
}
.project-totals {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  align-items: start;
  max-width: 620px;
}

.project-banner-hero {
  margin-block: 12px;
  max-width: 800px;
}
.project-total-stat {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 0 14px;
}
.project-total-stat:not(:first-child) {
  padding-left: 12px;
  padding-right: 12px;
}
.project-total-stat:first-child {
  padding-left: 0;
}
.project-total-stat:last-child {
  padding-right: 0;
}
.project-total-stat:not(:first-child) {
  border-left: 1px solid var(--border-strong, #eef2ea);
}
.project-total-stat strong {
  font-weight: 800;
  font-size: 24px;
  line-height: 1;
  color: var(--text-h, #0f172a);
  letter-spacing: -0.02em;
  display: inline-block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.project-total-stat span {
  font-size: 9px;
  color: var(--text, #94a3b8);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.variance-tol-inline {
  margin-left: 6px;
  font-style: normal;
  font-size: 9px;
  font-weight: 700;
  color: var(--text, #94a3b8);
  letter-spacing: 0.02em;
}
.project-total-stat.negative strong {
  color: var(--red);
}
.project-total-stat.positive strong {
  color: var(--accent);
}
.project-total-stat--variance strong {
  color: var(--red);
}
.project-total-stat--within strong {
  color: var(--accent);
}
.variance-note {
  margin-top: 2px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
}
.project-info-card,
.sk-info-card {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.04) 0%, var(--surface-2, #effaf4) 100%);
  color: var(--text-h, #0f172a);
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-content: start;
  border: 1px solid var(--accent-border, rgba(0, 165, 106, 0.12));
  justify-self: end;
  width: 100%;
  max-width: 440px;
}

.green-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 8px 2px;
}
.green-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.green-two-col .green-row {
  padding: 0;
}
.green-icon {
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: var(--accent-bg, rgba(0, 165, 106, 0.12));
  color: var(--accent);
  display: grid;
  place-items: center;
}
.green-icon .mdi {
  font-size: 18px;
}
.green-label {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text, rgba(15, 23, 42, 0.46));
  font-weight: 700;
}
.green-value {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.18;
  color: var(--text-h, #0f172a);
}
.green-body {
  min-width: 0;
}

.green-divider {
  border: none;
  border-top: 1px solid var(--border-strong, rgba(15, 23, 42, 0.08));
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  width: 100%;
}
.green-timeline-head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px 0;
}
.green-timeline-icon {
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--accent);
  display: flex;
  justify-content: center;
  align-items: center;
  color: #ffffff;
}
.green-timeline-icon .mdi {
  font-size: 12px;
}
.green-timeline-title {
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text, rgba(15, 23, 42, 0.5));
  font-weight: 800;
}
.green-timeline-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 6px 2px 4px;
}
.green-timeline-sep {
  height: 28px;
  background: var(--border-strong, rgba(15, 23, 42, 0.08));
  border-radius: 999px;
}
.green-timeline-k {
  text-transform: uppercase;
  font-size: 10px;
  color: var(--text, rgba(15, 23, 42, 0.68));
  font-weight: 500;
}
.green-timeline-v {
  /* margin-top: 4px; */
  font-size: 13px;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--text-h, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Revenue recognition layout */
.green-rev-layout {
  display: flex;
  align-items: stretch;
  gap: 12px;
}
.green-rev-dates,
.sk-rev-dates {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  justify-content: start;
  padding-left: 6px;
}
.green-rev-date-item {
  padding: 4px 0;
}
.green-rev-date-divider {
  /* height: 1px; */
  background: rgba(255, 255, 255, 0.1);
  margin: 2px 0;
  flex-shrink: 0;
}
/* Donut wrapper */
.green-rev-donut-wrap {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  position: relative;
  padding: 0 0 4px;
  margin-top: -24px;
  cursor: default;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.green-rev-donut-wrap:hover {
  transform: scale(1.05);
}
.green-rev-donut {
  width: 180px;
  height: 180px;
}
/* Arc draw-in animation */
.green-rev-donut-arc {
  transition: stroke-dashoffset 1.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.green-rev-donut-wrap:hover .green-rev-donut-arc {
  filter: drop-shadow(0 0 3px rgba(0, 165, 106, 0.55));
}
.green-rev-donut-wrap:hover .green-rev-donut-track {
  stroke: rgba(0, 165, 106, 0.18);
}
/* Dual label cross-fade */
.green-rev-donut-label {
  position: absolute;
  top: 60px;
  left: 0;
  width: 100%;
  height: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}
.green-rev-donut-label--default {
  opacity: 1;
  transform: scale(1);
}
.green-rev-donut-wrap:hover .green-rev-donut-label--default {
  opacity: 0;
  transform: scale(0.88);
}
.green-rev-donut-label--hover {
  opacity: 0;
  transform: scale(0.88);
}
.green-rev-donut-wrap:hover .green-rev-donut-label--hover {
  opacity: 1;
  transform: scale(1);
}
.green-rev-donut-pct {
  font-size: 18px;
  font-weight: 900;
  color: var(--text-h, #0f172a);
  line-height: 1;
}
.green-rev-donut-pct--amount {
  font-size: 13px;
}
.green-rev-donut-sub {
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text, rgba(15, 23, 42, 0.55));
  margin-top: 2px;
}
.green-rev-donut-amounts {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text, rgba(15, 23, 42, 0.65));
  white-space: nowrap;
  line-height: normal;
}
.green-rev-donut-recognized {
  color: #00a56a;
  font-weight: 700;
}
.green-rev-donut-sep {
  color: var(--text, rgba(15, 23, 42, 0.45));
}
.green-rev-donut-total {
  color: var(--text, rgba(15, 23, 42, 0.7));
  font-weight: 600;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.summary-title {
  font-size: 20px;
  font-weight: 500;
  color: var(--text-h, #1f2b1f);
}
.plans-pill {
  --plans-color: #6b7280;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 6px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  line-height: normal;
  background: color-mix(in srgb, var(--plans-color) 14%, transparent);
  color: var(--plans-color);
  border: 1px solid color-mix(in srgb, var(--plans-color) 22%, transparent);
}
.plans-pill.is-ok {
  --plans-color: #00a56a;
}
.plans-pill.is-bad {
  --plans-color: #dc2626;
}
.plans-pill.is-warn {
  --plans-color: #e9762b;
}
.plans-pill.is-muted {
  --plans-color: #6b7280;
}
.progress-bar {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: var(--surface-3, #e6efe9);
  overflow: hidden;
}
.progress-bar span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
}
.progress-value {
  font-size: 11px;
  color: var(--text, #6b7280);
  line-height: normal;
}
@media (max-width: 980px) {
  .project-hero {
    grid-template-columns: 1fr;
  }
  .project-info-card {
    padding: 18px;
    max-width: 940px;
  }
  .green-timeline-v {
    font-size: 14px;
  }
  .green-two-col {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .project-totals {
    display: grid;
    grid-template-columns: 1fr;
  }
  .project-total-stat {
    padding: 0;
  }
  .project-total-stat:not(:first-child) {
    border-left: none;
    border-top: 1px solid var(--border-strong, #eef2ea);
    margin-top: 18px;
    padding-top: 18px;
  }
}
</style>
