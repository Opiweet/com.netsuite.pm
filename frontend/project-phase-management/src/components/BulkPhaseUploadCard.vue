<script setup>
import { useSlots } from 'vue'

const props = defineProps({
  stepBadge: { type: [String, Number], default: '' },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  bodyClass: { type: [String, Array, Object], default: '' },
  headerClass: { type: [String, Array, Object], default: '' },
})

const slots = useSlots()
</script>

<template>
  <div class="bpu-card">
    <div
      class="bpu-card-header"
      :class="[headerClass, { 'bpu-card-header--between': Boolean(slots.headerRight) }]"
    >
      <div class="bpu-card-header-left">
        <div v-if="stepBadge" class="bpu-card-step-badge">{{ stepBadge }}</div>
        <div>
          <div class="bpu-card-title">{{ title }}</div>
          <div v-if="subtitle || slots.subtitle" class="bpu-card-subtitle">
            <slot name="subtitle">{{ subtitle }}</slot>
          </div>
        </div>
      </div>
      <div v-if="slots.headerRight" class="bpu-card-header-actions">
        <slot name="headerRight" />
      </div>
    </div>

    <div class="bpu-card-body" :class="bodyClass">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.bpu-card {
  background: var(--surface-1, #fff);
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 16px;
  overflow: hidden;
}

.bpu-card-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-strong, #e1e6dc);
  background: var(--surface-2, #f7faf8);
}

.bpu-card-header-left {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.bpu-card-header--between {
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.bpu-card-header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.bpu-card-step-badge {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent, #00a56a);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.bpu-card-title {
  font-size: 14px;
  font-weight: 700;
  text-align: start;
  line-height: normal;
  color: var(--text-h);
}

.bpu-card-subtitle {
  font-size: 12px;
  color: var(--text, #6b7280);
  margin-top: 2px;
  line-height: normal;
}

.bpu-card-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bpu-card-body--two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}

@media (max-width: 860px) {
  .bpu-card-body--two-col {
    grid-template-columns: 1fr;
  }
}
</style>
