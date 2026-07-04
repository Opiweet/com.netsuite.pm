<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Select from 'primevue/select'
import { useTopbarStore } from '@/stores/topbar'
import { useProjectsStore } from '@/stores/projects'
import { useToastStore } from '@/stores/toast'
import BlockingOverlay from '@/components/BlockingOverlay.vue'
import BulkPhaseUploadCard from '@/components/BulkPhaseUploadCard.vue'
import BulkUploadProjectDetail from '@/components/BulkUploadProjectDetail.vue'
import BulkPhaseUploadSteps from '@/components/BulkPhaseUploadSteps.vue'
import ProjectBanner from '@/components/ProjectBanner.vue'
import BulkUploadValidationSummary from '@/components/BulkUploadValidationSummary.vue'
import ActionBtn from '@/components/ActionBtn.vue'
import { useAuthz } from '@/composables/useAuthz'
import { useBannerUi } from '@/composables/useBannerUi'

const router = useRouter()
const route = useRoute()
const topbar = useTopbarStore()
const projectsStore = useProjectsStore()
const toast = useToastStore()

const selectedProjectId = ref('')
const { can } = useAuthz({ projectId: selectedProjectId })
const { resolveProjectBannerUi } = useBannerUi({ projectId: selectedProjectId })
const isPageLoading = ref(false)
const csvText = ref('')
const sourceFileName = ref('')
const parsedRows = ref([])
const isSubmitting = ref(false)
const isLoadingLookups = ref(false)
const isDragActive = ref(false)
const fileInputEl = ref(null)
const MAX_CSV_SIZE_BYTES = 5 * 1024 * 1024
const MAX_CSV_LINES = 101

const projectOptions = computed(() =>
  (Array.isArray(projectsStore.projects) ? projectsStore.projects : [])
    .map((project) => ({
      value: String(project?.id || ''),
      label: String(project?.name || project?.ref || '').trim(),
    }))
    .filter((option) => option.value && option.label)
    .sort((left, right) => left.label.localeCompare(right.label)),
)

const phaseStatusOptions = computed(() =>
  (Array.isArray(projectsStore.initData?.statuses?.projectPhases)
    ? projectsStore.initData.statuses.projectPhases
    : []
  )
    .map((status) => ({
      value: status?.id != null ? String(status.id) : '',
      label: String(status?.name || '').trim(),
    }))
    .filter((status) => status.value && status.label),
)

const pendingStatusId = computed(() => {
  const pending = phaseStatusOptions.value.find(
    (status) => String(status.label).toLowerCase() === 'pending',
  )
  return pending?.value || ''
})

const selectedProjectLabel = computed(
  () =>
    projectOptions.value.find((option) => option.value === selectedProjectId.value)?.label || '',
)

const selectedProject = computed(
  () =>
    (Array.isArray(projectsStore.projects) ? projectsStore.projects : []).find(
      (p) => String(p?.id || '') === String(selectedProjectId.value || ''),
    ) || null,
)

const selectedProjectHref = computed(() => {
  if (!selectedProjectId.value) return null
  const resolved = router.resolve({
    name: 'project-detail',
    params: { projectId: selectedProjectId.value },
  })
  return resolved?.href || null
})

const lookupsReadyForSelectedProject = computed(
  () =>
    selectedProjectId.value &&
    String(projectsStore.phaseLookups?.projectId || '') === String(selectedProjectId.value || ''),
)
const selectedProjectLoad = computed(
  () => projectsStore.projectLoadByProject[String(selectedProjectId.value || '')] || null,
)
const hasLinkedSalesOrder = computed(() => Boolean(selectedProjectLoad.value?.hasSalesOrder))
const isLockedForJnlProc = computed(() => Boolean(selectedProjectLoad.value?.isLockedForJnlProc))

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

const departmentByName = computed(() => {
  const map = new Map()
  const rows = Array.isArray(projectsStore.phaseLookups?.departments)
    ? projectsStore.phaseLookups.departments
    : []
  rows.forEach((department) => {
    const id = department?.id != null ? String(department.id) : ''
    const name = String(department?.name || '').trim()
    const key = normalizeKey(name)
    if (!id || !name || !key || map.has(key)) return
    map.set(key, { id, name })
  })
  return map
})

