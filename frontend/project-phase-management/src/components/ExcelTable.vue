<script setup>
import { computed, markRaw, ref } from 'vue'
import DownloadIcon from '@/components/icons/DownloadIcon.vue'
import UploadIcon from '@/components/icons/UploadIcon.vue'
import ActionBtn from '@/components/ActionBtn.vue'

const uploadIcon = markRaw(UploadIcon)
const downloadIcon = markRaw(DownloadIcon)

const props = defineProps({
  cardClass: { type: [String, Array, Object], default: '' },
  wrapClass: { type: [String, Array, Object], default: '' },
  tableClass: { type: [String, Array, Object], default: '' },
  busy: { type: Boolean, default: false },
  exportFilename: { type: String, default: 'table-export.xlsx' },
  exportHandler: { type: Function, default: null },
  showExport: { type: Boolean, default: true },
  onUploadClick: { type: Function, default: null },
})

const isExporting = ref(false)

const canExport = computed(
  () => !props.busy && !isExporting.value && typeof props.exportHandler === 'function',
)

async function exportXlsx() {
  if (isExporting.value || typeof props.exportHandler !== 'function') return

  isExporting.value = true
  try {
    await props.exportHandler()
  } finally {
    isExporting.value = false
  }
}
</script>

<template>
  <div class="excel-card" :class="cardClass" :aria-busy="busy ? 'true' : null">
    <div v-if="showExport || onUploadClick" class="excel-actions">
      <ActionBtn
        v-if="onUploadClick"
        label="Upload Allocations"
        :icon="uploadIcon"
        :on-click="onUploadClick"
      />
      <ActionBtn
        label="Download Template (xlsx)"
        :icon="downloadIcon"
        :disabled="!canExport"
        :on-click="exportXlsx"
      />
    </div>

    <div class="excel-wrap" :class="wrapClass">
      <table class="excel-table" :class="tableClass">
        <slot />
      </table>
    </div>
  </div>
</template>

<style>
.excel-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  border-bottom: 1px solid var(--border-strong, #e1e6dc);
  padding-block: 0.5rem;
  padding-right: 0.5rem;
}

.excel-card {
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 1.5rem;
  position: relative;
  z-index: 2;
}
.excel-wrap {
  overflow: auto;
  max-height: calc(100vh - 12.5rem);
  color-scheme: inherit;
}
.excel-wrap--skeleton {
  max-height: 520px;
  overflow: hidden;
}
.excel-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  min-width: 980px;
}
.excel-table--skeleton {
  width: 100%;
  border-collapse: collapse;
  min-width: 980px;
}
.excel-table--skeleton .sk {
  display: inline-block;
}

.sk.sk-th {
  width: 70%;
  height: 12px;
}
.sk.sk-th--sm {
  width: 60%;
  height: 10px;
}
.sk-td {
  width: 70%;
  height: 30px;
}
.sk.sk-td--wide {
  width: 92%;
}
.sk.sk-td--num {
  width: 40px;
  height: 30px;
}
.sk.sk-td--input {
  width: 100%;
  height: 28px;
  border-radius: 8px;
}
.sk.sk-td--icon {
  width: 22px;
  height: 22px;
  border-radius: 999px;
}

