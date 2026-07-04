<script setup>
defineProps({
  label: { type: String, default: '' },
  icon: { type: Object, default: null },
  mdiIcon: { type: String, default: '' },
  variant: { type: String, default: '' }, // '' | 'primary' | 'ghost'
  active: { type: Boolean, default: false },
  iconOnly: { type: Boolean, default: false },
  badge: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  onClick: { type: Function, default: null },
  ariaLabel: { type: String, default: '' },
  title: { type: String, default: '' },
})
</script>

<template>
  <button
    class="action-btn"
    :class="[variant ? `action-btn--${variant}` : '', { active, 'icon-only': iconOnly }]"
    type="button"
    :disabled="disabled || loading"
    :data-badge="badge ? '' : null"
    :aria-label="ariaLabel || null"
    :title="title || null"
    @click="onClick?.($event)"
  >
    <span v-if="loading" class="action-btn__spinner" aria-hidden="true"></span>
    <component :is="icon" v-if="icon" />
    <i v-else-if="mdiIcon" class="mdi" :class="mdiIcon" />
    <template v-if="!iconOnly && label">{{ loading ? `${label}` : label }}</template>
  </button>
</template>

<style scoped>
.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  white-space: nowrap;
  position: relative;
  border-radius: 5px;
  border: 1px solid var(--border-strong, #e7eee1);
  background: var(--surface-2, #f7fafc);
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text, #6c726c);
  cursor: pointer;
}
.action-btn :deep(svg) {
  width: 20px;
  height: 20px;
  padding-bottom: 2px;
}
.action-btn__spinner {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  display: inline-block;
  animation: action-btn-spin 0.7s linear infinite;
}
.action-btn .mdi {
  font-size: 16px;
}
.action-btn:hover:not(:disabled) {
  border-color: var(--accent, #00a56a);
  color: var(--accent, #00a56a);
}
.action-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
.action-btn--primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #ffffff;
}
.action-btn--primary:hover:not(:disabled) {
  border-color: var(--accent);
  color: #ffffff;
  filter: brightness(0.92);
}
.action-btn--primary:disabled {
  background: var(--surface-3, #e2e8e2);
  border-color: var(--border-strong, #d1d9ce);
  color: var(--text, #9ca89c);
  opacity: 1;
}
.action-btn--ghost {
  background: transparent;
}
.action-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-bg);
}
.action-btn.icon-only {
  padding: 5px 9px;
}
.action-btn[data-badge]::after {
  content: '';
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--accent);
}

@keyframes action-btn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
