<template>
  <div class="project-banner" :class="variantClass" :role="role">
    <div class="project-banner-body">
      <div class="project-banner-text">
        <slot />
      </div>
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  variant: { type: String, default: 'info' }, // info | warning | error | success
  role: { type: String, default: null },
})

const variantClass = computed(() => {
  const raw = String(props.variant || '')
    .trim()
    .toLowerCase()
  if (raw === 'warning' || raw === 'warn') return 'project-banner--warning'
  if (raw === 'error') return 'project-banner--error'
  if (raw === 'success' || raw === 'ok') return 'project-banner--success'
  return 'project-banner--info'
})
</script>

<style scoped>
.project-banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 5px;
  border: 1px solid transparent;
  font-size: 12px;
}

.project-banner-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.project-banner-text {
  font-size: 12px;
  line-height: 1.2;
  color: inherit;
}

.project-banner--info {
  border-color: rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.1);
  color: #4186f5;
}

.project-banner--warning {
  border-color: rgba(233, 118, 43, 0.35);
  background: rgba(233, 118, 43, 0.12);
  color: #bb511a;
}

.project-banner--error {
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.1);
  color: #b91c1c;
}

.project-banner--success {
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
}
</style>