const milestoneByLabel = computed(() => {
  const map = new Map()
  const rows = Array.isArray(projectsStore.phaseLookups?.milestones)
    ? projectsStore.phaseLookups.milestones
    : []
  rows.forEach((milestone) => {
    const itemId =
      milestone?.itemId != null && String(milestone.itemId)
        ? String(milestone.itemId)
        : String(milestone?.key || '').split('|||')[0]
    const desc = String(milestone?.desc || milestone?.label || '').trim()
    const key = normalizeKey(desc)
    if (!itemId || !desc || !key || map.has(key)) return
    map.set(key, { itemId, desc })
  })
  return map
})

const existingPhaseNameSet = computed(() => {
  const pid = String(selectedProjectId.value || '')
  const rows = Array.isArray(projectsStore.phasesByProject?.[pid])
    ? projectsStore.phasesByProject[pid]
    : []
  const set = new Set()
  rows.forEach((phase) => {
    const key = normalizeKey(phase?.name || '')
    if (key) set.add(key)
  })
  return set
})

const validRows = computed(() => parsedRows.value.filter((row) => !row.errors.length))
const invalidRows = computed(() => parsedRows.value.filter((row) => row.errors.length))

const canSubmit = computed(
  () =>
    can('phase.upsert') &&
    Boolean(step1Done.value) &&
    Boolean(parsedRows.value.length) &&
    !invalidRows.value.length &&
    !isSubmitting.value,
)

// Derived step state
const step1BaseDone = computed(
  () => Boolean(selectedProjectId.value) && lookupsReadyForSelectedProject.value,
)
const step1Done = computed(
  () => step1BaseDone.value && hasLinkedSalesOrder.value && !isLockedForJnlProc.value,
)
const step1ProjectBanner = computed(() => {
  if (!step1BaseDone.value || step1Done.value) return null
  const code = selectedProjectLoad.value?.projectBanner?.code || null
  const variant = selectedProjectLoad.value?.projectBanner?.variant || 'info'
  if (!code) return null
  const ui = resolveProjectBannerUi(code)
  if (!ui?.message) return null
  const resolvedVariant = ui?.variant || variant
  return {
    variant: resolvedVariant,
    role: resolvedVariant === 'warning' || resolvedVariant === 'error' ? 'alert' : 'status',
    message: ui.message,
    html: Boolean(ui.html),
  }
})
const step2Done = computed(() => Boolean(String(csvText.value || '').trim()))
const step3Done = computed(() => parsedRows.value.length > 0 && !invalidRows.value.length)
const bpuSteps = computed(() => [
  {
    number: 1,
    title: 'Select project',
    desc: 'Choose the project to upload into',
    done: step1Done.value,
    active: !step1Done.value,
  },
  {
    number: 2,
    title: 'Load CSV',
    desc: 'Upload file or paste CSV',
    done: step2Done.value,
    active: step1Done.value && !step2Done.value,
  },
  {
    number: 3,
    title: 'Preview & validate',
    desc: 'Review rows before submitting',
    done: step3Done.value,
    active: step2Done.value && !step3Done.value,
  },
  {
    number: 4,
    title: 'Submit',
    desc: 'Upload all valid phases',
    done: false,
    active: step3Done.value,
  },
])

function setTopbar() {
  topbar.setTopbar({
    title: 'Bulk Upload Phases',
    subtitle: 'Create multiple phases for a selected project.',
    backRouteName: 'bulk-upload',
    actions: [],
  })
}

