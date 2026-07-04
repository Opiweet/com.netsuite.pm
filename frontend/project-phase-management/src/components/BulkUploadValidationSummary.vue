<script setup>
import { computed } from 'vue'
import ProjectBanner from '@/components/ProjectBanner.vue'

const props = defineProps({
  total: { type: Number, default: 0 },
  valid: { type: Number, default: 0 },
  invalid: { type: Number, default: 0 },
  errorMessage: { type: String, default: '' },
  successMessage: { type: String, default: '' },
  bannerClass: { type: [String, Array, Object], default: '' },
})

const hasRows = computed(() => Number(props.total || 0) > 0)
const hasInvalid = computed(() => Number(props.invalid || 0) > 0)
</script>

<template>
  <div class="bpu-validation-summary">
    <div v-if="hasRows" class="bpu-stats">
      <div class="bpu-stat">
        <span class="bpu-stat-value">{{ total }}</span>
        <span class="bpu-stat-label">Total</span>
      </div>
      <div class="bpu-stat bpu-stat--ok">
        <span class="bpu-stat-value">{{ valid }}</span>
        <span class="bpu-stat-label">Valid</span>
      </div>
      <div v-if="hasInvalid" class="bpu-stat bpu-stat--bad">
        <span class="bpu-stat-value">{{ invalid }}</span>
        <span class="bpu-stat-label">Invalid</span>
      </div>
    </div>

    <ProjectBanner v-if="hasRows && hasInvalid" variant="warning" role="alert" :class="bannerClass">
      {{ errorMessage }}
    </ProjectBanner>
    <ProjectBanner v-else-if="hasRows" variant="info" role="status" :class="bannerClass">
      <span v-html="successMessage"></span>
    </ProjectBanner>
  </div>
</template>

<style scoped>
.bpu-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 0.5rem;
}

.bpu-stat {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 999px;
  padding: 4px 10px;
  background: var(--surface-2, #f7faf8);
}

.bpu-stat-value {
  min-width: 24px;
  text-align: center;
  font-weight: 700;
  font-size: 12px;
  color: var(--text-h, #243224);
}

.bpu-stat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text, #6b7280);
}

.bpu-stat--ok .bpu-stat-value {
  color: #16a34a;
}

.bpu-stat--bad .bpu-stat-value {
  color: #b91c1c;
}
</style>
