<script setup>
import { computed } from 'vue'
import { formatMoney, formatMoneyCompact } from '@/common'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  columns: { type: Array, default: () => [] },
  rows: { type: Array, default: () => [] },
  showModeToggle: { type: Boolean, default: false },
  mode: { type: String, default: 'department' },
})

const emit = defineEmits(['update:mode'])

const normalizedRows = computed(() =>
  (Array.isArray(props.rows) ? props.rows : []).map((row, idx) => ({
    key: row?.key ?? idx,
    label: String(row?.label ?? ''),
    values: Array.isArray(row?.values) ? row.values : [],
    isTotal: Boolean(row?.isTotal),
  })),
)

function setMode(next) {
  emit('update:mode', next)
}
</script>

<template>
  <div class="dept-card">
    <div class="dept-card-header">
      <div>
        <div class="summary-title">{{ title }}</div>
      </div>
      <div v-if="showModeToggle" class="breakdown-toggle" role="tablist" aria-label="Revenue breakdown mode">
        <button
          type="button"
          class="breakdown-toggle-btn"
          :class="{ active: mode === 'department' }"
          @click="setMode('department')"
        >
          Dept
        </button>
        <button
          type="button"
          class="breakdown-toggle-btn"
          :class="{ active: mode === 'phase' }"
          @click="setMode('phase')"
        >
          Phase
        </button>
      </div>
    </div>

    <div class="dept-card-body">
      <div
        class="summary-grid"
        :class="{ open }"
        :style="{
          gridTemplateColumns: `1.3fr ${Array(Math.max(0, columns.length - 1))
            .fill('1fr')
            .join(' ')}`,
        }"
      >
        <div class="summary-head">{{ columns[0]?.label || '' }}</div>
        <div v-for="col in columns.slice(1)" :key="String(col?.key || col?.label || '')" class="summary-head">
          {{ col?.label || '' }}
        </div>

        <template v-for="row in normalizedRows" :key="String(row.key)">
          <div class="summary-cell" :class="{ 'summary-cell--total': row.isTotal }">{{ row.label }}</div>
          <div
            v-for="(value, valueIdx) in row.values"
            :key="`${row.key}-${valueIdx}`"
            class="summary-cell"
            :class="{ 'summary-cell--total': row.isTotal }"
            :title="formatMoney(value)"
          >
            {{ formatMoneyCompact(value) }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dept-card {
  margin-top: 1rem;
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 5px;
  padding: 18px;
}
.dept-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.breakdown-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 10px;
  padding: 4px;
  background: var(--surface-2, #f8fafc);
}
.breakdown-toggle-btn {
  border: none;
  background: transparent;
  color: var(--text, #6b7280);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.breakdown-toggle-btn.active {
  background: var(--surface-1, #fff);
  color: var(--accent, #00a56a);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1);
}
.dept-card-body {
  overflow-x: auto;
}
.summary-grid {
  display: grid;
  gap: 8px 10px;
  font-size: 12px;
  min-width: 760px;
  width: 100%;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition:
    max-height 0.25s ease,
    opacity 0.2s ease;
}
.summary-grid.open {
  max-height: 250px;
  opacity: 1;
  overflow-x: auto;
  overflow-y: auto;
}
.summary-head {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text, #94a3b8);
  font-size: 10px;
}
.summary-cell {
  color: var(--text-h, #2f3b2f);
}
.summary-cell--total {
  font-weight: 700;
  color: var(--text-h, #111827);
  border-bottom: 1px solid var(--topbar-border, #e2e8f0);
}
</style>