function parseCsvMatrix(rawText) {
  const text = String(rawText || '')
  const rows = []
  let currentRow = []
  let currentField = ''
  let insideQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }
      continue
    }

    if (char === ',' && !insideQuotes) {
      currentRow.push(currentField)
      currentField = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1
      currentRow.push(currentField)
      rows.push(currentRow)
      currentRow = []
      currentField = ''
      continue
    }

    currentField += char
  }

  currentRow.push(currentField)
  rows.push(currentRow)
  return rows.filter((row) => row.some((value) => String(value || '').trim()))
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function parseHeaderIndexes(headerRow) {
  const normalizedHeaders = headerRow.map((header) =>
    normalizeKey(String(header || '').replace(/^\uFEFF/, '')),
  )

  const aliases = {
    name: ['name', 'phase', 'phase name', 'phase_name'],
    department: ['department', 'dept'],
    milestone: [
      'milestone',
      'milestone desc',
      'milestone description',
      'description',
      'service item',
    ],
    quantity: ['quantity', 'qty', 'defined qty', 'defined quantity', 'definedqty'],
    rate: ['rate', 'price'],
  }

  const findIndex = (candidates) =>
    normalizedHeaders.findIndex((header) => candidates.includes(header))

  const indexes = {
    name: findIndex(aliases.name),
    department: findIndex(aliases.department),
    milestone: findIndex(aliases.milestone),
    quantity: findIndex(aliases.quantity),
    rate: findIndex(aliases.rate),
  }

  const missingRequired = Object.entries(indexes)
    .filter(([, index]) => index < 0)
    .map(([key]) => key)

  return { indexes, missingRequired }
}

function parseRowsFromCsv(text) {
  const matrix = parseCsvMatrix(text)
  if (!matrix.length) throw new Error('CSV is empty.')

  const headerRow = matrix[0] || []
  const { indexes, missingRequired } = parseHeaderIndexes(headerRow)
  if (missingRequired.length) {
    throw new Error(`Missing required columns: ${missingRequired.join(', ')}`)
  }

  const rows = []
  const seenCsvPhaseNames = new Set()
  for (let offset = 1; offset < matrix.length; offset += 1) {
    const line = matrix[offset]
    const rowNumber = offset + 1
    const getCell = (index) => (index >= 0 ? String(line[index] || '').trim() : '')

    const name = getCell(indexes.name)
    const departmentText = getCell(indexes.department)
    const milestoneText = getCell(indexes.milestone)
    const quantityRaw = getCell(indexes.quantity)
    const rateRaw = getCell(indexes.rate)

    if (!name && !departmentText && !milestoneText && !quantityRaw && !rateRaw) continue

    const errors = []
    const department = departmentByName.value.get(normalizeKey(departmentText))
    const milestone = milestoneByLabel.value.get(normalizeKey(milestoneText))
    const quantity = Number(quantityRaw)
    const rate = Number(rateRaw)

    if (!name) errors.push('Phase name is required')
    if (!departmentText) errors.push('Department is required')
    if (departmentText && !department) errors.push(`Department "${departmentText}" was not found`)
    if (!milestoneText) errors.push('Milestone is required')
    if (milestoneText && !milestone) errors.push(`Milestone "${milestoneText}" was not found`)
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push('Quantity must be greater than 0')
    if (!Number.isFinite(rate) || rate <= 0) errors.push('Rate must be greater than 0')

    const phaseNameKey = normalizeKey(name)
    if (phaseNameKey) {
      if (existingPhaseNameSet.value.has(phaseNameKey)) {
        errors.push(`Phase "${name}" already exists in this project`)
      }
      if (seenCsvPhaseNames.has(phaseNameKey)) {
        errors.push(`Duplicate phase "${name}" found in CSV`)
      } else {
        seenCsvPhaseNames.add(phaseNameKey)
      }
    }

    // Status is always set by the backend (defaults to Pending). Any status
    // column in the CSV is intentionally ignored.
    const resolvedStatus = pendingStatusId.value
      ? phaseStatusOptions.value.find((s) => String(s.value) === String(pendingStatusId.value))
      : null

    rows.push({
      rowNumber,
      source: {
        name,
        department: departmentText,
        milestone: milestoneText,
        quantity: quantityRaw,
        rate: rateRaw,
      },
      payload: {
        name,
        departmentId: department?.id || null,
        department: department?.name || departmentText || '',
        milestoneId: milestone?.itemId || null,
        milestoneDesc: milestone?.desc || milestoneText || '',
        milestone: milestone?.desc || milestoneText || '',
        serviceItem: milestone?.desc || milestoneText || '',
        definedQty: Number.isFinite(quantity) ? quantity : null,
        rate: Number.isFinite(rate) ? rate : null,
        statusId: resolvedStatus?.value || null,
        status: resolvedStatus?.label || '',
      },
      errors,
    })
  }

  return rows
}

