<script setup>
import { computed, reactive, ref, watch } from 'vue'
import DocumentsUploader from '@/components/DocumentsUploader.vue'
import AppModal from '@/components/AppModal.vue'
import { useProjectsStore } from '@/stores/projects'
import { useToastStore } from '@/stores/toast'
import { useAuthz } from '@/composables/useAuthz'

const MAX_PROJECT_DOCUMENTS = 3

const props = defineProps({
  projectId: { type: [String, Number], default: '' },
  hidden: { type: Boolean, default: false },
  skeleton: { type: Boolean, default: false },
})

const emit = defineEmits(['update:has-unsaved-staged-documents'])

const projectsStore = useProjectsStore()
const toast = useToastStore()
const { can } = useAuthz({ projectId: computed(() => String(props.projectId || '')) })

const projectDocs = ref([])
const docsLoading = ref(false)
const docsLoadError = ref(false)
const deletingDocId = ref('')
const docsUploading = ref(false)
const showDeleteDocConfirmModal = ref(false)
const pendingDeleteDocId = ref('')
const pendingDeleteDocName = ref('')
const showDocPreviewModal = ref(false)
const docPreview = reactive({
  name: '',
  url: '',
  mimeType: '',
})
const detailStagedFiles = ref([])
const detailUploadingIndex = ref(-1)

const canManageDocuments = computed(() => can('documents.manage'))
const hasUnsavedStagedDocuments = computed(() => detailStagedFiles.value.length > 0)

watch(
  hasUnsavedStagedDocuments,
  (value) => {
    emit('update:has-unsaved-staged-documents', Boolean(value))
  },
  { immediate: true },
)

function isLikelyAbsoluteUrl(value) {
  const text = String(value || '').trim()
  if (!text) return false
  return /^(https?:)?\/\//i.test(text)
}

function toDownloadUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (isLikelyAbsoluteUrl(text)) return text
  return text.startsWith('/') ? text : `/${text}`
}

async function loadProjectDocuments({ force = false } = {}) {
  const pid = String(props.projectId || '')
  if (!pid) return
  docsLoading.value = true
  docsLoadError.value = false
  try {
    const result = await projectsStore.fetchProjectDocuments({ projectId: pid, force })
    projectDocs.value = result?.docs || []
  } catch {
    docsLoadError.value = true
  } finally {
    docsLoading.value = false
  }
}

function handleDocDeleteRequest({ id: fileId, name: fileName } = {}) {
  if (!fileId || deletingDocId.value) return
  pendingDeleteDocId.value = String(fileId)
  pendingDeleteDocName.value = String(fileName || '')
  showDeleteDocConfirmModal.value = true
}

function closeDeleteDocConfirmModal() {
  if (deletingDocId.value) return
  showDeleteDocConfirmModal.value = false
  pendingDeleteDocId.value = ''
  pendingDeleteDocName.value = ''
}

async function confirmDocDelete() {
  const pid = String(props.projectId || '')
  const fileId = String(pendingDeleteDocId.value || '')
  if (!pid || !fileId || deletingDocId.value) return

  showDeleteDocConfirmModal.value = false
  deletingDocId.value = fileId
  try {
    await projectsStore.deleteProjectDocument({ projectId: pid, fileId })
    projectDocs.value = projectDocs.value.filter((d) => String(d.id) !== String(fileId))
    toast.show({ message: 'Document removed.', variant: 'success' })
  } catch (e) {
    showDeleteDocConfirmModal.value = true
    toast.show({
      message: e?.message || 'Failed to remove document.',
      variant: 'error',
      durationMs: 9000,
    })
  } finally {
    deletingDocId.value = ''
    if (!showDeleteDocConfirmModal.value) {
      pendingDeleteDocId.value = ''
      pendingDeleteDocName.value = ''
    }
  }
}

function closeDocPreviewModal() {
  showDocPreviewModal.value = false
  docPreview.name = ''
  docPreview.url = ''
  docPreview.mimeType = ''
}

function handleDocView({ url, name, mimeType } = {}) {
  const raw = String(url || '').trim()
  if (!raw) {
    toast.show({ message: 'Document preview is unavailable.', variant: 'error' })
    return
  }

  const safeUrl = isLikelyAbsoluteUrl(raw) ? raw : raw.startsWith('/') ? raw : `/${raw}`
  docPreview.name = String(name || '')
  docPreview.url = safeUrl
  docPreview.mimeType = String(mimeType || '').toLowerCase()
  showDocPreviewModal.value = true
}

