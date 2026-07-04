<script setup>
import { computed, ref } from 'vue'
import ExcelTable from '@/components/ExcelTable.vue'
import UnlockIcon from '@/components/icons/UnlockIcon.vue'
import LockIcon from '@/components/icons/LockIcon.vue'
import CheckAllIcon from '@/components/icons/CheckAllIcon.vue'
import AlertCircleIcon from '@/components/icons/AlertCircleIcon.vue'
import { calculateRemainingQty, cumulativeActualQtyAtIndex } from '@/util'
import { createRevPlanExporter } from '@/services/revPlanXLSX'

const props = defineProps({
  project: { type: Object, default: null },
  showSkeleton: { type: Boolean, default: false },
  monthColumns: { type: Array, default: () => [] },
  planStatusById: { type: Object, default: () => ({}) },
  rows: { type: Array, default: () => [] },
  canEditLines: { type: Boolean, default: false },
  isPostJournalState: { type: Boolean, default: false },
  showExport: { type: Boolean, default: true },
  onUploadClick: { type: Function, default: null },
})

const emit = defineEmits(['table-change'])
const tableWrapRef = ref(null)
const focusedRow = ref(null)
const monthStatusTooltip = ref({
  visible: false,
  text: '',
  top: 0,
  left: 0,
})
const skeletonMonths = computed(() => Array.from({ length: 6 }, (_, i) => `sk-${i}`))
const exportRevPlanData = createRevPlanExporter(() => ({
  filename: `${String(props.project?.name || 'project-rev-plans').trim() || 'project-rev-plans'}-rev-plans.xlsx`,
  rows: props.rows,
  monthColumns: props.monthColumns,
  canEditLines: props.canEditLines,
  isPostJournalState: props.isPostJournalState,
  planStatusById: props.planStatusById,
}))

function remainingQtyForRow(row) {
  return calculateRemainingQty(row, props.monthColumns)
}

function cumulativeQtyAt(index) {
  return cumulativeActualQtyAtIndex(props.rows, props.monthColumns, index)
}

function revenueReadyForRow(row) {
  const rate = Number(row?.rate || 0)
  if (!Number.isFinite(rate) || rate <= 0) return 0
  const months = row?.months && typeof row.months === 'object' ? row.months : {}
  const planIds = row?.planIds && typeof row.planIds === 'object' ? row.planIds : {}
  const currentMonthIndex = props.monthColumns.findIndex((m) => Boolean(m?.isCurrent))
  if (currentMonthIndex < 0) return 0
  const readyMonthKeys = props.monthColumns
    .slice(0, currentMonthIndex + 1)
    .map((m) => m.key)
    .filter(Boolean)

  return readyMonthKeys.reduce((sum, key) => {
    const ids = Array.isArray(planIds?.[key]) ? planIds[key] : []
    const id = ids.length ? String(ids[0] || '') : ''
    const statusKey = String(props.planStatusById?.[id]?.status?.key || '')
      .trim()
      .toLowerCase()
    const isReadyStatus = statusKey === 'open' || statusKey === 'rev_rec_ready'
    if (!isReadyStatus) return sum
    const qty = Number(months?.[key] || 0)
    return sum + (Number.isFinite(qty) ? qty : 0) * rate
  }, 0)
}

function revenueReadyForRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  return list.reduce((sum, row) => sum + revenueReadyForRow(row), 0)
}

function getRevenueReadyTotal() {
  return revenueReadyForRows(props.rows)
}

function hasMissingRevPlansDetected() {
  return props.rows.some(
    (row) => Array.isArray(row?.missingMonthKeys) && row.missingMonthKeys.length > 0,
  )
}

function cellMissing(row, month) {
  const key = String(month?.key || '').trim()
  if (!key) return false
  const missingKeys = Array.isArray(row?.missingMonthKeys) ? row.missingMonthKeys : []
  return missingKeys.includes(key)
}

