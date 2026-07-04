<script setup>
import Select from 'primevue/select'

const props = defineProps({
  skeleton: { type: Boolean, default: false },
  phase: { type: Object, default: () => ({}) },
  bulkEditMode: { type: Boolean, default: false },
  showPhaseRowErrors: { type: Boolean, default: false },
  phaseTableGridColumns: {
    type: String,
    default: '280px 260px 220px 220px 120px 130px',
  },
  isDraftPhaseDirty: { type: Function, default: () => false },
  isPhaseRowValid: { type: Function, default: () => true },
  phaseKey: { type: Function, default: () => '' },
  isExistingPhaseLockedForNonDraft: { type: Function, default: () => false },
  handlePhaseFieldChange: { type: Function, default: () => {} },
  milestoneOptionsForPhase: { type: Function, default: () => [] },
  departmentOptionsForPhase: { type: Function, default: () => [] },
  removeBulkDraftPhase: { type: Function, default: () => {} },
  requestDeleteExistingPhase: { type: Function, default: () => {} },
  formatMoney: { type: Function, default: () => '—' },
})
</script>

<template>
  <article
    v-if="props.skeleton"
    class="phase-row phase-row--skeleton"
    :style="{ gridTemplateColumns: phaseTableGridColumns }"
    aria-hidden="true"
  >
    <div class="sk phase-sk--lg"></div>
    <div class="sk"></div>
    <div class="sk"></div>
    <div class="sk phase-sk--md"></div>
    <div class="sk phase-sk--sm"></div>
    <div class="sk phase-sk--sm"></div>
  </article>
  <article
    v-else
    class="phase-row"
    :class="{
      'phase-row--dirty': bulkEditMode && isDraftPhaseDirty(phase),
      'phase-row--error': showPhaseRowErrors && !isPhaseRowValid(phase),
    }"
    :style="{ gridTemplateColumns: phaseTableGridColumns }"
  >
    <div class="phase-col">
      <template v-if="bulkEditMode">
        <div class="phase-inline-name">
          <button
            v-if="String(phaseKey(phase) || '').startsWith('tmp-')"
            type="button"
            class="phase-inline-remove"
            title="Remove row"
            aria-label="Remove row"
            @click="removeBulkDraftPhase(phase)"
          >
            <i class="mdi mdi-trash-can-outline"></i>
          </button>
          <button
            v-else
            type="button"
            class="phase-inline-remove"
            title="Delete phase"
            aria-label="Delete phase"
            @click="requestDeleteExistingPhase(phase)"
          >
            <i class="mdi mdi-trash-can-outline"></i>
          </button>
          <input
            class="phase-inline-input"
            :value="phase.name"
            :disabled="isExistingPhaseLockedForNonDraft(phase)"
            :title="
              isExistingPhaseLockedForNonDraft(phase)
                ? 'Only quantity and rate can be edited once the project is no longer Draft.'
                : ''
            "
            @input="handlePhaseFieldChange(phase, 'name', $event.target.value)"
          />
        </div>
      </template>
      <div v-else class="phase-name">{{ phase.name }}</div>
    </div>
    <div class="phase-col phase-milestones">
      <template v-if="bulkEditMode">
        <Select
          class="phase-inline-select"
          :model-value="
            phase.milestoneId && (phase.milestoneDesc || phase.milestone || phase.serviceItem)
              ? `${String(phase.milestoneId)}|||${String(phase.milestoneDesc || phase.milestone || phase.serviceItem)}`
              : ''
          "
          :options="milestoneOptionsForPhase(phase)"
          option-label="label"
          option-value="value"
          placeholder="Select"
          filter
          :disabled="isExistingPhaseLockedForNonDraft(phase)"
          @update:model-value="(value) => handlePhaseFieldChange(phase, 'milestoneId', value)"
        />
      </template>
      <div v-else>{{ phase.milestone || phase.serviceItem || '—' }}</div>
    </div>
    <div class="phase-col">
      <template v-if="bulkEditMode">
        <Select
          class="phase-inline-select"
          :model-value="phase.departmentId != null ? String(phase.departmentId) : ''"
          :options="departmentOptionsForPhase(phase)"
          option-label="label"
          option-value="value"
          placeholder="Select"
          filter
          :disabled="isExistingPhaseLockedForNonDraft(phase)"
          @update:model-value="(value) => handlePhaseFieldChange(phase, 'departmentId', value)"
        />
      </template>
      <div v-else class="phase-dept">{{ phase.department || '—' }}</div>
    </div>
    <div class="phase-col phase-allocation">
      <div v-if="!bulkEditMode" class="alloc-amount">${{ phase.totalAmount ?? '—' }}</div>
      <div class="alloc-meta" :class="{ 'alloc-meta--edit': bulkEditMode }">
        <template v-if="bulkEditMode">
          Qty
          <input
            class="phase-inline-num"
            type="number"
            step="1"
            :value="phase.definedQty ?? ''"
            @input="handlePhaseFieldChange(phase, 'definedQty', $event.target.value)"
          />
          Rate
          <input
            class="phase-inline-num"
            type="number"
            step="0.01"
            :value="phase.rate ?? ''"
            @input="handlePhaseFieldChange(phase, 'rate', $event.target.value)"
          />
        </template>
        <template v-else>Qty {{ phase.definedQty ?? '—' }} @ ${{ phase.rate ?? '—' }}</template>
      </div>
    </div>
    <div class="phase-col phase-qty-total phase-qty-total--actual">
      {{ formatMoney(phase.totalActualAmount) }}
    </div>
    <div class="phase-col phase-qty-total">
      {{ formatMoney(phase.totalForecastAmount) }}
    </div>
  </article>
