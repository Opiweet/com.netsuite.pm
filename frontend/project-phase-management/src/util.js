export function deepCloneJson(value, fallback = []) {
  if (!value) return fallback
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return fallback
  }
}

export function normalizeQty(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function calculateRemainingQty(row, monthColumns) {
  const months = Array.isArray(monthColumns) ? monthColumns : []
  const allocated = months.reduce((sum, month) => sum + normalizeQty(row?.months?.[month?.key]), 0)
  const contingency = normalizeQty(row?.contingency)
  return normalizeQty(row?.qty) - allocated - contingency
}

export function cumulativeActualQtyAtIndex(rows, monthColumns, index) {
  const safeRows = Array.isArray(rows) ? rows : []
  if (!safeRows.length) return 0

  const at = Math.min(Math.max(Number(index) || 0, 0), safeRows.length - 1)
  const row = safeRows[at] || {}
  const months = Array.isArray(monthColumns) ? monthColumns : []

  return months.reduce((sum, month) => {
    const type = String(month?.type || '').toLowerCase()
    if (type === 'forecast') return sum
    return sum + normalizeQty(row?.months?.[month?.key])
  }, 0)
}

export function computeAllocationDirty({ baselineRows, currentRows, monthColumns }) {
  const keys = (Array.isArray(monthColumns) ? monthColumns : [])
    .map((m) => String(m?.key || ''))
    .filter(Boolean)

  const baseline = Array.isArray(baselineRows) ? baselineRows : []
  const current = Array.isArray(currentRows) ? currentRows : []

  if (baseline.length !== current.length) return true

  const baselineByPhaseId = new Map(
    baseline.map((row) => [String(row?.phaseId || ''), row]).filter(([phaseId]) => phaseId),
  )

  for (let i = 0; i < current.length; i++) {
    const row = current[i]
    const phaseId = String(row?.phaseId || '')
    if (!phaseId) return true
    const baseRow = baselineByPhaseId.get(phaseId)
    if (!baseRow) return true

    for (let k = 0; k < keys.length; k++) {
      const key = keys[k]
      if (normalizeQty(baseRow?.months?.[key]) !== normalizeQty(row?.months?.[key])) return true
    }

    if (normalizeQty(baseRow?.contingency) !== normalizeQty(row?.contingency)) return true

    if (String(row?.notes || '') !== String(baseRow?.notes || '')) return true
  }

  return false
}

export function joinLabels(labels) {
  const out = Array.isArray(labels)
    ? labels.map((v) => String(v || '').trim()).filter(Boolean)
    : []
  if (!out.length) return '—'
  if (out.length === 1) return out[0]
  if (out.length === 2) return `${out[0]} and ${out[1]}`
  return `${out.slice(0, -1).join(', ')}, and ${out[out.length - 1]}`
}

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
}
