<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  documents: { type: Array, default: () => [] },
  stagedFiles: { type: Array, default: () => [] },
  canManage: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  isDeletingId: { type: String, default: '' },
  isUploadingIndex: { type: Number, default: -1 },
})

const emit = defineEmits(['update:stagedFiles', 'delete', 'view'])

const MAX_FILES = 3
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const ACCEPTED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'text/plain',
]
const ACCEPTED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.txt']

const isDragOver = ref(false)
const fileInputRef = ref(null)

const totalCount = computed(() => props.documents.length + props.stagedFiles.length)
const slotsLeft = computed(() => MAX_FILES - totalCount.value)
const atLimit = computed(() => slotsLeft.value <= 0)

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(name) {
  const ext = String(name || '').toLowerCase().split('.').pop()
  if (ext === 'pdf') return 'mdi-file-pdf-box'
  if (['doc', 'docx'].includes(ext)) return 'mdi-file-word-box'
  if (['xls', 'xlsx'].includes(ext)) return 'mdi-file-excel-box'
  if (['png', 'jpg', 'jpeg'].includes(ext)) return 'mdi-file-image'
  if (ext === 'txt') return 'mdi-file-document-outline'
  return 'mdi-file-outline'
}

function getFileIconColor(name) {
  const ext = String(name || '').toLowerCase().split('.').pop()
  if (ext === 'pdf') return '#d62828'
  if (['doc', 'docx'].includes(ext)) return '#2b579a'
  if (['xls', 'xlsx'].includes(ext)) return '#217346'
  if (['png', 'jpg', 'jpeg'].includes(ext)) return '#7c4dff'
  return '#6b7280'
}

const errorMessages = ref([])

function validateFile(file) {
  if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSIONS.some(e => file.name.toLowerCase().endsWith(e))) {
    return `"${file.name}" is not an accepted file type.`
  }
  if (file.size > MAX_BYTES) {
    return `"${file.name}" exceeds the 2 MB limit (${formatSize(file.size)}).`
  }
  if (props.stagedFiles.some(f => f.name === file.name && f.size === file.size)) {
    return `"${file.name}" is already staged.`
  }
  return null
}

function processFiles(fileList) {
  const files = Array.from(fileList || [])
  const errors = []
  const toAdd = []

  for (const file of files) {
    if (totalCount.value + toAdd.length >= MAX_FILES) {
      errors.push(`Only ${MAX_FILES} documents allowed per project. Some files were skipped.`)
      break
    }
    const err = validateFile(file)
    if (err) {
      errors.push(err)
    } else {
      toAdd.push(file)
    }
  }

  errorMessages.value = errors
  if (toAdd.length) {
    emit('update:stagedFiles', [...props.stagedFiles, ...toAdd])
  }
}

function onDrop(e) {
  isDragOver.value = false
  if (atLimit.value) return
  processFiles(e.dataTransfer?.files)
}

function onDragOver(e) {
  e.preventDefault()
  isDragOver.value = true
}

function onDragLeave() {
  isDragOver.value = false
}

function onFileInputChange(e) {
  processFiles(e.target.files)
  e.target.value = ''
}

function openFilePicker() {
  if (atLimit.value) return
  fileInputRef.value?.click()
}

function removeStagedFile(index) {
  const updated = props.stagedFiles.filter((_, i) => i !== index)
  emit('update:stagedFiles', updated)
}

function requestDelete(fileId, fileName) {
  emit('delete', { fileId, fileName: String(fileName || '') })
}

function requestView(doc) {
  emit('view', {
    fileId: doc?.id != null ? String(doc.id) : '',
    name: String(doc?.name || ''),
    url: String(doc?.url || ''),
    mimeType: String(doc?.mimeType || ''),
  })
}

function toDownloadUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (/([?&])download=/i.test(raw)) return raw
  return raw.includes('?') ? `${raw}&download=T` : `${raw}?download=T`
}
</script>

