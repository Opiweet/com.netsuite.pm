<script setup>
import { computed, ref, watch } from 'vue'
import Select from 'primevue/select'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import SlidingDrawer from '@/components/SlidingDrawer.vue'
import ActionBtn from '@/components/ActionBtn.vue'
import { useProjectsStore } from '@/stores/projects'
import { useToastStore } from '@/stores/toast'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  projectId: { type: [String, Number], default: null },
  canEdit: { type: Boolean, default: false },
  showHandle: { type: Boolean, default: true },
  handleLabel: { type: String, default: 'ADMIN PANEL' },
})

const emit = defineEmits(['update:modelValue'])
const projectsStore = useProjectsStore()
const toast = useToastStore()
const isSaving = ref(false)
const selectedProjectMonth = ref('')
const activeTab = ref('simulated-month')

const resolvedProjectId = computed(() => String(props.projectId ?? '').trim())
const project = computed(
  () =>
    projectsStore.projects.find((item) => String(item?.id || '') === resolvedProjectId.value) ||
    null,
)
const projectLoad = computed(
  () => projectsStore.projectLoadByProject[resolvedProjectId.value] || null,
)
const monthSimulation = computed(() => projectLoad.value?.monthSimulation || {})
const projectOverride = computed(() => monthSimulation.value?.projectSimulated || null)
const appOverride = computed(() => monthSimulation.value?.appSimulated || null)
const actualCurrent = computed(() => monthSimulation.value?.actual || null)
const effectiveCurrent = computed(() => monthSimulation.value?.effective || null)
const projectMonths = computed(() => {
  const months = Array.isArray(projectsStore.backendMonthsByProject?.[resolvedProjectId.value])
    ? projectsStore.backendMonthsByProject[resolvedProjectId.value]
    : []
  const byKey = new Map()
  months.forEach((month) => {
    const year = Number(month?.year || 0)
    const monthNum = Number(month?.month || 0)
    if (!year || !monthNum) return
    const raw = monthOverrideValueFromYearMonth(year, monthNum)
    if (!raw || byKey.has(raw)) return
    byKey.set(raw, {
      value: raw,
      label: month?.label || monthOverrideDisplayFromYearMonth(year, monthNum),
    })
  })
  return Array.from(byKey.values())
})
const dirty = computed(
  () => String(selectedProjectMonth.value || '') !== currentProjectOverrideRaw.value,
)
const currentProjectOverrideRaw = computed(() => String(projectOverride.value?.raw || '').trim())
const effectiveSourceLabel = computed(() => {
  const source = String(monthSimulation.value?.source || '').trim()
  if (source === 'project_override') return 'Project override'
  if (source === 'app_override') return 'App override'
  return 'Actual current month'
})
const effectiveSourceVariant = computed(() => {
  const source = String(monthSimulation.value?.source || '').trim()
  if (source === 'project_override') return 'accent'
  if (source === 'app_override') return 'warn'
  return 'neutral'
})

function monthOverrideValueFromYearMonth(year, month) {
  const monthNames = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ]
  const y = Number(year)
  const m = Number(month)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return ''
  return `${monthNames[m - 1]}-${y}`
}

function monthOverrideDisplayFromYearMonth(year, month) {
  const y = Number(year)
  const m = Number(month)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })
      .format(new Date(y, m - 1, 1))
      .replace(',', '')
  } catch (_e) {
    return `${y}-${String(m).padStart(2, '0')}`
  }
}

