<script setup>
import { computed, onMounted, reactive, ref, markRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTopbarStore } from '@/stores/topbar'
import { useToastStore } from '@/stores/toast'
import DatatableCust from '@/components/DatatableCust.vue'
import AppModal from '@/components/AppModal.vue'
import BlockingOverlay from '@/components/BlockingOverlay.vue'
import { useProjectsStore } from '@/stores/projects'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import DatePicker from 'primevue/datepicker'
import CreateIcon from '@/components/icons/CreateIcon.vue'
import UploadIcon from '@/components/icons/UploadIcon.vue'
import DocumentsUploader from '@/components/DocumentsUploader.vue'
import { useAuthz } from '@/composables/useAuthz'

const topbar = useTopbarStore()
const router = useRouter()
const route = useRoute()
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

const showProjectsSkeleton = computed(
  () => Boolean(projectsLoading.value) && !projectsStore.projectsFetchedAt,
)
const showInitSkeleton = computed(
  () => Boolean(projectsStore.initDataInFlight) && !projectsStore.initData?.fetchedAt,
)
const pageLoading = computed(
  () => Boolean(showProjectsSkeleton.value) || Boolean(showInitSkeleton.value),
)

const showNewProjectModal = ref(false)
const isCreatingProject = ref(false)
const newProjectSubmitAttempted = ref(false)
const newProjectStagedFiles = ref([])
const newProjectUploadingIndex = ref(-1)
const MAX_PROJECT_DOCUMENTS = 3

const newProjectForm = reactive({
  name: '',
  description: '',
  startDate: null,
  endDate: null,
  customerId: '',
  projectManagerId: '',
  departmentId: '',
  poRef: '',
})

const customerOptions = computed(() => {
  const rows = Array.isArray(projectsStore.projectEditLookups?.customers)
    ? projectsStore.projectEditLookups.customers
    : Array.isArray(projectsStore.initData?.lookups?.customers)
      ? projectsStore.initData.lookups.customers
      : []
  return rows
    .map((c) => ({ value: c?.id != null ? String(c.id) : '', label: c?.name || '' }))
    .filter((o) => o.value && o.label)
})

const projectManagerOptions = computed(() => {
  const rows = Array.isArray(projectsStore.projectEditLookups?.projectManagers)
    ? projectsStore.projectEditLookups.projectManagers
    : Array.isArray(projectsStore.initData?.lookups?.projectManagers)
      ? projectsStore.initData.lookups.projectManagers
      : []
  return rows
    .map((e) => ({ value: e?.id != null ? String(e.id) : '', label: e?.name || '' }))
    .filter((o) => o.value && o.label)
})

const departmentOptions = computed(() => {
  const rows = Array.isArray(projectsStore.projectEditLookups?.departments)
    ? projectsStore.projectEditLookups.departments
    : Array.isArray(projectsStore.initData?.lookups?.departments)
      ? projectsStore.initData.lookups.departments
      : []
  return rows
    .map((d) => ({ value: d?.id != null ? String(d.id) : '', label: d?.name || '' }))
    .filter((o) => o.value && o.label)
})

const canSubmitNewProject = computed(() => {
  const nameOk = Boolean(String(newProjectForm.name || '').trim())
  const startOk =
    newProjectForm.startDate instanceof Date && !Number.isNaN(newProjectForm.startDate.getTime())
  const endOk =
    newProjectForm.endDate instanceof Date && !Number.isNaN(newProjectForm.endDate.getTime())
  const customerOk = Boolean(String(newProjectForm.customerId || '').trim())
  const pmOk = Boolean(String(newProjectForm.projectManagerId || '').trim())
  const rangeOk =
    startOk && endOk ? newProjectForm.endDate.getTime() >= newProjectForm.startDate.getTime() : true
  return nameOk && startOk && endOk && customerOk && pmOk && rangeOk && !isCreatingProject.value
})

const newProjectNameMissing = computed(() => !String(newProjectForm.name || '').trim())
const newProjectStartDateMissing = computed(
  () =>
    !(
      newProjectForm.startDate instanceof Date && !Number.isNaN(newProjectForm.startDate.getTime())
    ),
)
const newProjectEndDateMissing = computed(
  () =>
    !(newProjectForm.endDate instanceof Date && !Number.isNaN(newProjectForm.endDate.getTime())),
)
const newProjectCustomerMissing = computed(() => !String(newProjectForm.customerId || '').trim())
const newProjectPmMissing = computed(() => !String(newProjectForm.projectManagerId || '').trim())
const newProjectMissingRequiredFields = computed(
  () =>
    newProjectNameMissing.value ||
    newProjectStartDateMissing.value ||
    newProjectEndDateMissing.value ||
    newProjectCustomerMissing.value ||
    newProjectPmMissing.value,
)