function isMonthEditable(month) {
  if (!props.canEditLines) return false
  const type = String(month?.type || '')
    .trim()
    .toLowerCase()
  if (props.isPostJournalState && type === 'actual') return false
  if (Boolean(month?.isLockedForEdit)) return false
  return true
}

function monthEditable(row, month) {
  if (!isMonthEditable(month)) return false
  const key = String(month?.key || '')
  if (!key) return false
  const ids = Array.isArray(row?.planIds?.[key]) ? row.planIds[key].filter(Boolean).map(String) : []
  if (!ids.length) return false
  const hasLockedPlan = ids.some((id) => Boolean(props.planStatusById?.[id]?.isLockedForEdit))
  if (hasLockedPlan) return false
  return true
}

function buildUpdateRevenuePlansPhasesData() {
  const months = Array.isArray(props.monthColumns) ? props.monthColumns : []
  const rows = Array.isArray(props.rows) ? props.rows : []

  return rows.map((row) => {
    const phaseId = String(row?.phaseId || '')
    if (!phaseId) throw new Error('Missing phaseId in revenue row')

    const plans = months
      .filter((m) => monthEditable(row, m))
      .map((m) => {
        const key = String(m?.key || '')
        const ids = row?.planIds?.[key]
        const idList = Array.isArray(ids) ? ids.filter(Boolean).map(String) : []
        if (idList.length !== 1) {
          throw new Error(
            `Unable to resolve a single revenue plan id for phase ${phaseId} (${key}).`,
          )
        }
        return {
          planId: idList[0],
          quantity: Number(row?.months?.[key]) || 0,
        }
      })

    return {
      phaseId,
      plans,
      note: String(row?.notes || ''),
      contingency: Number(row?.contingency || 0),
    }
  })
}

function getBadAllocationCount() {
  const rows = Array.isArray(props.rows) ? props.rows : []
  if (!rows.length) return 0
  return rows.reduce((count, row) => {
    const remaining = remainingQtyForRow(row)
    const isBad = Math.abs(Number(remaining || 0)) > 0.0001
    return isBad ? count + 1 : count
  }, 0)
}

function hasBadAllocation() {
  return getBadAllocationCount() > 0
}

function getAllocationValidation({ hasUnsavedChanges } = {}) {
  const unsaved = Boolean(hasUnsavedChanges)
  const badCount = getBadAllocationCount()
  const hasBad = badCount > 0
  return {
    badAllocationCount: badCount,
    hasBadAllocation: hasBad,
    canSaveAllocation: Boolean(props.canEditLines) && unsaved && !hasBad,
  }
}

defineExpose({
  revenueReadyForRow,
  revenueReadyForRows,
  getRevenueReadyTotal,
  hasMissingRevPlansDetected,
  buildUpdateRevenuePlansPhasesData,
  getBadAllocationCount,
  hasBadAllocation,
  getAllocationValidation,
})

const remainingQty = computed(() => {
  if (!focusedRow.value) return null
  return remainingQtyForRow(focusedRow.value)
})

const remainingStatus = computed(() => {
  if (!focusedRow.value || remainingQty.value == null) return null
  const defined = Number(focusedRow.value.qty) || 0
  if (remainingQty.value < -0.0001 || remainingQty.value > defined + 0.0001) return 'bad'
  if (Math.abs(remainingQty.value) <= 0.0001) return 'ok'
  if (Math.abs(remainingQty.value - defined) <= 0.0001) return 'empty'
  return 'pending'
})

function statusClass(row) {
  const remaining = remainingQtyForRow(row)
  const defined = Number(row?.qty) || 0
  if (Math.abs(remaining - defined) <= 0.0001) return 'excel-col-status--empty'
  if (remaining < -0.0001 || remaining > defined + 0.0001) return 'excel-col-status--bad'
  if (Math.abs(remaining) <= 0.0001) return 'excel-col-status--ok'
  return 'excel-col-status--pending'
}

