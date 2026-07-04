<script setup>
import { useRouter } from 'vue-router'
import { computed, onMounted, ref, watch } from 'vue'
import { useTopbarStore } from '@/stores/topbar'
import DatatableCust from '@/components/DatatableCust.vue'
import NotebookPlusIcon from '@/components/icons/NotebookPlusIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import AppModal from '@/components/AppModal.vue'
import BlockingOverlay from '@/components/BlockingOverlay.vue'
import { useProjectsStore } from '@/stores/projects'
import { useToastStore } from '@/stores/toast'
import { useAuthz } from '@/composables/useAuthz'

const router = useRouter()
const topbar = useTopbarStore()
const projectsStore = useProjectsStore()
const toast = useToastStore()
const { can } = useAuthz()
const usePaginatedProjects = true
const projectsLoading = computed(
  () => Boolean(projectsStore.projectsInFlight) || Boolean(projectsStore.projectsPaginatedInFlight),
)
const tableLoading = computed(
  () =>
    Boolean(usePaginatedProjects) &&
    Boolean(projectsStore.projectsPaginatedInFlight) &&
    Boolean(projectsStore.projectsFetchedAt),
)

const columns = [
  { key: 'name', label: 'PROJECT NAME', sortable: true, thClass: 'pt-th--name' },
  {
    key: 'department',
    label: 'DEPARTMENT',
    sortable: true,
    thClass: 'pt-th--department',
    tdClass: 'pt-td--department',
  },
  {
    key: 'status',
    label: 'REV PLAN STATUS',
    sortable: true,
    thClass: 'pt-th--status',
  },
  {
    key: 'estimation',
    label: 'PROJECT TOTAL',
    sortable: false,
    thClass: 'pt-th--estimation',
    tdClass: 'pt-td--estimation',
  },
  {
    key: 'revenueReady',
    label: 'REVENUE READY',
    sortable: true,
    thClass: 'pt-th--recognized-month',
    tdClass: 'pt-td--recognized-month',
  },
  {
    key: 'amountRecognized',
    label: 'RECOGNIZED TO DATE',
    sortable: true,
    thClass: 'pt-th--recognized',
    tdClass: 'pt-td--recognized',
  },
  {
    key: 'invoicedToDate',
    label: 'BILLED TO DATE',
    sortable: false,
    thClass: 'pt-th--recognized',
    tdClass: 'pt-td--recognized',
  },
  {
    key: 'lastJournalPostedDate',
    label: 'LAST JNL POSTED',
    sortable: true,
  },
  { key: 'timeline', label: 'PROJECT TIMELINE', sortable: false, thClass: 'pt-th--timeline' },
]

const revPlanColors = {
  open: '#94a3b8',
  rev_rec_ready: '#f59e0b',
  completed: '#00a56a',
  cancelled: '#dc2626',
  mixed: '#f97316',
}

function formatMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '$0.00'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)
  } catch (e) {
    return `$${n.toFixed(2)}`
  }
}

function revenueReadyFromRevPlans(projectId) {
  const pid = String(projectId || '')
  if (!pid) return null
  const months = Array.isArray(projectsStore.backendMonthsByProject?.[pid])
    ? projectsStore.backendMonthsByProject[pid]
    : []
  const rows = Array.isArray(projectsStore.revenueRowsByProject?.[pid])
    ? projectsStore.revenueRowsByProject[pid]
    : []
  const meta =
    projectsStore.projectRevPlansMetaByProject?.[pid] &&
    typeof projectsStore.projectRevPlansMetaByProject[pid] === 'object'
      ? projectsStore.projectRevPlansMetaByProject[pid]
      : {}
  const planStatusById =
    meta?.planStatusById && typeof meta.planStatusById === 'object' ? meta.planStatusById : {}
  if (!months.length || !rows.length) return null

  const currentMonthIndex = months.findIndex((m) => Boolean(m?.isCurrent))
  if (currentMonthIndex < 0) return 0
  const keys = months
    .slice(0, currentMonthIndex + 1)
    .map((m) => m.key)
    .filter(Boolean)
  if (!keys.length) return 0

  return rows.reduce((sum, row) => {
    const rate = Number(row?.rate || 0)
    if (!Number.isFinite(rate) || rate <= 0) return sum
    const rowMonths = row?.months && typeof row.months === 'object' ? row.months : {}
    const planIds = row?.planIds && typeof row.planIds === 'object' ? row.planIds : {}
    return (
      sum +
      keys.reduce((rowSum, key) => {
        const ids = Array.isArray(planIds?.[key]) ? planIds[key].filter(Boolean).map(String) : []
        const firstId = ids.length ? ids[0] : ''
        const statusKey = String(planStatusById?.[firstId]?.status?.key || '')
        const isReadyStatus = statusKey === 'open' || statusKey === 'rev_rec_ready'
        if (!isReadyStatus) return rowSum
        const qty = Number(rowMonths?.[key] || 0)
        return rowSum + (Number.isFinite(qty) ? qty : 0) * rate
      }, 0)
    )
  }, 0)
}

