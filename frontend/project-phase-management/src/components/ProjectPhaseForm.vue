<script setup>
import { computed, reactive, watch } from 'vue'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import { useProjectsStore } from '@/stores/projects'

const props = defineProps({
  phase: { type: Object, default: null },
  saving: { type: Boolean, default: false },
})

const emit = defineEmits(['save', 'cancel'])

const projectsStore = useProjectsStore()

const form = reactive({
  name: '',
  departmentId: '',
  department: '',
  milestoneKey: '',
  milestoneId: '',
  milestoneDesc: '',
  statusId: '',
  status: '',
  definedQty: null,
  rate: null,
})

let isHydrating = false

const departmentOptions = computed(() => {
  const rows = Array.isArray(projectsStore.phaseLookups.departments)
    ? projectsStore.phaseLookups.departments
    : []

  const opts = rows
    .map((d) => ({
      value: d?.id != null ? String(d.id) : '',
      label: d?.name || 'Unassigned',
    }))
    .filter((o) => o.label)

  if (form.departmentId && !opts.some((o) => o.value === String(form.departmentId))) {
    opts.unshift({ value: String(form.departmentId), label: form.department || 'Unassigned' })
  }

  return opts
})

const milestoneOptionsAll = computed(() => {
  // Backward compatible:
  // - New backend returns `phaseLookups.milestones` (global milestone list).
  // - Older backend only returns `milestonesByDept`.
  const rows =
    Array.isArray(projectsStore.phaseLookups.milestones) &&
    projectsStore.phaseLookups.milestones.length
      ? projectsStore.phaseLookups.milestones
      : []

  let derived = rows
  if (!derived.length) {
    const map = projectsStore.phaseLookups.milestonesByDept || {}
    const merge = {}
    Object.keys(map).forEach((deptKey) => {
      const list = Array.isArray(map[deptKey]) ? map[deptKey] : []
      list.forEach((it) => {
        const key = it?.key != null ? String(it.key) : ''
        const label = it?.label || it?.desc || ''
        const itemId = it?.itemId != null ? String(it.itemId) : ''
        const desc = it?.desc || it?.label || ''
        if (!key || !label) return
        if (!merge[key]) merge[key] = { key, label, itemId, desc, departments: [] }
        if (!merge[key].departments.some((d) => String(d?.id || '') === String(deptKey || ''))) {
          merge[key].departments.push({ id: deptKey || null, name: '' })
        }
      })
    })
    derived = Object.values(merge)
  }

  const opts = derived
    .map((m) => ({
      key: m?.key != null ? String(m.key) : '',
      label: m?.label || m?.desc || '',
      itemId: m?.itemId != null ? String(m.itemId) : '',
      desc: m?.desc || m?.label || '',
    }))
    .filter((o) => o.key && o.label)

  if (form.milestoneKey && !opts.some((o) => o.key === String(form.milestoneKey))) {
    const desc = form.milestoneDesc || ''
    const itemId = form.milestoneId || ''
    if (desc && itemId) {
      opts.unshift({
        key: `${String(itemId)}|||${desc}`,
        label: desc,
        itemId: String(itemId),
        desc,
      })
    }
  }

  return opts
})

const milestoneOptions = computed(() => {
  // Milestones are NOT dependent on department; always show the full list.
  const opts = milestoneOptionsAll.value.slice()

  if (form.milestoneKey && !opts.some((o) => o.key === String(form.milestoneKey))) {
    const desc = form.milestoneDesc || ''
    const itemId = form.milestoneId || ''
    if (desc && itemId) {
      opts.unshift({
        key: `${String(itemId)}|||${desc}`,
        label: desc,
        itemId: String(itemId),
        desc,
      })
    }
  }

  return opts
})
const phaseStatusOptions = computed(() => {
  const rows = Array.isArray(projectsStore.initData.statuses?.projectPhases)
    ? projectsStore.initData.statuses.projectPhases
    : []
  return rows
    .map((s) => ({ value: s?.id != null ? String(s.id) : '', label: s?.name || '' }))
    .filter((o) => o.value && o.label)
})