async function handleCsvFileChange(event) {
  if (!step1Done.value) {
    const blockedMessage = step1ProjectBanner.value?.message
      ? String(step1ProjectBanner.value.message).replace(/<[^>]+>/g, '')
      : isLockedForJnlProc.value
        ? 'This project is locked for journal processing. Bulk upload is temporarily disabled.'
        : 'Please link a sales order with the project before upload.'
    toast.show({
      message: blockedMessage,
      variant: 'warning',
    })
    if (event?.target) event.target.value = ''
    return
  }
  const file = event?.target?.files?.[0]
  if (!file) return
  await handleCsvFile(file)
  if (event?.target) event.target.value = ''
}

async function handleCsvFile(file) {
  if (!file) return
  if (Number(file.size || 0) > MAX_CSV_SIZE_BYTES) {
    toast.show({ message: 'CSV file exceeds 5MB limit.', variant: 'error' })
    return
  }

  try {
    const text = await readFileAsText(file)
    const parsedLines = parseCsvMatrix(text)
    if (parsedLines.length > MAX_CSV_LINES) {
      toast.show({
        message: `CSV exceeds ${MAX_CSV_LINES} lines. Please upload a smaller file.`,
        variant: 'error',
      })
      return
    }
    csvText.value = text
    sourceFileName.value = file.name || 'upload.csv'
    toast.show({ message: `Loaded ${sourceFileName.value}.`, variant: 'success' })
  } catch (error) {
    toast.show({ message: error?.message || 'Failed to read file.', variant: 'error' })
  }
}

function openFilePicker() {
  if (!step1Done.value) return
  fileInputEl.value?.click?.()
}

function onDropzoneDragEnter() {
  if (!step1Done.value) return
  isDragActive.value = true
}

function onDropzoneDragOver(event) {
  event.preventDefault()
  if (!step1Done.value) return
  isDragActive.value = true
}

function onDropzoneDragLeave(event) {
  if (event.currentTarget === event.target) isDragActive.value = false
}

async function onDropzoneDrop(event) {
  event.preventDefault()
  isDragActive.value = false
  if (!step1Done.value) return
  const files = event?.dataTransfer?.files
  if (!files?.length) return
  if (files.length > 1) {
    toast.show({ message: 'Only one CSV file can be uploaded at a time.', variant: 'error' })
    return
  }
  const file = files[0]
  await handleCsvFile(file)
}

function parseUpload() {
  if (!selectedProjectId.value) {
    toast.show({ message: 'Please select a project first.', variant: 'error' })
    return
  }
  if (!lookupsReadyForSelectedProject.value) {
    toast.show({
      message: 'Please wait for phase lookups to finish loading for this project.',
      variant: 'info',
    })
    return
  }
  if (!hasLinkedSalesOrder.value) {
    toast.show({
      message:
        step1ProjectBanner.value?.message?.replace?.(/<[^>]+>/g, '') ||
        'Please link a sales order with the project before upload.',
      variant: 'warning',
    })
    return
  }
  if (isLockedForJnlProc.value) {
    toast.show({
      message:
        step1ProjectBanner.value?.message?.replace?.(/<[^>]+>/g, '') ||
        'This project is locked for journal processing. Bulk upload is temporarily disabled.',
      variant: 'warning',
    })
    return
  }
  if (!String(csvText.value || '').trim()) {
    toast.show({ message: 'Paste CSV content or select a CSV file first.', variant: 'error' })
    return
  }
  const parsedLines = parseCsvMatrix(csvText.value)
  if (parsedLines.length > MAX_CSV_LINES) {
    toast.show({
      message: `CSV exceeds ${MAX_CSV_LINES} lines. Please keep it within the limit.`,
      variant: 'error',
    })
    return
  }

  try {
    const rows = parseRowsFromCsv(csvText.value)
    parsedRows.value = rows
    if (!rows.length) {
      toast.show({ message: 'No data rows found in CSV.', variant: 'warning' })
      return
    }
    if (invalidRows.value.length) {
      toast.show({
        message: `${invalidRows.value.length} row(s) have validation errors.`,
        variant: 'warning',
      })
      return
    }
    toast.show({ message: `${rows.length} row(s) ready to upload.`, variant: 'success' })
  } catch (error) {
    parsedRows.value = []
    toast.show({ message: error?.message || 'Failed to parse CSV.', variant: 'error' })
  }
}

