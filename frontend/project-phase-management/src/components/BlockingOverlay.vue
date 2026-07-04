<template>
  <div class="blocking-overlay" role="alert" aria-live="polite" aria-busy="true">
    <div class="blocking-overlay-card">
      <div class="blocking-overlay-spinner" aria-hidden="true"></div>
      <div class="blocking-overlay-text">
        <div class="blocking-overlay-title">{{ title }}</div>
        <div v-if="subtitle" class="blocking-overlay-subtitle">{{ subtitle }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  title: { type: String, default: 'Working…' },
  subtitle: { type: String, default: '' },
})

const title = props.title
const subtitle = props.subtitle
</script>

<style scoped>
.blocking-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  padding: 18px;
}

.blocking-overlay-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border-strong, rgba(15, 23, 42, 0.12));
  box-shadow: var(--shadow, 0 16px 48px rgba(15, 23, 42, 0.18));
  min-width: min(520px, 92vw);
}

.blocking-overlay-spinner {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 2px solid rgba(148, 163, 184, 0.55);
  border-top-color: var(--accent, #00a56a);
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

.blocking-overlay-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-h, #0f172a);
}

.blocking-overlay-subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text, rgba(15, 23, 42, 0.62));
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

