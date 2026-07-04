<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import SlidingDrawer from '@/components/SlidingDrawer.vue'
import RelatedRecordsIcon from '@/components/icons/RelatedRecordsIcon.vue'
import { useProjectsStore } from '@/stores/projects'
import { formatMoney } from '@/common'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: 'Related Records' },
  projectId: { type: [String, Number], default: null },
})

const emit = defineEmits(['update:modelValue'])
const collapsedByTitle = ref({})
const route = useRoute()
const projectsStore = useProjectsStore()

const resolvedProjectId = computed(() => {
  const fromProp = String(props.projectId ?? '').trim()
  if (fromProp) return fromProp
  return String(route.params.projectId ?? '').trim()
})

const safeSections = computed(() => {
  const records = projectsStore.projectLoadByProject[resolvedProjectId.value]?.relatedRecords || {}
  const normalizeRows = (rows) => (Array.isArray(rows) ? rows : [])
  const baseOrigin = (() => {
    const fromInit = String(projectsStore.initData?.links?.netsuiteHomeUrl || '').trim()
    if (fromInit) {
      try {
        return new URL(fromInit).origin
      } catch {
        // ignore
      }
    }
    if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
    return ''
  })()
  const withMeta = (row, sectionTitle = '') => {
    const id = row?.id != null ? String(row.id) : ''
    const tranId = String(row?.tranId || row?.tranid || '').trim()
    const date = String(row?.tranDate || row?.trandate || '').trim()
    const amountNumber =
      row?.appliedAmount != null && Number.isFinite(Number(row.appliedAmount))
        ? Number(row.appliedAmount)
        : row?.amount != null && Number.isFinite(Number(row.amount))
          ? Number(row.amount)
          : null
    return {
      label: tranId || (id ? `#${id}` : '—'),
      meta: [id ? `#${id}` : '', date].filter(Boolean).join(' • '),
      amount: amountNumber != null ? formatMoney(amountNumber) : null,
      badgeLabel:
        String(sectionTitle).toLowerCase() === 'journals'
          ? Boolean(row?.isVoided)
            ? 'Voided'
            : Boolean(row?.isReversal)
              ? 'Reversal'
              : ''
          : '',
      href:
        id && baseOrigin ? `${baseOrigin}/app/accounting/transactions/transaction.nl?id=${id}` : '',
    }
  }

  return [
    {
      title: 'Sales Orders',
      items: normalizeRows(records.salesOrders).map((row) => withMeta(row, 'Sales Orders')),
    },
    {
      title: 'Invoices',
      items: normalizeRows(records.invoices).map((row) => withMeta(row, 'Invoices')),
    },
    {
      title: 'Purchase Orders',
      items: normalizeRows(records.purchaseOrders).map((row) => withMeta(row, 'Purchase Orders')),
    },
    {
      title: 'Vendor Bills',
      items: normalizeRows(records.vendorBills).map((row) => withMeta(row, 'Vendor Bills')),
    },
    {
      title: 'Inventory Adjustments',
      items: normalizeRows(records.inventoryAdjustments).map((row) =>
        withMeta(row, 'Inventory Adjustments'),
      ),
    },
    {
      title: 'Credit Memos',
      items: normalizeRows(records.creditMemos).map((row) => withMeta(row, 'Credit Memos')),
    },
    {
      title: 'Journals',
      items: normalizeRows(records.journals).map((row) => withMeta(row, 'Journals')),
    },
  ].filter((section) => section.title || section.items.length)
})

watch(
  safeSections,
  (sections) => {
    const next = {}
    sections.forEach((section) => {
      const key = String(section?.title || '')
      next[key] = collapsedByTitle.value[key] === true
    })
    collapsedByTitle.value = next
  },
  { immediate: true },
)

function isCollapsed(sectionTitle) {
  return Boolean(collapsedByTitle.value[String(sectionTitle || '')])
}

