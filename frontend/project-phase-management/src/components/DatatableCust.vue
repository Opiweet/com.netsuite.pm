<template>
  <div class="pt-wrapper">
    <!-- ══ TOP BAR ══ -->
    <div class="pt-topbar">
      <div class="pt-topbar-left">
        <!-- Grid icon -->
        <button
          class="pt-icon-btn"
          :class="{ 'pt-icon-btn--active': viewMode === 'grid' }"
          @click="viewMode = 'grid'"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" />
            <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" />
            <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" />
            <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
          </svg>
        </button>
        <button
          class="pt-icon-btn"
          :class="{ 'pt-icon-btn--active': viewMode === 'table' }"
          @click="viewMode = 'table'"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <line x1="9" y1="4" x2="9" y2="20" />
          </svg>
        </button>

        <!-- Search -->
        <div v-if="showSearch" class="pt-search">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="pt-icon-muted"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref="searchInputRef"
            v-model="search"
            type="text"
            placeholder="Search"
            class="pt-search-input"
          />
          <span class="pt-search-kbd">/</span>
        </div>
      </div>
    </div>

    <!-- ══ STATUS TABS ══ -->
    <div v-if="showTabs" class="pt-tabs">
      <button
        v-for="tab in computedTabs"
        :key="tab.key"
        class="pt-tab"
        :class="{ 'pt-tab--active': activeTab === tab.key }"
        @click="selectTab(tab.key)"
      >
        {{ tab.label }}
        <span class="pt-tab-count" :class="{ 'pt-tab-count--active': activeTab === tab.key }">
          {{ tab.count }}
        </span>
      </button>
    </div>
    <div
      v-if="viewMode === 'table' && loading"
      class="pt-inline-loader pt-inline-loader--table-root"
      aria-live="polite"
      aria-busy="true"
    >
      <span class="pt-inline-loader__spinner" aria-hidden="true"></span>
      <span class="pt-inline-loader__label">Loading projects…</span>
    </div>

    <!-- ══ TABLE ══ -->
    <div
      v-if="viewMode === 'table'"
      class="pt-table-wrap"
      :class="{ 'pt-table-wrap--loading': loading }"
    >
      <table class="pt-table">
        <thead>
          <tr>
            <th v-if="selectable" class="pt-th pt-th--check">
              <v-checkbox
                v-model="selectAll"
                density="compact"
                hide-details
                color="primary"
                class="pt-check"
              />
            </th>
            <th v-if="showRowNumber" class="pt-th pt-th--num">
              <span class="pt-th-inner">
                #
                <v-icon size="12" color="var(--text)">mdi-arrow-up-down</v-icon>
              </span>
            </th>
            <th
              v-for="col in tableColumns"
              :key="col.key"
              class="pt-th"
              :class="col.thClass"
              @click="col.sortable && toggleSort(col.key)"
            >
              <span class="pt-th-inner">
                {{ col.label }}
                <v-icon
                  v-if="col.sortable"
                  size="12"
                  :color="sortBy === col.key ? 'var(--accent)' : 'var(--text)'"
                >
                  {{
                    sortBy === col.key && sortDir === 'desc'
                      ? 'mdi-arrow-down'
                      : 'mdi-arrow-up-down'
                  }}
                </v-icon>
                <v-icon
                  v-if="col.help"
                  size="13"
                  color="var(--text)"
                  class="ml-0.5"
                  :title="col.help"
                >
                  mdi-information-outline
                </v-icon>
              </span>
            </th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="row in paginatedRows"
            :key="row[rowKey]"
            class="pt-row"
            :class="{
              'pt-row--selected': selectedIds.includes(row[rowKey]),
              'pt-row--clickable': rowClickEmit,
            }"
            @click="rowClickEmit && emit('row-click', row)"
          >
            <!-- Checkbox -->
            <td v-if="selectable" class="pt-td pt-td--check">
              <v-checkbox
                :model-value="selectedIds.includes(row[rowKey])"
                density="compact"
                hide-details
                color="primary"
                class="pt-check"
                @update:model-value="toggleRow(row[rowKey])"
              />
            </td>

            <!-- Expand -->
            <!-- Row number -->
            <td v-if="showRowNumber" class="pt-td pt-td--num">{{ row[rowKey] }}</td>

            <td v-for="col in tableColumns" :key="col.key" class="pt-td" :class="col.tdClass">
              <template v-if="col.key === 'name'">
                <a href="#" class="pt-project-link" @click.prevent>{{ row[col.key] }}</a>
              </template>
              <template v-else-if="col.key === 'pm'">
                <div class="pt-avatar" :class="`pt-avatar--${row.pmColor}`" :title="row.pm">
                  {{ row.pmInitials }}
                </div>
              </template>
              <template v-else-if="col.key === 'status'">
                <StatusBadge
                  :label="row.status"
                  :color="row.statusColor || statusColorMap[row.statusKey] || '#6b7280'"
                />
              </template>
              <template v-else-if="col.key === 'amountRecognized'">
                <div class="pt-recognized" :title="row.amountRecognizedText || '-'">
                  <div class="pt-recognized-top">
                    <span class="pt-recognized-value">
                      <span class="pt-recognized-primary">{{
                        getAmountRecognizedParts(row).primary
                      }}</span>
                      <span class="pt-recognized-secondary">{{
                        getAmountRecognizedParts(row).secondary
                      }}</span>
                    </span>
                    <span class="pt-recognized-pct">{{
                      row.amountRecognizedPct != null ? `${row.amountRecognizedPct}%` : '—'
                    }}</span>
                  </div>
                  <div class="pt-recognized-bar" aria-hidden="true">
                    <span
                      class="pt-recognized-bar-fill"
                      :style="{
                        width: `${Math.max(
                          0,
                          Math.min(100, Number(row.amountRecognizedPct) || 0),
                        )}%`,
                      }"
                    />
                  </div>
                </div>
              </template>
              <template v-else-if="col.key === 'invoicedToDate'">
                <div class="pt-recognized" :title="row.invoicedToDateText || '-'">
                  <div class="pt-recognized-top">
                    <span class="pt-recognized-value">
                      <span class="pt-recognized-primary">{{
                        getInvoicedToDateParts(row).primary
                      }}</span>
                      <span class="pt-recognized-secondary">{{
                        getInvoicedToDateParts(row).secondary
                      }}</span>
                    </span>
                    <span class="pt-recognized-pct">{{
                      row.invoicedToDatePct != null ? `${row.invoicedToDatePct}%` : '—'
                    }}</span>
                  </div>
                  <div class="pt-recognized-bar" aria-hidden="true">
                    <span
                      class="pt-recognized-bar-fill"
                      :style="{
                        width: `${Math.max(0, Math.min(100, Number(row.invoicedToDatePct) || 0))}%`,
                      }"
                    />
                  </div>
                </div>
              </template>
              <template v-else-if="col.key === 'revenueReady'">
                <span :title="row.revenueReady || '-'">
                  {{ formatMoneyCompact(row._revenueReadyRaw ?? row.revenueReady) }}
                </span>
              </template>
              <template v-else-if="col.key === 'lastUpdate'">
                <span class="pt-update">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    style="flex-shrink: 0"
                    class="pt-icon-muted"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {{ row.lastUpdate }}
                </span>
              </template>
              <template v-else-if="col.key === 'resources'">
                <button v-if="row.resources === null" class="pt-add-resource">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke-dasharray="4 2" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </button>
                <span v-else class="pt-resource-count">{{ row.resources }}</span>
              </template>
              <template v-else-if="col.key === 'qtyProgress'">
                <div
                  class="pt-qty"
                  :title="`${formatNumberFull(row.qtyCompleted ?? 0)} / ${formatNumberFull(row.totalQty ?? 0)}`"
                >
                  <div class="pt-qty-top">
                    <span class="pt-qty-value"
                      >{{ formatNumberCompact(row.qtyCompleted ?? 0) }} /
                      {{ formatNumberCompact(row.totalQty ?? 0) }}</span
                    >
                    <span class="pt-qty-pct">{{
                      row.totalQty
                        ? `${Math.round((Number(row.qtyCompleted) / Number(row.totalQty)) * 100)}%`
                        : '—'
                    }}</span>
                  </div>
                  <div class="pt-qty-bar" aria-hidden="true">
                    <span
                      class="pt-qty-bar-fill"
                      :style="{
                        width: `${Math.max(
                          0,
                          Math.min(100, (Number(row.qtyProgress) || 0) * 100),
                        )}%`,
                      }"
                    />
                  </div>
                </div>
              </template>
              <template v-else-if="col.key === 'phases'">
                <span class="pt-phase-count">{{ row.phases ?? 0 }}</span>
              </template>
              <template v-else-if="col.key === 'timeline'">
                <template v-if="row.timelineStart">
                  <span class="pt-timeline-pill">{{ row.timelineStart }}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="pt-timeline-arrow"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                  <span class="pt-timeline-pill">{{ row.timelineEnd }}</span>
                </template>
                <template v-else>
                  <span class="pt-timeline-pill pt-timeline-pill--empty">-</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="pt-timeline-arrow"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                  <span class="pt-timeline-pill pt-timeline-pill--empty">-</span>
                </template>
              </template>
              <template v-else-if="col.key === 'estimation'">
                <span :title="row.estimation || '-'">
                  {{ formatMoneyCompact(row._contractValueRaw ?? row.estimation) }}
                </span>
              </template>
              <template v-else>
                {{ row[col.key] ?? '-' }}
              </template>
            </td>
          </tr>

          <tr v-if="paginatedRows.length === 0">
            <td :colspan="totalColumns" class="pt-empty">No projects found.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ══ GRID VIEW ══ -->
    <div v-else class="pt-grid-wrap">
      <div v-if="loading" class="pt-inline-loader" aria-live="polite" aria-busy="true">
        <span class="pt-inline-loader__spinner" aria-hidden="true"></span>
        <span class="pt-inline-loader__label">Loading projects…</span>
      </div>
      <div v-if="paginatedRows.length === 0" class="pt-empty pt-empty--grid">
        No projects found.
      </div>
      <div v-else class="pt-grid">
        <article
          v-for="row in paginatedRows"
          :key="row[rowKey]"
          class="pt-card"
          :class="{ 'pt-card--clickable': rowClickEmit }"
          :style="{ '--card-color': row.statusColor || statusColorMap[row.statusKey] || '#94a3b8' }"
          @click="rowClickEmit && emit('row-click', row)"
        >
          <div class="pt-card-accent"></div>
          <div class="pt-card-body">
            <!-- Header: status + PM avatar -->
            <div class="pt-card-head">
              <StatusBadge
                :label="row.status"
                :color="row.statusColor || statusColorMap[row.statusKey] || '#6b7280'"
              />
              <div
                v-if="hasPmColumn"
                class="pt-avatar"
                :class="`pt-avatar--${row.pmColor}`"
                :title="row.pm"
              >
                {{ row.pmInitials }}
              </div>
            </div>

            <!-- Project name + customer -->
            <div class="pt-card-name">{{ row.name }}</div>
            <div v-if="hasCustomerColumn" class="pt-card-client">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              {{ row.client ?? '—' }}
            </div>

            <!-- Financial progress bars (revenue management view) -->
            <div v-if="hasAmountRecognizedColumn || hasInvoicedToDateColumn" class="pt-card-bars">
              <div v-if="hasAmountRecognizedColumn" class="pt-card-bar-item">
                <div class="pt-card-bar-meta">
                  <span class="pt-card-bar-label">Recognized</span>
                  <span class="pt-card-bar-val">{{ getAmountRecognizedDisplay(row) }}</span>
                  <span class="pt-card-bar-pct">{{
                    row.amountRecognizedPct != null ? `${row.amountRecognizedPct}%` : ''
                  }}</span>
                </div>
                <div class="pt-card-bar-track" aria-hidden="true">
                  <span
                    class="pt-card-bar-fill"
                    :style="{
                      width: `${Math.max(0, Math.min(100, Number(row.amountRecognizedPct) || 0))}%`,
                    }"
                  ></span>
                </div>
              </div>
              <div v-if="hasInvoicedToDateColumn" class="pt-card-bar-item">
                <div class="pt-card-bar-meta">
                  <span class="pt-card-bar-label">Billed</span>
                  <span class="pt-card-bar-val">{{ getInvoicedToDateDisplay(row) }}</span>
                  <span class="pt-card-bar-pct">{{
                    row.invoicedToDatePct != null ? `${row.invoicedToDatePct}%` : ''
                  }}</span>
                </div>
                <div class="pt-card-bar-track" aria-hidden="true">
                  <span
                    class="pt-card-bar-fill pt-card-bar-fill--billed"
                    :style="{
                      width: `${Math.max(0, Math.min(100, Number(row.invoicedToDatePct) || 0))}%`,
                    }"
                  ></span>
                </div>
              </div>
            </div>

            <!-- Stats row -->
            <div
              v-if="
                hasPhasesColumn ||
                hasEstimationColumn ||
                hasRevenueReadyColumn ||
                hasLastUpdateColumn
              "
              class="pt-card-stats"
            >
              <div v-if="hasPhasesColumn" class="pt-card-stat">
                <span class="pt-card-stat-val">{{ row.phases ?? 0 }}</span>
                <span class="pt-card-stat-lbl">Phases</span>
              </div>
              <div v-if="hasEstimationColumn" class="pt-card-stat">
                <span class="pt-card-stat-val">{{
                  formatMoneyCompact(row._contractValueRaw ?? row.estimation)
                }}</span>
                <span class="pt-card-stat-lbl">Contract</span>
              </div>
              <div v-if="hasRevenueReadyColumn" class="pt-card-stat">
                <span class="pt-card-stat-val">{{
                  formatMoneyCompact(row._revenueReadyRaw ?? row.revenueReady)
                }}</span>
                <span class="pt-card-stat-lbl">{{ revenueReadyLabel }}</span>
              </div>
              <div v-if="hasLastUpdateColumn" class="pt-card-stat pt-card-stat--date">
                <span class="pt-card-stat-val pt-card-stat-val--sm">{{
                  row.lastUpdate ?? '—'
                }}</span>
                <span class="pt-card-stat-lbl">Updated</span>
              </div>
            </div>

            <!-- Timeline footer -->
            <div class="pt-card-foot">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>{{
                row.timelineStart ? `${row.timelineStart} → ${row.timelineEnd}` : '—'
              }}</span>
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- ══ PAGINATION ══ -->
    <div v-if="showPagination" class="pt-pagination">
      <div class="pt-rpp">
        <span class="pt-rpp-label">Rows per page</span>
        <v-select
          v-model="rowsPerPage"
          :items="rowsPerPageOptions"
          variant="plain"
          density="compact"
          hide-details
          class="pt-rpp-select"
        />
      </div>

      <span class="pt-page-info">
        {{ displayStart }}–{{ displayEnd }} of {{ totalRowsCount }}
      </span>

      <div class="pt-page-nav">
        <button
          v-for="p in pageButtons"
          :key="p"
          class="pt-page-btn"
          :class="{ active: p === currentPage, ellipsis: p === '…' }"
          :disabled="p === '…'"
          @click="
            p !== '…' &&
            ((currentPage = Number(p)), props.serverMode && emitQueryChange({ page: Number(p) }))
          "
        >
          {{ p }}
        </button>
      </div>

      <div class="pt-goto">
        <span class="pt-goto-label">Go to</span>
        <input
          v-model.number="goInput"
          type="number"
          class="pt-goto-input"
          @keyup.enter="goToPage"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import StatusBadge from './StatusBadge.vue'