function statusTitle(row) {
  const remaining = remainingQtyForRow(row)
  const defined = Number(row?.qty) || 0
  if (remaining < -0.0001 || remaining > defined + 0.0001) return 'Over allocated'
  if (Math.abs(remaining) <= 0.0001) return 'Complete'
  return 'Contingency must match remaining qty'
}

function statusIcon(row) {
  const remaining = remainingQtyForRow(row)
  const defined = Number(row?.qty) || 0
  if (remaining < -0.0001 || remaining > defined + 0.0001) return 'x'
  if (Math.abs(remaining) <= 0.0001) return '✓'
  return 'i'
}

function statusIconClass(row) {
  const remaining = remainingQtyForRow(row)
  const defined = Number(row?.qty) || 0
  if (remaining < -0.0001 || remaining > defined + 0.0001) return 'excel-phase-icon--bad'
  if (Math.abs(remaining) <= 0.0001) return 'excel-phase-icon--ok'
  return 'excel-phase-icon--pending'
}

function handleCellFocus(row) {
  focusedRow.value = row
}

function handleCellInput(row) {
  focusedRow.value = row
  emit('table-change')
}

function handleCellBlur() {
  setTimeout(() => {
    const active = document.activeElement
    if (!tableWrapRef.value || !tableWrapRef.value.contains(active)) {
      focusedRow.value = null
    }
  }, 0)
}

function monthStatusKey(month) {
  return String(month?.monthStatusKey || month?.statusKey || '')
    .trim()
    .toLowerCase()
}

function monthStatusTitle(month) {
  return String(month?.monthStatusLabel || '—').trim() || '—'
}

function monthStatusIcon(month) {
  const key = monthStatusKey(month)
  if (key === 'open') return UnlockIcon
  if (key === 'rev_rec_ready') return CheckAllIcon
  if (key === 'completed') return LockIcon
  if (key === 'mixed') return AlertCircleIcon
  return AlertCircleIcon
}

function showMonthStatusTooltip(event, month) {
  const target = event?.currentTarget
  if (!target || typeof target.getBoundingClientRect !== 'function') return
  const rect = target.getBoundingClientRect()
  monthStatusTooltip.value = {
    visible: true,
    text: monthStatusTitle(month),
    top: Math.max(8, rect.top - 10),
    left: rect.left + rect.width / 2,
  }
}

function hideMonthStatusTooltip() {
  monthStatusTooltip.value.visible = false
}
</script>

