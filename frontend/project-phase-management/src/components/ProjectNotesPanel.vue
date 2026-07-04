<template>
  <button
    v-if="showHandle && !modelValue"
    type="button"
    class="project-notes-handle"
    aria-label="Open project notes"
    @click="openPanel"
  >
    <NoteIcon class="project-notes-handle-icon" aria-hidden="true" />
    <span class="project-notes-handle-label">{{ handleLabel }}</span>
  </button>

  <Teleport to="body">
    <Transition name="project-notes-fade">
      <div v-if="modelValue" class="project-notes-backdrop" @click="closePanel"></div>
    </Transition>

    <Transition name="project-notes-slide">
      <aside v-if="modelValue" class="project-notes-panel" role="dialog" aria-label="Project Notes">
        <header class="project-notes-panel-head">
          <h3 class="project-notes-panel-title">
            <NoteIcon class="project-notes-panel-title-icon" aria-hidden="true" />
            <span>Project Notes</span>
          </h3>
          <div class="project-notes-panel-actions">
            <button
              type="button"
              class="phase-action-btn phase-action-btn--primary project-notes-panel-add"
              @click="showAddProjectNoteModal = true"
            >
              Add Note
            </button>
            <button
              type="button"
              class="project-notes-panel-close"
              aria-label="Close notes panel"
              @click="closePanel"
            >
              <i class="mdi mdi-close"></i>
            </button>
          </div>
        </header>

        <div class="project-notes-panel-body">
          <div class="project-notes-timeline-wrap">
            <div v-if="loading" class="project-notes-state">Loading notes…</div>
            <div v-else-if="error" class="project-notes-state project-notes-state--error">
              {{ error }}
              <button type="button" class="project-notes-retry" @click="loadProjectNotes(true)">
                Retry
              </button>
            </div>
            <div v-else-if="!sortedProjectNotes.length" class="project-notes-state">
              No notes yet.
            </div>
            <ol v-else class="project-notes-timeline">
              <li
                v-for="note in sortedProjectNotes"
                :key="note.id || `${note.createdAt}-${note.title}`"
                class="project-note-item"
              >
                <span class="project-note-dot" aria-hidden="true"></span>
                <article class="project-note-card">
                  <h4 class="project-note-title">{{ note.title || 'Untitled note' }}</h4>
                  <p class="project-note-meta">
                    {{ note.authorName || 'Unknown user' }} • {{ formatNoteDate(note.createdAt) }}
                  </p>
                  <p class="project-note-content">{{ note.content || '—' }}</p>
                </article>
              </li>
            </ol>
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>

  <ProjectAddNoteModal
    v-model="showAddProjectNoteModal"
    v-model:title="projectNoteForm.title"
    v-model:content="projectNoteForm.content"
    :creating="creatingProjectNote"
    @cancel="closeAddProjectNoteModal"
    @save="createProjectNote"
  />
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import NoteIcon from '@/components/icons/NoteIcon.vue'
import ProjectAddNoteModal from '@/components/ProjectAddNoteModal.vue'
import { useProjectsStore } from '@/stores/projects'
import { useToastStore } from '@/stores/toast'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  projectId: { type: [String, Number], default: null },
  showHandle: { type: Boolean, default: true },
  handleLabel: { type: String, default: 'Notes' },
})

const emit = defineEmits(['update:modelValue'])
const route = useRoute()
const projectsStore = useProjectsStore()
const toast = useToastStore()
const loading = ref(false)
const error = ref('')
const showAddProjectNoteModal = ref(false)
const creatingProjectNote = ref(false)
const projectNotes = ref([])
const projectNoteForm = ref({
  title: '',
  content: '',
})

const resolvedProjectId = computed(() => {
  const fromProp = String(props.projectId ?? '').trim()
  if (fromProp) return fromProp
  return String(route.params.projectId ?? '').trim()
})

const sortedProjectNotes = computed(() => {
  const rows = Array.isArray(projectNotes.value) ? [...projectNotes.value] : []
  rows.sort((a, b) => {
    const aMs = projectsStore._parseDateAny(a?.createdAt)?.getTime() || 0
    const bMs = projectsStore._parseDateAny(b?.createdAt)?.getTime() || 0
    return bMs - aMs
  })
  return rows
})

function closePanel() {
  emit('update:modelValue', false)
}

async function loadProjectNotes(force = false) {
  const pid = resolvedProjectId.value
  if (!pid) return
  loading.value = true
  error.value = ''
  try {
    const result = await projectsStore.fetchProjectNotes({ projectId: pid, force })
    projectNotes.value = Array.isArray(result?.notes) ? result.notes : []
  } catch (e) {
    error.value = e?.message || 'Failed to load notes.'
  } finally {
    loading.value = false
  }
}

function resetAddProjectNoteForm() {
  projectNoteForm.value = { title: '', content: '' }
}

function closeAddProjectNoteModal() {
  showAddProjectNoteModal.value = false
  resetAddProjectNoteForm()
}