const props = defineProps({
  rows: { type: Array, default: null },
  columns: { type: Array, default: null },
  tabs: { type: Array, default: null },
  rowKey: { type: String, default: 'id' },
  tabKeyField: { type: String, default: 'statusKey' },
  selectable: { type: Boolean, default: false },
  rowClickEmit: { type: Boolean, default: false },
  showRowNumber: { type: Boolean, default: true },
  showSearch: { type: Boolean, default: true },
  showTabs: { type: Boolean, default: true },
  showPagination: { type: Boolean, default: true },
  rowsPerPageOptions: { type: Array, default: () => [10, 25, 50] },
  serverMode: { type: Boolean, default: false },
  pagination: { type: Object, default: null },
  query: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  queryDebounceMs: { type: Number, default: 300 },
})

const emit = defineEmits(['row-click', 'query-change'])

const searchInputRef = ref(null)
const viewMode = ref('table')

const statusColorMap = {
  on_track: '#00a56a',
  on_hold: '#9ca3af',
  risk: '#dc2626',
  potential_risk: '#f97316',
  open: '#94a3b8',
  rev_rec_ready: '#f59e0b',
  completed: '#00a56a',
  cancelled: '#dc2626',
  mixed: '#f97316',
}

// ── Tabs ──────────────────────────────────────────────────────────
const activeTab = ref((props.tabs && props.tabs[0]?.key) || 'all')

