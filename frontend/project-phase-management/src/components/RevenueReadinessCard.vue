<script setup>
import { formatMoney, formatMoneyCompact } from '@/common'

defineProps({
  revenueReady: { type: Number, default: 0 },
  unbilledRevenue: { type: Number, default: 0 },
  skeleton: { type: Boolean, default: false },
})
</script>

<template>
  <div class="readiness-card" aria-label="Revenue stats" :aria-busy="skeleton">
    <template v-if="skeleton">
      <div class="readiness-stat">
        <div class="sk sk-k"></div>
        <div class="sk sk-v"></div>
      </div>
      <div class="readiness-divider" aria-hidden="true"></div>
      <div class="readiness-stat readiness-stat--sub">
        <div class="sk sk-k"></div>
        <div class="sk sk-v sk-v--sub"></div>
      </div>
    </template>
    <template v-else>
      <div class="readiness-stat">
        <div class="readiness-k">Revenue Ready</div>
        <div class="readiness-v" :title="formatMoney(revenueReady)">
          {{ formatMoneyCompact(revenueReady) }}
        </div>
      </div>
      <div class="readiness-divider" aria-hidden="true"></div>
      <div class="readiness-stat readiness-stat--sub">
        <div class="readiness-k">Unbilled Revenue</div>
        <div class="readiness-v" :title="formatMoney(unbilledRevenue)">
          {{ formatMoneyCompact(unbilledRevenue) }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.readiness-card {
  min-height: 160px;
  background: var(--project-current-bg, var(--surface-2, rgba(15, 23, 42, 0.04)));
  border: 1px solid rgba(0, 165, 106, 0.6);
  box-shadow:
    0 0 12px 2px rgba(0, 165, 106, 0.25),
    0 0 4px 0px rgba(0, 165, 106, 0.15);
  border-radius: 16px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: stretch;
  text-align: center;
}
:global(:root[data-theme='light']) .readiness-card {
  box-shadow: 0 0 6px 1px rgba(0, 165, 106, 0.08);
}
.readiness-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.readiness-k {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 800;
  color: rgba(148, 163, 184, 0.85);
}
.readiness-v {
  margin-top: 4px;
  font-size: 24px;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: rgba(0, 165, 106, 1);
}
.readiness-stat--sub .readiness-k {
  color: rgba(148, 163, 184, 0.75);
}
.readiness-stat--sub .readiness-v {
  font-size: 18px;
  color: rgba(148, 163, 184, 0.95);
}
.readiness-divider {
  height: 1px;
  width: 70%;
  margin: 2px auto;
  background: rgba(148, 163, 184, 0.22);
}
.sk-k {
  width: 140px;
  height: 10px;
}
.sk-v {
  width: 120px;
  height: 34px;
  margin-top: 12px;
}
.sk-v--sub {
  height: 28px;
}
</style>
