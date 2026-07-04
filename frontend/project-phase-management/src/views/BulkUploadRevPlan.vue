<script setup>
import { computed, markRaw, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Select from 'primevue/select'
import { useProjectsStore } from '@/stores/projects'
import { useTopbarStore } from '@/stores/topbar'
import { useToastStore } from '@/stores/toast'
import BlockingOverlay from '@/components/BlockingOverlay.vue'
import BulkPhaseUploadCard from '@/components/BulkPhaseUploadCard.vue'
import BulkPhaseUploadSteps from '@/components/BulkPhaseUploadSteps.vue'
import BulkUploadProjectDetail from '@/components/BulkUploadProjectDetail.vue'
import BulkUploadValidationSummary from '@/components/BulkUploadValidationSummary.vue'
import ProjectBanner from '@/components/ProjectBanner.vue'
import RevPlanTable from '@/components/RevPlanTable.vue'
import { useBannerUi } from '@/composables/useBannerUi'
import { exportRevPlanXlsx, parseRevPlanUploadXlsx } from '@/services/revPlanXLSX'
import { useAllocationUpdate } from '@/composables/useAllocationUpdate'
import { useAuthz } from '@/composables/useAuthz'
import ActionBtn from '@/components/ActionBtn.vue'
import DownloadIcon from '@/components/icons/DownloadIcon.vue'

const downloadIcon = markRaw(DownloadIcon)

const route = useRoute()
const router = useRouter()
const projectsStore = useProjectsStore()
const topbar = useTopbarStore()
const toast = useToastStore()
const { submitUpdate } = useAllocationUpdate()

const selectedProjectId = ref('')
const { can } = useAuthz({ projectId: selectedProjectId })
const { resolveRevPlanBannerUi } = useBannerUi({ projectId: selectedProjectId })
const isPageLoading = ref(false)
const isLoadingProjectChecks = ref(false)
const isDownloadingTemplate = ref(false)
const isParsingUpload = ref(false)
const isSubmitting = ref(false)
const isDragActive = ref(false)
const sourceFileName = ref('')
const fileInputEl = ref(null)
const parsedPreviewRows = ref([])
const parsedPayload = ref([])
const uploadRowErrors = ref([])
const missingPhaseRows = ref([])
const MAX_XLSX_SIZE_BYTES = 8 * 1024 * 1024

const projectOptions = computed(() =>
  (Array.isArray(projectsStore.projects) ? projectsStore.projects : [])
    .map((project) => ({
      value: String(project?.id || ''),
      label: String(project?.name || project?.ref || '').trim(),
    }))
    .filter((option) => option.value && option.label)
    .sort((left, right) => left.label.localeCompare(right.label)),
)

const selectedProject = computed(
  () =>
    (Array.isArray(projectsStore.projects) ? projectsStore.projects : []).find(
      (p) => String(p?.id || '') === String(selectedProjectId.value || ''),
    ) || null,
)

const selectedProjectHref = computed(() => {
  if (!selectedProjectId.value) return ''
  const resolved = router.resolve({
    name: 'revenue-detail',
    params: { projectId: selectedProjectId.value },
  })
  return resolved?.href || ''
})

const projectLoad = computed(
  () => projectsStore.projectLoadByProject[String(selectedProjectId.value || '')] || null,
)
const revPlanBannerCode = computed(() => projectLoad.value?.revPlanBanner?.code || null)
const revPlanBannerUi = computed(() => resolveRevPlanBannerUi(revPlanBannerCode.value))
const revPlanBannerVariant = computed(
  () => revPlanBannerUi.value?.variant || projectLoad.value?.revPlanBanner?.variant || 'success',
)
const canEditRevPlans = computed(
  () => can('revplan.update') && Boolean(projectLoad.value?.canEditRevPlan),
)
const revPlansMeta = computed(
  () => projectsStore.projectRevPlansMetaByProject[String(selectedProjectId.value || '')] || {},
)
const monthColumns = computed(() => {
  const rows = Array.isArray(
    projectsStore.backendMonthsByProject[String(selectedProjectId.value || '')],
  )
    ? projectsStore.backendMonthsByProject[String(selectedProjectId.value || '')]
    : []
  return rows.map((month) => ({
    ...month,
    statusKey: month.status?.key || '',
    statusLabel: month.isCurrent ? 'Current' : month.type === 'actual' ? 'Actual' : 'Forecast',
    monthStatusKey: month.status?.key || '',
    monthStatusLabel: month.status?.label || '—',
    monthTypeLabel: month.isCurrent ? 'Current' : month.type === 'actual' ? 'Actual' : 'Forecast',
  }))
})

const step1BaseDone = computed(
  () => Boolean(selectedProjectId.value) && !isLoadingProjectChecks.value,
)
const step1Done = computed(() => step1BaseDone.value && canEditRevPlans.value)

const revPlanEditBlockedMessage = computed(() => {
  if (!selectedProjectId.value || isLoadingProjectChecks.value || canEditRevPlans.value) return ''
  return revPlanBannerUi.value.message || 'Rev plans are not editable for this project.'
})
const canDownloadTemplate = computed(
  () => Boolean(step1Done.value) && !isLoadingProjectChecks.value && !isDownloadingTemplate.value,
)
const canLoadTemplate = computed(
  () => Boolean(step1Done.value) && !isLoadingProjectChecks.value && !isParsingUpload.value,
)
const step2Done = computed(() => Boolean(sourceFileName.value))
const step3Done = computed(
  () =>
    Boolean(parsedPreviewRows.value.length) &&
    !uploadRowErrors.value.length &&
    !missingPhaseRows.value.length,
)
const previewInvalidCount = computed(
  () => Number(uploadRowErrors.value.length || 0) + Number(missingPhaseRows.value.length || 0),
)
const previewValidCount = computed(() =>
  Math.max(
    0,
    Number(parsedPreviewRows.value.length || 0) - Number(uploadRowErrors.value.length || 0),
  ),
)
const canValidateAndSubmit = computed(
  () =>
    can('revplan.update') &&
    Boolean(step1Done.value) &&
    Boolean(sourceFileName.value) &&
    !isParsingUpload.value &&
    !isSubmitting.value &&
    !uploadRowErrors.value.length &&
    !missingPhaseRows.value.length &&
    Boolean(parsedPayload.value.length),
)

async function downloadTemplate() {
  const projectId = String(selectedProjectId.value || '').trim()
  if (!projectId || !canEditRevPlans.value || isDownloadingTemplate.value) return

  isDownloadingTemplate.value = true
  try {
    await projectsStore.fetchProjectRevPlans({ projectId })

    const projectName = String(
      selectedProject.value?.name || selectedProject.value?.ref || '',
    ).trim()
    const rows = Array.isArray(projectsStore.revenueRowsByProject?.[projectId])
      ? projectsStore.revenueRowsByProject[projectId]
      : []
    const revPlansMeta = projectsStore.projectRevPlansMetaByProject?.[projectId] || {}

    await exportRevPlanXlsx({
      filename: `${projectName || 'project-rev-plans'}-rev-plans-template.xlsx`,
      rows,
      monthColumns: monthColumns.value,
      canEditLines: true,
      isPostJournalState: Boolean(revPlansMeta?.isPostJournalState),
      planStatusById:
        revPlansMeta?.planStatusById && typeof revPlansMeta.planStatusById === 'object'
          ? revPlansMeta.planStatusById
          : {},
    })
  } catch (error) {
    toast.show({
      message: error?.message || 'Failed to download rev plan template.',
      variant: 'error',
    })
  } finally {
    isDownloadingTemplate.value = false
  }
}

function resetUploadState() {
  sourceFileName.value = ''
  parsedPreviewRows.value = []
  parsedPayload.value = []
  uploadRowErrors.value = []
  missingPhaseRows.value = []
}

function openFilePicker() {
  if (!canLoadTemplate.value) return
  fileInputEl.value?.click?.()
}

function onDropzoneDragEnter() {
  if (!canLoadTemplate.value) return
  isDragActive.value = true
}

function onDropzoneDragOver(event) {
  event.preventDefault()
  if (!canLoadTemplate.value) return
  isDragActive.value = true
}

function onDropzoneDragLeave(event) {
  if (event.currentTarget === event.target) isDragActive.value = false
}

async function parseUploadFile(file) {
  if (!file) return
  if (Number(file.size || 0) > MAX_XLSX_SIZE_BYTES) {
    toast.show({ message: 'XLSX file exceeds 8MB limit.', variant: 'error' })
    return
  }
  const fileName = String(file.name || '').toLowerCase()
  if (!fileName.endsWith('.xlsx')) {
    toast.show({ message: 'Only .xlsx files are supported.', variant: 'error' })
    return
  }

  const projectId = String(selectedProjectId.value || '').trim()
  if (!projectId || !step1Done.value) return

  isParsingUpload.value = true
  try {
    await projectsStore.fetchProjectRevPlans({ projectId })
    const rows = Array.isArray(projectsStore.revenueRowsByProject?.[projectId])
      ? projectsStore.revenueRowsByProject[projectId]
      : []

    const result = await parseRevPlanUploadXlsx({
      file,
      monthColumns: monthColumns.value,
      baseRows: rows,
      canEditLines: canEditRevPlans.value,
      isPostJournalState: Boolean(revPlansMeta.value?.isPostJournalState),
      planStatusById:
        revPlansMeta.value?.planStatusById && typeof revPlansMeta.value.planStatusById === 'object'
          ? revPlansMeta.value.planStatusById
          : {},
    })

    sourceFileName.value = file.name || 'upload.xlsx'
    parsedPreviewRows.value = result.previewRows || []
    parsedPayload.value = result.payload || []
    uploadRowErrors.value = result.rowErrors || []
    missingPhaseRows.value = result.missingPhaseRows || []

    if (result.hasErrors) {
      toast.show({
        message: 'Template parsed with validation errors. Review the preview before submit.',
        variant: 'warning',
      })
    } else {
      toast.show({
        message: `Template parsed successfully (${parsedPreviewRows.value.length} row(s)).`,
        variant: 'success',
      })
    }
  } catch (error) {
    resetUploadState()
    toast.show({ message: error?.message || 'Failed to parse XLSX template.', variant: 'error' })
  } finally {
    isParsingUpload.value = false
  }
}

async function handleXlsxFileChange(event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  await parseUploadFile(file)
  if (event?.target) event.target.value = ''
}

async function onDropzoneDrop(event) {
  event.preventDefault()
  isDragActive.value = false
  if (!canLoadTemplate.value) return
  const files = event?.dataTransfer?.files
  if (!files?.length) return
  if (files.length > 1) {
    toast.show({ message: 'Only one XLSX file can be uploaded at a time.', variant: 'error' })
    return
  }
  await parseUploadFile(files[0])
}

async function validateAndSubmit() {
  if (!canValidateAndSubmit.value) return
  const projectId = String(selectedProjectId.value || '').trim()
  if (!projectId) return

  isSubmitting.value = true
  try {
    await submitUpdate({
      projectsStore,
      projectId,
      confirmed: false,
      phasesData: parsedPayload.value,
    })

    isSubmitting.value = false
    toast.show({
      message: `Uploaded ${parsedPayload.value.length} rev plan row(s).`,
      variant: 'success',
    })
    resetUploadState()
    router.push({ name: 'revenue-detail', params: { projectId } })
  } catch (error) {
    isSubmitting.value = false
    toast.show({
      message: error?.message || 'Failed to upload rev plan allocations.',
      variant: 'error',
      durationMs: 10000,
    })
  }
}

const bpuSteps = computed(() => [
  {
    number: 1,
    title: 'Select project',
    desc: 'Choose project for rev plan upload',
    done: step1Done.value,
    active: !step1Done.value,
  },
  {
    number: 2,
    title: 'Load Template',
    desc: 'Upload rev plan template file (xlsx)',
    done: step2Done.value,
    active: step1Done.value && canEditRevPlans.value,
  },
  {
    number: 3,
    title: 'Preview & submit',
    desc: 'Review before applying',
    done: step3Done.value,
    active: step2Done.value,
  },
])

function setTopbar() {
  topbar.setTopbar({
    title: 'Bulk Upload Revenue Allocations',
    subtitle: 'Upload revenue plans allocations for a selected project.',
    backRouteName: 'bulk-upload',
    actions: [],
  })
}

onMounted(async () => {
  setTopbar()
  isPageLoading.value = true
  try {
    await projectsStore.fetchProjects().catch(() => {})

    const queryProjectId = String(route.query?.projectId || '').trim()
    if (queryProjectId && projectOptions.value.some((option) => option.value === queryProjectId)) {
      selectedProjectId.value = queryProjectId
    }
  } finally {
    isPageLoading.value = false
  }
})

watch(
  () => selectedProjectId.value,
  async (projectId) => {
    resetUploadState()
    if (!projectId) return
    isLoadingProjectChecks.value = true
    try {
      await Promise.all([
        projectsStore.fetchProjectLoad({ projectId }),
        projectsStore.fetchProjectRevPlans({ projectId }),
      ])
    } catch (error) {
      toast.show({
        message: error?.message || 'Failed to fetch project rev plan checks.',
        variant: 'error',
      })
    } finally {
      isLoadingProjectChecks.value = false
    }
  },
)
</script>

<template>
  <section class="bpu-page">
    <BlockingOverlay
      v-if="isPageLoading"
      title="Loading rev plan upload..."
      subtitle="Please wait while we set up the page."
    />
    <BlockingOverlay
      v-if="isSubmitting"
      title="Saving rev plan allocations..."
      subtitle="Please wait while we apply your uploaded allocations."
    />

    <BulkPhaseUploadSteps :steps="bpuSteps" />

    <div class="bpu-main">
      <BulkPhaseUploadCard
        step-badge="1"
        title="Select project"
        subtitle="The rev plans allocations will be uploaded into this project"
        body-class="bpu-card-body--two-col"
      >
        <div class="bpu-project-left">
          <label class="bpu-label" for="project-select-rev">Project</label>
          <Select
            id="project-select-rev"
            v-model="selectedProjectId"
            :options="projectOptions"
            option-label="label"
            option-value="value"
            placeholder="Search and select a project…"
            class="bpu-select"
            filter
          />
          <div v-if="selectedProjectId && isLoadingProjectChecks" class="bpu-loading-hint">
            <span class="bpu-spinner"></span> Running rev plan checks…
          </div>
          <div v-else-if="step1Done" class="bpu-ready-hint">
            <span class="bpu-ready-dot"></span> Ready — this project allows rev plan edits
          </div>
          <div v-if="step1Done" class="flex-center bpu-template-download">
            <ActionBtn
              :label="isDownloadingTemplate ? 'Downloading…' : 'Download template'"
              :icon="downloadIcon"
              :disabled="!canDownloadTemplate"
              :on-click="downloadTemplate"
            />
            <span>The acceptable XLSX template file.</span>
          </div>
          <ProjectBanner
            v-else-if="revPlanEditBlockedMessage"
            :variant="revPlanBannerVariant"
            role="alert"
            class="bpu-banner"
          >
            {{ revPlanEditBlockedMessage }}
          </ProjectBanner>
        </div>

        <BulkUploadProjectDetail
          v-if="selectedProject || !selectedProjectId"
          :project="selectedProject"
          :project-href="selectedProjectHref"
          :show-rev-plan-status="true"
        />
      </BulkPhaseUploadCard>

      <BulkPhaseUploadCard
        step-badge="2"
        title="Load Template"
        subtitle="Upload the XLSX template exported from the App"
      >
        <input
          ref="fileInputEl"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="bpu-hidden-input"
          @change="handleXlsxFileChange"
        />
        <div
          class="bpu-dropzone"
          :class="{
            'bpu-dropzone--active': isDragActive,
            'bpu-dropzone--disabled': !canLoadTemplate,
          }"
          @click="openFilePicker"
          @dragenter="onDropzoneDragEnter"
          @dragover="onDropzoneDragOver"
          @dragleave="onDropzoneDragLeave"
          @drop="onDropzoneDrop"
        >
          <div class="bpu-dropzone-title">
            {{ sourceFileName ? sourceFileName : 'Drop XLSX file here' }}
          </div>
          <div class="bpu-dropzone-sub">or click to browse</div>
        </div>
        <div class="bpu-upload-meta">
          <span>Template rows: {{ parsedPreviewRows.length }}</span>
          <span>Payload rows: {{ parsedPayload.length }}</span>
        </div>
      </BulkPhaseUploadCard>

      <BulkPhaseUploadCard
        step-badge="3"
        title="Preview & Submit"
        subtitle="Review your uploaded rev plans allocations before submitting"
      >
        <template #headerRight>
          <ActionBtn
            :label="
              parsedPayload.length
                ? `Validate & submit (${parsedPayload.length})`
                : 'Validate & submit'
            "
            mdi-icon="mdi-check-circle-outline"
            variant="primary"
            :disabled="!canValidateAndSubmit"
            :on-click="validateAndSubmit"
          />
        </template>
        <BulkUploadValidationSummary
          :total="parsedPreviewRows.length"
          :valid="previewValidCount"
          :invalid="previewInvalidCount"
          :error-message="`Validation found ${uploadRowErrors.length} row error(s) and ${missingPhaseRows.length} missing phase row(s).`"
          :success-message="`All ${previewValidCount} rows are valid. Review the preview below.`"
          banner-class="bpu-banner"
        />
        <div v-if="!sourceFileName" class="bru-placeholder">
          Upload your filled template to review your rev plans allocations before submitting.
        </div>

        <div v-else>
          <ul v-if="uploadRowErrors.length" class="bpu-errors">
            <li v-for="error in uploadRowErrors" :key="`row-${error.rowNumber}`">
              Row {{ error.rowNumber }} ({{ error.department || '—' }} / {{ error.phase || '—' }}):
              {{ error.errors.join(' ') }}
            </li>
          </ul>
          <ul v-if="missingPhaseRows.length" class="bpu-errors">
            <li
              v-for="missing in missingPhaseRows"
              :key="`missing-${missing.department}-${missing.phase}`"
            >
              {{ missing.department }} / {{ missing.phase }}: {{ missing.message }}
            </li>
          </ul>

          <RevPlanTable
            v-if="selectedProject && parsedPreviewRows.length"
            :project="selectedProject"
            :show-skeleton="false"
            :month-columns="monthColumns"
            :plan-status-by-id="revPlansMeta?.planStatusById || {}"
            :rows="parsedPreviewRows"
            :can-edit-lines="false"
            :is-post-journal-state="Boolean(revPlansMeta?.isPostJournalState)"
            :show-export="false"
          />
        </div>
      </BulkPhaseUploadCard>
    </div>
  </section>