function selectTab(key) {
  activeTab.value = key
  if (!props.serverMode) {
    currentPage.value = 1
    return
  }
  emitQueryChange({ page: 1, statusTabKey: key })
}

// ── Columns / Rows (no props fallback) ─────────────────────────
// This component is expected to receive `rows` + `columns` from callers.
const columns = []

// ── Mock data
const allRows = []

// ── Search + Tab filter ───────────────────────────────────────────
const search = ref('')

const tableRows = computed(() => (props.rows && props.rows.length ? props.rows : allRows))
const tableColumns = computed(() =>
  props.columns && props.columns.length ? props.columns : columns,
)
const hasPhasesColumn = computed(() => tableColumns.value.some((col) => col.key === 'phases'))
const hasResourcesColumn = computed(() => tableColumns.value.some((col) => col.key === 'resources'))
const hasCustomerColumn = computed(() => tableColumns.value.some((col) => col.key === 'client'))
const hasQtyProgressColumn = computed(() =>
  tableColumns.value.some((col) => col.key === 'qtyProgress'),
)
const hasPmColumn = computed(() => tableColumns.value.some((col) => col.key === 'pm'))
const hasLastUpdateColumn = computed(() =>
  tableColumns.value.some((col) => col.key === 'lastUpdate'),
)
const hasAmountRecognizedColumn = computed(() =>
  tableColumns.value.some((col) => col.key === 'amountRecognized'),
)
const hasInvoicedToDateColumn = computed(() =>
  tableColumns.value.some((col) => col.key === 'invoicedToDate'),
)
const hasRevenueReadyColumn = computed(() =>
  tableColumns.value.some((col) => col.key === 'revenueReady'),
)
const invoicedToDateLabel = computed(
  () => tableColumns.value.find((col) => col.key === 'invoicedToDate')?.label || 'INVOICED TO DATE',
)
const revenueReadyLabel = computed(
  () => tableColumns.value.find((col) => col.key === 'revenueReady')?.label || 'REVENUE READY',
)
const hasEstimationColumn = computed(() =>
  tableColumns.value.some((col) => col.key === 'estimation'),
)
const generatedTabs = computed(() => {
  const labelMap = {}
  tableRows.value.forEach((row) => {
    const key = row[props.tabKeyField]
    if (!key || labelMap[key]) return
    if (row.status) labelMap[key] = row.status
  })
  const keys = [...new Set(tableRows.value.map((row) => row[props.tabKeyField]).filter(Boolean))]
  return [{ key: 'all', label: 'All' }].concat(
    keys.map((key) => ({ key, label: labelMap[key] ?? key })),
  )
})

