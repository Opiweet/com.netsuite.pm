<script setup>
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  ariaLabel: { type: String, default: 'Panel' },
  title: { type: String, default: '' },
  width: { type: String, default: 'min(420px, 92vw)' },
  panelClass: { type: [String, Array, Object], default: '' },
  bodyClass: { type: [String, Array, Object], default: '' },
})

const emit = defineEmits(['update:modelValue'])

function closePanel() {
  emit('update:modelValue', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div v-if="modelValue" class="drawer-backdrop" @click="closePanel"></div>
    </Transition>

    <Transition name="drawer-slide">
      <aside
        v-if="modelValue"
        class="drawer-panel"
        :class="panelClass"
        role="dialog"
        :aria-label="ariaLabel || title || 'Panel'"
        :style="{ width }"
      >
        <header class="drawer-head">
          <div class="drawer-title-wrap">
            <slot name="title">
              <h3 class="drawer-title">{{ title }}</h3>
            </slot>
          </div>
          <div class="drawer-head-actions">
            <slot name="header-actions" :close="closePanel"></slot>
            <button type="button" class="drawer-close" aria-label="Close panel" @click="closePanel">
              <i class="mdi mdi-close"></i>
            </button>
          </div>
        </header>

        <div class="drawer-body" :class="bodyClass">
          <slot />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1990;
}

:global(:root[data-theme='dark'] .drawer-backdrop) {
  background: rgba(0, 0, 0, 0.75);
}

.drawer-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  background: var(--surface-1, #fff);
  border-left: 1px solid var(--border-strong, #e1e6dc);
  box-shadow: -12px 0 28px rgba(15, 23, 42, 0.2);
  z-index: 2000;
  display: flex;
  flex-direction: column;
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-strong, #e1e6dc);
}

.drawer-title-wrap {
  min-width: 0;
}

.drawer-title {
  margin: 0;
  font-size: 18px;
  color: var(--text-h, #1f2b1f);
}

.drawer-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.drawer-close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border-strong, #e1e6dc);
  background: transparent;
  color: var(--text, #6b7280);
  cursor: pointer;
  flex-shrink: 0;
}

.drawer-body {
  overflow: auto;
  flex: 1;
}

.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.18s ease;
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.22s ease;
}

.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(100%);
}
</style>
