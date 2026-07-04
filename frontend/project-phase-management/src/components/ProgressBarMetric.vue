<script setup>
import { computed } from 'vue'
import { formatMoney, formatMoneyCompact } from '@/common'

const props = defineProps({
  label: { type: String, required: true },
  skeleton: { type: Boolean, default: false },
  value: { type: Number, default: 0 },
  valueTitle: { type: String, default: '' },
  percent: { type: Number, default: null },
  accent: { type: Boolean, default: false },
  ariaLabel: { type: String, default: 'Progress metric' },
  remainingLabel: { type: String, default: '' },
  remainingValue: { type: Number, default: null },
  splitLeftLabel: { type: String, default: '' },
  splitLeftValue: { type: Number, default: null },
  splitRightLabel: { type: String, default: '' },
  splitRightValue: { type: Number, default: null },
  secondaryPercent: { type: Number, default: null },
  secondaryColor: { type: String, default: 'cost' },
})

const pct = computed(() => {
  if (props.percent == null || !Number.isFinite(Number(props.percent))) return null
  return Math.max(0, Math.min(100, Number(props.percent)))
})

const remainingPct = computed(() => {
  if (pct.value == null) return null
  return Math.max(0, 100 - pct.value)
})

const hasSplitFooter = computed(() => props.splitLeftValue != null || props.splitRightValue != null)
</script>

<template>
  <div class="metric-item">
    <template v-if="skeleton">
      <div class="sk sk-k"></div>
      <div class="sk sk-money"></div>
      <div class="sk sk-progress"></div>
      <div class="sk sk-meta"></div>
    </template>
    <template v-else>
      <span>{{ label }}</span>
      <div class="metric-amount-row">
        <strong :title="valueTitle || formatMoney(value)">{{ formatMoneyCompact(value) }}</strong>
        <span
          v-if="pct != null"
          class="metric-amount-pct"
          :class="{ 'metric-amount-pct--accent': accent }"
        >
          {{ Math.round(pct) }}%
        </span>
      </div>

      <div
        class="metric-progress"
        :class="{ 'metric-progress--accent': accent }"
        :aria-label="ariaLabel"
      >
        <div
          class="metric-progress-bar"
          :class="{ 'metric-progress-bar--accent': accent }"
          :style="{ width: `${pct ?? 0}%` }"
        ></div>
        <div
          v-if="secondaryPercent != null"
          class="metric-progress-bar"
          :class="
            secondaryColor === 'cost' ? 'metric-progress-bar--cost' : 'metric-progress-bar--accent'
          "
          :style="{ width: `${Math.max(0, Math.min(100, Number(secondaryPercent || 0)))}%` }"
        ></div>
        <div
          v-else-if="pct != null"
          class="metric-progress-bar-remaining"
          :class="{ 'metric-progress-bar-remaining--accent': accent }"
          :style="{ width: `${remainingPct ?? 0}%` }"
        ></div>
      </div>

      <div
        v-if="hasSplitFooter"
        class="metric-progress-under metric-progress-under--split"
        aria-hidden="true"
      >
        <span
          v-if="splitLeftValue != null"
          class="metric-progress-under-left"
          :title="`${splitLeftLabel} ${formatMoney(splitLeftValue)}`"
        >
          {{ splitLeftLabel }} {{ formatMoneyCompact(splitLeftValue) }}
        </span>
        <span
          v-if="splitRightValue != null"
          class="metric-progress-under-right"
          :title="`${splitRightLabel} ${formatMoney(splitRightValue)}`"
        >
          {{ splitRightLabel }} {{ formatMoneyCompact(splitRightValue) }}
        </span>
      </div>
      <div v-else-if="remainingValue != null" class="metric-progress-under" aria-hidden="true">
        <span
          class="metric-progress-under-right"
          :title="`${remainingLabel} ${formatMoney(remainingValue)}`"
        >
          {{ remainingLabel }} {{ formatMoneyCompact(remainingValue) }}
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.metric-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.metric-item span {
  font-size: 9px;
  color: var(--text, #94a3b8);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
}
.metric-item strong {
  font-weight: 900;
  font-size: 18px;
  line-height: 1;
  color: var(--text-h, #0f172a);
  letter-spacing: -0.02em;
}
.metric-amount-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.metric-amount-pct {
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.02em;
  color: var(--text, rgba(15, 23, 42, 0.6));
  white-space: nowrap;
}
.metric-amount-pct--accent {
  color: rgba(0, 165, 106, 0.85);
}
.metric-progress {
  height: 10px;
  border-radius: 999px;
  background: transparent;
  border: 1px solid rgba(148, 163, 184, 0.22);
  overflow: hidden;
  display: flex;
}
.metric-progress-bar {
  height: 100%;
  width: 0%;
  background: rgba(148, 163, 184, 0.55);
  transition: width 0.25s ease;
}
.metric-progress-bar-remaining {
  height: 100%;
  width: 0%;
  background: rgba(148, 163, 184, 0.18);
  transition: width 0.25s ease;
}
.metric-progress--accent {
  border-color: rgba(0, 165, 106, 0.22);
}
.metric-progress-bar--accent {
  background: rgba(0, 165, 106, 0.7);
}
.metric-progress-bar--cost {
  background: rgba(234, 88, 12, 0.75);
}
.metric-progress-bar-remaining--accent {
  background: rgba(0, 165, 106, 0.12);
}
.metric-progress-under {
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: end;
  font-size: 10px;
  color: var(--text, rgba(15, 23, 42, 0.55));
  font-weight: 700;
  letter-spacing: 0.02em;
}
.metric-progress-under--split {
  justify-content: space-between;
  gap: 10px;
}
.metric-progress-under-left,
.metric-progress-under-right {
  opacity: 0.75;
  white-space: nowrap;
}
.sk-k {
  width: 90px;
  height: 12px;
}
.sk-money {
  width: 150px;
  height: 30px;
}
.sk-progress {
  width: 100%;
  height: 10px;
  border-radius: 999px;
}
.sk-meta {
  margin-left: auto;
  width: 140px;
  height: 12px;
}
</style>