<template>
  <div class="docs-section">
    <!-- Existing uploaded documents -->
    <div v-if="isLoading" class="docs-loading">
      <div class="docs-spinner" aria-hidden="true"></div>
      <span>Loading documents…</span>
    </div>

    <template v-else>
      <div v-if="documents.length || stagedFiles.length" class="docs-list">
        <!-- Already uploaded -->
        <div
          v-for="doc in documents"
          :key="doc.id"
          class="docs-item"
        >
          <span class="docs-item-icon" :style="{ color: getFileIconColor(doc.name) }" aria-hidden="true">
            <i class="mdi" :class="getFileIcon(doc.name)"></i>
          </span>
          <div class="docs-item-meta">
            <span class="docs-item-name" :title="doc.name">{{ doc.name }}</span>
            <span class="docs-item-sub">{{ doc.uploadedAt }} · {{ formatSize(doc.size) }}<template v-if="doc.uploadedByName"> · {{ doc.uploadedByName }}</template></span>
          </div>
          <div class="docs-item-actions">
            <button
              v-if="doc.url"
              type="button"
              class="docs-btn docs-btn--icon"
              title="View"
              aria-label="View file"
              @click="requestView(doc)"
            >
              <i class="mdi mdi-eye-outline"></i>
            </button>
            <a
              v-if="doc.url"
              :href="toDownloadUrl(doc.url)"
              :download="doc.name || true"
              target="_blank"
              rel="noopener noreferrer"
              class="docs-btn docs-btn--icon"
              title="Download"
              aria-label="Download file"
            >
              <i class="mdi mdi-download"></i>
            </a>
            <button
              v-if="canManage"
              type="button"
              class="docs-btn docs-btn--icon docs-btn--error"
              :disabled="isDeletingId === String(doc.id)"
              title="Remove document"
              aria-label="Remove document"
              @click="requestDelete(doc.id, doc.name)"
            >
              <i v-if="isDeletingId === String(doc.id)" class="mdi mdi-loading mdi-spin"></i>
              <i v-else class="mdi mdi-trash-can-outline"></i>
            </button>
          </div>
        </div>

        <!-- Staged (not yet uploaded) -->
        <div
          v-for="(file, idx) in stagedFiles"
          :key="`staged-${idx}`"
          class="docs-item docs-item--staged"
        >
          <span class="docs-item-icon" :style="{ color: getFileIconColor(file.name) }" aria-hidden="true">
            <i class="mdi" :class="getFileIcon(file.name)"></i>
          </span>
          <div class="docs-item-meta">
            <span class="docs-item-name" :title="file.name">{{ file.name }}</span>
            <span class="docs-item-sub docs-item-pending">
              <template v-if="isUploadingIndex === idx">
                <i class="mdi mdi-loading mdi-spin"></i> Uploading…
              </template>
              <template v-else>
                {{ formatSize(file.size) }} · pending upload
              </template>
            </span>
          </div>
          <div class="docs-item-actions">
            <button
              v-if="isUploadingIndex !== idx"
              type="button"
              class="docs-btn docs-btn--icon docs-btn--error"
              title="Remove staged file"
              aria-label="Remove staged file"
              @click="removeStagedFile(idx)"
            >
              <i class="mdi mdi-close"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Drop zone: shown when under the limit and canManage -->
      <div
        v-if="canManage && !atLimit"
        class="docs-dropzone"
        :class="{ 'docs-dropzone--over': isDragOver }"
        role="button"
        tabindex="0"
        :aria-label="`Drop files here or click to browse. ${slotsLeft} of ${MAX_FILES} slots remaining.`"
        @click="openFilePicker"
        @keydown.enter.space.prevent="openFilePicker"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <i class="mdi mdi-cloud-upload-outline docs-dropzone-icon" aria-hidden="true"></i>
        <div class="docs-dropzone-text">
          Drop files here or <span class="docs-dropzone-link">browse</span>
        </div>
        <div class="docs-dropzone-hint">
          PDF, DOC, DOCX, XLS, XLSX, TXT, PNG, JPG · Max 2 MB · {{ slotsLeft }} of {{ MAX_FILES }} slot{{ slotsLeft === 1 ? '' : 's' }} remaining
        </div>
      </div>

      <!-- Limit reached notice -->
      <div v-else-if="canManage && atLimit" class="docs-limit-notice">
        <i class="mdi mdi-information-outline" aria-hidden="true"></i>
        Maximum of {{ MAX_FILES }} documents reached. Remove a file to upload another.
      </div>

      <!-- Empty state for read-only -->
      <div v-if="!canManage && !documents.length && !stagedFiles.length" class="docs-empty">
        <i class="mdi mdi-folder-open-outline docs-empty-icon" aria-hidden="true"></i>
        <p class="docs-empty-text">No documents attached</p>
      </div>

      <!-- Validation errors -->
      <div v-if="errorMessages.length" class="docs-errors">
        <p v-for="(msg, i) in errorMessages" :key="i" class="docs-error-msg">
          <i class="mdi mdi-alert-circle-outline" aria-hidden="true"></i> {{ msg }}
        </p>
      </div>
    </template>

    <input
      ref="fileInputRef"
      type="file"
      :accept="ACCEPTED_EXTENSIONS.join(',')"
      multiple
      class="docs-file-input"
      aria-hidden="true"
      tabindex="-1"
      @change="onFileInputChange"
    />
  </div>