.excel-table th,
.excel-table td {
  border: 1px solid var(--border-strong, #e1e6dc);
  padding: 2.5px 10px 0.5px;
  line-height: normal;
  background: var(--surface-1, #fff);
  color: var(--text-h, #243224);
}
.excel-table thead th {
  border-top: none;
  text-transform: uppercase;
}
.excel-table tbody tr:last-child td {
  border-bottom: none;
}
.excel-table th:first-child,
.excel-table td:first-child {
  border-left: none;
}
.excel-table th:last-child,
.excel-table td:last-child {
  border-right: none;
}

.excel-month-row th {
  background: var(--surface-2, #f5f5f5);
  font-weight: 500;
  color: var(--text, #898b89);
  position: sticky;
  top: 0;
  z-index: 4;
  height: 40px;
  padding-top: 8px;
  padding-bottom: 8px;
  overflow: visible;
}
.excel-sub-row th {
  background: var(--surface-2, #f5f5f5);
  font-size: 12px;
  color: var(--text, #6c7a6c);
  font-weight: 500;
  text-align: center;
  position: sticky;
  top: 40px;
  z-index: 4;
  height: 32px;
  padding-top: 6px;
  padding-bottom: 6px;
  overflow: visible;
}

.excel-month {
  text-align: center;
  min-width: 128px;
}
.excel-month-cell {
  min-width: 128px;
  position: relative;
}
.excel-month--current {
  background: rgba(0, 165, 106, 0.12);
}
.excel-month--current .excel-input {
  border-color: var(--accent);
}
.excel-month-row .excel-month--current,
.excel-sub-row .excel-month--current {
  background: var(--accent);
  color: #ffffff;
}
.excel-month-cell.excel-month--actual {
  background: var(--surface-3, #f3f4f6);
}
.excel-missing-cell-icon {
  position: absolute;
  top: 4px;
  left: 6px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  color: #ffffff;
  background: #d97706;
  pointer-events: auto;
  z-index: 2;
}

.excel-num {
  text-align: right;
}
.excel-input {
  width: 100%;
  border: 1px solid var(--border-strong, #d6dfd0);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
  text-align: right;
  background: var(--surface-2, rgba(255, 255, 255, 0.4));
  color: var(--text-h, #243224);
  height: 30px;
  appearance: textfield;
}
.excel-input:disabled,
.excel-notes:disabled {
  background: var(--surface-3, rgba(148, 163, 184, 0.18));
  border-color: var(--border-strong, #d1d5db);
  color: var(--text, #94a3b8);
  cursor: not-allowed;
}
.excel-input::-webkit-outer-spin-button,
.excel-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.excel-input:focus {
  outline: 2px solid rgba(0, 165, 106, 0.25);
  border-color: var(--accent);
}
.excel-notes {
  width: 100%;
  min-height: 36px;
  resize: both;
  border: 1px solid var(--border-strong, #d6dfd0);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
  background: var(--surface-2, rgba(255, 255, 255, 0.5));
  color: var(--text-h, #243224);
}

.excel-sticky {
  position: sticky;
  left: 0;
  background: var(--surface-1, #ffffff);
  z-index: 2;
}

:root {
  --excel-col-status-w: 44px;
  --excel-col-phase-w: 300px;
  --excel-col-status-left: 0px;
  --excel-col-phase-left: 43px;
  --excel-col-cumm-left: calc(var(--excel-col-phase-left) + var(--excel-col-phase-w) - 1px);
}

.excel-col-status {
  min-width: var(--excel-col-status-w);
  left: var(--excel-col-status-left);
  text-align: center;
}
.excel-col-status.excel-col-status--empty {
  background: var(--surface-3, #f3f4f6);
  color: var(--text, #6b7280);
}
.excel-col-status.excel-col-status--ok {
  background: var(--green);
  color: #ffffff;
}
.excel-col-status.excel-col-status--pending {
  background: var(--orange);
  color: #ffffff;
}
.excel-col-status.excel-col-status--bad {
  background: var(--red);
  color: #ffffff;
}
:root[data-theme='dark'] .excel-col-status.excel-col-status--empty {
  background: rgb(27 33 30);
  color: rgba(148, 163, 184, 0.7);
}
:root[data-theme='dark'] .excel-col-status.excel-col-status--ok {
  background: rgb(19 43 30);
  color: var(--green);
}
:root[data-theme='dark'] .excel-col-status.excel-col-status--ok .excel-phase-icon--ok {
  color: rgb(19 43 30);
  background: var(--green);
}
:root[data-theme='dark'] .excel-col-status.excel-col-status--pending {
  background: rgb(49 37 21);
  color: var(--orange);
}
:root[data-theme='dark'] .excel-col-status.excel-col-status--pending .excel-phase-icon--pending {
  color: rgb(49 37 21);
  background: var(--orange);
}
:root[data-theme='dark'] .excel-col-status.excel-col-status--bad {
  background: rgb(60 20 9);
  color: var(--red);
}
:root[data-theme='dark'] .excel-col-status.excel-col-status--bad .excel-phase-icon--bad {
  color: rgb(60 20 9);
  background: var(--red);
}

.excel-col-phase {
  min-width: var(--excel-col-phase-w);
  left: var(--excel-col-phase-left);
  background: var(--surface-2, #e9f2e7);
  box-shadow: inset -1px 0 0 var(--border-strong, #d5e2d1);
}
.excel-col-cumm {
  min-width: 120px;
  left: var(--excel-col-cumm-left);
  background: var(--surface-2, #e9f2e7);
  box-shadow: inset -1px 0 0 var(--border-strong, #d5e2d1);
}
.excel-month-row .excel-sticky,
.excel-sub-row .excel-sticky {
  z-index: 5;
}
.excel-col-dept {
  min-width: 220px;
}
.excel-col-notes {
  width: fit-content;
  min-width: 100px;
}
.excel-phase-icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--surface-1, #ffffff);
  color: currentColor;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.excel-phase-icon--ok {
  color: var(--green);
}
.excel-phase-icon--pending {
  color: var(--orange);
}
.excel-phase-icon--bad {
  color: var(--red);
  padding-bottom: 3px;
}
</style>
