<script setup>
import { computed, onBeforeUnmount, watch, useSlots } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  icon: { type: [String, Object, Function], default: '' }, // string mdi name or a Vue component
  variant: { type: String, default: 'default' }, // default | warning | error
  actions: { type: Array, default: () => [] }, // [{ label, variant, onClick, disabled }]
  closeOnBackdrop: { type: Boolean, default: true },
  closeOnEsc: { type: Boolean, default: true },
  showClose: { type: Boolean, default: true },
  width: { type: [String, Number], default: null },
})

const emit = defineEmits(['update:modelValue'])
const slots = useSlots()

const isWarning = computed(() => props.variant === 'warning')
const isError = computed(() => props.variant === 'error')
const hasSubtitle = computed(() => Boolean(props.subtitle) || Boolean(slots.subtitle))

const iconClass = computed(() => {
  if (!props.icon || typeof props.icon !== 'string') return ''
  const normalized = props.icon.startsWith('mdi-') ? props.icon : `mdi-${props.icon}`
  return normalized
})

const cardStyle = computed(() => {
  if (!props.width) return undefined
  return { width: typeof props.width === 'number' ? `${props.width}px` : props.width }
})

function requestClose() {
  emit('update:modelValue', false)
}

function handleBackdropClick() {
  if (!props.closeOnBackdrop) return
  requestClose()
}

function onKeydown(event) {
  if (!props.closeOnEsc) return
  if (event.key !== 'Escape') return
  requestClose()
}

watch(
  () => props.modelValue,
  (open) => {
    if (!props.closeOnEsc) return
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <transition name="modal-fade">
      <div
        v-if="modelValue"
        class="app-modal"
        :class="{
          'app-modal--warning': isWarning,
          'app-modal--error': isError,
        }"
      >
        <div class="app-modal-backdrop" @click="handleBackdropClick"></div>
        <div
          class="app-modal-card"
          :class="{
            'app-modal-card--warning': isWarning,
            'app-modal-card--error': isError,
          }"
          :style="cardStyle"
          role="dialog"
          aria-modal="true"
          :aria-label="title || 'Modal'"
        >
          <div class="app-modal-header">
            <h3 class="app-modal-title">
              <span v-if="iconClass || icon" class="app-modal-title-icon" aria-hidden="true">
                <i v-if="iconClass" class="mdi" :class="iconClass"></i>
                <component v-else :is="icon" class="app-modal-svg-icon" />
              </span>
              <span>{{ title }}</span>
            </h3>
            <button v-if="showClose" type="button" class="app-modal-close" @click="requestClose">
              ×
            </button>
          </div>

          <p v-if="hasSubtitle" class="app-modal-sub">
            <slot name="subtitle">{{ subtitle }}</slot>
          </p>

          <slot />

          <div v-if="$slots.actions" class="app-modal-actions">
            <slot name="actions" />
          </div>

          <div v-else-if="actions?.length" class="app-modal-actions">
            <button
              v-for="(action, idx) in actions"
              :key="action.key ?? `${action.label}-${idx}`"
              type="button"
              class="app-modal-btn"
              :class="`app-modal-btn--${action.variant || 'ghost'}`"
              :disabled="Boolean(action.disabled)"
              @click="action.onClick && action.onClick()"
            >
              {{ action.label }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
/* Transition must live inside the modal component (root is Teleport). */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.app-modal {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-modal-backdrop {
  position: absolute;
  inset: 0;
  background: var(--modal-backdrop);
  backdrop-filter: blur(3px);
  /* -webkit-backdrop-filter: blur(3px); */
}

.app-modal-card {
  position: relative;
  z-index: 1;
  width: min(520px, 92vw);
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.08));
  border-radius: 14px;
  padding: 18px 28px;
  box-shadow: var(--modal-shadow, 0 18px 40px rgba(15, 23, 42, 0.2));
}

.app-modal-card--warning {
  border-color: rgba(233, 118, 43, 0.78);
}

.app-modal-card--error {
  border-color: rgba(220, 38, 38, 0.7);
}

.app-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--border-strong, rgba(15, 23, 42, 0.12));
}

.app-modal-card--warning .app-modal-header {
  border-bottom-color: rgba(233, 118, 43, 0.22);
}

.app-modal-card--error .app-modal-header {
  border-bottom-color: rgba(220, 38, 38, 0.24);
}

.app-modal-header h3 {
  margin: 0;
  font-size: 16px;
  color: var(--text-h, #1f2b1f);
}

.app-modal-card--warning .app-modal-header h3 {
  color: var(--orange);
}

.app-modal-card--error .app-modal-header h3 {
  color: var(--red);
}

.app-modal-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.app-modal-title-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 165, 106, 0.18);
  color: var(--accent, #00a56a);
  flex-shrink: 0;
}
.app-modal-svg-icon {
  width: 18px;
  height: 18px;
  display: block;
}

.app-modal-card--warning .app-modal-title-icon {
  background: rgba(233, 118, 43, 0.22);
  color: rgba(233, 118, 43, 0.95);
}

.app-modal-card--error .app-modal-title-icon {
  background: rgba(220, 38, 38, 0.16);
  color: rgba(220, 38, 38, 0.95);
}

.app-modal-title-icon .mdi {
  font-size: 18px;
}

.app-modal-close {
  border: none;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
  color: var(--text, #6b7280);
}

.app-modal-sub {
  margin: 8px 0 12px;
  color: var(--text, #6b7280);
  font-size: 12px;
  text-align: start;
}

.app-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

.app-modal-btn {
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    filter 0.15s,
    transform 0.15s;
}

.app-modal-btn:active {
  transform: translateY(1px);
}

.app-modal-btn:focus-visible {
  outline: 2px solid rgba(0, 165, 106, 0.55);
  outline-offset: 2px;
}

.app-modal-btn--primary {
  background: var(--topbar-primary-bg, var(--dark));
  color: #ffffff;
  border-color: transparent;
}

.app-modal-btn--primary:hover {
  filter: brightness(1.05);
}

.app-modal-btn--warning {
  background: rgba(233, 118, 43, 0.96);
  border-color: rgba(233, 118, 43, 0.9);
  color: #ffffff;
}

.app-modal-btn--warning:hover {
  background: rgba(233, 118, 43, 0.88);
  border-color: rgba(233, 118, 43, 0.95);
}

.app-modal-btn--ghost {
  background: var(--surface-2, #ffffff);
  border-color: var(--border-strong, #e1e6dc);
  color: var(--text-h, #1f2b1f);
}

.app-modal-btn--error {
  background: transparent;
  border-color: rgba(220, 38, 38, 0.6);
  color: var(--red);
}

.app-modal-btn--error:hover {
  background: rgba(220, 38, 38, 0.12);
  border-color: rgba(220, 38, 38, 0.8);
}
</style>