const tableTabs = computed(() =>
  props.tabs && props.tabs.length ? props.tabs : generatedTabs.value,
)

const computedTabs = computed(() => {
  if (props.serverMode) {
    return tableTabs.value.map((tab) => ({
      ...tab,
      count: Number(tab?.count || 0),
    }))
  }
  const counts = {}
  tableRows.value.forEach((row) => {
    const key = row[props.tabKeyField]
    if (key != null) counts[key] = (counts[key] ?? 0) + 1
  })
  const total = tableRows.value.length
  return tableTabs.value.map((tab) => ({
    ...tab,
    count: tab.key === 'all' ? total : (counts[tab.key] ?? 0),
  }))
})

const filteredRows = computed(() => {
  if (props.serverMode) return tableRows.value
  let rows = tableRows.value
  if (activeTab.value !== 'all') rows = rows.filter((r) => r[props.tabKeyField] === activeTab.value)
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    rows = rows.filter((r) =>
      String(r.name ?? '')
        .toLowerCase()
        .includes(q),
    )
  }
  if (sortBy.value) {
    rows = [...rows].sort((a, b) => {
      let av = a[sortBy.value],
        bv = b[sortBy.value]
      if (sortBy.value === 'revenueReady') {
        av = a?._revenueReadyRaw ?? av
        bv = b?._revenueReadyRaw ?? bv
      }
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') av = av.toLowerCase()
      if (typeof bv === 'string') bv = bv.toLowerCase()
      return sortDir.value === 'asc' ? (av < bv ? -1 : 1) : av > bv ? -1 : 1
    })
  }
  return rows
})

// ── Sort ──────────────────────────────────────────────────────────
const sortBy = ref('')
const sortDir = ref('asc')
function toggleSort(key) {
  if (sortBy.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else {
    sortBy.value = key
    sortDir.value = 'asc'
  }
  if (props.serverMode) emitQueryChange({ page: 1, sortBy: sortBy.value, sortDir: sortDir.value })
}

function formatMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '$0.00'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)
  } catch (e) {
    return `$${n.toFixed(2)}`
  }
}

function formatMoneyCompact(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '$0.00'
  if (Math.abs(n) < 1000000) return formatMoney(n)
  const abs = Math.abs(n)
  const tiers = [
    { min: 1_000_000_000_000, suffix: 'T' },
    { min: 1_000_000_000, suffix: 'B' },
    { min: 1_000_000, suffix: 'M' },
  ]
  const tier = tiers.find((t) => abs >= t.min)
  if (!tier) return formatMoney(n)
  const scaled = abs / tier.min
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
  const scaledText = scaled
    .toFixed(decimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1')
  return `${n < 0 ? '-' : ''}$${scaledText}${tier.suffix}`
}

function formatNumberFull(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  try {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n)
  } catch (e) {
    return String(n)
  }
}

function formatNumberCompact(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs < 1000) return formatNumberFull(n)

  const tiers = [
    { min: 1_000_000_000_000, suffix: 'T' },
    { min: 1_000_000_000, suffix: 'B' },
    { min: 1_000_000, suffix: 'M' },
    { min: 1_000, suffix: 'K' },
  ]
  const tier = tiers.find((t) => abs >= t.min)
  if (!tier) return formatNumberFull(n)

  const scaled = abs / tier.min
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
  const scaledText = scaled
    .toFixed(decimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1')
  return `${n < 0 ? '-' : ''}${scaledText}${tier.suffix}`
}

