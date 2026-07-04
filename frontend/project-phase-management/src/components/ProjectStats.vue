<template>
  <section class="project-stats">
    <div
      v-if="skeleton"
      v-for="idx in skeletonCountSafe"
      :key="`sk-${idx}`"
      class="sk sk-stats"
    ></div>

    <div v-else v-for="stat in stats" :key="stat.label" class="project-stat">
      <div class="project-stat-icon">
        <component :is="stat.icon" />
      </div>
      <div class="project-stat-label">{{ stat.label }}</div>
      <div class="project-stat-value" :title="formatMoney(stat.value)">
        {{ formatMoneyCompact(stat.value) }}
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { formatMoney, formatMoneyCompact } from '@/common'
const props = defineProps({
  stats: {
    type: Array,
    default: () => [],
  },
  skeleton: {
    type: Boolean,
    default: false,
  },
  skeletonCount: {
    type: Number,
    default: 3,
  },
})

const skeletonCountSafe = computed(() => {
  const n = Number(props.skeletonCount || 0)
  if (!Number.isFinite(n) || n <= 0) return 3
  return Math.round(n)
})
</script>

<style scoped>
.project-stats {
  display: flex;
  align-items: center;
  justify-content: start;
  gap: 1rem;
  flex-wrap: wrap;
  margin-block: 1rem;
}

.project-stat {
  display: flex;
  flex-direction: row;
  text-align: right;
  justify-self: start;
  gap: 12px;
  border-radius: 5px;
  border: 1px solid var(--border-strong, rgba(15, 23, 42, 0.12));
  padding: 4px 10px;
  background: var(--surface-3, #ffffff);
}
.project-stat-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.project-stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.project-stat-icon svg {
  width: 18px;
  height: 18px;
  color: var(--text, rgba(15, 23, 42, 0.55));
}

.project-stat-label {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 800;
  color: var(--text, rgba(15, 23, 42, 0.55));
}
.project-stat-value {
  font-size: 16px;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--text-h, #0f172a);
}
.sk.sk-stats {
  width: 220px;
  height: 35px;
}
</style>