const isDocPreviewImage = computed(() => {
  const mime = String(docPreview.mimeType || '').toLowerCase()
  return mime.startsWith('image/')
})

const canInlinePreviewDoc = computed(() => {
  const mime = String(docPreview.mimeType || '')
    .trim()
    .toLowerCase()
  return mime === 'application/pdf' || mime.startsWith('image/')
})

async function handleDetailUpload() {
  const pid = String(props.projectId || '')
  if (!pid || !detailStagedFiles.value.length) return
  const currentCount = Array.isArray(projectDocs.value) ? projectDocs.value.length : 0
  const stagedCount = detailStagedFiles.value.length
  if (currentCount + stagedCount > MAX_PROJECT_DOCUMENTS) {
    toast.show({
      message: `Maximum of ${MAX_PROJECT_DOCUMENTS} documents allowed per project.`,
      variant: 'error',
      durationMs: 8000,
    })
    return
  }

  docsUploading.value = true
  try {
    const files = [...detailStagedFiles.value]
    detailStagedFiles.value = []
    const result = await projectsStore.uploadProjectDocuments({
      projectId: pid,
      files,
      maxDocuments: MAX_PROJECT_DOCUMENTS,
    })

    await loadProjectDocuments({ force: true })

    if (Array.isArray(result?.warnings) && result.warnings.length) {
      result.warnings.forEach((warning) =>
        toast.show({ message: warning, variant: 'warning', durationMs: 9000 }),
      )
    }

    if (Array.isArray(result?.uploaded) && result.uploaded.length) {
      toast.show({
        message: `${files.length} document${files.length > 1 ? 's' : ''} uploaded.`,
        variant: 'success',
      })
    }
  } catch (e) {
    toast.show({
      message: e?.message || 'Failed to upload documents.',
      variant: 'error',
      durationMs: 9000,
    })
  } finally {
    docsUploading.value = false
    detailUploadingIndex.value = -1
  }
}

watch(
  () => String(props.projectId || ''),
  () => {
    detailStagedFiles.value = []
    showDeleteDocConfirmModal.value = false
    showDocPreviewModal.value = false
    pendingDeleteDocId.value = ''
    pendingDeleteDocName.value = ''
    closeDocPreviewModal()
    loadProjectDocuments().catch(() => {})
  },
  { immediate: true },
)

function clearStagedFiles() {
  detailStagedFiles.value = []
}

defineExpose({ clearStagedFiles })
</script>

