<script setup>
defineProps({
  steps: {
    type: Array,
    default: () => [],
  },
})
</script>

<template>
  <aside class="bpu-steps">
    <template v-for="(step, index) in steps" :key="`${index}-${step?.title || ''}`">
      <div
        class="bpu-step"
        :class="{ 'bpu-step--done': Boolean(step?.done), 'bpu-step--active': Boolean(step?.active) }"
      >
        <div class="bpu-step-indicator">
          <span v-if="step?.done" class="bpu-step-check">✓</span>
          <span v-else class="bpu-step-num">{{ step?.number ?? index + 1 }}</span>
        </div>
        <div class="bpu-step-body">
          <div class="bpu-step-title">{{ step?.title || '' }}</div>
          <div class="bpu-step-desc">{{ step?.desc || '' }}</div>
        </div>
      </div>
      <div v-if="index < steps.length - 1" class="bpu-step-connector"></div>
    </template>
  </aside>
</template>

<style scoped>
.bpu-steps {
  position: sticky;
  top: 80px;
  display: flex;
  flex-direction: column;
  padding: 16px 0;
}

.bpu-step {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 0 4px;
  opacity: 0.4;
  transition: opacity 0.2s;
}

.bpu-step--active,
.bpu-step--done {
  opacity: 1;
}

.bpu-step-connector {
  width: 2px;
  height: 28px;
  background: var(--border-strong, #e1e6dc);
  margin: 4px 0 4px 16px;
}

.bpu-step-indicator {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid var(--border-strong, #e1e6dc);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--surface-1, #fff);
  transition:
    border-color 0.2s,
    background 0.2s;
}

.bpu-step--active .bpu-step-indicator {
  border-color: var(--accent, #00a56a);
  background: var(--accent-bg, rgba(0, 165, 106, 0.1));
}

.bpu-step--done .bpu-step-indicator {
  border-color: var(--accent, #00a56a);
  background: var(--accent, #00a56a);
}

.bpu-step-num {
  font-size: 12px;
  font-weight: 700;
  color: var(--text, #6b7280);
}

.bpu-step--active .bpu-step-num {
  color: var(--accent, #00a56a);
}

.bpu-step-check {
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}

.bpu-step-body {
  padding-top: 4px;
  text-align: start;
}

.bpu-step-title {
  line-height: normal;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-h);
}

.bpu-step-desc {
  font-size: 11px;
  color: var(--text, #6b7280);
  margin-top: 2px;
  line-height: 1.4;
}

@media (max-width: 768px) {
  .bpu-steps {
    display: none;
  }
}
</style>