const newProjectDateRangeInvalid = computed(() => {
  const startOk =
    newProjectForm.startDate instanceof Date && !Number.isNaN(newProjectForm.startDate.getTime())
  const endOk =
    newProjectForm.endDate instanceof Date && !Number.isNaN(newProjectForm.endDate.getTime())
  if (!startOk || !endOk) return false
  return newProjectForm.endDate.getTime() < newProjectForm.startDate.getTime()
})

function resetNewProjectForm() {
  newProjectForm.name = ''
  newProjectForm.description = ''
  newProjectForm.startDate = null
  newProjectForm.endDate = null
  newProjectForm.customerId = ''
  newProjectForm.projectManagerId = ''
  newProjectForm.departmentId = ''
  newProjectForm.poRef = ''
  newProjectSubmitAttempted.value = false
  newProjectStagedFiles.value = []
  newProjectUploadingIndex.value = -1
}

async function openNewProjectModal() {
  if (pageLoading.value) {
    toast.show({ message: 'Please wait for projects to finish loading.', variant: 'info' })
    return
  }
  resetNewProjectForm()
  showNewProjectModal.value = true
  if (!projectsStore.initData?.fetchedAt) {
    projectsStore.fetchInitData().catch(() => {})
  }
}

function closeNewProjectModal() {
  if (isCreatingProject.value) return
  showNewProjectModal.value = false
  newProjectSubmitAttempted.value = false
}

async function handleCreateProjectClick() {
  newProjectSubmitAttempted.value = true
  if (!canSubmitNewProject.value) {
    toast.show({ message: 'Please fill in all required fields marked with *.', variant: 'warning' })
    return
  }
  await submitNewProject()
}

async function submitNewProject() {
  const name = String(newProjectForm.name || '').trim()
  if (!name) return toast.show({ message: 'Project name is required.', variant: 'error' })
  if (
    !(newProjectForm.startDate instanceof Date) ||
    Number.isNaN(newProjectForm.startDate.getTime())
  ) {
    return toast.show({ message: 'Start date is required.', variant: 'error' })
  }
  if (!(newProjectForm.endDate instanceof Date) || Number.isNaN(newProjectForm.endDate.getTime())) {
    return toast.show({ message: 'End date is required.', variant: 'error' })
  }
  if (newProjectForm.endDate.getTime() < newProjectForm.startDate.getTime()) {
    return toast.show({ message: 'End date cannot be before start date.', variant: 'error' })
  }
  if (!String(newProjectForm.customerId || '').trim()) {
    return toast.show({ message: 'Customer is required.', variant: 'error' })
  }
  if (!String(newProjectForm.projectManagerId || '').trim()) {
    return toast.show({ message: 'Project manager is required.', variant: 'error' })
  }

  showNewProjectModal.value = false
  isCreatingProject.value = true
  try {
    const startDate = `${newProjectForm.startDate.getFullYear()}-${String(newProjectForm.startDate.getMonth() + 1).padStart(2, '0')}-${String(newProjectForm.startDate.getDate()).padStart(2, '0')}`
    const endDate = `${newProjectForm.endDate.getFullYear()}-${String(newProjectForm.endDate.getMonth() + 1).padStart(2, '0')}-${String(newProjectForm.endDate.getDate()).padStart(2, '0')}`

    const res = await projectsStore.upsertProject({
      project: {
        name,
        description: String(newProjectForm.description || ''),
        startDate,
        endDate,
        customer: newProjectForm.customerId || null,
        projectManager: newProjectForm.projectManagerId || null,
        department: newProjectForm.departmentId || null,
        poRef: String(newProjectForm.poRef || ''),
      },
    })

    const newProjectId = res?.projectId

    // Upload staged documents one by one (non-blocking on project creation)
    const filesToUpload = [...newProjectStagedFiles.value]
    if (newProjectId && filesToUpload.length) {
      if (filesToUpload.length > MAX_PROJECT_DOCUMENTS) {
        toast.show({
          message: `Maximum of ${MAX_PROJECT_DOCUMENTS} documents allowed per project.`,
          variant: 'warning',
        })
      } else {
        const uploadResult = await projectsStore.uploadProjectDocuments({
          projectId: newProjectId,
          files: filesToUpload,
          existingCount: 0,
          uploadingIndexRef: newProjectUploadingIndex,
        })
        const uploadFailed = Number(uploadResult?.failed || 0)
        if (uploadFailed > 0) {
          toast.show({
            message: `Project created, but ${uploadFailed} document${uploadFailed > 1 ? 's' : ''} failed to upload. You can retry from the project page.`,
            variant: 'warning',
            durationMs: 8000,
          })
        } else {
          toast.show({ message: 'Project created successfully.', variant: 'success' })
        }
      }
    } else {
      toast.show({ message: 'Project created successfully.', variant: 'success' })
    }

    if (newProjectId) {
      router.push({ name: 'project-detail', params: { projectId: newProjectId } })
    }
  } catch (e) {
    showNewProjectModal.value = true
    toast.show({ message: e?.message || String(e), variant: 'error', durationMs: 6000 })
  } finally {
    isCreatingProject.value = false
  }
}

