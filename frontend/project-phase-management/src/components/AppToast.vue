<template>
  <div class="app-toasts" aria-live="polite" aria-relevant="additions removals">
    <div v-for="t in items" :key="t.id" class="app-toast" :data-variant="t.variant">
      <div class="app-toast__message">{{ t.message }}</div>
      <button class="app-toast__close" type="button" aria-label="Dismiss" @click="dismiss(t.id)">
        ×
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
const items = computed(() => toast.items || [])
const dismiss = (id) => toast.dismiss(id)
</script>

<style scoped>
.app-toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 5000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.app-toast {
  pointer-events: auto;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  text-align: start;
  gap: 12px;
  min-width: 280px;
  max-width: 420px;
  padding: 6px 6px 6px 12px;
  border-radius: 5px;
  border: 1px solid var(--toast-info-border);
  background: var(--toast-info-bg);
  color: var(--toast-info-fg);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(8px);
}

.app-toast[data-variant='success'] {
  border-color: var(--toast-success-border);
  background: var(--toast-success-bg);
  color: var(--toast-success-fg);
}
.app-toast[data-variant='warning'] {
  border-color: var(--toast-warning-border);
  background: var(--toast-warning-bg);
  color: var(--toast-warning-fg);
}
.app-toast[data-variant='error'] {
  border-color: var(--toast-error-border);
  background: var(--toast-error-bg);
  color: var(--toast-error-fg);
}

.app-toast__message {
  font-size: 13px;
  line-height: 1.35;
  word-break: break-word;
}

.app-toast__close {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.app-toast__close:hover {
  background: rgba(255, 255, 255, 0.16);
}
</style>