</template>

<style scoped>
.phase-row {
  position: relative;
  display: grid;
  gap: 14px;
  align-items: center;
  padding: 16px 18px;
  border: 1px solid var(--border-strong, #eef2ea);
  border-radius: 16px;
  background: var(--surface-1, #ffffff);
  box-shadow: var(--shadow, 0 6px 18px rgba(15, 23, 42, 0.06));
}
.phase-row--dirty {
  border-color: rgb(97 127 147 / 50%);
  background: rgb(89 134 180 / 10%);
}
.phase-row--error {
  border-color: rgb(205 27 27 / 47%);
  background: rgb(201 43 43 / 3%);
}
.phase-row--skeleton {
  box-shadow: none;
}
.phase-row {
  width: max-content;
  min-width: 100%;
}
.phase-sk--lg {
  height: 22px;
  width: 85%;
}
.phase-sk--md {
  width: 70%;
}
.phase-sk--sm {
  width: 78%;
}
.phase-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-h, #1f2b1f);
}
.phase-dept,
.phase-milestones {
  font-size: 12px;
  color: var(--text-h, #1f2b1f);
}
.phase-allocation {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.alloc-amount {
  font-weight: 700;
  font-size: 16px;
  color: var(--accent);
}
.alloc-meta {
  font-size: 11px;
  color: var(--text, #6b7280);
  line-height: normal;
}
.alloc-meta--edit {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  white-space: nowrap;
}
.phase-qty-total {
  font-size: 12px;
  color: var(--text-h, #1f2b1f);
  font-weight: 500;
  width: fit-content;
  background: var(--border-strong, #e7eee1);
  padding: 1px 10px;
  border-radius: 5px;
}
.phase-qty-total--actual {
  color: #0f7a55;
  background: rgba(0, 165, 106, 0.14);
  border: 1px solid rgba(0, 165, 106, 0.28);
}
:global(:root[data-theme='dark'] .phase-qty-total--actual),
:global(html[data-theme='dark'] .phase-qty-total--actual),
:global(body.dark .phase-qty-total--actual),
:global(.v-theme--dark .phase-qty-total--actual) {
  color: #6ee7b7;
  background: rgba(16, 185, 129, 0.22);
  border-color: rgba(110, 231, 183, 0.32);
}
.phase-inline-input,
.phase-inline-select,
.phase-inline-num {
  width: 100%;
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--border-strong, #e1e6dc);
  padding: 0 10px;
  font-size: 13px;
  color: var(--text-h, #243224);
  background: var(--surface-2, #f7fafc);
  box-shadow: none;
}
.phase-inline-input:disabled,
.phase-inline-num:disabled {
  background: var(--surface-3, #f3f4f6);
  border-style: dashed;
  border-color: var(--border-strong, #d5dbe3);
  color: var(--text, #8b95a1);
  cursor: not-allowed;
}
.phase-inline-input:disabled::placeholder,
.phase-inline-num:disabled::placeholder {
  color: var(--text, #9ca3af);
}
.phase-inline-name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.phase-inline-remove {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--border-strong, #e1e6dc);
  background: var(--surface-2, #f7fafc);
  color: var(--text, #6b7280);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.phase-inline-remove:hover {
  border-color: rgba(220, 38, 38, 0.55);
  color: rgba(220, 38, 38, 0.95);
}
.phase-inline-remove .mdi {
  font-size: 18px;
}
.phase-inline-select {
  padding: 0 0 0 10px;
}
:deep(.phase-inline-select.p-select) {
  align-items: center;
}
:deep(.phase-inline-select.p-select.p-disabled) {
  opacity: 1;
  background: var(--surface-3, #f3f4f6);
  border-style: dashed;
  border-color: var(--border-strong, #d5dbe3);
  cursor: not-allowed;
}
:deep(.phase-inline-select.p-select.p-disabled .p-select-label) {
  color: var(--text, #8b95a1);
}
:deep(.phase-inline-select.p-select.p-disabled .p-select-dropdown) {
  color: var(--text, #9ca3af);
}
:deep(.phase-inline-select.p-select .p-select-label) {
  padding: 0;
  display: flex;
  align-items: center;
  height: 100%;
  line-height: 1;
  font-size: 12px;
  color: var(--text-h, #243224);
}
:deep(.phase-inline-select.p-select .p-select-label.p-placeholder) {
  color: var(--text, #6b7280);
}
:deep(.phase-inline-select.p-select:focus-within) {
  border-color: var(--accent, #00a56a);
}
:deep(.phase-inline-select.p-select.p-disabled:focus-within) {
  border-color: var(--border-strong, #d5dbe3);
}
:deep(.phase-inline-select.p-select .p-select-dropdown) {
  color: var(--text, #6b7768);
  display: flex;
  align-items: center;
  max-width: 30px;
}
:deep(.phase-inline-select.p-select .p-select-dropdown svg) {
  width: 12px;
  height: 12px;
  margin-top: 2px;
}
.phase-inline-num {
  width: 74px;
  padding: 0 8px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