const projects = computed(() =>
  projectsStore.projects.map((project) => {
    const pid = String(project?.id || '')
    const load = pid ? projectsStore.projectLoadByProject?.[pid] : null
    const recognizedRaw = Number(
      load?.completionCheck?.recognizedAmount ?? project?.amountRecognized ?? 0,
    )
    const billedRaw = Number(project?._invoicedToDateRaw ?? project?.invoicedToDate ?? 0)
    const contractRaw = Number(project?._contractValueRaw || 0)
    const recognizedPct =
      contractRaw > 0
        ? Math.max(0, Math.min(100, Math.round((recognizedRaw / contractRaw) * 100)))
        : 0
    const billedPct =
      contractRaw > 0 ? Math.max(0, Math.min(100, Math.round((billedRaw / contractRaw) * 100))) : 0
    const amountRecognizedText =
      contractRaw > 0
        ? `${formatMoney(recognizedRaw)} / ${formatMoney(contractRaw)}`
        : formatMoney(recognizedRaw)
    const billedToDateText =
      contractRaw > 0
        ? `${formatMoney(billedRaw)} / ${formatMoney(contractRaw)}`
        : formatMoney(billedRaw)

    const revenueReadyCalculated = revenueReadyFromRevPlans(pid)
    const revenueReadyRaw = Number(
      revenueReadyCalculated != null ? revenueReadyCalculated : project?._revenueReadyRaw || 0,
    )

    return {
      ...project,
      revPlanStatusConflict: Boolean(project.revPlanStatusConflict),
      status: project.revPlanStatusConflict
        ? 'Mixed'
        : project?.revPlanStatus?.label || 'Unknown',
      statusKey: project.revPlanStatusConflict
        ? 'mixed'
        : project?.revPlanStatus?.key || 'unknown',
      statusColor: null,
      amountRecognized: recognizedRaw,
      amountRecognizedPct: recognizedPct,
      amountRecognizedText,
      invoicedToDate: billedRaw,
      invoicedToDatePct: billedPct,
      invoicedToDateText: billedToDateText,
      revenueReady: formatMoney(revenueReadyRaw),
      _revenueReadyRaw: revenueReadyRaw,
    }
  }),
)
const showProjectsSkeleton = computed(
  () => Boolean(projectsLoading.value) && !projectsStore.projectsFetchedAt,
)
const canGenerateRevRec = computed(() => can('revrec.generate'))

const selectableProjects = computed(() =>
  projects.value.filter((project) => !project.isLockedForJnlProc),
)
const eligibleGenerateProjects = computed(() =>
  selectableProjects.value.filter((project) => {
    const pid = String(project?.id || '')
    const action = projectsStore.projectLoadByProject?.[pid]?.revRecGeneration?.generateJournalAction
    return Boolean(action?.visible) && Boolean(action?.enabled)
  }),
)
const canGenerate = computed(() => eligibleGenerateProjects.value.length > 0)
const showGenerateModal = ref(false)
const selectedProjectIds = ref([])
const isGeneratingJournals = ref(false)
const revListQuery = ref({
  page: 1,
  pageSize: 25,
  search: '',
  statusTabKey: 'all',
  sortBy: '',
  sortDir: 'asc',
})
const asyncThreshold = computed(() =>
  Number(projectsStore.initData?.settings?.revRecJournalBulkAsyncThreshold || 5),
)
const modalProjects = computed(() => eligibleGenerateProjects.value)

function syncTopbarActions() {
  topbar.setTopbar({
    title: 'Revenue Management',
    subtitle: 'Select a project to view revenue details and allocations.',
    backRouteName: null,
    actions: canGenerateRevRec.value && canGenerate.value
      ? [
          {
            key: 'generate-rev-rec-journal',
            label: 'Generate Rev Rec Journals',
            icon: NotebookPlusIcon,
            variant: 'primary',
            loading: false,
            onClick: handleGenerateJournal,
          },
        ]
      : [],
  })
}