function updateTopbar() {
  const actions = []
  if (can('phase.upsert')) {
    actions.push({
      key: 'bulk-upload-phases',
      label: 'Bulk Create Phases',
      icon: markRaw(UploadIcon),
      variant: 'secondary',
      loading: pageLoading.value,
      onClick: () => router.push({ name: 'bulk-phase-upload' }),
    })
  }
  if (can('project.create')) {
    actions.push({
      key: 'new-project',
      label: 'New Project',
      icon: markRaw(CreateIcon),
      variant: 'primary',
      loading: pageLoading.value,
      onClick: openNewProjectModal,
    })
  }
  topbar.setTopbar({
    title: 'Projects',
    subtitle: 'Browse and manage your active projects.',
    actions,
  })
}

onMounted(() => {
  if (String(route.query?.unauthorized || '') === '1') {
    toast.show({
      message: 'You do not have permission to access that page.',
      variant: 'warning',
    })
    router.replace({ name: 'projects' })
  }
  if (String(route.query?.authLoadError || '') === '1') {
    toast.show({
      message: 'Could not load permissions. Please refresh and try again.',
      variant: 'error',
    })
    router.replace({ name: 'projects' })
  }
  updateTopbar()
  Promise.all([
    projectsStore.fetchInitData().catch(() => {}),
    usePaginatedProjects
      ? fetchProjectsPaginated(projectsTableQuery.value).catch(() => {})
      : projectsStore.fetchProjects().catch(() => {}),
  ])
})

watch(pageLoading, () => updateTopbar())

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
    key: 'client',
    label: 'CUSTOMER',
    sortable: true,
    thClass: 'pt-th--customer',
    tdClass: 'pt-td--customer',
  },
  { key: 'pm', label: 'PM', sortable: false, thClass: 'pt-th--pm' },
  { key: 'status', label: 'STATUS', sortable: true, thClass: 'pt-th--status' },
  { key: 'estimation', label: 'CONTRACT VALUE', sortable: false, thClass: 'pt-th--estimation' },
  { key: 'timeline', label: 'PROJECT TIMELINE', sortable: false, thClass: 'pt-th--timeline' },
  { key: 'lastUpdate', label: 'LAST UPDATE', sortable: true, thClass: 'pt-th--update' },
  {
    key: 'phases',
    label: 'Phases',
    sortable: false,
    thClass: 'pt-th--phases',
    tdClass: 'pt-td--phases',
  },
]

const projects = computed(() =>
  projectsStore.projects.map((project) => {
    const resolvedStatus = project?.status?.label || 'Unknown'
    const rawStatusKey =
      project?.status?.key != null && String(project.status.key).trim()
        ? String(project.status.key)
        : 'unknown'

    return {
      ...project,
      status: resolvedStatus,
      statusKey: rawStatusKey,
      statusTabKey: rawStatusKey,
    }
  }),
)

