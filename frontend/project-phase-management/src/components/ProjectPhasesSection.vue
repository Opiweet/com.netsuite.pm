<script setup>
import { computed, markRaw, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Select from 'primevue/select'
import UploadIcon from '@/components/icons/UploadIcon.vue'
import ActionBtn from '@/components/ActionBtn.vue'
import AppModal from '@/components/AppModal.vue'

const uploadIcon = markRaw(UploadIcon)
import ProjectPhaseRow from '@/components/ProjectPhaseRow.vue'
import { useProjectsStore } from '@/stores/projects'
import { useToastStore } from '@/stores/toast'

const props = defineProps({
  skeleton: { type: Boolean, default: false },
  projectId: { type: [String, Number], required: true },
  phases: { type: Array, required: true },
  projectLoadLoading: { type: Boolean, required: true },
  isProjectFrozen: { type: Boolean, required: true },
  isProjectLockedForJnlProc: { type: Boolean, required: true },
  isEditingProject: { type: Boolean, required: true },
  restrictExistingPhaseDetailsToRateQty: { type: Boolean, required: true },
  shouldWarnAddPhase: { type: Boolean, required: true },
  addPhaseConfirmSubtitle: { type: String, required: true },
  phasesMaximized: { type: Boolean, required: true },
})

const emit = defineEmits([
  'update:phasesMaximized',
  'update:is-deleting-phase',
  'update:is-editing-phase',
  'update:has-unsaved-phase-changes',
  'update:phase-drafts',
  'request-collapse-side-panels',
])

const router = useRouter()
const projectsStore = useProjectsStore()
const toast = useToastStore()

const isSubmittingPhaseChanges = ref(false)
const isDeletingPhase = ref(false)
const showPhaseRowErrors = ref(false)
const showAddPhaseConfirmModal = ref(false)
const showDeletePhaseConfirmModal = ref(false)
const pendingDeletePhaseId = ref('')
const pendingDeletePhaseName = ref('')

const phaseDrafts = ref([])
const phaseDraftDirtyByKey = ref({})
const tempPhaseCounter = ref(0)

const filterOpen = ref(false)
const sortOpen = ref(false)
const filterStatus = ref('All')
const filterDept = ref('All')
const sortBy = ref('sequence')
const bulkEditMode = ref(false)

const phaseTableGridColumns = '280px 260px 220px 220px 120px 130px'
const phaseSortOptions = [
  { value: 'sequence', label: 'Sequence' },
  { value: 'name', label: 'Phase name' },
  { value: 'amount', label: 'Allocation amount' },
]

const dirtyPhaseKeys = computed(() => Object.keys(phaseDraftDirtyByKey.value))
const hasUnsavedPhaseChanges = computed(() => dirtyPhaseKeys.value.length > 0)

watch(isDeletingPhase, (v) => emit('update:is-deleting-phase', Boolean(v)), { immediate: true })
watch(
  () => Boolean(bulkEditMode.value),
  (v) => emit('update:is-editing-phase', v),
  { immediate: true },
)
watch(hasUnsavedPhaseChanges, (v) => emit('update:has-unsaved-phase-changes', Boolean(v)), {
  immediate: true,
})
watch(phaseDrafts, (rows) => emit('update:phase-drafts', rows), { deep: true, immediate: true })

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

function phaseKey(phase) {
  return String(phase?._draftKey || phase?.id || '')
}

function normalizePhaseForDiff(phase) {
  return {
    name: String(phase?.name || ''),
    departmentId:
      phase?.departmentId != null && phase?.departmentId !== '' ? String(phase.departmentId) : null,
    milestoneId:
      phase?.milestoneId != null && phase?.milestoneId !== '' ? String(phase.milestoneId) : null,
    milestoneDesc: String(phase?.milestoneDesc || phase?.milestone || phase?.serviceItem || ''),
    definedQty: Number.isFinite(Number(phase?.definedQty)) ? Number(phase.definedQty) : null,
    rate: Number.isFinite(Number(phase?.rate)) ? Number(phase.rate) : null,
  }
}

function isDraftPhaseDirty(draft) {
  const key = phaseKey(draft)
  if (!key) return false
  if (String(key).startsWith('tmp-')) return true
  const base = (props.phases || []).find((p) => String(p?.id || '') === String(key))
  if (!base) return true
  return (
    JSON.stringify(normalizePhaseForDiff(base)) !== JSON.stringify(normalizePhaseForDiff(draft))
  )
}

function setDirtyFlagForDraft(draft) {
  const key = phaseKey(draft)
  if (!key) return
  const dirty = isDraftPhaseDirty(draft)
  if (dirty) {
    phaseDraftDirtyByKey.value = { ...phaseDraftDirtyByKey.value, [key]: true }
    return
  }
  if (phaseDraftDirtyByKey.value[key]) {
    const next = { ...phaseDraftDirtyByKey.value }
    delete next[key]
    phaseDraftDirtyByKey.value = next
  }
}

function resetPhaseDrafts() {
  const rows = Array.isArray(props.phases) ? props.phases : []
  phaseDrafts.value = rows.map((p) => ({ ...cloneJson(p), _draftKey: String(p.id) }))
  phaseDraftDirtyByKey.value = {}
}

watch(
  () => [String(props.projectId || ''), props.phases],
  () => {
    if (hasUnsavedPhaseChanges.value) return
    resetPhaseDrafts()
  },
  { deep: true, immediate: true },
)

const phaseStatusOptions = computed(() => {
  const rows = Array.isArray(projectsStore.initData.statuses?.projectPhases)
    ? projectsStore.initData.statuses.projectPhases
    : []
  return rows
    .map((s) => ({ value: s?.id != null ? String(s.id) : '', label: s?.name || '' }))
    .filter((o) => o.value && o.label)
})

const pendingStatusId = computed(() => {
  const row = phaseStatusOptions.value.find((s) => String(s.label).toLowerCase() === 'pending')
  return row?.value || ''
})

const statusLabelById = computed(() => {
  const map = {}
  phaseStatusOptions.value.forEach((o) => {
    map[String(o.value)] = o.label
  })
  return map
})

const milestoneOptionsAll = computed(() => {
  const rows =
    Array.isArray(projectsStore.phaseLookups.milestones) &&
    projectsStore.phaseLookups.milestones.length
      ? projectsStore.phaseLookups.milestones
      : []

  let derived = rows
  if (!derived.length) {
    const map = projectsStore.phaseLookups.milestonesByDept || {}
    const merge = {}
    Object.keys(map).forEach((deptKey) => {
      const list = Array.isArray(map[deptKey]) ? map[deptKey] : []
      list.forEach((it) => {
        const key = it?.key != null ? String(it.key) : ''
        const label = it?.label || it?.desc || ''
        const itemId = it?.itemId != null ? String(it.itemId) : ''
        const desc = it?.desc || it?.label || ''
        if (!key || !label) return
        if (!merge[key]) merge[key] = { key, label, itemId, desc, departments: [] }
      })
    })
    derived = Object.values(merge)
  }

  return derived
    .map((m) => ({
      value: m?.key != null ? String(m.key) : '',
      label: m?.label || m?.desc || '',
      itemId: m?.itemId != null ? String(m.itemId) : '',
      desc: m?.desc || m?.label || '',
    }))
    .filter((o) => o.value && o.label)
})

function milestoneOptionsForPhase(current) {
  const opts = milestoneOptionsAll.value.slice()
  const currentDesc = current?.milestoneDesc || current?.milestone || current?.serviceItem || ''
  if (
    current?.milestoneId &&
    currentDesc &&
    !opts.some((o) => o.itemId === String(current.milestoneId) && o.desc === String(currentDesc))
  ) {
    opts.unshift({
      value: `${String(current.milestoneId)}|||${String(currentDesc)}`,
      label: String(currentDesc),
      itemId: String(current.milestoneId),
      desc: String(currentDesc),
    })
  }
  return opts
}

function departmentOptionsForPhase(current) {
  const rows = Array.isArray(projectsStore.phaseLookups.departments)
    ? projectsStore.phaseLookups.departments
    : []
  const opts = rows
    .map((d) => ({ value: d?.id != null ? String(d.id) : '', label: d?.name || 'Unassigned' }))
    .filter((o) => o.label)

  if (current?.departmentId && !opts.some((o) => o.value === String(current.departmentId))) {
    opts.unshift({ value: String(current.departmentId), label: current.department || 'Unassigned' })
  }
  return opts
}

function isExistingPhaseLockedForNonDraft(phase) {
  return (
    Boolean(props.restrictExistingPhaseDetailsToRateQty) &&
    Boolean(phase?.id) &&
    !String(phaseKey(phase) || '').startsWith('tmp-')
  )
}

function updateDraftByKey(key, patch) {
  const next = phaseDrafts.value.map((p) => {
    if (phaseKey(p) !== key) return p
    return { ...p, ...patch }
  })
  phaseDrafts.value = next
  const updatedDraft = next.find((p) => phaseKey(p) === key)
  if (updatedDraft) setDirtyFlagForDraft(updatedDraft)
}

function handlePhaseFieldChange(phase, field, value) {
  const protectedFieldsForExisting = new Set([
    'name',
    'departmentId',
    'milestoneId',
    'statusId',
    'sequence',
  ])
  if (isExistingPhaseLockedForNonDraft(phase) && protectedFieldsForExisting.has(String(field)))
    return

  const key = phaseKey(phase)
  const current = phaseDrafts.value.find((p) => phaseKey(p) === key) || phase
  const patch = { [field]: value }

  if (field === 'departmentId') {
    patch.departmentId = value || null
    const opts = departmentOptionsForPhase(current)
    patch.department = value ? opts.find((o) => o.value === String(value))?.label || '' : ''
  }
  if (field === 'milestoneId') {
    const raw = value != null ? String(value) : ''
    const parts = raw.split('|||')
    const itemId = parts[0] || ''
    const desc = parts.slice(1).join('|||') || ''
    patch.milestoneId = itemId || null
    patch.milestoneDesc = desc || ''
    patch.milestone = desc || ''
    patch.serviceItem = desc || ''
  }
  if (field === 'statusId') {
    patch.statusId = value || null
    patch.status = value ? statusLabelById.value[String(value)] || '' : ''
  }
  if (field === 'definedQty') {
    const n = value === '' ? null : Number(value)
    patch.definedQty = Number.isFinite(n) ? n : null
  }
  if (field === 'rate') {
    const n = value === '' ? null : Number(value)
    patch.rate = Number.isFinite(n) ? n : null
  }
  if (field === 'name') patch.name = String(value || '')

  updateDraftByKey(key, patch)
}

function normalizePhaseNameKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

const duplicatePhaseNameKeys = computed(() => {
  const counts = new Map()
  phaseDrafts.value.forEach((phase) => {
    const key = normalizePhaseNameKey(phase?.name)
    if (!key) return
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  const duplicates = new Set()
  counts.forEach((count, key) => {
    if (count > 1) duplicates.add(key)
  })
  return duplicates
})

function isDuplicatePhaseName(phase) {
  const key = normalizePhaseNameKey(phase?.name)
  return Boolean(key) && duplicatePhaseNameKeys.value.has(key)
}

function isPhaseRowValid(phase) {
  const nameOk = Boolean(String(phase?.name || '').trim())
  const milestoneOk = Boolean(phase?.milestoneId)
  const deptOk = Boolean(phase?.departmentId)
  const qtyOk = phase?.definedQty != null && Number(phase.definedQty) > 0
  const rateOk = phase?.rate != null && Number(phase.rate) > 0
  const uniqueNameOk = !isDuplicatePhaseName(phase)
  return nameOk && milestoneOk && deptOk && qtyOk && rateOk && uniqueNameOk
}

const deptOptions = computed(() => {
  const set = new Set(phaseDrafts.value.map((phase) => phase.department).filter(Boolean))
  return ['All', ...Array.from(set)]
})

const statusOptions = computed(() => {
  const set = new Set(phaseDrafts.value.map((phase) => phase.status).filter(Boolean))
  return ['All', ...Array.from(set)]
})

const hasActiveFilter = computed(() => filterStatus.value !== 'All' || filterDept.value !== 'All')
const hasActiveSort = computed(() => sortBy.value !== 'sequence')

const phaseRows = computed(() => {
  let rows = phaseDrafts.value.map((phase) => ({
    ...phase,
    totalAmount:
      phase.definedQty && phase.rate ? Number(phase.definedQty) * Number(phase.rate) : null,
    totalActualQty: Number(phase?.totalActualQty || 0),
    totalForecastQty: Number(phase?.totalForecastQty || 0),
    totalActualAmount: Number(phase?.totalActualQty || 0) * Number(phase?.rate || 0),
    totalForecastAmount: Number(phase?.totalForecastQty || 0) * Number(phase?.rate || 0),
  }))

  if (filterStatus.value !== 'All')
    rows = rows.filter((phase) => phase.status === filterStatus.value)
  if (filterDept.value !== 'All')
    rows = rows.filter((phase) => phase.department === filterDept.value)

  if (!bulkEditMode.value) {
    rows = rows.slice().sort((a, b) => {
      if (sortBy.value === 'amount') return (b.totalAmount ?? 0) - (a.totalAmount ?? 0)
      if (sortBy.value === 'name') return String(a.name).localeCompare(String(b.name))
      return (a.sequence ?? 0) - (b.sequence ?? 0)
    })
  }
  return rows
})

function showFrozenToast() {
  toast.show({
    message: props.isProjectLockedForJnlProc
      ? 'Project is locked for journal processing. Please wait until processing is completed.'
      : 'Project is Completed or Closed. Editing is no longer allowed.',
    variant: 'warning',
    durationMs: 6000,
  })
}

function toggleFilter() {
  filterOpen.value = !filterOpen.value
  sortOpen.value = false
}

function toggleSort() {
  sortOpen.value = !sortOpen.value
  filterOpen.value = false
}

function togglePhasesMaximized() {
  const next = !props.phasesMaximized
  emit('update:phasesMaximized', next)
  if (next) {
    emit('request-collapse-side-panels')
    filterOpen.value = false
    sortOpen.value = false
  }
}

function ensureLookupsReady() {
  if (!projectsStore.initData?.fetchedAt) projectsStore.fetchInitData().catch(() => {})
  if (props.projectId && !projectsStore.phaseLookups?.fetchedAt) {
    projectsStore.fetchPhaseLookupsForProject({ projectId: props.projectId }).catch(() => {})
  }
}

function addBulkDraftPhase() {
  if (props.isProjectFrozen) return
  ensureLookupsReady()

  tempPhaseCounter.value += 1
  const key = `tmp-${Date.now()}-${tempPhaseCounter.value}`
  const maxSequence = phaseDrafts.value.reduce(
    (max, p) => Math.max(max, p.sequence ?? 0),
    (props.phases || []).reduce((max, p) => Math.max(max, p.sequence ?? 0), 0),
  )

  const created = {
    id: null,
    _draftKey: key,
    name: '',
    sequence: maxSequence + 1,
    department: '',
    departmentId: null,
    statusId: pendingStatusId.value || null,
    status:
      (pendingStatusId.value && statusLabelById.value[String(pendingStatusId.value)]) || 'Pending',
    milestone: '',
    milestoneId: null,
    milestoneDesc: '',
    serviceItem: '',
    definedQty: 1,
    rate: null,
    startDate: null,
    endDate: null,
    revPlansCount: 0,
    numOfPlans: null,
    numOfMissingPlans: null,
    desiredPlansPerPhase: null,
  }

  phaseDrafts.value = [created, ...phaseDrafts.value]
  setDirtyFlagForDraft(created)
}

function requestAddPhase() {
  if (isSubmittingPhaseChanges.value) return
  if (props.isProjectFrozen) {
    showFrozenToast()
    return
  }
  if (props.shouldWarnAddPhase) {
    showAddPhaseConfirmModal.value = true
    return
  }
  addBulkDraftPhase()
}

function toggleBulkEditMode() {
  if (props.isProjectFrozen) {
    showFrozenToast()
    return
  }
  if (props.isEditingProject) {
    toast.show({ message: 'Close the Edit Project modal before editing phases.', variant: 'info' })
    return
  }
  const next = !bulkEditMode.value
  if (next) ensureLookupsReady()
  if (!next && hasUnsavedPhaseChanges.value) {
    discardPhaseChanges()
    return
  }
  bulkEditMode.value = next
}

function removeBulkDraftPhase(phase) {
  const key = phaseKey(phase)
  if (!key || !String(key).startsWith('tmp-')) return
  phaseDrafts.value = phaseDrafts.value.filter((p) => phaseKey(p) !== key)
  if (phaseDraftDirtyByKey.value[key]) {
    const next = { ...phaseDraftDirtyByKey.value }
    delete next[key]
    phaseDraftDirtyByKey.value = next
  }
}

function requestDeleteExistingPhase(phase) {
  const phaseId = String(phase?.id || '').trim()
  if (!phaseId || String(phaseId).startsWith('tmp-')) return
  pendingDeletePhaseId.value = phaseId
  pendingDeletePhaseName.value = String(phase?.name || '').trim()
  showDeletePhaseConfirmModal.value = true
}

function closeDeletePhaseConfirmModal() {
  if (isDeletingPhase.value) return
  showDeletePhaseConfirmModal.value = false
  pendingDeletePhaseId.value = ''
  pendingDeletePhaseName.value = ''
}

async function confirmDeleteExistingPhase() {
  const pid = String(props.projectId || '')
  const phaseId = String(pendingDeletePhaseId.value || '')
  if (!pid || !phaseId) return
  if (props.isProjectFrozen) {
    showFrozenToast()
    return
  }

  showDeletePhaseConfirmModal.value = false
  isDeletingPhase.value = true
  try {
    await projectsStore.deletePhase({ projectId: pid, phaseId })
    await projectsStore.fetchProjectPhases({ projectId: pid, force: true })
    resetPhaseDrafts()
    bulkEditMode.value = false
    showPhaseRowErrors.value = false
    toast.show({ message: 'Phase deleted.', variant: 'success' })
  } catch (e) {
    toast.show({
      message: e?.message || 'Failed to delete phase',
      variant: 'error',
      durationMs: 10000,
    })
    showDeletePhaseConfirmModal.value = true
  } finally {
    isDeletingPhase.value = false
    if (!showDeletePhaseConfirmModal.value) {
      closeDeletePhaseConfirmModal()
    }
  }
}

const modifiedPhases = computed(() => {
  const dirty = phaseDrafts.value.filter((p) => Boolean(phaseDraftDirtyByKey.value[phaseKey(p)]))
  const mapped = dirty.map((p) => {
    const out = { ...cloneJson(p) }
    if (String(out._draftKey || '').startsWith('tmp-')) out.id = null
    delete out._draftKey
    return out
  })
  return mapped.sort((a, b) => {
    if (a.id || b.id) return 0
    return (a.sequence ?? 0) - (b.sequence ?? 0)
  })
})

async function submitPhaseChanges() {
  const pid = String(props.projectId || '')
  if (!pid) return
  if (props.isProjectFrozen) {
    showFrozenToast()
    return
  }
  const keys = dirtyPhaseKeys.value
  if (!keys.length) return

  isSubmittingPhaseChanges.value = true
  try {
    const phasesPayload = modifiedPhases.value

    showPhaseRowErrors.value = true
    const invalid = phasesPayload.find((p) => !isPhaseRowValid(p))
    if (invalid) {
      toast.show({
        message:
          'Please fix phase rows before submitting. Phase name must be unique, and quantity/rate must be greater than 0.',
        variant: 'error',
      })
      return
    }

    await projectsStore.upsertPhases({ projectId: pid, phases: phasesPayload })
    await projectsStore.fetchProjectPhases({ projectId: pid, force: true })

    resetPhaseDrafts()
    bulkEditMode.value = false
    showPhaseRowErrors.value = false
    isSubmittingPhaseChanges.value = false
    toast.show({ message: 'Phase changes saved.', variant: 'success' })
  } catch (e) {
    toast.show({ message: e?.message || 'Failed to save phase changes', variant: 'error' })
  }
}

function discardPhaseChanges() {
  resetPhaseDrafts()
  bulkEditMode.value = false
  showPhaseRowErrors.value = false
  toast.show({ message: 'Discarded staged phase changes.', variant: 'info' })
}
</script>

<template>
  <div v-if="skeleton" class="phase-board sk-frame" aria-hidden="true">
    <div class="flex-between">
      <div class="sk sk-phase-title"></div>
      <div class="sk sk-phase-sub"></div>
    </div>
    <div class="sk-phase-table">
      <ProjectPhaseRow v-for="i in 6" :key="i" skeleton />
    </div>
  </div>

  <div v-else class="phase-board">
    <div v-if="projectLoadLoading || isSubmittingPhaseChanges" class="phase-table-overlay">
      Updating…
    </div>
    <div class="phase-board-header">
      <div>
        <div class="phase-board-title">Project Phases</div>
        <p class="phase-board-subtitle">
          Manage and monitor the lifecycle of this project's delivery windows and allocations.
        </p>
      </div>
      <div class="phase-board-actions">
        <ActionBtn
          v-if="!bulkEditMode && !isProjectFrozen"
          label="Bulk Create Phases"
          :icon="uploadIcon"
          :on-click="
            () =>
              router.push({
                name: 'bulk-phase-upload',
                query: { projectId: String(projectId || '') },
              })
          "
        />
        <ActionBtn
          v-if="bulkEditMode && !isProjectFrozen"
          label="Add"
          mdi-icon="mdi-plus"
          variant="primary"
          :disabled="isSubmittingPhaseChanges"
          :on-click="requestAddPhase"
        />
        <ActionBtn
          v-if="!isEditingProject && !isProjectFrozen"
          :label="bulkEditMode ? 'Editing' : 'Edit'"
          mdi-icon="mdi-pencil-outline"
          :variant="bulkEditMode ? '' : 'primary'"
          :active="bulkEditMode"
          :on-click="toggleBulkEditMode"
        />
        <ActionBtn
          v-if="bulkEditMode && hasUnsavedPhaseChanges && !isProjectFrozen"
          :label="isSubmittingPhaseChanges ? 'Saving…' : `Submit (${dirtyPhaseKeys.length})`"
          mdi-icon="mdi-content-save-outline"
          variant="primary"
          :disabled="isSubmittingPhaseChanges"
          :on-click="submitPhaseChanges"
        />
        <ActionBtn
          v-if="bulkEditMode && hasUnsavedPhaseChanges && !isProjectFrozen"
          label="Discard"
          mdi-icon="mdi-undo-variant"
          variant="ghost"
          :disabled="isSubmittingPhaseChanges"
          :on-click="discardPhaseChanges"
        />
        <ActionBtn
          :mdi-icon="phasesMaximized ? 'mdi-arrow-collapse' : 'mdi-arrow-expand'"
          :aria-label="phasesMaximized ? 'Restore' : 'Maximise'"
          :title="phasesMaximized ? 'Restore' : 'Maximise'"
          :active="phasesMaximized"
          icon-only
          :on-click="togglePhasesMaximized"
        />
        <ActionBtn
          label="Filter"
          mdi-icon="mdi-filter-variant"
          :active="filterOpen"
          :badge="hasActiveFilter"
          :on-click="toggleFilter"
        />
        <ActionBtn
          label="Sort"
          mdi-icon="mdi-sort-variant"
          :active="sortOpen"
          :badge="hasActiveSort"
          :on-click="toggleSort"
        />
      </div>
    </div>
    <div v-if="filterOpen || sortOpen" class="phase-board-controls">
      <div v-if="filterOpen" class="phase-filters">
        <label class="phase-control-group">
          <span>Department</span>
          <Select
            :model-value="filterDept"
            :options="deptOptions"
            placeholder="All"
            class="phase-control-select"
            filter
            @update:model-value="filterDept = $event"
          />
        </label>
        <label class="phase-control-group">
          <span>Status</span>
          <Select
            :model-value="filterStatus"
            :options="statusOptions"
            placeholder="All"
            class="phase-control-select"
            filter
            @update:model-value="filterStatus = $event"
          />
        </label>
      </div>
      <div v-if="sortOpen" class="phase-sorts">
        <label class="phase-control-group">
          <span>Sort by</span>
          <Select
            :model-value="sortBy"
            :options="phaseSortOptions"
            option-label="label"
            option-value="value"
            placeholder="Sort by"
            class="phase-control-select"
            @update:model-value="sortBy = $event"
          />
        </label>
      </div>
    </div>
    <div class="phase-table" :class="{ 'is-edit': bulkEditMode }">
      <div class="phase-table-scroll">
        <div class="phase-table-head" :style="{ gridTemplateColumns: phaseTableGridColumns }">
          <span>Phase</span>
          <span>Milestone</span>
          <span>Department</span>
          <span>Allocation</span>
          <span>Total Actual</span>
          <span>Total Forecasted</span>
        </div>
        <div v-if="projectLoadLoading && phaseRows.length === 0" class="empty-state">
          Loading phases…
        </div>
        <div v-else-if="phaseRows.length === 0" class="empty-state">No phases yet.</div>
        <div v-else class="phase-table-body">
          <ProjectPhaseRow
            v-for="phase in phaseRows"
            :key="phase.id || phase._draftKey"
            :phase="phase"
            :bulk-edit-mode="bulkEditMode"
            :show-phase-row-errors="showPhaseRowErrors"
            :phase-table-grid-columns="phaseTableGridColumns"
            :is-draft-phase-dirty="isDraftPhaseDirty"
            :is-phase-row-valid="isPhaseRowValid"
            :phase-key="phaseKey"
            :is-existing-phase-locked-for-non-draft="isExistingPhaseLockedForNonDraft"
            :handle-phase-field-change="handlePhaseFieldChange"
            :milestone-options-for-phase="milestoneOptionsForPhase"
            :department-options-for-phase="departmentOptionsForPhase"
            :remove-bulk-draft-phase="removeBulkDraftPhase"
            :request-delete-existing-phase="requestDeleteExistingPhase"
            :format-money="
              (value) =>
                `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            "
          />
        </div>
      </div>
    </div>

    <AppModal
      v-model="showAddPhaseConfirmModal"
      title="Add another phase?"
      :subtitle="addPhaseConfirmSubtitle"
      variant="warning"
      :actions="[
        { label: 'Cancel', variant: 'ghost', onClick: () => (showAddPhaseConfirmModal = false) },
        {
          label: 'Proceed',
          variant: 'primary',
          onClick: () => {
            showAddPhaseConfirmModal = false
            addBulkDraftPhase()
          },
        },
      ]"
    />

    <AppModal
      v-model="showDeletePhaseConfirmModal"
      title="Delete phase?"
      variant="error"
      icon="mdi-trash-can-outline"
      :close-on-backdrop="!Boolean(isDeletingPhase)"
      :close-on-esc="!Boolean(isDeletingPhase)"
      :show-close="!Boolean(isDeletingPhase)"
      :actions="[
        {
          label: 'Cancel',
          variant: 'ghost',
          disabled: Boolean(isDeletingPhase),
          onClick: closeDeletePhaseConfirmModal,
        },
        {
          label: isDeletingPhase ? 'Deleting…' : 'Delete',
          variant: 'error',
          disabled: Boolean(isDeletingPhase),
          onClick: confirmDeleteExistingPhase,
        },
      ]"
    >
      <template #subtitle>
        <span class="doc-delete-confirm-text">
          This will delete phase
          <strong>{{ pendingDeletePhaseName || 'selected phase' }}</strong> and its associated rev
          plans.
        </span>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.phase-board {
  position: relative;
  margin-block: 1rem;
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 5px;
  padding: 18px;
}
.phase-board-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 18px;
}
.phase-board-title {
  font-size: 20px;
  font-weight: 500;
  color: var(--text-h, #1f2b1f);
}
.phase-board-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text, #6b7280);
  max-width: 560px;
}
.phase-board-actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.phase-board-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  border: 1px solid var(--border-strong, #eef2ea);
  border-radius: 12px;
  background: var(--surface-1, #ffffff);
  margin-bottom: 14px;
}
.phase-filters,
.phase-sorts {
  display: flex;
  align-items: center;
  gap: 12px;
}
.phase-control-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  color: var(--text, #6b7280);
}
:deep(.phase-control-select.p-select) {
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--border-strong, #e1e6dc);
  padding: 0 0 0 10px;
  font-size: 12px;
  color: var(--text-h, #1f2b1f);
  background: var(--surface-2, #f7fafc);
  box-shadow: none;
  align-items: center;
}
:deep(.phase-control-select.p-select:focus-within) {
  border-color: var(--accent, #00a56a);
}
:deep(.phase-control-select.p-select .p-select-label) {
  padding: 0;
  display: flex;
  align-items: center;
  height: 100%;
  line-height: 1;
  font-size: 12px;
  color: var(--text-h, #1f2b1f);
}
:deep(.phase-control-select.p-select .p-select-dropdown) {
  color: var(--text, #6b7768);
  display: flex;
  align-items: center;
  max-width: 30px;
}
:deep(.phase-control-select.p-select .p-select-dropdown svg) {
  width: 12px;
  height: 12px;
  margin-top: 2px;
}
.phase-table {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.phase-table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 2px;
}
.phase-table-head {
  display: grid;
  gap: 14px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text, #94a3b8);
  padding: 0 18px;
  width: max-content;
  min-width: 100%;
}
.phase-table:not(.is-edit) .phase-table-head {
  white-space: nowrap;
}
.phase-table-body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 4px;
  align-items: flex-start;
}
.phase-table-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text, #6b7280);
  background: color-mix(in srgb, var(--surface-1, #ffffff) 82%, transparent);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
  pointer-events: none;
  transform: translate(-50%, -50%);
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}
.empty-state {
  font-size: 12px;
  color: var(--text, #6b7280);
}
.doc-delete-confirm-text {
  color: var(--red, #dc2626);
  font-weight: 600;
}
.sk-phase-table {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-x: auto;
  width: calc(100vw - 9rem);
}
.sk-phase-title {
  width: 190px;
  height: 26px;
}
.sk-phase-sub {
  width: 360px;
  height: 26px;
}
@keyframes phase-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}
@media (max-width: 980px) {
  .phase-board-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .phase-board-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
</style>