async function submitUpload() {
  if (!canSubmit.value) return
  if (isLockedForJnlProc.value) {
    toast.show({
      message:
        step1ProjectBanner.value?.message?.replace?.(/<[^>]+>/g, '') ||
        'This project is locked for journal processing. Bulk upload is temporarily disabled.',
      variant: 'warning',
    })
    return
  }

  isSubmitting.value = true
  try {
    const phases = validRows.value.map((row) => row.payload)
    await projectsStore.upsertPhases({
      projectId: String(selectedProjectId.value),
      phases,
    })

    isSubmitting.value = false
    toast.show({
      message: `Uploaded ${phases.length} phase(s) to ${selectedProjectLabel.value}.`,
      variant: 'success',
    })
    parsedRows.value = []
    csvText.value = ''
    sourceFileName.value = ''
    router.push({ name: 'project-detail', params: { projectId: String(selectedProjectId.value) } })
  } catch (error) {
    isSubmitting.value = false
    toast.show({
      message: error?.message || 'Failed to upload phases.',
      variant: 'error',
      durationMs: 10000,
    })
  }
}

function clearAll() {
  parsedRows.value = []
  csvText.value = ''
  sourceFileName.value = ''
}

function setSampleCsv() {
  csvText.value = `name,department,milestone,quantity,rate
Sample Phase 1,Operations,Sign off,1,500
Sample Phase 2,Operations,Documentation,2,350`
  sourceFileName.value = ''
}

watch(
  () => selectedProjectId.value,
  async (projectId) => {
    parsedRows.value = []
    if (!projectId) return
    isLoadingLookups.value = true
    try {
      await Promise.all([
        projectsStore.fetchPhaseLookupsForProject({ projectId }),
        projectsStore.fetchProjectLoad({ projectId }),
      ])
    } catch (error) {
      toast.show({ message: error?.message || 'Failed to fetch phase lookups.', variant: 'error' })
    } finally {
      isLoadingLookups.value = false
    }
  },
)

onMounted(async () => {
  setTopbar()
  isPageLoading.value = true
  try {
    await Promise.all([
      projectsStore.fetchInitData().catch(() => {}),
      projectsStore.fetchProjects().catch(() => {}),
    ])

    const queryProjectId = String(route.query?.projectId || '').trim()
    if (queryProjectId && projectOptions.value.some((option) => option.value === queryProjectId)) {
      selectedProjectId.value = queryProjectId
    }
  } catch {
    // no-op
  } finally {
    isPageLoading.value = false
  }
})
</script>

