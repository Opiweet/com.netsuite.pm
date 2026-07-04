<script setup>
import { computed } from 'vue'
import InputText from 'primevue/inputtext'
import AppModal from '@/components/AppModal.vue'
import NoteIcon from '@/components/icons/NoteIcon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  content: { type: String, default: '' },
  creating: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:modelValue',
  'update:title',
  'update:content',
  'cancel',
  'save',
])

const modalOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', Boolean(v)),
})

const noteTitle = computed({
  get: () => props.title,
  set: (v) => emit('update:title', String(v ?? '')),
})

const noteContent = computed({
  get: () => props.content,
  set: (v) => emit('update:content', String(v ?? '')),
})
</script>

<template>
  <AppModal
    v-model="modalOpen"
    title="Add Note"
    subtitle="Create a new project note."
    :icon="NoteIcon"
    width="min(620px, 92vw)"
    :actions="[
      {
        label: 'Cancel',
        variant: 'ghost',
        disabled: creating,
        onClick: () => emit('cancel'),
      },
      {
        label: creating ? 'Saving…' : 'Save Note',
        variant: 'primary',
        disabled: creating,
        onClick: () => emit('save'),
      },
    ]"
  >
    <div class="project-note-form">
      <label class="project-note-form-field">
        <span class="project-note-form-label">Title</span>
        <InputText
          v-model="noteTitle"
          class="form-ctrl"
          placeholder="Short note title"
          :maxlength="300"
        />
      </label>
      <label class="project-note-form-field">
        <span class="project-note-form-label">Content</span>
        <textarea
          v-model="noteContent"
          class="project-note-form-textarea"
          rows="5"
          placeholder="Write your note"
        />
      </label>
    </div>
  </AppModal>
</template>

<style scoped>
.project-note-form {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border-strong, #e1e6dc);
  background: var(--surface-2, #f7fafc);
}

.project-note-form-field {
  display: grid;
  gap: 5px;
}

.project-note-form-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text, #6b7280);
}

.project-note-form-textarea {
  width: 100%;
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 10px;
  background: var(--surface-1, #ffffff);
  color: var(--text-h, #243224);
  padding: 10px 12px;
  font-size: 13px;
  resize: vertical;
  min-height: 92px;
  line-height: 1.4;
}

.project-note-form-textarea:focus-visible {
  outline: none;
  border-color: var(--accent, #00a56a);
}

:global(.app-modal-card[aria-label='Add Note'] .app-modal-title-icon) {
  background: rgba(239, 197, 68, 0.2) !important;
  color: #efc544 !important;
}

:global(.app-modal-card[aria-label='Add Note'] .app-modal-title-icon svg) {
  color: #efc544 !important;
}
</style>