function parseDateAny(value) {
  if (typeof projectsStore._parseDateAny === 'function') {
    return projectsStore._parseDateAny(value)
  }
  if (!value) return null
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

function buildProjectMonthsFromDates() {
  const start = parseDateAny(project.value?.startDate)
  const end = parseDateAny(project.value?.endDate)
  if (!(start instanceof Date) || !(end instanceof Date)) return []
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []
  const current = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  const out = []
  while (current <= last) {
    out.push({
      value: monthOverrideValueFromYearMonth(current.getFullYear(), current.getMonth() + 1),
      label: monthOverrideDisplayFromYearMonth(current.getFullYear(), current.getMonth() + 1),
    })
    current.setMonth(current.getMonth() + 1)
  }
  return out
}

const monthOptions = computed(() => {
  const fallback = buildProjectMonthsFromDates()
  return projectMonths.value.length ? projectMonths.value : fallback
})

watch(
  () => [props.modelValue, currentProjectOverrideRaw.value],
  ([open]) => {
    if (!open) return
    selectedProjectMonth.value = currentProjectOverrideRaw.value
  },
  { immediate: true },
)

watch(
  () => [resolvedProjectId.value, props.modelValue],
  async ([pid, open]) => {
    if (!pid || !open) return
    if (!projectLoad.value) {
      await projectsStore.fetchProjectLoad({ projectId: pid }).catch(() => {})
    }
    if (!monthOptions.value.length) {
      await projectsStore.fetchProjectRevPlans({ projectId: pid }).catch(() => {})
    }
    selectedProjectMonth.value = currentProjectOverrideRaw.value
  },
  { immediate: true },
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) activeTab.value = 'simulated-month'
  },
)

function closePanel() {
  emit('update:modelValue', false)
}

function openPanel() {
  if (!props.modelValue) emit('update:modelValue', true)
}

async function saveMonthSimulation() {
  const pid = resolvedProjectId.value
  if (!pid || isSaving.value) return
  isSaving.value = true
  try {
    await projectsStore.updateProjectMonthSimulation({
      projectId: pid,
      simulatedPeriod: selectedProjectMonth.value,
    })
    toast.show({
      message: selectedProjectMonth.value
        ? 'Project month simulation saved.'
        : 'Project month simulation cleared.',
      variant: 'success',
    })
  } catch (error) {
    toast.show({
      message: error?.message || 'Failed to save project month simulation.',
      variant: 'error',
      durationMs: 10000,
    })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <button
    v-if="showHandle && !modelValue"
    type="button"
    class="project-month-admin-handle"
    aria-label="Open month admin panel"
    @click="openPanel"
  >
    <i class="mdi mdi-shield-outline project-month-admin-handle-icon" aria-hidden="true"></i>
    <span class="project-month-admin-handle-label">{{ handleLabel }}</span>
  </button>

  <SlidingDrawer
    :model-value="modelValue"
    aria-label="Admin Panel"
    title="Admin Panel"
    width="min(720px, 96vw)"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #title>
      <div class="pma-title">
        <i class="mdi mdi-shield-outline pma-title__icon"></i>
        <span>Admin Panel</span>
      </div>
    </template>

    <Tabs v-model:value="activeTab" class="pma-tabs">
      <TabList>
        <Tab value="simulated-month">
          <i class="mdi mdi-calendar-sync-outline"></i>
          Simulated Month
        </Tab>
        <Tab value="audit">
          <i class="mdi mdi-history"></i>
          Audit
        </Tab>
      </TabList>

      <TabPanels>
        <!-- Simulated Month -->
        <TabPanel value="simulated-month" class="pma-content">
          <section class="pma-card pma-card--highlight">
            <div class="pma-card__head">
              <div class="pma-card__titles">
                <div class="pma-kicker">Current month state</div>
                <div class="pma-heading">Backend-controlled month</div>
              </div>
              <span class="pma-badge" :class="`pma-badge--${effectiveSourceVariant}`">
                {{ effectiveSourceLabel }}
              </span>
            </div>

            <div class="pma-month-grid">
              <div class="pma-month-cell">
                <div class="pma-month-cell__label">Real current</div>
                <div class="pma-month-cell__value">{{ actualCurrent?.label || '—' }}</div>
              </div>
              <div class="pma-month-cell">
                <div class="pma-month-cell__label">App-wide simulation</div>
                <div class="pma-month-cell__value">{{ appOverride?.label || '—' }}</div>
              </div>
              <div class="pma-month-cell">
                <div class="pma-month-cell__label">Project simulation</div>
                <div class="pma-month-cell__value">{{ projectOverride?.label || '—' }}</div>
              </div>
              <div class="pma-month-cell pma-month-cell--effective">
                <div class="pma-month-cell__label">Effective</div>
                <div class="pma-month-cell__value">{{ effectiveCurrent?.label || '—' }}</div>
              </div>
            </div>

            <p class="pma-note">
              Priority order: real month → app-wide override → project override.
            </p>
          </section>

          <section class="pma-card">
            <div class="pma-card__head">
              <div class="pma-card__titles">
                <div class="pma-kicker">Project override</div>
                <div class="pma-heading">Simulate a specific month for this project</div>
              </div>
              <button
                v-if="selectedProjectMonth"
                type="button"
                class="pma-ghost-btn"
                :disabled="!canEdit || isSaving"
                @click="selectedProjectMonth = ''"
              >
                <i class="mdi mdi-close-circle-outline"></i>
                Clear
              </button>
            </div>

            <label class="pma-field">
              <span class="pma-field-label">Simulated month</span>
              <Select
                v-model="selectedProjectMonth"
                :options="[{ value: '', label: 'Inherit backend month' }, ...monthOptions]"
                option-label="label"
                option-value="value"
                placeholder="Select a month"
                filter
                :disabled="!canEdit || isSaving"
                class="form-ctrl pma-select"
              />
            </label>

            <div class="pma-actions">
              <ActionBtn
                label="Save month override"
                variant="primary"
                :loading="isSaving"
                :disabled="!canEdit || isSaving || !dirty"
                :onClick="saveMonthSimulation"
              />
            </div>
          </section>
        </TabPanel>

        <!-- Audit (TODO) -->
        <TabPanel value="audit" class="pma-content">
          <div class="pma-todo">
            <i class="mdi mdi-tools pma-todo__icon"></i>
            <div class="pma-todo__text">
              <div class="pma-todo__title">Audit log</div>
              <div class="pma-todo__sub">Coming soon — this section is not yet implemented.</div>
            </div>
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </SlidingDrawer>
</template>

<style scoped>
/* ── Title ── */
.pma-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-h);
}