<template>
  <section class="bpu-page">
    <BlockingOverlay
      v-if="isPageLoading"
      title="Loading phase upload..."
      subtitle="Please wait while we prepare the page."
    />

    <BlockingOverlay
      v-if="isSubmitting"
      title="Uploading phases…"
      subtitle="Please wait while we create phases for the selected project."
    />

    <BulkPhaseUploadSteps :steps="bpuSteps" />

    <!-- Main content -->
    <div class="bpu-main">
      <!-- Step 1: Project -->
      <BulkPhaseUploadCard
        step-badge="1"
        title="Select project"
        subtitle="The phases will be uploaded into this project"
        body-class="bpu-card-body--two-col"
      >
        <!-- Left: selector -->
        <div class="bpu-project-left">
          <label class="bpu-label" for="project-select">Project</label>
          <Select
            id="project-select"
            v-model="selectedProjectId"
            :options="projectOptions"
            option-label="label"
            option-value="value"
            placeholder="Search and select a project…"
            class="bpu-select"
            filter
          />
          <div v-if="selectedProjectId && isLoadingLookups" class="bpu-loading-hint">
            <span class="bpu-spinner"></span> Loading phase lookups…
          </div>
          <div v-else-if="step1Done" class="bpu-ready-hint">
            <span class="bpu-ready-dot"></span> Ready — validators loaded for
            <strong>{{ selectedProjectLabel }}</strong>
          </div>
          <ProjectBanner
            v-else-if="step1ProjectBanner"
            :variant="step1ProjectBanner.variant"
            :role="step1ProjectBanner.role"
            class="bpu-banner"
          >
            <span v-if="step1ProjectBanner.html" v-html="step1ProjectBanner.message"></span>
            <span v-else>{{ step1ProjectBanner.message }}</span>
          </ProjectBanner>
        </div>

        <BulkUploadProjectDetail
          v-if="selectedProject || !selectedProjectId"
          :project="selectedProject"
          :project-href="selectedProjectHref || ''"
          :is-processing="isLockedForJnlProc"
        />
      </BulkPhaseUploadCard>

      <!-- Step 2: CSV input -->
      <BulkPhaseUploadCard step-badge="2" title="Load CSV data">
        <template #subtitle>
          Required columns:
          <code class="bpu-code">name, department, milestone, quantity, rate</code>
        </template>
        <input
          ref="fileInputEl"
          type="file"
          accept=".csv,text/csv"
          class="bpu-hidden-input"
          @change="handleCsvFileChange"
        />

        <!-- Drop zone -->
        <div
          class="bpu-dropzone"
          :class="{ 'bpu-dropzone--active': isDragActive, 'bpu-dropzone--disabled': !step1Done }"
          @click="openFilePicker"
          @dragenter="onDropzoneDragEnter"
          @dragover="onDropzoneDragOver"
          @dragleave="onDropzoneDragLeave"
          @drop="onDropzoneDrop"
        >
          <div class="bpu-dropzone-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="28"
              height="28"
            >
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
              <polyline points="16 8 12 4 8 8" />
              <line x1="12" y1="4" x2="12" y2="16" />
            </svg>
          </div>
          <div class="bpu-dropzone-title">
            {{ sourceFileName ? sourceFileName : 'Drop CSV file here' }}
          </div>
          <div class="bpu-dropzone-sub">or click to browse</div>
        </div>

        <div class="bpu-divider"><span>or paste CSV</span></div>

        <textarea
          v-model="csvText"
          class="bpu-textarea"
          :disabled="!step1Done"
          placeholder="name,department,milestone,quantity,rate&#10;Phase 1,Operations,Sign off,1,500"
          spellcheck="false"
        ></textarea>

        <div class="bpu-row-actions">
          <ActionBtn
            label="Show sample"
            mdi-icon="mdi-file-document-outline"
            :disabled="!step1Done"
            :on-click="setSampleCsv"
          />
          <ActionBtn
            label="Clear all"
            mdi-icon="mdi-delete-outline"
            :disabled="!csvText && !parsedRows.length"
            :on-click="clearAll"
          />
        </div>
      </BulkPhaseUploadCard>

      <!-- Step 3 + 4: Preview & Submit -->
      <BulkPhaseUploadCard
        step-badge="3/4"
        title="Preview & submit"
        subtitle="Review rows, then upload valid phases"
      >
        <template #headerRight>
          <ActionBtn
            :label="isLoadingLookups ? 'Loading…' : 'Preview upload'"
            mdi-icon="mdi-eye-outline"
            variant="primary"
            :disabled="!step1Done || isLoadingLookups || !step2Done"
            :on-click="parseUpload"
          />
          <ActionBtn
            :label="validRows.length ? `Submit (${validRows.length})` : 'Submit'"
            mdi-icon="mdi-check-circle-outline"
            variant="primary"
            :disabled="!canSubmit"
            :on-click="submitUpload"
          />
        </template>
        <BulkUploadValidationSummary
          :total="parsedRows.length"
          :valid="validRows.length"
          :invalid="invalidRows.length"
          :error-message="`${invalidRows.length} row(s) have errors. Fix your CSV and preview again.`"
          :success-message="`All ${validRows.length} rows are valid. Click <strong>Submit</strong> to upload.`"
          banner-class="bpu-banner"
        />

        <!-- Empty state -->
        <div v-if="!parsedRows.length" class="bpu-empty">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            width="32"
            height="32"
            class="bpu-empty-icon"
          >
            <path d="M9 17H5a2 2 0 00-2 2v0a2 2 0 002 2h14a2 2 0 002-2v0a2 2 0 00-2-2h-4" />
            <rect x="9" y="3" width="6" height="14" rx="1" />
          </svg>
          <div class="bpu-empty-title">No preview yet</div>
          <div class="bpu-empty-sub">
            Load CSV data above, then click <strong>Preview upload</strong>
          </div>
        </div>

        <!-- Preview table -->
        <div v-else class="bpu-table-wrap">
          <table class="bpu-table">
            <thead>
              <tr>
                <th class="bpu-th-row">#</th>
                <th>Name</th>
                <th>Department</th>
                <th>Milestone</th>
                <th class="bpu-th-num">Qty</th>
                <th class="bpu-th-num">Rate</th>
                <th>Validation</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in parsedRows"
                :key="row.rowNumber"
                :class="row.errors.length ? 'bpu-tr--invalid' : 'bpu-tr--valid'"
              >
                <td class="bpu-td-row">{{ row.rowNumber }}</td>
                <td>{{ row.source.name || '—' }}</td>
                <td>{{ row.source.department || '—' }}</td>
                <td>{{ row.source.milestone || '—' }}</td>
                <td class="bpu-td-num">{{ row.source.quantity || '—' }}</td>
                <td class="bpu-td-num">{{ row.source.rate || '—' }}</td>
                <td>
                  <div v-if="!row.errors.length" class="bpu-valid-badge">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      width="12"
                      height="12"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Ready
                  </div>
                  <div v-else class="bpu-error-list">
                    <div v-for="(err, i) in row.errors" :key="i" class="bpu-error-item">
                      {{ err }}
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </BulkPhaseUploadCard>
    </div>
  </section>