</template>

<style scoped>
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

.bpu-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  margin-bottom: 1rem;
}

.bpu-project-left {
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: 12px;
}

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

.bpu-template-btn {
  border: 1px solid var(--border-strong, #d6dfd0);
  background: var(--surface-1, #ffffff);
  color: var(--text-h, #243224);
  border-radius: 8px;
  padding: 7px 11px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.bpu-template-btn:hover:not(:disabled) {
  border-color: var(--accent, #00a56a);
  color: var(--accent, #00a56a);
}

.bpu-template-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.bpu-btn {
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 8px;
  padding: 8px 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.bpu-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.bpu-btn--success {
  background: var(--accent, #00a56a);
  color: #fff;
  border-color: transparent;
}

.bpu-banner {
  margin: 0;
  text-align: start;
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

.bpu-template-download {
  flex-wrap: wrap;
  gap: 5px;
  font-size: 12px;
}

.bru-placeholder {
  border: 1px dashed var(--border-strong, #e1e6dc);
  border-radius: 10px;
  padding: 14px;
  font-size: 13px;
  color: var(--text, #6b7280);
  text-align: start;
}

.bpu-hidden-input {
  display: none;
}

.bpu-dropzone {
  border: 1px dashed var(--border-strong, #d6dfd0);
  border-radius: 10px;
  padding: 16px;
  text-align: center;
  color: var(--text, #6b7280);
  cursor: pointer;
  background: var(--surface-1, #ffffff);
}

.bpu-dropzone--active {
  border-color: var(--accent, #00a56a);
  background: var(--surface-2, #f7faf8);
}

.bpu-dropzone--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bpu-dropzone-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-h, #243224);
}

.bpu-dropzone-sub {
  margin-top: 4px;
  font-size: 12px;
}

.bpu-upload-meta {
  margin-top: 8px;
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text, #6b7280);
}

.bpu-errors {
  margin: 0 0 10px;
  padding: 0 0 0 16px;
  font-size: 12px;
  color: #dc2626;
}

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
</style>