</template>

<style scoped>
.docs-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.docs-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  font-size: 13px;
  color: var(--text, #6b7280);
}

.docs-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--accent-bg, rgba(0, 165, 106, 0.2));
  border-top-color: var(--accent, #00a56a);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Document list */
.docs-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.docs-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--border-strong, #e5e7eb);
  border-radius: 10px;
  background: var(--surface-2, #f9fafb);
}

.docs-item--staged {
  border-style: dashed;
  border-color: var(--accent-border, rgba(0, 165, 106, 0.45));
  background: var(--accent-bg, rgba(0, 165, 106, 0.04));
}

.docs-item-icon {
  font-size: 22px;
  line-height: 1;
  flex-shrink: 0;
}

.docs-item-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.docs-item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-h, #08060d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.docs-item-sub {
  font-size: 11px;
  color: var(--text, #6b7280);
}

.docs-item-pending {
  color: var(--accent, #00a56a);
}

.docs-item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* Icon buttons */
.docs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--border-strong, #e5e7eb);
  background: var(--surface-1, #fff);
  color: var(--text, #6b7280);
  font-size: 15px;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.docs-btn:hover:not(:disabled) {
  background: var(--surface-3, #f3f4f6);
  border-color: var(--text, #9ca3af);
  color: var(--text-h, #08060d);
}

.docs-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.docs-btn--error:hover:not(:disabled) {
  background: rgba(214, 40, 40, 0.08);
  border-color: rgba(214, 40, 40, 0.45);
  color: var(--red, #d62828);
}

/* Drop zone */
.docs-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 20px 16px;
  border: 1.5px dashed var(--border-strong, #d1d5db);
  border-radius: 12px;
  background: var(--surface-2, #f9fafb);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: center;
  outline: none;
}

.docs-dropzone:hover,
.docs-dropzone:focus-visible {
  border-color: var(--accent, #00a56a);
  background: var(--accent-bg, rgba(0, 165, 106, 0.04));
}

.docs-dropzone--over {
  border-color: var(--accent, #00a56a);
  background: var(--accent-bg, rgba(0, 165, 106, 0.08));
}

.docs-dropzone-icon {
  font-size: 28px;
  color: var(--accent, #00a56a);
  opacity: 0.7;
}

.docs-dropzone-text {
  font-size: 13px;
  color: var(--text-h, #08060d);
  font-weight: 500;
}

.docs-dropzone-link {
  color: var(--accent, #00a56a);
  text-decoration: underline;
}

.docs-dropzone-hint {
  font-size: 11px;
  color: var(--text, #6b7280);
}

/* Limit notice */
.docs-limit-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(249, 115, 22, 0.07);
  border: 1px solid rgba(249, 115, 22, 0.3);
  color: var(--orange, #e9762b);
  font-size: 12px;
}

/* Empty state */
.docs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 16px;
  text-align: center;
}

.docs-empty-icon {
  font-size: 36px;
  color: var(--text, #9ca3af);
  opacity: 0.6;
}

.docs-empty-text {
  margin: 0;
  font-size: 13px;
  color: var(--text, #6b7280);
}

/* Validation errors */
.docs-errors {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.docs-error-msg {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: var(--red, #d62828);
}

/* Hidden file input */
.docs-file-input {
  display: none;
}
</style>