function handleView(row) {
  router.push({ name: 'revenue-detail', params: { projectId: row.id } })
}

function handleGenerateJournal() {
  if (!canGenerate.value) {
    toast.show({ message: 'No projects are currently eligible for rev rec journal generation.', variant: 'warning' })
    return
  }
  selectedProjectIds.value = eligibleGenerateProjects.value.map((project) => project.id)
  showGenerateModal.value = true
}

function closeGenerateModal() {
  showGenerateModal.value = false
}

async function confirmGenerate() {
  if (!selectedProjectIds.value.length) return
  closeGenerateModal()
  isGeneratingJournals.value = true
  try {
    const previewResult = await projectsStore.fetchRevRecGenerationPreviews({
      projectIds: selectedProjectIds.value,
    })
    const blocked = Array.isArray(previewResult?.blocked) ? previewResult.blocked : []
    if (blocked.length) {
      const first = blocked[0]
      throw new Error(
        first?.message || 'Some selected projects are not eligible for rev rec journal generation.',
      )
    }

    const previews = Array.isArray(previewResult?.previews) ? previewResult.previews : []
    const disabledGeneration = previews.filter(
      (preview) =>
        !(preview?.generateJournalAction?.visible && preview?.generateJournalAction?.enabled),
    )
    if (disabledGeneration.length) {
      const first = disabledGeneration[0]
      throw new Error(
        first?.generateJournalAction?.reason ||
          first?.message ||
          'Some selected projects are not eligible for rev rec journal generation.',
      )
    }

    const lockedTargets = previews.filter((preview) => {
      const labels = Array.isArray(preview?.missingMonths) ? preview.missingMonths : []
      return labels.some((month) => Boolean(month?.locked))
    })
    if (lockedTargets.length) {
      const first = lockedTargets[0]
      const lockedNames = (first?.missingMonths || [])
        .filter((m) => m?.locked)
        .map((m) => m?.label || m?.key)
      throw new Error(
        `Missing month period is locked/closed for project ${first?.projectId || ''}${
          lockedNames.length ? ` (${lockedNames.join(', ')})` : ''
        }. Reopen the period first.`,
      )
    }

    await runBulkGeneration({
      projectIds: selectedProjectIds.value,
      mode: 'auto',
      forceMissingOpen: false,
    })
  } catch (error) {
    toast.show({
      message: error?.message || 'Failed to generate rev rec journals.',
      variant: 'error',
      durationMs: 10000,
    })
  } finally {
    isGeneratingJournals.value = false
  }
}

async function runBulkGeneration({ projectIds, mode, forceMissingOpen }) {
  const ids = Array.isArray(projectIds) ? projectIds.filter(Boolean) : []
  if (!ids.length) throw new Error('No projects left to generate journals for.')

  const selectedCount = ids.length
  const result = await projectsStore.generateRevRecJournals({
    projectIds: ids,
    mode,
    forceMissingOpen,
  })

  if (String(result?.mode || '').toLowerCase() === 'async') {
    const taskId = String(result?.taskId || '').trim()
    toast.show({
      message: `More than ${asyncThreshold.value} projects selected. Processing in background${
        taskId ? ` (Task ${taskId})` : ''
      }.`,
      variant: 'info',
      durationMs: 10000,
    })
    return
  }

  toast.show({
    message: `Rev Rec journals generated for ${selectedCount} project(s).`,
    variant: 'success',
  })
}

function hydrateListMetrics() {
  const ids = projectsStore.projects.map((p) => String(p?.id || '')).filter(Boolean)
  if (!ids.length) return
  Promise.all(
    ids.map((pid) =>
      Promise.all([
        projectsStore.fetchProjectLoad({ projectId: pid }).catch(() => null),
        projectsStore.fetchProjectRevPlans({ projectId: pid }).catch(() => null),
      ]),
    ),
  ).catch(() => {})
}

function mapRevListSortByToBackend(value) {
  const map = {
    name: 'name',
    amountRecognized: 'name',
    revenueReady: 'name',
    status: 'name',
    lastJournalPostedDate: 'lastModified',
  }
  return map[String(value || '').trim()] || 'name'
}