function toggleSection(sectionTitle) {
  const key = String(sectionTitle || '')
  collapsedByTitle.value = {
    ...collapsedByTitle.value,
    [key]: !Boolean(collapsedByTitle.value[key]),
  }
}

function closePanel() {
  emit('update:modelValue', false)
}
</script>

<template>
  <SlidingDrawer
    :model-value="modelValue"
    :aria-label="title"
    :title="title"
    width="min(420px, 92vw)"
    body-class="rr-body"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #title>
      <h3 class="rr-title">
        <RelatedRecordsIcon class="rr-title-icon" />
        <span>{{ title }}</span>
      </h3>
    </template>
    <div class="related-records-sections">
      <section v-for="section in safeSections" :key="section.title" class="rr-section">
        <button type="button" class="rr-section-head" @click="toggleSection(section.title)">
          <h4 class="rr-section-title">{{ section.title }}</h4>
          <i
            class="rr-section-toggle mdi"
            :class="isCollapsed(section.title) ? 'mdi-chevron-right' : 'mdi-chevron-down'"
          ></i>
        </button>
        <div v-if="!isCollapsed(section.title) && section.items.length" class="rr-list">
          <div
            v-for="(item, idx) in section.items"
            :key="`${section.title}-${idx}`"
            class="rr-item"
          >
            <a
              v-if="item?.href"
              class="rr-item-label rr-item-link"
              :href="item.href"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ item?.label || '—' }}
            </a>
            <div v-else class="rr-item-label">{{ item?.label || '—' }}</div>
            <span v-if="item?.badgeLabel" class="rr-item-badge">{{ item.badgeLabel }}</span>
            <div v-if="item?.meta" class="rr-item-meta">{{ item.meta }}</div>
            <div v-if="item?.amount != null" class="rr-item-amount">{{ item.amount }}</div>
          </div>
        </div>
        <div v-else-if="!isCollapsed(section.title)" class="rr-empty">No related records.</div>
      </section>
    </div>
  </SlidingDrawer>
</template>

<style scoped>
.related-records-sections {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
}

.rr-title {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  color: var(--text-h, #1f2b1f);
}

.rr-title-icon {
  width: 20px;
  height: 20px;
  stroke-width: 1.5px;
}

.rr-body {
  padding: 12px 14px 16px;
  display: grid;
  gap: 12px;
}

.rr-section {
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 10px;
  padding: 10px;
}

.rr-section-title {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text, #7b8a7b);
}

.rr-section-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
}

.rr-section-toggle {
  color: var(--text, #7b8a7b);
  font-size: 14px;
  line-height: 1;
}

.rr-list {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.rr-item {
  border: 1px solid var(--border, rgba(15, 23, 42, 0.08));
  border-radius: 8px;
  padding: 8px 10px;
}

.rr-item-label {
  font-size: 13px;
  color: var(--text-h, #1f2b1f);
  font-weight: 500;
  word-break: break-word;
}

.rr-item-badge {
  display: inline-block;
  margin-top: 4px;
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: normal;
  background: rgba(59, 130, 246, 0.14);
  color: #1d4ed8;
  border: 1px solid rgba(59, 130, 246, 0.4);
}

.rr-item-link {
  color: var(--accent, #00a56a);
  text-decoration: none;
}

.rr-item-link:hover {
  text-decoration: underline;
}

.rr-item-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text, #6b7280);
  word-break: break-word;
}

.rr-item-amount {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-h, #1f2b1f);
}

.rr-empty {
  font-size: 12px;
  color: var(--text, #6b7280);
}

.rr-fade-enter-active,
.rr-fade-leave-active {
  transition: opacity 0.18s ease;
}
.rr-fade-enter-from,
.rr-fade-leave-to {
  opacity: 0;
}

.rr-slide-enter-active,
.rr-slide-leave-active {
  transition: transform 0.22s ease;
}
.rr-slide-enter-from,
.rr-slide-leave-to {
  transform: translateX(100%);
}
</style>