async function createProjectNote() {
  const pid = resolvedProjectId.value
  const title = String(projectNoteForm.value.title || '').trim()
  const content = String(projectNoteForm.value.content || '').trim()
  if (!pid) return
  if (!title) {
    toast.show({ message: 'Please enter a note title.', variant: 'warning' })
    return
  }
  if (!content) {
    toast.show({ message: 'Please enter note content.', variant: 'warning' })
    return
  }

  creatingProjectNote.value = true
  try {
    await projectsStore.createProjectNote({ projectId: pid, title, content })
    closeAddProjectNoteModal()
    await loadProjectNotes(true)
    toast.show({ message: 'Note added.', variant: 'success' })
  } catch (e) {
    toast.show({ message: e?.message || 'Failed to create note.', variant: 'error' })
  } finally {
    creatingProjectNote.value = false
  }
}

async function openPanel() {
  if (!props.modelValue) emit('update:modelValue', true)
  await loadProjectNotes(false)
}

function formatNoteDate(value) {
  if (typeof projectsStore._formatDisplayDateTime === 'function') {
    return projectsStore._formatDisplayDateTime(value) || '—'
  }
  return String(value || '—')
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) loadProjectNotes(false)
  },
  { immediate: true },
)
</script>

<style scoped>
.project-notes-handle {
  position: fixed;
  top: 25%;
  right: 0;
  transform: translateY(-50%);
  z-index: 1870;
  width: 30px;
  min-height: 80px;
  padding: 10px 8px;
  border: 1px solid #e6c56c;
  border-right: none;
  border-radius: 8px 0 0 8px;
  background: #fff1bd;
  color: #805d05;
  box-shadow: -8px 0 18px rgba(15, 23, 42, 0.12);
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
}
.project-notes-handle-icon {
  width: 16px;
  height: 16px;
  transform: rotate(-90deg);
}
.project-notes-handle-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  line-height: 1;
}
.project-notes-handle:hover {
  background: #ffe59a;
  border-color: #d9b24d;
  color: #644700;
}
:root[data-theme='dark'] .project-notes-handle,
html[data-theme='dark'] .project-notes-handle,
body.dark .project-notes-handle,
.v-theme--dark .project-notes-handle {
  border-color: #e0ba4a;
  background: #2d3029;
  color: #e7c15a;
}
:root[data-theme='dark'] .project-notes-handle:hover,
html[data-theme='dark'] .project-notes-handle:hover,
body.dark .project-notes-handle:hover,
.v-theme--dark .project-notes-handle:hover {
  background: #343830;
  border-color: #ebc95f;
  color: #f1d376;
}

.project-notes-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1860;
}
:root[data-theme='dark'] .project-notes-backdrop {
  background: rgba(0, 0, 0, 0.75);
}