const statusTabs = computed(() => {
  if (usePaginatedProjects) {
    const counters =
      projectsStore.projectsStatusCounters &&
      typeof projectsStore.projectsStatusCounters === 'object'
        ? projectsStore.projectsStatusCounters
        : { all: 0 }
    const initStatuses = Array.isArray(projectsStore.initData?.statuses?.projects)
      ? projectsStore.initData.statuses.projects
      : []
    const fixed = [{ key: 'all', label: 'All', count: Number(counters.all || 0) }]
    const seenKeys = new Set(['all'])
    initStatuses.forEach((status) => {
      const key = toStatusKey(status)
      if (!key || seenKeys.has(key)) return
      seenKeys.add(key)
      fixed.push({
        key,
        label: `Project: ${String(status?.label || status?.key || key)}`,
        count: Number(counters[String(key).toLowerCase()] || 0),
      })
    })
    if (!seenKeys.has('closed')) {
      fixed.push({
        key: 'closed',
        label: 'Project: Closed',
        count: Number(counters.closed || 0),
      })
    }
    return fixed
  }

  const tabs = [{ key: 'all', label: 'All' }]
  const seen = new Set()

  projects.value.forEach((project) => {
    const key = String(project?.statusTabKey || '')
    if (!key || seen.has(key)) return
    seen.add(key)
    tabs.push({ key, label: project?.status || key })
  })

  if (!seen.has('closed')) {
    tabs.push({ key: 'closed', label: 'Project: Closed' })
  }

  return tabs
})

function handleRowClick(row) {
  router.push({ name: 'project-detail', params: { projectId: row.id } })
}

const projectsTableQuery = ref({
  page: 1,
  pageSize: 25,
  search: '',
  statusTabKey: 'all',
  sortBy: '',
  sortDir: 'asc',
})

function toStatusKey(status) {
  const raw =
    status?.key != null
      ? String(status.key)
      : status?.valueKey != null
        ? String(status.valueKey)
        : ''
  return raw.trim().toLowerCase()
}

function mapSortByToBackend(value) {
  const map = {
    name: 'name',
    client: 'customerName',
    status: 'status',
    lastUpdate: 'lastModified',
  }
  return map[String(value || '').trim()] || 'name'
}

function mapStatusKeyToStatusKeys(statusKey) {
  const key = String(statusKey || '').trim().toLowerCase()
  if (!key || key === 'all') return []
  return [key]
}