function getAmountRecognizedDisplay(row) {
  const recognized = Number(row?.amountRecognized)
  const contract = Number(row?._contractValueRaw)
  if (Number.isFinite(recognized) && Number.isFinite(contract) && contract > 0) {
    return `${formatMoneyCompact(recognized)} / ${formatMoneyCompact(contract)}`
  }
  if (Number.isFinite(recognized)) return formatMoneyCompact(recognized)
  return row?.amountRecognizedText || '-'
}

function getAmountRecognizedParts(row) {
  const recognized = Number(row?.amountRecognized)
  const contract = Number(row?._contractValueRaw)
  if (Number.isFinite(recognized) && Number.isFinite(contract) && contract > 0) {
    return {
      primary: formatMoneyCompact(recognized),
      secondary: ` / ${formatMoneyCompact(contract)}`,
    }
  }
  if (Number.isFinite(recognized)) {
    return { primary: formatMoneyCompact(recognized), secondary: '' }
  }
  return { primary: row?.amountRecognizedText || '-', secondary: '' }
}

function getInvoicedToDateDisplay(row) {
  const invoiced = Number(row?.invoicedToDate)
  const contract = Number(row?._contractValueRaw)
  if (Number.isFinite(invoiced) && Number.isFinite(contract) && contract > 0) {
    return `${formatMoneyCompact(invoiced)} / ${formatMoneyCompact(contract)}`
  }
  if (Number.isFinite(invoiced)) return formatMoneyCompact(invoiced)
  return row?.invoicedToDateText || '-'
}

function getInvoicedToDateParts(row) {
  const invoiced = Number(row?.invoicedToDate)
  const contract = Number(row?._contractValueRaw)
  if (Number.isFinite(invoiced) && Number.isFinite(contract) && contract > 0) {
    return {
      primary: formatMoneyCompact(invoiced),
      secondary: ` / ${formatMoneyCompact(contract)}`,
    }
  }
  if (Number.isFinite(invoiced)) {
    return { primary: formatMoneyCompact(invoiced), secondary: '' }
  }
  return { primary: row?.invoicedToDateText || '-', secondary: '' }
}

// ── Selection ─────────────────────────────────────────────────────
const selectedIds = ref([])
const selectAll = computed({
  get: () =>
    props.selectable &&
    paginatedRows.value.length > 0 &&
    paginatedRows.value.every((r) => selectedIds.value.includes(r[props.rowKey])),
  set: (v) => {
    if (!props.selectable) return
    const ids = paginatedRows.value.map((r) => r[props.rowKey])
    if (v) selectedIds.value = [...new Set([...selectedIds.value, ...ids])]
    else selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id))
  },
})
function toggleRow(id) {
  const i = selectedIds.value.indexOf(id)
  i === -1 ? selectedIds.value.push(id) : selectedIds.value.splice(i, 1)
}

// ── Pagination ────────────────────────────────────────────────────
const rowsPerPage = ref(props.query?.pageSize || props.rowsPerPageOptions[0] || 10)
const currentPage = ref(props.query?.page || 1)
const goInput = ref('')
const isSyncingServerState = ref(false)
const queryDebounceTimer = ref(null)

const totalPages = computed(() =>
  props.serverMode
    ? Math.max(1, Number(props.pagination?.totalPages || 1))
    : Math.max(1, Math.ceil(filteredRows.value.length / rowsPerPage.value)),
)

const paginatedRows = computed(() => {
  if (props.serverMode) return filteredRows.value
  const s = (currentPage.value - 1) * rowsPerPage.value
  return filteredRows.value.slice(s, s + rowsPerPage.value)
})

const pageButtons = computed(() => {
  const t = totalPages.value,
    c = currentPage.value
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1)
  const p = [1]
  if (c > 3) p.push('…')
  for (let i = Math.max(2, c - 1); i <= Math.min(t - 1, c + 1); i++) p.push(i)
  if (c < t - 2) p.push('…')
  p.push(t)
  return p
})

function goToPage() {
  const p = Number(goInput.value)
  if (p >= 1 && p <= totalPages.value) {
    currentPage.value = p
    if (props.serverMode) emitQueryChange({ page: p })
  }
  goInput.value = ''
}

watch(search, () => {
  if (isSyncingServerState.value) return
  if (props.serverMode) {
    emitQueryChangeDebounced({
      page: 1,
      search: search.value,
    })
    return
  }
  currentPage.value = 1
})

watch(activeTab, () => {
  if (isSyncingServerState.value) return
  if (props.serverMode) {
    emitQueryChange({
      page: 1,
      statusTabKey: activeTab.value,
    })
    return
  }
  currentPage.value = 1
})
watch(rowsPerPage, () => {
  if (isSyncingServerState.value) return
  if (props.serverMode) {
    emitQueryChange({ page: 1, pageSize: Number(rowsPerPage.value) || 10 })
    return
  }
  currentPage.value = 1
})

watch(
  () => props.pagination,
  (value) => {
    if (!props.serverMode || !value) return
    isSyncingServerState.value = true
    const p = Number(value.page || 1)
    const ps = Number(value.pageSize || rowsPerPage.value || 10)
    if (p > 0) currentPage.value = p
    if (ps > 0) rowsPerPage.value = ps
    isSyncingServerState.value = false
  },
  { deep: true },
)

watch(
  () => props.query,
  (value) => {
    if (!props.serverMode || !value) return
    isSyncingServerState.value = true
    if (typeof value.search === 'string') search.value = value.search
    if (typeof value.statusTabKey === 'string' && value.statusTabKey)
      activeTab.value = value.statusTabKey
    if (value.sortBy != null) sortBy.value = String(value.sortBy || '')
    if (value.sortDir != null) sortDir.value = String(value.sortDir || 'asc')
    isSyncingServerState.value = false
  },
  { deep: true },
)

function emitQueryChange(partial = {}) {
  const next = {
    page: currentPage.value,
    pageSize: Number(rowsPerPage.value) || 10,
    search: search.value || '',
    statusTabKey: activeTab.value || 'all',
    sortBy: sortBy.value || '',
    sortDir: sortDir.value || 'asc',
    ...partial,
  }
  emit('query-change', next)
}

