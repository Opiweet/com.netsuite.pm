<script setup>
import { computed } from 'vue'

const props = defineProps({
  project: { type: Object, default: null },
  projectHref: { type: String, default: '' },
  isProcessing: { type: Boolean, default: false },
  showRevPlanStatus: { type: Boolean, default: false },
  emptyTitle: { type: String, default: 'No project selected' },
  emptySubtitle: { type: String, default: 'Project details will appear here' },
})

const statusStyle = computed(() => {
  const color = String(props.project?.statusColor || '').trim()
  if (!color) return null
  return {
    background: `${color}18`,
    color,
    borderColor: `${color}55`,
  }
})

const revPlanStatusStyle = computed(() => {
  const key = String(props.project?.revPlanStatus?.key || '')
    .trim()
    .toLowerCase()
  if (key === 'completed') {
    return {
      background: 'rgba(0, 165, 106, 0.12)',
      color: 'var(--accent, #00a56a)',
      borderColor: 'rgba(0, 165, 106, 0.45)',
    }
  }
  if (key === 'rev_rec_ready') {
    return {
      background: 'rgba(245, 158, 11, 0.14)',
      color: '#d97706',
      borderColor: 'rgba(245, 158, 11, 0.45)',
    }
  }
  if (key === 'cancelled') {
    return {
      background: 'rgba(220, 38, 38, 0.12)',
      color: '#dc2626',
      borderColor: 'rgba(220, 38, 38, 0.45)',
    }
  }
  if (key === 'open') {
    return {
      background: 'rgba(148, 163, 184, 0.16)',
      color: '#475569',
      borderColor: 'rgba(148, 163, 184, 0.45)',
    }
  }
  return null
})
</script>

<template>
  <div v-if="project" class="bpu-project-detail">
    <div class="bpu-pd-header">
      <div class="bpu-pd-header--right">
        <div class="bpu-pd-name" :title="project.name">
          {{ project.name }}
        </div>
        <span v-if="project.status?.label" class="bpu-pd-status-badge" :style="statusStyle || {}">
          {{ project.status.label }}
        </span>
        <span
          v-if="showRevPlanStatus && project.revPlanStatus?.label"
          class="bpu-pd-status-badge"
          :style="revPlanStatusStyle || {}"
        >
          {{ project.revPlanStatus.label }}
        </span>
        <span
          v-if="isProcessing"
          class="bpu-pd-status-badge"
          style="
            background: rgba(245, 158, 11, 0.16);
            color: #d97706;
            border-color: rgba(245, 158, 11, 0.45);
          "
        >
          🔒 Processing
        </span>
      </div>

      <a
        v-if="projectHref"
        :href="projectHref"
        target="_blank"
        rel="noopener"
        class="bpu-pd-open-btn"
        title="Open project in new tab"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="13"
          height="13"
        >
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </a>
    </div>

    <p v-if="project.description" class="bpu-pd-desc">
      {{ project.description }}
    </p>

    <div class="bpu-pd-stats">
      <div class="bpu-pd-stat">
        <svg
          width="21"
          height="21"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="bpu-pd-stat-icon"
        >
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 12h6M9 16h4" />
        </svg>
        <div class="bpu-pd-stat-body">
          <span class="bpu-pd-stat-value">{{ project.phases ?? '—' }}</span>
          <span class="bpu-pd-stat-label">Phases</span>
        </div>
      </div>
      <div v-if="project.timelineStart" class="bpu-pd-stat">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="bpu-pd-stat-icon"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <div class="bpu-pd-stat-body">
          <span class="bpu-pd-stat-value">{{ project.timelineStart }}</span>
          <span class="bpu-pd-stat-label">Start date</span>
        </div>
      </div>
      <div v-if="project.timelineEnd" class="bpu-pd-stat">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="bpu-pd-stat-icon"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
          <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
        </svg>
        <div class="bpu-pd-stat-body">
          <span class="bpu-pd-stat-value">{{ project.timelineEnd }}</span>
          <span class="bpu-pd-stat-label">End date</span>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="bpu-project-detail bpu-project-detail--empty">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      width="28"
      height="28"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </svg>
    <div>
      <div class="bpu-pd-empty-title">{{ emptyTitle }}</div>
      <div class="bpu-pd-empty-sub">{{ emptySubtitle }}</div>
    </div>
  </div>
</template>

<style scoped>
.bpu-project-detail {
  background: var(--surface-1, #fff);
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 12px;
  padding: 18px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 140px;
}

.bpu-project-detail--empty {
  border-left-color: var(--border-strong, #e1e6dc);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--text, #6b7280);
  opacity: 0.55;
}

.bpu-pd-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-h);
  line-height: normal;
}

.bpu-pd-empty-sub {
  font-size: 12px;
  color: var(--text, #6b7280);
  margin-top: 2px;
}

.bpu-pd-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.bpu-pd-header--right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bpu-pd-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-h);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bpu-pd-status-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  border: 1px solid var(--border-strong, #e1e6dc);
  background: var(--surface-2, #f7faf8);
  color: var(--text, #6b7280);
  white-space: nowrap;
  line-height: 1.5;
}

.bpu-pd-desc {
  font-size: 12px;
  color: var(--text, #6b7280);
  line-height: 1.55;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  overflow: hidden;
  text-align: start;
}

.bpu-pd-stats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.bpu-pd-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: var(--surface-2, #f7faf8);
  border: 1px solid var(--border-strong, #e1e6dc);
  border-radius: 9px;
  padding: 7px 11px;
  flex: 1;
  min-width: 90px;
}

.bpu-pd-stat-icon {
  color: var(--accent, #00a56a);
  flex-shrink: 0;
}

.bpu-pd-stat-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.bpu-pd-stat-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-h);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bpu-pd-stat-label {
  font-size: 9px;
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text, #6b7280);
  line-height: 1;
}

.bpu-pd-open-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent, #00a56a);
  text-decoration: none;
  padding: 4px;
  border-radius: 6px;
  border: 1px solid var(--accent, #00a56a);
  background: transparent;
  transition:
    background 0.15s,
    color 0.15s;
  line-height: 1;
}

.bpu-pd-open-btn:hover {
  background: var(--accent, #00a56a);
  color: #fff;
}
</style>