<template>
  <ExcelTable
    v-if="showSkeleton"
    :busy="true"
    wrap-class="excel-wrap--skeleton"
    table-class="excel-table--skeleton"
  >
    <thead>
      <tr class="excel-month-row">
        <th class="excel-sticky excel-col-status"><span class="sk sk-th"></span></th>
        <th class="excel-col-dept"><span class="sk sk-th"></span></th>
        <th class="excel-sticky excel-col-phase"><span class="sk sk-th"></span></th>
        <th class="excel-num"><span class="sk sk-th"></span></th>
        <th class="excel-num"><span class="sk sk-th"></span></th>
        <th class="excel-num"><span class="sk sk-th"></span></th>
        <th class="excel-col-notes"><span class="sk sk-th"></span></th>
        <th class="excel-num"><span class="sk sk-th"></span></th>
        <th class="excel-num"><span class="sk sk-th"></span></th>
        <th v-for="k in skeletonMonths" :key="k" class="excel-month">
          <span class="sk sk-th"></span>
        </th>
      </tr>
      <tr class="excel-sub-row">
        <th class="excel-sticky excel-col-status"><span class="sk sk-th sk-th--sm"></span></th>
        <th class="excel-col-dept"><span class="sk sk-th sk-th--sm"></span></th>
        <th class="excel-sticky excel-col-phase"><span class="sk sk-th sk-th--sm"></span></th>
        <th><span class="sk sk-th sk-th--sm"></span></th>
        <th><span class="sk sk-th sk-th--sm"></span></th>
        <th><span class="sk sk-th sk-th--sm"></span></th>
        <th class="excel-col-notes"><span class="sk sk-th sk-th--sm"></span></th>
        <th><span class="sk sk-th sk-th--sm"></span></th>
        <th><span class="sk sk-th sk-th--sm"></span></th>
        <th v-for="k in skeletonMonths" :key="`${k}-sub`" class="excel-month">
          <span class="sk sk-th sk-th--sm"></span>
        </th>
      </tr>
      <tr class="excel-sub-row">
        <th class="excel-sticky excel-col-status"><span class="sk sk-th sk-th--sm"></span></th>
        <th class="excel-col-dept"><span class="sk sk-th sk-th--sm"></span></th>
        <th class="excel-sticky excel-col-phase"><span class="sk sk-th sk-th--sm"></span></th>
        <th><span class="sk sk-th sk-th--sm"></span></th>
        <th><span class="sk sk-th sk-th--sm"></span></th>
        <th><span class="sk sk-th sk-th--sm"></span></th>
        <th class="excel-col-notes"><span class="sk sk-th sk-th--sm"></span></th>
        <th class="excel-sticky excel-col-cumm"><span class="sk sk-th sk-th--sm"></span></th>
        <th><span class="sk sk-th sk-th--sm"></span></th>
        <th v-for="k in skeletonMonths" :key="`${k}-type`" class="excel-month">
          <span class="sk sk-th sk-th--sm"></span>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="n in 6" :key="`row-${n}`">
        <td class="excel-sticky excel-col-status"><span class="sk sk-td sk-td--icon"></span></td>
        <td class="excel-col-dept"><span class="sk sk-td"></span></td>
        <td class="excel-sticky excel-col-phase"><span class="sk sk-td sk-td--wide"></span></td>
        <td class="excel-num"><span class="sk sk-td sk-td--num"></span></td>
        <td class="excel-num"><span class="sk sk-td sk-td--num"></span></td>
        <td class="excel-num"><span class="sk sk-td sk-td--num"></span></td>
        <td class="excel-col-notes"><span class="sk sk-td sk-td--input"></span></td>
        <td class="excel-num"><span class="sk sk-td sk-td--num"></span></td>
        <td class="excel-num"><span class="sk sk-td sk-td--input"></span></td>
        <td v-for="k in skeletonMonths" :key="`cell-${n}-${k}`" class="excel-month-cell">
          <span class="sk sk-td sk-td--input"></span>
        </td>
      </tr>
    </tbody>
  </ExcelTable>

  <ExcelTable
    v-else-if="project"
    :export-handler="exportRevPlanData"
    :show-export="showExport"
    :on-upload-click="onUploadClick"
  >
    <thead>
      <tr class="excel-month-row">
        <th class="excel-sticky excel-col-status"></th>
        <th class="excel-col-dept">Department</th>
        <th class="excel-sticky excel-col-phase">Phase details</th>
        <th class="excel-num">Qty</th>
        <th class="excel-num">Rate</th>
        <th class="excel-num">Total</th>
        <th class="excel-col-notes">Notes</th>
        <th class="excel-num excel-sticky excel-col-cumm">Cumm Act Qty</th>
        <th class="excel-num">Contingency</th>
        <th
          v-for="month in monthColumns"
          :key="month.key"
          class="excel-month"
          :class="[
            `excel-month--${month.monthStatusKey || month.statusKey}`,
            {
              'excel-month--current': month.isCurrent,
              'excel-month--actual': month.type === 'actual',
            },
          ]"
        >
          <span class="excel-month-header">
            <span>{{ month.label }}</span>
            <span
              class="excel-month-status-icon"
              :class="`is-${month.monthStatusKey || month.statusKey || 'none'}`"
              tabindex="0"
              @mouseenter="showMonthStatusTooltip($event, month)"
              @mouseleave="hideMonthStatusTooltip"
              @focus="showMonthStatusTooltip($event, month)"
              @blur="hideMonthStatusTooltip"
            >
              <component :is="monthStatusIcon(month)" />
            </span>
          </span>
        </th>
      </tr>
      <tr class="excel-sub-row">
        <th class="excel-sticky excel-col-status"></th>
        <th class="excel-col-dept"></th>
        <th class="excel-sticky excel-col-phase"></th>
        <th></th>
        <th></th>
        <th></th>
        <th class="excel-col-notes"></th>
        <th class="excel-sticky excel-col-cumm"></th>
        <th></th>
        <th
          v-for="month in monthColumns"
          :key="`${month.key}-type`"
          class="excel-month"
          :class="[
            `excel-month--${month.monthStatusKey || month.statusKey}`,
            {
              'excel-month--current': month.isCurrent,
              'excel-month--actual': month.type === 'actual',
            },
          ]"
        >
          {{ month.monthTypeLabel || month.statusLabel }}
        </th>
      </tr>
    </thead>
    <tbody ref="tableWrapRef">
      <tr v-for="(row, idx) in rows" :key="idx">
        <td class="excel-sticky excel-col-status" :class="statusClass(row)">
          <span
            v-if="remainingQtyForRow(row) !== Number(row.qty)"
            class="excel-phase-icon"
            :class="statusIconClass(row)"
            :title="statusTitle(row)"
          >
            {{ statusIcon(row) }}
          </span>
        </td>
        <td class="excel-col-dept">{{ row.department }}</td>
        <td class="excel-sticky excel-col-phase">{{ row.phase }}</td>
        <td class="excel-num">{{ row.qty }}</td>
        <td class="excel-num">{{ row.rate }}</td>
        <td class="excel-num">{{ row.total }}</td>
        <td class="excel-col-notes">
          <textarea
            v-model="row.notes"
            class="excel-notes"
            rows="1"
            placeholder="Add note..."
            :disabled="!canEditLines"
            @focus="handleCellFocus(row)"
            @input="handleCellInput(row)"
            @blur="handleCellBlur"
          ></textarea>
        </td>
        <td class="excel-num excel-sticky excel-col-cumm">{{ cumulativeQtyAt(idx) }}</td>
        <td class="excel-month-cell">
          <input
            v-model.number="row.contingency"
            type="number"
            class="excel-input"
            min="0"
            :disabled="!canEditLines"
            @focus="handleCellFocus(row)"
            @input="handleCellInput(row)"
            @blur="handleCellBlur"
          />
        </td>
        <td
          v-for="month in monthColumns"
          :key="`${idx}-${month.key}`"
          class="excel-month-cell"
          :class="[
            `excel-month--${month.statusKey}`,
            {
              'excel-month--current': month.isCurrent,
              'excel-month--actual': month.type === 'actual',
            },
          ]"
        >
          <span
            v-if="cellMissing(row, month)"
            class="excel-missing-cell-icon"
            title="Missing rev plan for this phase/month. Generate Revenue Plan to create it."
            >!</span
          >
          <input
            v-model.number="row.months[month.key]"
            type="number"
            class="excel-input"
            min="0"
            :disabled="!monthEditable(row, month)"
            @focus="handleCellFocus(row)"
            @input="handleCellInput(row)"
            @blur="handleCellBlur"
          />
        </td>
      </tr>
    </tbody>
  </ExcelTable>

  <Teleport to="body">
    <div
      v-if="monthStatusTooltip.visible"
      class="excel-month-status-tooltip-overlay"
      :style="{
        top: `${monthStatusTooltip.top}px`,
        left: `${monthStatusTooltip.left}px`,
      }"
      role="tooltip"
    >
      {{ monthStatusTooltip.text }}
    </div>
  </Teleport>

  <div
    class="focus-panel"
    :class="{ 'is-open': focusedRow, 'is-hidden': !focusedRow }"
    aria-live="polite"
  >
    <div class="focus-panel-body">
      <div class="focus-panel-row">
        <span class="focus-panel-label">Milestone</span>
        <span class="focus-panel-value">{{ focusedRow?.milestone }}</span>
      </div>
      <div class="focus-panel-row">
        <span class="focus-panel-label">Department</span>
        <span class="focus-panel-value">{{ focusedRow?.department }}</span>
      </div>
      <div class="focus-panel-pills">
        <div class="focus-panel-row">
          <span class="focus-panel-pill">Defined Qty: {{ focusedRow?.qty }}</span>
        </div>
        <div class="focus-panel-row">
          <span
            class="focus-panel-pill focus-panel-pill--remaining"
            :class="remainingStatus ? `is-${remainingStatus}` : ''"
          >
            Remaining Qty: {{ remainingQty ?? '' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.excel-sub-row th {
  top: 40px;
}

.excel-month-header {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.excel-month-status-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  line-height: 1;
  cursor: help;
  z-index: 8;
}

.excel-month-status-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.excel-month-status-icon :deep(.mdi) {
  font-size: 14px;
}

.excel-month-status-tooltip-overlay {
  position: fixed;
  transform: translate(-50%, -100%);
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--tooltip-bg, #1f2b1f);
  color: var(--tooltip-fg, #ffffff);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  box-shadow: var(--tooltip-shadow, 0 8px 18px rgba(15, 23, 42, 0.18));
  pointer-events: none;
  z-index: 1000;
}

.excel-month-status-icon.is-open {
  color: inherit;
}

.excel-month-status-icon.is-rev_rec_ready {
  color: inherit;
}

.excel-month-status-icon.is-completed {
  color: inherit;
}

.excel-month-status-icon.is-mixed {
  color: inherit;
}

.excel-month-status-icon.is-none {
  color: inherit;
}

.focus-panel {
  position: fixed;
  right: 24px;
  top: 85px;
  width: 260px;
  background: var(--surface-1, #ffffff);
  color: var(--text-h, #1f2b1f);
  border-radius: 12px;
  border: 1px solid var(--border-strong, rgba(15, 23, 42, 0.12));
  box-shadow: var(--tooltip-shadow, 0 0px 32px rgba(15, 23, 42, 0.18));
  padding: 10px 12px;
  z-index: 40;
  transform: translateX(24px);
  opacity: 0;
  transition:
    transform 0.28s ease,
    opacity 0.28s ease;
}
.focus-panel.is-open {
  transform: translateX(0);
  opacity: 1;
}
.focus-panel.is-hidden {
  display: none;
}
.focus-panel-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.focus-panel-row {
  display: flex;
  font-size: 12px;
  justify-content: space-between;
  gap: 1rem;
}
.focus-panel-label {
  color: var(--text, rgba(31, 43, 31, 0.6));
}
.focus-panel-value {
  color: var(--text-h, #1f2b1f);
  font-weight: 600;
  text-align: right;
}
.focus-panel-pill {
  padding: 0 8px;
  border-radius: 999px;
  background: var(--surface-3, rgba(118, 122, 118, 0.08));
  border: 1px solid var(--border-strong, rgba(31, 43, 31, 0.14));
  color: var(--text-h, #1f2b1f);
  font-weight: 400;
  display: inline-flex;
  align-items: center;
}
.focus-panel-pill--remaining {
  margin-top: 6px;
}
.focus-panel-pill--remaining.is-ok {
  color: var(--green);
  border-color: color-mix(in srgb, var(--green) 45%, #d1d5db);
}
.focus-panel-pill--remaining.is-pending {
  color: var(--orange);
  border-color: color-mix(in srgb, var(--orange) 45%, #d1d5db);
}
.focus-panel-pill--remaining.is-bad {
  color: var(--red);
  border-color: color-mix(in srgb, var(--red) 45%, #d1d5db);
}
.focus-panel-pill--remaining.is-empty {
  color: var(--text, #6b7280);
}
.focus-panel-pills {
  margin-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