const pendingStatusId = computed(() => {
  const row = phaseStatusOptions.value.find((s) => String(s.label).toLowerCase() === 'pending')
  return row?.value || ''
})

const canSubmit = computed(() => {
  const nameOk = Boolean(String(form.name || '').trim())
  const milestoneOk = Boolean(String(form.milestoneKey || '').trim())
  const deptOk = Boolean(String(form.departmentId || '').trim())

  const qtyOk =
    form.definedQty != null && Number.isFinite(Number(form.definedQty)) && Number(form.definedQty) > 0
  const rateOk =
    form.rate != null && Number.isFinite(Number(form.rate)) && Number(form.rate) > 0

  return nameOk && milestoneOk && deptOk && qtyOk && rateOk && !props.saving
})

const deptLabelById = computed(() => {
  const map = {}
  departmentOptions.value.forEach((o) => {
    if (!o.value) return
    map[String(o.value)] = o.label
  })
  return map
})
const statusLabelById = computed(() => {
  const map = {}
  phaseStatusOptions.value.forEach((o) => {
    map[String(o.value)] = o.label
  })
  return map
})

const allocationValue = computed(() => {
  const qty = Number(form.definedQty)
  const rate = Number(form.rate)
  if (!Number.isFinite(qty) || !Number.isFinite(rate)) return null
  const total = qty * rate
  return Number.isFinite(total) ? total : null
})

watch(
  () => pendingStatusId.value,
  (value) => {
    if (!value) return
    if (!props.phase?.id && !form.statusId) {
      form.statusId = value
    }
  },
  { immediate: true },
)

watch(
  () => form.departmentId,
  (value) => {
    if (isHydrating) return
    form.department = value ? deptLabelById.value[String(value)] || 'Unassigned' : ''
  },
)

  watch(
    () => form.milestoneKey,
    (value) => {
      if (isHydrating) return
      const key = value != null ? String(value) : ''
      const opt = milestoneOptions.value.find((o) => String(o.key) === key) || null
      form.milestoneId = opt?.itemId ? String(opt.itemId) : ''
      form.milestoneDesc = opt?.desc ? String(opt.desc) : ''
    },
  )

watch(
  () => form.statusId,
  (value) => {
    if (isHydrating) return
    form.status = value ? statusLabelById.value[String(value)] || '' : ''
  },
)

watch(
  () => props.phase,
  (value) => {
    isHydrating = true
    form.name = value?.name ?? ''
    form.departmentId = value?.departmentId != null ? String(value.departmentId) : ''
    form.department = value?.department ?? ''
    form.milestoneId = value?.milestoneId != null ? String(value.milestoneId) : ''
    form.milestoneDesc = value?.milestoneDesc ?? value?.milestone ?? value?.serviceItem ?? ''
    form.milestoneKey =
      form.milestoneId && form.milestoneDesc ? `${form.milestoneId}|||${form.milestoneDesc}` : ''
    form.statusId =
      value?.statusId != null ? String(value.statusId) : (pendingStatusId.value || '')
    form.status = value?.status ?? 'Pending'
    const defaultQty = value?.id ? null : 1
    form.definedQty = value?.definedQty ?? defaultQty
    form.rate = value?.rate ?? null
    Promise.resolve().then(() => {
      isHydrating = false
    })
  },
  { immediate: true },
)

function submit() {
  if (!canSubmit.value) return
  emit('save', {
    ...form,
    departmentId: form.departmentId || null,
    milestoneId: form.milestoneId || null,
    milestoneDesc: form.milestoneDesc || null,
    statusId: form.statusId || pendingStatusId.value || null,
    id: props.phase?.id,
  })
}
</script>