function emitQueryChangeDebounced(partial = {}) {
  if (!props.serverMode) {
    emitQueryChange(partial)
    return
  }
  if (queryDebounceTimer.value) {
    clearTimeout(queryDebounceTimer.value)
    queryDebounceTimer.value = null
  }
  const waitMs = Math.max(0, Number(props.queryDebounceMs || 0))
  queryDebounceTimer.value = setTimeout(() => {
    queryDebounceTimer.value = null
    emitQueryChange(partial)
  }, waitMs)
}

const totalRowsCount = computed(() =>
  props.serverMode
    ? Math.max(0, Number(props.pagination?.totalCount || 0))
    : filteredRows.value.length,
)
const displayStart = computed(() =>
  totalRowsCount.value > 0 ? (currentPage.value - 1) * rowsPerPage.value + 1 : 0,
)
const displayEnd = computed(() =>
  totalRowsCount.value > 0
    ? Math.min(currentPage.value * rowsPerPage.value, totalRowsCount.value)
    : 0,
)

const totalColumns = computed(
  () => tableColumns.value.length + (props.showRowNumber ? 1 : 0) + (props.selectable ? 1 : 0),
)

function handleSlashShortcut(event) {
  if (event.key !== '/') return
  if (!props.showSearch) return
  const target = event.target
  const isTypingTarget =
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  if (isTypingTarget) return
  event.preventDefault()
  searchInputRef.value?.focus()
}