.pma-title__icon {
  font-size: 20px;
  color: var(--accent);
  flex-shrink: 0;
}

/* ── PrimeVue Tabs overrides ── */
.pma-tabs {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1rem;
}

:deep(.p-tabs) {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
}

:deep(.p-tablist) {
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-strong);
  margin-bottom: 0.5rem;
}

:deep(.p-tablist-content) {
  overflow: visible;
}

:deep(.p-tablist-tab-list) {
  border: none;
  background: transparent;
  gap: 0;
}

:deep(.p-tab) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  margin-bottom: -1px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    color 0.14s,
    background 0.14s;
}

:deep(.p-tab:not(.p-tab-active):not(.p-disabled):hover),
:deep(.p-tab:not(.p-tab-active):hover) {
  background: var(--surface-2);
  color: var(--text-h) !important;
  border-bottom-color: transparent;
}

:deep(.p-tab.p-tab-active) {
  color: var(--accent);
  font-weight: 600;
  background: transparent;
  border-bottom-color: var(--accent);
}

:deep(.p-tab:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

:deep(.p-tablist-active-bar) {
  display: none;
}

:deep(.p-tabpanels) {
  padding: 0;
  background: transparent;
  flex: 1;
  overflow: hidden;
}

:deep(.p-tabpanel) {
  padding: 0;
  height: 100%;
  overflow-y: auto;
}

/* ── Content area ── */
.pma-content {
  display: grid;
  gap: 12px;
  padding: 16px;
}

/* ── Cards ── */
.pma-card {
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  background: var(--surface-1);
  padding: 16px;
  display: grid;
  gap: 14px;
}

.pma-card--highlight {
  margin-bottom: 0.75rem;
  background:
    radial-gradient(
      ellipse at top right,
      color-mix(in srgb, var(--accent) 7%, transparent),
      transparent 55%
    ),
    var(--surface-1);
  border-color: color-mix(in srgb, var(--accent) 20%, var(--border-strong));
}

.pma-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.pma-kicker {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 700;
  color: var(--text);
  opacity: 0.7;
  margin-bottom: 3px;
}

.pma-heading {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-h);
}

