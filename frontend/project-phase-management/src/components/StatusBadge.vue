<template>
  <span class="status-badge" :style="badgeStyle">
    {{ label ?? '—' }}
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  label: { type: [String, Number], default: '' },
  color: { type: String, default: '#6b7280' },
})

const badgeStyle = computed(() => ({
  background: `color-mix(in srgb, ${props.color} 14%, transparent)`,
  color: props.color,
}))
</script>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  width: max-content;
  padding: 7px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.03em;
  max-height: 2rem;
  line-height: normal;
  height: fit-content;
}
</style>
