<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTopbarStore } from '@/stores/topbar'
import PhasesIcon from '@/components/icons/PhasesIcon.vue'
import CalendarIcon from '@/components/icons/CalendarIcon.vue'

const router = useRouter()
const topbar = useTopbarStore()

function setTopbar() {
  topbar.setTopbar({
    title: 'Bulk Upload',
    subtitle: 'Choose what you want to upload.',
    backRouteName: 'projects',
    actions: [],
  })
}

function goToPhases() {
  router.push({ name: 'bulk-phase-upload' })
}

function goToRevPlans() {
  router.push({ name: 'bulk-revplan-upload' })
}

onMounted(() => {
  setTopbar()
})
</script>

<template>
  <section class="bu-page">
    <button
      type="button"
      class="bu-card"
      @click="goToPhases"
    >
      <div class="bu-card-icon">
        <PhasesIcon />
      </div>
      <div class="bu-card-title">Phases Upload</div>
      <div class="bu-card-subtitle">Create multiple phases from a CSV file</div>
    </button>

    <button
      type="button"
      class="bu-card"
      @click="goToRevPlans"
    >
      <div class="bu-card-icon">
        <CalendarIcon />
      </div>
      <div class="bu-card-title">Revenue Allocations Upload</div>
      <div class="bu-card-subtitle">Upload revenue plans allocations in batch</div>
    </button>
  </section>
</template>

<style scoped>
.bu-page {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  padding: 0.2rem;
}

.bu-card {
  background: var(--surface-1, #fff);
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 14px;
  padding: 20px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition:
    border-color 0.2s,
    transform 0.2s;
}

.bu-card:hover {
  border-color: var(--accent, #00a56a);
  transform: translateY(-1px);
}

.bu-card-icon {
  width: 48px;
  height: 48px;
  display: inline-flex;
  color: var(--accent, #00a56a);
  border: 1px solid var(--border-strong, #0f172a1f);
  border-radius: 0.5rem;
  padding: 0.5rem;
  background: var(--surface-3, #0f172a0a);
}

.bu-card-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.bu-card-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-h);
}

.bu-card-subtitle {
  font-size: 13px;
  color: var(--text, #6b7280);
}
</style>