async function fetchProjectsPaginated(query) {
  const q = query && typeof query === 'object' ? query : projectsTableQuery.value
  const payload = {
    page: Number(q.page || 1),
    pageSize: Number(q.pageSize || 25),
    search: String(q.search || '').trim(),
    statusKeys: mapStatusKeyToStatusKeys(q.statusTabKey),
    sortBy: mapSortByToBackend(q.sortBy),
    sortDir: String(q.sortDir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc',
  }
  await projectsStore.fetchProjectsPaginated(payload)
}

function handleProjectsQueryChange(nextQuery) {
  if (!usePaginatedProjects) return
  projectsTableQuery.value = {
    ...projectsTableQuery.value,
    ...(nextQuery || {}),
  }
  fetchProjectsPaginated(projectsTableQuery.value).catch((e) => {
    toast.show({
      message: e?.message || 'Failed to fetch paginated projects',
      variant: 'error',
    })
  })
}
</script>

<template>
  <section class="page">
    <BlockingOverlay
      v-if="isCreatingProject"
      title="Creating project…"
      subtitle="Please wait while we create the project."
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
    <DatatableCust
      v-else
      :rows="projects"
      :loading="tableLoading"
      row-key="id"
      :columns="columns"
      :tabs="statusTabs"
      tab-key-field="statusTabKey"
      :server-mode="usePaginatedProjects"
      :pagination="projectsStore.projectsPagination"
      :query="projectsTableQuery"
      :show-row-number="false"
      row-click-emit
      @query-change="handleProjectsQueryChange"
      @row-click="handleRowClick"
    />

    <AppModal
      v-model="showNewProjectModal"
      title="New project"
      subtitle="Create a new project."
      width="min(720px, 92vw)"
      :actions="[
        {
          label: 'Cancel',
          variant: 'ghost',
          disabled: isCreatingProject,
          onClick: closeNewProjectModal,
        },
        {
          label: 'Create',
          variant: 'primary',
          disabled: isCreatingProject,
          onClick: handleCreateProjectClick,
        },
      ]"
    >
      <div class="project-edit-form">
        <label class="project-edit-field">
          <span class="project-edit-label"
            >Name <span class="project-edit-required" aria-hidden="true">*</span></span
          >
          <InputText
            v-model="newProjectForm.name"
            :class="[
              'form-ctrl',
              { 'form-ctrl--invalid': newProjectSubmitAttempted && newProjectNameMissing },
            ]"
          />
        </label>

        <label class="project-edit-field">
          <span class="project-edit-label">Description</span>
          <textarea v-model="newProjectForm.description" class="project-edit-textarea" rows="3" />
        </label>

        <div class="project-edit-row">
          <label class="project-edit-field">
            <span class="project-edit-label"
              >Start date <span class="project-edit-required" aria-hidden="true">*</span></span
            >
            <DatePicker
              v-model="newProjectForm.startDate"
              :class="[
                'form-ctrl',
                {
                  'form-ctrl--invalid':
                    newProjectDateRangeInvalid ||
                    (newProjectSubmitAttempted && newProjectStartDateMissing),
                },
              ]"
              date-format="yy-mm-dd"
              show-icon
              :show-clear="false"
              :max-date="newProjectForm.endDate || undefined"
            />
          </label>
          <label class="project-edit-field">
            <span class="project-edit-label"
              >End date <span class="project-edit-required" aria-hidden="true">*</span></span
            >
            <DatePicker
              v-model="newProjectForm.endDate"
              :class="[
                'form-ctrl',
                {
                  'form-ctrl--invalid':
                    newProjectDateRangeInvalid ||
                    (newProjectSubmitAttempted && newProjectEndDateMissing),
                },
              ]"
              date-format="yy-mm-dd"
              show-icon
              :show-clear="false"
              :min-date="newProjectForm.startDate || undefined"
            />
          </label>
        </div>

        <p v-if="newProjectDateRangeInvalid" class="project-edit-error">
          End date cannot be before start date.
        </p>

        <div class="project-edit-row">
          <label class="project-edit-field">
            <span class="project-edit-label"
              >Customer <span class="project-edit-required" aria-hidden="true">*</span></span
            >
            <Select
              v-model="newProjectForm.customerId"
              :options="customerOptions"
              option-label="label"
              option-value="value"
              placeholder="Select a customer"
              filter
              :class="[
                'form-ctrl',
                {
                  'form-ctrl--invalid': newProjectSubmitAttempted && newProjectCustomerMissing,
                },
              ]"
            />
          </label>

          <label class="project-edit-field">
            <span class="project-edit-label"
              >Project manager <span class="project-edit-required" aria-hidden="true">*</span></span
            >
            <Select
              v-model="newProjectForm.projectManagerId"
              :options="projectManagerOptions"
              option-label="label"
              option-value="value"
              placeholder="Select a project manager"
              filter
              :class="[
                'form-ctrl',
                { 'form-ctrl--invalid': newProjectSubmitAttempted && newProjectPmMissing },
              ]"
            />
          </label>
        </div>
        <div class="project-edit-row">
          <label class="project-edit-field">
            <span class="project-edit-label">Department</span>
            <Select
              v-model="newProjectForm.departmentId"
              :options="departmentOptions"
              option-label="label"
              option-value="value"
              placeholder="Select a department"
              filter
              class="form-ctrl"
            />
          </label>
          <label class="project-edit-field">
            <span class="project-edit-label">PO ref</span>
            <InputText v-model="newProjectForm.poRef" class="form-ctrl" />
          </label>
        </div>

        <div class="project-edit-docs">
          <span class="project-edit-label project-edit-docs-label"
            >Documents <span class="project-edit-hint">(optional)</span></span
          >
          <DocumentsUploader
            v-model:staged-files="newProjectStagedFiles"
            :documents="[]"
            :can-manage="true"
            :is-uploading-index="newProjectUploadingIndex"
          />
        </div>

        <p class="project-edit-help">
          <span class="project-edit-required" aria-hidden="true">*</span> Required fields.
        </p>
        <p
          v-if="newProjectSubmitAttempted && newProjectMissingRequiredFields"
          class="project-edit-error"
        >
          Please fill in all required fields marked with *.
        </p>
      </div>
    </AppModal>
  </section>
</template>

<style scoped>
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

/* Reuse the same modal form styles as Edit Project */
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

.project-edit-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.project-edit-required {
  color: var(--accent, #00a56a);
  font-weight: 800;
}

.project-edit-textarea {
  width: 100%;
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

.project-edit-docs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 1rem;
  border-top: 1px solid var(--border-strong, #e5e7eb);
}

.project-edit-docs-label {
  display: block;
  font-size: 12px;
}

.project-edit-hint {
  font-size: 11px;
  color: var(--text, #9ca3af);
  font-weight: 400;
}

.project-edit-help {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text, rgba(15, 23, 42, 0.65));
}

.project-edit-error {
  margin: 0;
  font-size: 12px;
  color: var(--red, #ef4444);
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
</style>