<template>
  <form class="phase-form" @submit.prevent="submit">
    <div class="phase-section">
      <div class="phase-section-title">01 Identification</div>
      <label class="phase-field full">
        <span>Phase name</span>
        <InputText
          v-model="form.name"
          placeholder="e.g., Structural Foundation Review"
          class="form-ctrl"
          required
        />
      </label>
      <label class="phase-field">
        <span>Milestone</span>
        <Select
          v-model="form.milestoneKey"
          :options="milestoneOptions"
          option-label="label"
          option-value="key"
          placeholder="Select milestone"
          class="form-ctrl"
          filter
        />
      </label>
      <label class="phase-field">
        <span>Department</span>
        <Select
          v-model="form.departmentId"
          :options="departmentOptions"
          option-label="label"
          option-value="value"
          placeholder="Select department"
          class="form-ctrl"
          filter
        />
      </label>
    </div>

    <div class="phase-section">
      <div class="phase-section-title">02 Finance</div>
      <label class="phase-field">
        <span>Status</span>
        <Select
          v-model="form.statusId"
          :options="phaseStatusOptions"
          option-label="label"
          option-value="value"
          placeholder="Select status"
          class="form-ctrl form-ctrl--readonly"
          filter
          disabled
        />
      </label>
      <label class="phase-field">
        <span>Quantity</span>
        <InputNumber
          v-model="form.definedQty"
          :min="1"
          :min-fraction-digits="0"
          :max-fraction-digits="2"
          placeholder="1.00"
          class="form-ctrl"
        />
      </label>
      <label class="phase-field">
        <span>Rate</span>
        <InputNumber
          v-model="form.rate"
          :min="0.01"
          mode="currency"
          currency="USD"
          locale="en-US"
          placeholder="$ 0.00"
          class="form-ctrl"
        />
      </label>
      <label class="phase-field">
        <span>Phase Total</span>
        <InputNumber
          :model-value="allocationValue"
          mode="currency"
          currency="USD"
          locale="en-US"
          placeholder="$ 0.00"
          class="form-ctrl form-ctrl--readonly"
          disabled
        />
      </label>
    </div>

    <div class="phase-actions">
      <button type="button" class="phase-btn ghost" @click="emit('cancel')">Cancel</button>
      <button
        type="submit"
        class="phase-btn primary"
        :disabled="saving || !canSubmit"
        :title="canSubmit ? '' : 'Please fill all fields. Quantity and rate must be greater than 0.'"
      >
        {{ saving ? 'Saving…' : 'Save Phase' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.phase-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.phase-section {
  border-top: 1px solid var(--border-strong, #eef2ea);
  padding-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}
.phase-section:first-of-type {
  border-top: none;
  padding-top: 0;
}
.phase-section-title {
  grid-column: 1 / -1;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent, #00a56a);
  font-weight: 700;
}

.phase-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  color: var(--text, #5b6b5b);
}
.phase-field.full {
  grid-column: 1 / -1;
}

:deep(.p-select-overlay) {
  border-radius: 12px;
  border: 1px solid var(--border-strong, #e1e6dc);
  background: var(--surface-1, #ffffff) !important;
  color: var(--text-h, #243224);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
}
:deep(.p-select-list-container),
:deep(.p-select-list) {
  background: var(--surface-1, #ffffff) !important;
  padding: 6px 0;
}
:deep(.p-select-option) {
  font-size: 13px;
  color: var(--text-h, #243224);
  padding: 8px 12px;
}
:deep(.p-select-option-label) {
  font-size: 13px;
}
:deep(.p-select-option.p-highlight) {
  background: var(--accent-bg, #e8f6ef);
  color: var(--text-h, #1f2b1f);
}
:deep(.p-select-filter-container) {
  padding: 8px 10px 6px;
}
:deep(.p-select-filter) {
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--border-strong, #e1e6dc);
  padding: 0 32px 0 10px;
  font-size: 13px;
  color: var(--text-h, #243224);
  background: var(--surface-2, #f7fafc) !important;
}
:deep(.p-select-filter-icon) {
  color: var(--text, #6b7768);
}

.phase-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}

.phase-btn {
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
}
.phase-btn.primary {
  background: var(--dark);
  color: #ffffff;
}
.phase-btn.ghost {
  background: var(--surface-2, #ffffff);
  border-color: var(--border-strong, #e1e6dc);
  color: var(--text-h, #1f2b1f);
}
</style>