onMounted(() => {
  window.addEventListener('keydown', handleSlashShortcut)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleSlashShortcut)
  if (queryDebounceTimer.value) {
    clearTimeout(queryDebounceTimer.value)
    queryDebounceTimer.value = null
  }
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');

* {
  box-sizing: border-box;
}

.pt-wrapper {
  position: relative;
  font-family: 'Inter', sans-serif;
  background: var(--surface-1, #fff);
  color: var(--text-h, #111827);
  /* border-radius: 12px; */
  overflow: hidden;
}

/* ── Top bar ── */
.pt-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--surface-3, #f3f4f6);
  gap: 10px;
}
.pt-topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pt-icon-btn {
  width: 34px;
  height: 34px;
  border: 1px solid var(--border-strong, #e5e7eb);
  border-radius: 6px;
  background: var(--surface-1, #fff);
  color: var(--text-h, #374151);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.1s;
}
.pt-icon-btn--active {
  border-color: var(--accent);
  background: rgba(0, 165, 106, 0.12);
  color: var(--accent);
}

.pt-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  height: 34px;
  border: 1px solid var(--border-strong, #e5e7eb);
  border-radius: 6px;
  background: var(--surface-1, #fff);
  min-width: 220px;
}
.pt-search-input {
  border: none;
  outline: none;
  font-size: 13px;
  color: var(--text-h, #374151);
  background: transparent;
  flex: 1;
  font-family: 'Inter', sans-serif;
}
.pt-search-input::placeholder {
  color: var(--text, #9ca3af);
}
.pt-search-kbd {
  font-size: 11px;
  font-weight: 600;
  color: var(--text, #989ca4);
  background: var(--surface-2, #fcfcfc);
  border: 1px solid var(--border-strong, #e5e7eb);
  border-radius: 6px;
  padding: 5px 7px;
  line-height: 1;
  font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.06);
}
.pt-icon-muted {
  color: var(--text, #9ca3af);
}

/* ── Tabs ── */
.pt-tabs {
  display: flex;
  align-items: center;
  /* padding: 0 16px; */
  border-bottom: 1px solid var(--border-strong, #e5e7eb);
  gap: 0;
}
.pt-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 500;
  color: var(--text, #6b7280);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s;
  white-space: nowrap;
}
.pt-tab:hover {
  color: var(--text-h, #374151);
}
.pt-tab--active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.pt-tab-count {
  font-size: 11px;
  font-weight: 600;
  background: var(--surface-3, #f3f4f6);
  color: var(--text, #6b7280);
  padding: 4px 6px;
  border-radius: 999px;
  line-height: normal;
}
.pt-tab-count--active {
  background: rgba(0, 165, 106, 0.12);
  color: var(--accent);
}

/* ── Table ── */
.pt-table-wrap {
  position: relative;
  overflow-x: auto;
  border-inline: 1px solid var(--border-strong, #e5e7eb);
  max-height: calc(100vh - 300px);
  overflow-y: auto;
}
.pt-table-wrap--loading {
  overflow: hidden;
  overscroll-behavior: contain;
  touch-action: none;
}
.pt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

thead tr {
  background: var(--surface-2, #f9fafb);
}

.pt-th {
  padding: 10px 12px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text, #9ca3af);
  border-bottom: 1px solid var(--border-strong, #e5e7eb);
  white-space: nowrap;
  user-select: none;
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--surface-2, #f9fafb);
}
.pt-th--check {
  width: 40px;
  padding: 10px 6px 10px 14px;
}
.pt-th--num {
  width: 48px;
  min-width: 90px;
  cursor: pointer;
}
.pt-th--name {
  min-width: 180px;
  cursor: pointer;
}
.pt-th--customer {
  min-width: 180px;
  cursor: pointer;
}
.pt-th--department {
  min-width: 210px;
  cursor: pointer;
}
.pt-th--pm {
  width: 56px;
}
.pt-th--status {
  min-width: 130px;
  cursor: pointer;
}
.pt-th--update {
  min-width: 190px;
  cursor: pointer;
}
.pt-th--resources {
  width: 100px;
  text-align: center;
}
.pt-th--phases {
  width: 100px;
  text-align: center;
}
.pt-th--qty {
  width: 110px;
  text-align: right;
  cursor: pointer;
}
.pt-th--timeline {
  min-width: 260px;
}
.pt-th--estimation {
  min-width: 100px;
  text-align: right;
}
.pt-th--recognized-month {
  color: var(--accent, #00a56a);
}

.pt-th-inner {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  text-transform: uppercase;
}

/* Data rows */
.pt-row {
  border-bottom: 1px solid var(--surface-3, #f3f4f6);
  transition: background 0.1s;
}
.pt-row:hover {
  background: var(--surface-2, #fafafa);
}
.pt-row--clickable {
  cursor: pointer;
}
.pt-row--selected {
  background: rgba(0, 165, 106, 0.08);
}

/* ── Grid view ── */
.pt-grid-wrap {
  position: relative;
  padding: 16px;
  max-height: calc(100vh - 300px);
  overflow-y: auto;
}

.pt-inline-loader {
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: color-mix(in srgb, var(--surface-1, #ffffff) 74%, transparent);
  backdrop-filter: blur(1px);
}
.pt-inline-loader--table-root {
  position: absolute;
  inset: 0;
}
.pt-grid-wrap > .pt-inline-loader {
  position: absolute;
  inset: 0;
}

.pt-inline-loader__spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-strong, #d1d5db);
  border-top-color: var(--accent, #00a56a);
  border-radius: 50%;
  animation: pt-spin 0.8s linear infinite;
}

.pt-inline-loader__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-h, #111827);
}

@keyframes pt-spin {
  to {
    transform: rotate(360deg);
  }
}
.pt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.pt-card {
  position: relative;
  display: flex;
  flex-direction: row;
  border: 1px solid var(--border-strong, #e5e7eb);
  border-radius: 14px;
  background: var(--surface-1, #fff);
  box-shadow: 0 2px 8px rgba(17, 24, 39, 0.05);
  overflow: hidden;
}
.pt-card--clickable {
  cursor: pointer;
  transition:
    box-shadow 0.18s,
    transform 0.18s,
    border-color 0.18s;
}
.pt-card--clickable:hover {
  box-shadow: 0 10px 28px rgba(17, 24, 39, 0.11);
  transform: translateY(-2px);
  border-color: var(--card-color, var(--accent));
}

/* Left accent stripe */
.pt-card-accent {
  width: 4px;
  flex-shrink: 0;
  background: var(--card-color, var(--border-strong, #e5e7eb));
}

/* Card body */
.pt-card-body {
  flex: 1;
  min-width: 0;
  padding: 14px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Header row: status badge + PM avatar */
.pt-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* Project name */
.pt-card-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-h, #111827);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Customer line */
.pt-card-client {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text, #6b7280);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pt-card-client svg {
  flex-shrink: 0;
  color: var(--text, #9ca3af);
}

/* Financial progress bars */
.pt-card-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--surface-3, #f3f4f6);
}
.pt-card-bar-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pt-card-bar-meta {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.pt-card-bar-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text, #9ca3af);
  flex-shrink: 0;
  width: 68px;
}
.pt-card-bar-val {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-h, #111827);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pt-card-bar-pct {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text, #6b7280);
}
.pt-card-bar-track {
  height: 5px;
  border-radius: 999px;
  background: var(--surface-3, #e5e7eb);
  overflow: hidden;
}
.pt-card-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--accent, #00a56a);
  transition: width 0.4s ease;
}
.pt-card-bar-fill--billed {
  background: #3b82f6;
}

/* Stats row */
.pt-card-stats {
  display: flex;
  gap: 0;
  padding-top: 10px;
  border-top: 1px solid var(--surface-3, #f3f4f6);
}
.pt-card-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0 10px;
}
.pt-card-stat:first-child {
  padding-left: 0;
}
.pt-card-stat:not(:first-child) {
  border-left: 1px solid var(--surface-3, #f3f4f6);
}
.pt-card-stat--date {
  flex: 1.6;
}
.pt-card-stat-val {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-h, #111827);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}
.pt-card-stat-val--sm {
  font-size: 12px;
  font-weight: 600;
}
.pt-card-stat-lbl {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text, #9ca3af);
}

/* Timeline footer */
.pt-card-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--surface-3, #f3f4f6);
  font-size: 11.5px;
  color: var(--text, #6b7280);
}
.pt-card-foot svg {
  flex-shrink: 0;
  color: var(--text, #9ca3af);
}

.pt-empty--grid {
  padding: 24px;
  text-align: center;
  color: var(--text, #9ca3af);
}

.pt-td {
  padding: 11px 12px;
  color: var(--text-h, #374151);
  vertical-align: middle;
}
.pt-td--check {
  padding: 11px 6px 11px 14px;
  width: 40px;
}
.pt-td--num {
  width: 48px;
  min-width: 90px;
  color: var(--text, #9ca3af);
  font-size: 12px;
}
.pt-td--pm {
  width: 56px;
}
.pt-td--customer {
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pt-td--resources {
  text-align: center;
}
.pt-td--phases {
  text-align: center;
}
.pt-td--qty {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.pt-td--recognized {
  text-align: right;
  font-variant-numeric: tabular-nums;
  min-width: 250px;
}
.pt-td--recognized-month {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--text-h, #111827);
  background: color-mix(in srgb, var(--accent, #00a56a) 10%, transparent);
}
.pt-qty {
  display: grid;
  gap: 6px;
  min-width: 110px;
}
.pt-qty-top {
  display: flex;
  align-items: baseline;
  justify-content: space-evenly;
  gap: 8px;
}
.pt-qty-value {
  font-weight: 600;
  color: var(--text-h, #111827);
}
.pt-qty-pct {
  font-size: 11px;
  color: var(--text, #6b7280);
}
.pt-qty-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--surface-3, #e5e7eb);
  overflow: hidden;
}
.pt-qty-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: rgba(0, 165, 106, 0.75);
}
.pt-recognized {
  display: grid;
  gap: 6px;
  min-width: 180px;
}
.pt-recognized-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.pt-recognized-value {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  white-space: nowrap;
  font-weight: 600;
  color: var(--text-h, #111827);
}
.pt-recognized-primary {
  font-size: 1em;
  font-weight: 700;
  color: var(--text-h, #111827);
}
.pt-recognized-secondary {
  font-size: 0.8em;
  font-weight: 500;
  color: var(--text, #9ca3af);
}
.pt-recognized-pct {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text, #6b7280);
}
.pt-recognized-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--surface-3, #e5e7eb);
  overflow: hidden;
}
.pt-recognized-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: rgba(0, 165, 106, 0.75);
}
.pt-td--timeline {
  white-space: nowrap;
}
.pt-td--estimation {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--text-h, #111827);
}
.pt-td--update {
  white-space: nowrap;
}

.pt-check :deep(.v-input__control) {
  min-height: unset;
}
.pt-check :deep(.v-selection-control) {
  min-height: unset;
}

/* Expand btn */
.pt-expand-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text, #d1d5db);
  display: flex;
  align-items: center;
  padding: 2px;
  border-radius: 4px;
  transition: color 0.1s;
}
.pt-row:hover .pt-expand-btn {
  color: var(--text, #9ca3af);
}

/* Project link */
.pt-project-link {
  color: var(--text-h, #686868);
  text-decoration: none;
  font-weight: 500;
  font-size: 13px;
}
.pt-project-link:hover {
  text-decoration: underline;
}

/* Avatar */
.pt-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #fff;
}
.pt-avatar--blue {
  background: #3b82f6;
}
.pt-avatar--teal {
  background: #14b8a6;
}
.pt-avatar--purple {
  background: #a855f7;
}
.pt-avatar--orange {
  background: #f97316;
}
.pt-avatar--green {
  background: #22c55e;
}

/* Last update */
.pt-update {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text, #6b7280);
  font-size: 12.5px;
}

/* Resources */
.pt-resource-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--surface-3, #f3f4f6);
  color: var(--text-h, #374151);
  font-size: 12px;
  font-weight: 600;
}
.pt-add-resource {
  background: none;
  border: 1.5px dashed var(--border-strong, #d1d5db);
  border-radius: 6px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text, #9ca3af);
  cursor: pointer;
  transition:
    border-color 0.1s,
    color 0.1s;
  margin: 0 auto;
}
.pt-add-resource:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* Phases */
.pt-phase-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--surface-3, #f3f4f6);
  color: var(--text-h, #374151);
  font-size: 12px;
  font-weight: 600;
}

/* Timeline */
.pt-timeline-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 6px;
  background: var(--surface-3, #f3f4f6);
  color: var(--text-h, #374151);
  font-size: 12px;
  font-weight: 500;
}
.pt-timeline-pill--empty {
  color: var(--text, #9ca3af);
}
.pt-timeline-arrow {
  color: var(--text, #9ca3af);
}
.pt-timeline-arrow {
  margin: 0 4px;
  vertical-align: middle;
}

/* Estimation */
.pt-estimation {
  font-size: 13px;
}
.pt-estimation-dash {
  color: var(--text, #9ca3af);
}

/* Empty */
.pt-empty {
  text-align: center;
  padding: 48px;
  color: var(--text, #9ca3af);
  font-size: 13.5px;
}

/* ── Pagination ── */
.pt-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--border-strong, #e5e7eb);
  gap: 16px;
  flex-wrap: wrap;
  /* background: #fafafa; */
}

.pt-rpp {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pt-rpp-label {
  font-size: 12px;
  color: var(--text, #6b7280);
  white-space: nowrap;
}
.pt-rpp-select {
  width: 64px;
}
.pt-rpp-select :deep(.v-field__input) {
  font-size: 12px;
  padding: 0 6px;
  min-height: unset;
}
.pt-rpp-select :deep(.v-field) {
  padding: 0 4px;
  height: 30px;
  border-radius: 6px;
  background: var(--surface-1, #fff);
  border: 1px solid var(--border-strong, #d6dfd0);
  align-items: center;
  column-gap: 2px;
  min-width: max-content;
}
.pt-rpp-select :deep(.v-field__append-inner .v-icon) {
  color: var(--text, #6b7280);
}
.pt-rpp-select :deep(.v-field__append-inner) {
  margin-inline-start: 0;
  margin-inline-end: 2px;
  align-self: center;
}
.pt-rpp-select :deep(.v-field__append-inner .v-icon) {
  font-size: 16px;
  margin-bottom: 6px;
}

.pt-page-info {
  font-size: 12px;
  color: var(--text, #6b7280);
  white-space: nowrap;
}

.pt-page-nav {
  display: flex;
  align-items: center;
  gap: 2px;
}
.pt-page-btn {
  min-width: 30px;
  height: 30px;
  padding: 0 6px;
  border: none;
  background: none;
  border-radius: 6px;
  font-size: 13px;
  font-family: 'Inter', sans-serif;
  color: var(--text-h, #374151);
  cursor: pointer;
  transition: background 0.1s;
}
.pt-page-btn:hover:not(.ellipsis):not(:disabled) {
  background: var(--surface-3, #f3f4f6);
}
.pt-page-btn.active {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.pt-page-btn.ellipsis {
  cursor: default;
  color: var(--text, #9ca3af);
}

.pt-goto {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pt-goto-label {
  font-size: 12px;
  color: var(--text, #6b7280);
}
.pt-goto-input {
  width: 52px;
  height: 30px;
  border: 1px solid var(--border-strong, #d6dfd0);
  border-radius: 6px;
  text-align: center;
  font-size: 12px;
  font-family: 'Inter', sans-serif;
  color: var(--text-h, #374151);
  background: var(--surface-1, #fff);
  outline: none;
}
.pt-goto-input:focus {
  border-color: var(--accent);
}
.pt-goto-input::-webkit-inner-spin-button,
.pt-goto-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
}
</style>