.project-notes-panel {
  background: var(--surface-1, #fff);
  border-left: 1px solid var(--border-strong, #e1e6dc);
  z-index: 1890;
  flex-direction: column;
  width: min(420px, 98vw);
  height: 100vh;
  display: flex;
  position: fixed;
  top: 0;
  right: 0;
  box-shadow: -12px 0 28px #0f172a33;
}
.project-notes-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-strong, #e1e6dc);
}
.project-notes-panel-title {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  color: #0f1018;
}
.project-notes-panel-title-icon {
  width: 20px;
  height: 20px;
}
:deep(.project-notes-panel-title-icon path) {
  stroke: currentColor;
  stroke-width: 2.5px;
}
.project-notes-panel-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.project-notes-panel-add {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #efc544 !important;
  border-radius: 5px !important;
  background: #efc544 !important;
  color: #ffffff !important;
  font-size: 12px;
}
.project-notes-panel-add:hover:not(:disabled) {
  border-color: #f3cf64 !important;
  background: #e2b62e !important;
  color: #ffffff !important;
}
.project-notes-panel-close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border-strong, #e1e6dc);
  background: 0 0;
  color: var(--text, #6b7280);
  cursor: pointer;
}

.project-notes-panel-body {
  overflow: auto;
  padding: 12px 14px 16px;
  display: grid;
  gap: 12px;
}
.project-notes-timeline-wrap {
  border-radius: 12px;
  background: transparent;
  max-height: calc(100vh - 4.8rem);
  overflow: auto;
  padding: 12px 12px 12px 0;
}
.project-notes-state {
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  color: var(--text, #6b7280);
  font-size: 13px;
}
.project-notes-state--error {
  color: #f87171;
}
.project-notes-retry {
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 8px;
  background: var(--surface-1, #fff);
  color: var(--text-h, #243224);
  font-size: 12px;
  padding: 6px 10px;
  cursor: pointer;
}
.project-notes-timeline {
  margin: 0;
  padding: 0 0 0 2px;
  list-style: none;
  display: grid;
  gap: 12px;
}
.project-note-item {
  position: relative;
  padding-left: 20px;
}
.project-note-item::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 8px;
  bottom: -16px;
  width: 2px;
  background: #cfd3db;
}
.project-note-item:last-child::before {
  display: none;
}
.project-note-dot {
  position: absolute;
  left: 0;
  top: 8px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #f2f2f4;
  background: #e2a10a;
  box-shadow: 0 0 0 1px rgba(226, 161, 10, 0.45);
}
.project-note-card {
  position: relative;
  border: 1px solid #e7cf75;
  border-radius: 10px;
  background: #fff9dd;
  padding: 12px;
  box-shadow: 0 6px 16px #9276181a;
  margin-left: 5px;
}
.project-note-title {
  margin: 0;
  color: #2b220d;
  font-size: 14px;
  line-height: 1.3;
  font-weight: 700;
}
.project-note-meta {
  margin: 4px 0 0;
  color: #6a5730;
  font-size: 12px;
}
.project-note-content {
  margin: 8px 0 0;
  color: #433515;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.project-notes-fade-enter-active,
.project-notes-fade-leave-active {
  transition: opacity 0.18s ease;
}
.project-notes-fade-enter-from,
.project-notes-fade-leave-to {
  opacity: 0;
}
.project-notes-slide-enter-active,
.project-notes-slide-leave-active {
  transition: transform 0.22s ease;
}
.project-notes-slide-enter-from,
.project-notes-slide-leave-to {
  transform: translateX(100%);
}

@media (max-width: 720px) {
  .project-notes-handle {
    min-height: 96px;
    width: 36px;
    padding: 8px 6px;
  }
}

:root[data-theme='dark'] .project-notes-panel-head,
html[data-theme='dark'] .project-notes-panel-head,
body.dark .project-notes-panel-head,
.v-theme--dark .project-notes-panel-head {
  border-bottom-color: rgba(224, 186, 74, 0.2);
}

:root[data-theme='dark'] .project-notes-panel-title,
html[data-theme='dark'] .project-notes-panel-title,
body.dark .project-notes-panel-title,
.v-theme--dark .project-notes-panel-title {
  color: #f4f7f5 !important;
}

:root[data-theme='dark'] .project-notes-panel-title-icon,
html[data-theme='dark'] .project-notes-panel-title-icon,
body.dark .project-notes-panel-title-icon,
.v-theme--dark .project-notes-panel-title-icon {
  color: #f4f7f5 !important;
}

:root[data-theme='dark'] .project-notes-panel-title-icon :deep(path),
html[data-theme='dark'] .project-notes-panel-title-icon :deep(path),
body.dark .project-notes-panel-title-icon :deep(path),
.v-theme--dark .project-notes-panel-title-icon :deep(path) {
  stroke: currentColor !important;
}

:root[data-theme='dark'] .project-notes-panel-add,
html[data-theme='dark'] .project-notes-panel-add,
body.dark .project-notes-panel-add,
.v-theme--dark .project-notes-panel-add {
  background: rgba(66, 61, 48, 0.85) !important;
  color: #efc544 !important;
}

:root[data-theme='dark'] .project-notes-panel-add:hover:not(:disabled),
html[data-theme='dark'] .project-notes-panel-add:hover:not(:disabled),
body.dark .project-notes-panel-add:hover:not(:disabled),
.v-theme--dark .project-notes-panel-add:hover:not(:disabled) {
  background: rgba(83, 76, 60, 0.95) !important;
  color: #f6d978 !important;
}

:root[data-theme='dark'] .project-note-item::before,
html[data-theme='dark'] .project-note-item::before,
body.dark .project-note-item::before,
.v-theme--dark .project-note-item::before {
  background: #66706a;
}

:root[data-theme='dark'] .project-note-dot,
html[data-theme='dark'] .project-note-dot,
body.dark .project-note-dot,
.v-theme--dark .project-note-dot {
  border-color: #051710;
  background: #d99f12;
  box-shadow: 0 0 0 1px rgba(233, 191, 74, 0.62);
}

:root[data-theme='dark'] .project-note-card,
html[data-theme='dark'] .project-note-card,
body.dark .project-note-card,
.v-theme--dark .project-note-card {
  background: #454338;
  border-color: #e0ba4a;
  box-shadow: 0 8px 18px #00000038;
}

:root[data-theme='dark'] .project-note-title,
html[data-theme='dark'] .project-note-title,
body.dark .project-note-title,
.v-theme--dark .project-note-title {
  color: #efc54e !important;
}

:root[data-theme='dark'] .project-note-meta,
html[data-theme='dark'] .project-note-meta,
body.dark .project-note-meta,
.v-theme--dark .project-note-meta {
  color: #e0b546 !important;
}

:root[data-theme='dark'] .project-note-content,
html[data-theme='dark'] .project-note-content,
body.dark .project-note-content,
.v-theme--dark .project-note-content {
  color: #f1ede2 !important;
}
</style>