/* ── Badge ── */
.pma-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.pma-badge--accent {
  background: var(--accent-bg);
  color: var(--accent);
  border: 1px solid var(--accent-border);
}

.pma-badge--warn {
  background: color-mix(in srgb, var(--yellow, #f59e0b) 12%, transparent);
  color: var(--yellow, #f59e0b);
  border: 1px solid color-mix(in srgb, var(--yellow, #f59e0b) 30%, transparent);
}

.pma-badge--neutral {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border-strong);
}

/* ── Month grid ── */
.pma-month-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.pma-month-cell {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  display: grid;
  gap: 3px;
}

.pma-month-cell--effective {
  background: var(--accent-bg);
  border-color: var(--accent-border);
}

.pma-month-cell__label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  color: var(--text);
  opacity: 0.65;
}

.pma-month-cell__value {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-h);
  line-height: 1.2;
}

.pma-month-cell--effective .pma-month-cell__value {
  color: var(--accent);
}

/* ── Note ── */
.pma-note {
  margin: 0;
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  opacity: 0.8;
}

/* ── Field ── */
.pma-field {
  display: grid;
  gap: 6px;
}

.pma-field-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text);
  opacity: 0.8;
}

.pma-select {
  width: 100%;
}

/* ── Actions ── */
.pma-actions {
  display: flex;
  justify-content: flex-end;
}

/* ── Ghost button ── */
.pma-ghost-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.14s,
    border-color 0.14s,
    color 0.14s;
}

.pma-ghost-btn:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text-h);
}

.pma-ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pma-ghost-btn .mdi {
  font-size: 14px;
}

/* ── Audit TODO ── */
.pma-todo {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 24px;
  border: 1.5px dashed var(--border-strong);
  border-radius: 14px;
  background: var(--surface-2);
}

.pma-todo__icon {
  font-size: 22px;
  color: var(--text);
  opacity: 0.4;
  flex-shrink: 0;
  margin-top: 2px;
}

.pma-todo__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-h);
  margin-bottom: 4px;
}

.pma-todo__sub {
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
}

/* ── Responsive ── */
@media (max-width: 520px) {
  .pma-month-grid {
    grid-template-columns: 1fr;
  }

  .pma-card__head {
    flex-direction: column;
  }
}

.project-month-admin-handle {
  position: fixed;
  top: 40%;
  right: 0;
  transform: translateY(-50%);
  z-index: 1870;
  width: 30px;
  min-height: 84px;
  padding: 10px 8px;
  border: 1px solid #cfcfcf;
  border-right: none;
  border-radius: 8px 0 0 8px;
  background: #efefef;
  color: #1f1f1f;
  box-shadow: -8px 0 18px rgba(15, 23, 42, 0.12);
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
}
.project-month-admin-handle-icon {
  width: 20px;
  height: 24px;
  font-size: 16px;
  transform: rotate(-90deg);
}
.project-month-admin-handle-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  line-height: 1;
}
.project-month-admin-handle:hover {
  background: #e2e2e2;
  border-color: #b9b9b9;
  color: #111111;
}
:root[data-theme='dark'] .project-month-admin-handle,
html[data-theme='dark'] .project-month-admin-handle,
body.dark .project-month-admin-handle,
.v-theme--dark .project-month-admin-handle {
  border-color: #616161;
  background: #2a2a2a;
  color: #f4f4f4;
}
:root[data-theme='dark'] .project-month-admin-handle:hover,
html[data-theme='dark'] .project-month-admin-handle:hover,
body.dark .project-month-admin-handle:hover,
.v-theme--dark .project-month-admin-handle:hover {
  background: #353535;
  border-color: #767676;
  color: #ffffff;
}
</style>