<template>
  <div v-if="skeleton" class="docs-card sk-frame" aria-hidden="true">
    <div class="flex-between">
      <div class="sk sk-doc-title"></div>
      <div class="sk sk-doc-btn"></div>
    </div>
    <div class="sk sk-doc-row"></div>
  </div>

  <div v-else-if="!hidden" class="docs-card">
    <div class="docs-card-header">
      <div>
        <div class="docs-card-title">Documents</div>
        <p class="docs-card-subtitle">Files attached to this project.</p>
      </div>
      <button
        v-if="canManageDocuments && detailStagedFiles.length"
        type="button"
        class="docs-action-btn docs-action-btn--primary"
        :disabled="detailUploadingIndex >= 0 || docsUploading"
        @click="handleDetailUpload"
      >
        <i
          class="mdi"
          :class="
            detailUploadingIndex >= 0 || docsUploading
              ? 'mdi-loading mdi-spin'
              : 'mdi-cloud-upload-outline'
          "
        ></i>
        {{
          detailUploadingIndex >= 0 || docsUploading
            ? 'Uploading…'
            : `Upload (${detailStagedFiles.length})`
        }}
      </button>
    </div>
    <div v-if="docsUploading" class="docs-uploading-state">
      <span class="docs-uploading-spinner" aria-hidden="true"></span>
      Uploading document(s)… Please wait.
    </div>
    <DocumentsUploader
      :documents="projectDocs"
      v-model:staged-files="detailStagedFiles"
      :can-manage="canManageDocuments"
      :is-loading="docsLoading"
      :is-deleting-id="deletingDocId"
      :is-uploading-index="detailUploadingIndex"
      @delete="handleDocDeleteRequest"
      @view="handleDocView"
    />
    <p v-if="docsLoadError" class="docs-load-error">
      <i class="mdi mdi-alert-circle-outline"></i> Failed to load documents.
      <button type="button" @click="loadProjectDocuments({ force: true })">Retry</button>
    </p>

    <AppModal
      v-model="showDeleteDocConfirmModal"
      title="Remove document?"
      variant="error"
      icon="mdi-trash-can-outline"
      :close-on-backdrop="!Boolean(deletingDocId)"
      :close-on-esc="!Boolean(deletingDocId)"
      :show-close="!Boolean(deletingDocId)"
      :actions="[
        {
          label: 'Cancel',
          variant: 'ghost',
          disabled: Boolean(deletingDocId),
          onClick: closeDeleteDocConfirmModal,
        },
        {
          label: deletingDocId ? 'Removing…' : 'Remove',
          variant: 'error',
          disabled: Boolean(deletingDocId),
          onClick: confirmDocDelete,
        },
      ]"
    >
      <template #subtitle>
        <span class="doc-delete-confirm-text">
          This will permanently remove
          <strong>{{ pendingDeleteDocName || 'this document' }}</strong
          >.
        </span>
      </template>
    </AppModal>

    <AppModal
      v-model="showDocPreviewModal"
      :title="docPreview.name || 'File preview'"
      subtitle="Preview attached document."
      icon="mdi-file-eye-outline"
      width="min(980px, 96vw)"
      :actions="[
        {
          label: 'Close',
          variant: 'ghost',
          onClick: closeDocPreviewModal,
        },
      ]"
    >
      <div class="doc-preview-body">
        <template v-if="canInlinePreviewDoc">
          <img
            v-if="isDocPreviewImage"
            class="doc-preview-image"
            :src="docPreview.url"
            :alt="docPreview.name || 'Preview image'"
          />
          <iframe
            v-else
            class="doc-preview-frame"
            :src="docPreview.url"
            :title="docPreview.name || 'Document preview'"
          ></iframe>
        </template>
        <div v-else class="doc-preview-fallback">
          <p>Preview is not available for this file type.</p>
          <a
            :href="toDownloadUrl(docPreview.url)"
            :download="docPreview.name || true"
            class="doc-preview-open-link"
          >
            Download file
          </a>
        </div>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.docs-card {
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 5px;
  padding: 18px;
  margin-block: 1rem;
}
.docs-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
}
.docs-card-title {
  font-size: 20px;
  font-weight: 500;
  color: var(--text-h, #1f2b1f);
}
.docs-card-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text, #6b7280);
}
.docs-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  white-space: nowrap;
  border-radius: 5px;
  border: 1px solid var(--border-strong, #e7eee1);
  background: var(--surface-2, #f7fafc);
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text, #6c726c);
  cursor: pointer;
}
.docs-action-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
.docs-action-btn--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #ffffff;
}
.docs-action-btn--primary:hover:not(:disabled) {
  filter: brightness(0.98);
}
.docs-action-btn .mdi {
  font-size: 16px;
}
.docs-load-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--red, #d62828);
  margin-top: 8px;
}
.docs-load-error button {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}
.docs-uploading-state {
  margin: 0 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text, #6b7280);
}
.docs-uploading-spinner {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 2px solid var(--border-strong, #e1e6dc);
  border-top-color: var(--accent, #00a56a);
  animation: docs-spin 0.7s linear infinite;
}
@keyframes docs-spin {
  to {
    transform: rotate(360deg);
  }
}
.doc-delete-confirm-text {
  color: var(--red, #dc2626);
  font-weight: 600;
}
.doc-preview-body {
  min-height: min(70vh, 620px);
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface-1, #ffffff);
}
.doc-preview-frame {
  width: 100%;
  height: min(70vh, 620px);
  border: none;
  display: block;
}
.doc-preview-image {
  display: block;
  width: 100%;
  height: auto;
  max-height: min(70vh, 620px);
  object-fit: contain;
  background: var(--surface-2, #f7fafc);
}
.doc-preview-fallback {
  min-height: min(70vh, 620px);
  padding: 24px;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 10px;
  color: var(--text, #6b7280);
}
.doc-preview-open-link {
  color: var(--accent, #00a56a);
  font-weight: 700;
  text-decoration: none;
}
.doc-preview-open-link:hover {
  text-decoration: underline;
}
.sk-doc-title {
  width: 190px;
  height: 26px;
}
.sk-doc-btn {
  width: 120px;
  height: 26px;
}
.sk-doc-row {
  margin-top: 1rem;
  height: 180px;
  width: 100%;
  border-radius: 12px;
}
@keyframes docs-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}
</style>