</template>

<style scoped>
/* ── Layout ─────────────────────────────────────────────── */
.bpu-page {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 20px;
  align-items: start;
}

@media (max-width: 768px) {
  .bpu-page {
    grid-template-columns: 1fr;
  }
}

/* ── Main column ─────────────────────────────────────────── */
.bpu-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  margin-bottom: 1rem;
}

/* ── Form elements ───────────────────────────────────────── */
.bpu-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text, #6b7280);
}

.bpu-select {
  width: 100%;
  text-align: start;
}

/* Fix PrimeVue Select for light mode */
:deep(.p-select) {
  background: var(--surface-1, #fff) !important;
  border-color: var(--border-strong, #e1e6dc) !important;
  border-radius: 8px !important;
  color: var(--text-h) !important;
  font-size: 16px !important;
}

:deep(.p-select-label) {
  color: var(--text-h) !important;
  font-size: 16px !important;
}

:deep(.p-select-dropdown) {
  color: var(--text, #6b7280) !important;
}

:deep(.p-select-overlay) {
  background: var(--surface-1, #fff) !important;
  border-color: var(--border-strong, #e1e6dc) !important;
  border-radius: 10px !important;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.1) !important;
}

:deep(.p-select-option) {
  color: var(--text-h) !important;
}

:deep(.p-select-option:hover),
:deep(.p-select-option.p-focus) {
  background: var(--surface-2, #f7faf8) !important;
}

:deep(.p-select-option.p-selected) {
  background: var(--accent-bg, rgba(0, 165, 106, 0.1)) !important;
  color: var(--accent, #00a56a) !important;
}

:deep(.p-select-filter) {
  background: var(--surface-2, #f7faf8) !important;
  border-color: var(--border-strong, #e1e6dc) !important;
  color: var(--text-h) !important;
  border-radius: 6px !important;
}

.bpu-project-left {
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: 12px;
}

.bpu-code {
  font-family: var(--mono, monospace);
  font-size: 11px;
  background: var(--surface-3, #f3f4f6);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--text-h);
}

/* ── Status hints ────────────────────────────────────────── */
.bpu-loading-hint,
.bpu-ready-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text, #6b7280);
}

.bpu-ready-hint {
  color: var(--accent, #00a56a);
}

.bpu-ready-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent, #00a56a);
  flex-shrink: 0;
}

.bpu-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-strong, #e1e6dc);
  border-top-color: var(--accent, #00a56a);
  border-radius: 50%;
  animation: bpu-spin 0.7s linear infinite;
}

@keyframes bpu-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Drop zone ───────────────────────────────────────────── */
.bpu-hidden-input {
  display: none;
}

.bpu-dropzone {
  border: 2px dashed var(--border-strong, #e1e6dc);
  border-radius: 12px;
  background: var(--surface-2, #f7faf8);
  padding: 28px 20px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transition:
    border-color 0.2s,
    background 0.2s;
  text-align: center;
}

.bpu-dropzone:not(.bpu-dropzone--disabled):hover,
.bpu-dropzone--active {
  border-color: var(--accent, #00a56a);
  background: var(--accent-bg, rgba(0, 165, 106, 0.06));
}

.bpu-dropzone-icon {
  color: var(--text, #6b7280);
  opacity: 0.6;
}

.bpu-dropzone--active .bpu-dropzone-icon {
  color: var(--accent, #00a56a);
  opacity: 1;
}

.bpu-dropzone--disabled {
  opacity: 0.58;
  cursor: not-allowed;
  border-style: dashed;
}

.bpu-dropzone-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-h);
}

.bpu-dropzone-sub {
  font-size: 12px;
  color: var(--text, #6b7280);
}

/* ── Divider ─────────────────────────────────────────────── */
.bpu-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text, #6b7280);
  font-size: 12px;
}

.bpu-divider::before,
.bpu-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-strong, #e1e6dc);
}

/* ── Textarea ────────────────────────────────────────────── */
.bpu-textarea {
  width: 100%;
  min-height: 140px;
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 10px;
  padding: 12px;
  background: var(--surface-2, #f7faf8);
  color: var(--text-h);
  font: 12px/1.5 var(--mono, monospace);
  resize: vertical;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.bpu-textarea:focus {
  outline: none;
  border-color: var(--accent, #00a56a);
}

.bpu-textarea:disabled {
  background: var(--surface-3, #f3f4f6);
  color: var(--text, #9ca3af);
  border-style: dashed;
  cursor: not-allowed;
}

/* ── Row action buttons ──────────────────────────────────── */
.bpu-row-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* ── Buttons ─────────────────────────────────────────────── */
.bpu-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 400;
  padding: 0 14px;
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition:
    opacity 0.15s,
    background 0.15s;
}

.bpu-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.bpu-btn--primary {
  background: var(--topbar-primary-bg, #1a5c38);
  color: #fff;
  border-color: transparent;
}

.bpu-btn--success {
  background: var(--accent, #00a56a);
  color: #fff;
  border-color: transparent;
}

.bpu-btn--ghost {
  background: var(--surface-2, #f7faf8);
  color: var(--text-h);
  border-color: var(--border-strong, #e1e6dc);
}

/* ── Banner ──────────────────────────────────────────────── */
.bpu-banner {
  margin: 0;
}

/* ── Empty state ─────────────────────────────────────────── */
.bpu-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 20px;
  text-align: center;
}

.bpu-empty-icon {
  color: var(--text, #6b7280);
  opacity: 0.4;
}

.bpu-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-h);
}

.bpu-empty-sub {
  font-size: 13px;
  color: var(--text, #6b7280);
}

/* ── Table ───────────────────────────────────────────────── */
.bpu-table-wrap {
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 12px;
  overflow: auto;
}

.bpu-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 860px;
}

.bpu-table thead tr {
  background: var(--surface-2, #f7faf8);
}

.bpu-table th {
  padding: 10px 14px;
  text-align: left;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text, #6b7280);
  border-bottom: 1px solid var(--border-strong, #e1e6dc);
  white-space: nowrap;
}

.bpu-table td {
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-h);
  border-bottom: 1px solid var(--border-strong, #e1e6dc);
  vertical-align: top;
  text-align: start;
}

.bpu-table tbody tr:last-child td {
  border-bottom: none;
}

.bpu-th-row,
.bpu-td-row {
  width: 40px;
  text-align: center;
  color: var(--text, #6b7280);
  font-size: 11px;
}

.bpu-th-num,
.bpu-td-num {
  text-align: right;
  white-space: nowrap;
}

.bpu-tr--invalid td {
  background: rgba(239, 68, 68, 0.04);
}

/* ── Valid / error badges ────────────────────────────────── */
.bpu-valid-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent, #00a56a);
}

.bpu-error-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.bpu-error-item {
  font-size: 12px;
  color: var(--red, #ef4444);
  line-height: 1.35;
}

.bpu-error-item::before {
  content: '· ';
}
</style>