function toStatusKey(status) {
  const raw =
    status?.key != null
      ? String(status.key)
      : status?.valueKey != null
        ? String(status.valueKey)
        : ''
  return raw.trim().toLowerCase()
}

function mapRevPlanTabToKeys(tabKey) {
  const key = String(tabKey || '').trim().toLowerCase()
  if (!key || key === 'all') return []
  if (key === 'conflicts') return []
  return [key]
}

async function fetchRevenueProjectsPaginated(query) {
  const q = query && typeof query === 'object' ? query : revListQuery.value
  await projectsStore.fetchProjectsPaginated({
    page: Number(q.page || 1),
    pageSize: Number(q.pageSize || 25),
    search: String(q.search || '').trim(),
    sortBy: mapRevListSortByToBackend(q.sortBy),
    sortDir: String(q.sortDir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc',
    includeRevPlanCounters: true,
    revPlanStatusKeys: mapRevPlanTabToKeys(q.statusTabKey),
    revPlanStatusConflictOnly: String(q.statusTabKey || '').trim().toLowerCase() === 'conflicts',
  })
}

function handleRevListQueryChange(nextQuery) {
  if (!usePaginatedProjects) return
  revListQuery.value = {
    ...revListQuery.value,
    ...(nextQuery || {}),
  }
  fetchRevenueProjectsPaginated(revListQuery.value)
    .then(() => {
      hydrateListMetrics()
    })
    .catch((e) =>
      toast.show({ message: e?.message || 'Failed to fetch projects', variant: 'error' }),
    )
}

const revPlanStatusTabs = computed(() => {
  if (!usePaginatedProjects) return null
  const counters =
    projectsStore.projectsRevPlanStatusCounters &&
    typeof projectsStore.projectsRevPlanStatusCounters === 'object'
      ? projectsStore.projectsRevPlanStatusCounters
      : { all: 0 }
  const rows = Array.isArray(projectsStore.initData?.statuses?.revPlans)
    ? projectsStore.initData.statuses.revPlans
    : []
  const tabs = [{ key: 'all', label: 'All', count: Number(counters.all || 0) }]
  const seenKeys = new Set(['all'])
  rows.forEach((status) => {
    const key = toStatusKey(status)
    if (!key || seenKeys.has(key)) return
    seenKeys.add(key)
    tabs.push({
      key,
      label: `Rev Plan: ${String(status?.label || status?.key || key)}`,
      count: Number(counters[key] || 0),
    })
  })
  tabs.push({ key: 'conflicts', label: 'Conflicts', count: Number(counters.mixed || 0) })
  return tabs
})

onMounted(() => {
  syncTopbarActions()

  projectsStore.ensureHandlerUrl()
  if (!projectsStore.handlerUrl) {
    toast.show({
      message:
        'Backend handler URL is not set. Open the app via the Project Phase Management Suitelet (it injects window.PM_PROJECT_PHASE_HANDLER_URL), or set VITE_PM_PROJECT_PHASE_HANDLER_URL in dev.',
      variant: 'error',
      durationMs: 6000,
    })
    return
  }

  Promise.all([
    projectsStore.fetchInitData().catch(() => {}),
    usePaginatedProjects
      ? fetchRevenueProjectsPaginated(revListQuery.value).catch((e) =>
          toast.show({ message: e?.message || 'Failed to fetch projects', variant: 'error' }),
        )
      : projectsStore.fetchProjects({ force: true }).catch((e) =>
          toast.show({ message: e?.message || 'Failed to fetch projects', variant: 'error' }),
        ),
  ]).finally(() => {
    hydrateListMetrics()
  })
})

watch([canGenerateRevRec, canGenerate], () => {
  syncTopbarActions()
})
</script>

<template>
  <section class="page">
    <BlockingOverlay
      v-if="isGeneratingJournals"
      title="Generating Rev Rec Journal(s)…"
      subtitle="Please wait until the process finishes."
    />
    <div v-if="showProjectsSkeleton" class="projects-skeleton">
      <div class="sk-head">
        <div class="sk sk-title"></div>
        <div class="sk sk-btn"></div>
      </div>
      <div class="sk-table">
        <div v-for="i in 8" :key="i" class="sk-row">
          <div class="sk sk-cell" :class="{ 'sk-cell--lg': i == 1 }"></div>
          <div class="sk sk-cell" :class="{ 'sk-cell--lg': i == 1 }"></div>
          <div class="sk sk-cell" :class="{ 'sk-cell--lg': i == 1 }"></div>
          <div class="sk sk-cell" :class="{ 'sk-cell--lg': i == 1 }"></div>
          <div class="sk sk-cell" :class="{ 'sk-cell--lg': i == 1 }"></div>
        </div>
      </div>
    </div>

    <div v-else class="table-card">
      <DatatableCust
        :rows="projects"
        :columns="columns"
        row-key="id"
        tab-key-field="statusKey"
        :server-mode="usePaginatedProjects"
        :pagination="projectsStore.projectsPagination"
        :query="revListQuery"
        :loading="tableLoading"
        :tabs="revPlanStatusTabs"
        :show-tabs="true"
        :show-search="true"
        :show-pagination="true"
        :show-row-number="false"
        :row-click-emit="true"
        @query-change="handleRevListQueryChange"
        @row-click="handleView"
      />
    </div>

    <AppModal
      v-model="showGenerateModal"
      title="Generate Rev Rec Journal"
      icon="notebook-plus-outline"
      :actions="[
        { label: 'Cancel', variant: 'ghost', onClick: closeGenerateModal },
        {
          label: 'Generate Journal',
          variant: 'primary',
          onClick: confirmGenerate,
          loading: isGeneratingJournals,
        },
      ]"
    >
      <template #subtitle>
        Select the projects whose current backend action allows rev rec journal generation.
      </template>
      <div class="rev-modal-list">
        <label v-for="project in modalProjects" :key="project.id" class="rev-modal-item">
          <input v-model="selectedProjectIds" type="checkbox" :value="project.id" />
          <span class="rev-modal-name">{{ project.name }}</span>
          <StatusBadge
            :label="project.status"
            :color="revPlanColors[project.statusKey] ?? '#6b7280'"
          />
        </label>
      </div>
    </AppModal>

  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.projects-skeleton {
  border: 1px solid var(--border-strong, #e5e7eb);
  background: var(--surface-1, #ffffff);
  border-radius: 14px;
  padding: 14px;
  box-shadow: var(--shadow);
}
.sk-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.sk-table {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sk-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
  gap: 10px;
}
.sk-title {
  width: 180px;
  height: 22px;
}
.sk-btn {
  width: 120px;
  height: 34px;
  border-radius: 999px;
}
.sk-cell {
  width: 100%;
  height: 30px;
}
.sk-cell--lg {
  height: 38px;
}

.empty-card {
  border: 1px solid var(--border-strong, #e5e7eb);
  background: var(--surface-1, #ffffff);
  border-radius: 14px;
  padding: 18px;
  color: var(--text, #6b7280);
  box-shadow: var(--shadow);
}

.page-header h1 {
  margin: 0 0 6px;
  font-size: 24px;
  color: #243224;
}

.project-title {
  font-weight: 600;
  color: #1f2b1f;
}

.project-id {
  font-size: 12px;
  color: #8a9a8a;
}

.rev-modal-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow: auto;
  padding-right: 4px;
}
.rev-modal-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border-strong, #e6e9e0);
  border-radius: 10px;
  background: var(--surface-2, #fbfcf8);
}
.rev-modal-item--plain {
  gap: 0;
}
.rev-modal-item input[type='checkbox'] {
  width: 16px;
  height: 16px;
  margin: 0;
  appearance: none;
  border: 1px solid var(--border-strong, #cbd5c0);
  border-radius: 4px;
  background: var(--surface-1, #ffffff);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
}
.rev-modal-item input[type='checkbox']::after {
  content: '';
  width: 5px;
  height: 10px;
  border-right: 2px solid #ffffff;
  border-bottom: 2px solid #ffffff;
  transform: rotate(45deg) translateY(-1px) scale(0);
  transition: transform 0.12s ease;
}
.rev-modal-item input[type='checkbox']:checked {
  background: var(--accent);
  border-color: var(--accent);
}
.rev-modal-item input[type='checkbox']:checked::after {
  transform: rotate(45deg) translateY(-1px) scale(1);
}
.rev-modal-item input[type='checkbox']:focus-visible {
  outline: 2px solid rgba(0, 165, 106, 0.35);
  outline-offset: 2px;
}
.rev-modal-name {
  font-size: 13px;
  color: var(--text-h, #1f2b1f);
  flex: 1;
}
</style>
