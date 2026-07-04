import { defineStore } from 'pinia'

const STORAGE_KEY = 'ppm_sidebar_collapsed'

function readCollapsedFromStorage() {
  try {
    const raw = window?.localStorage?.getItem(STORAGE_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
    return null
  } catch {
    return null
  }
}

function writeCollapsedToStorage(value) {
  try {
    window?.localStorage?.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    // ignore storage errors
  }
}

function getSystemDefaultCollapsed() {
  if (typeof window === 'undefined') return false
  // Treat smaller viewports as "system" preference to start collapsed.
  return window.matchMedia?.('(max-width: 980px)')?.matches ?? false
}

export const useUiStore = defineStore('ui', {
  state: () => ({
    sidebarCollapsed: false,
    initialized: false,
  }),
  actions: {
    init() {
      if (this.initialized) return
      const stored = readCollapsedFromStorage()
      if (stored !== null) this.sidebarCollapsed = stored
      else this.sidebarCollapsed = getSystemDefaultCollapsed()
      this.initialized = true
    },
    setSidebarCollapsed(value) {
      this.sidebarCollapsed = Boolean(value)
      writeCollapsedToStorage(this.sidebarCollapsed)
    },
    toggleSidebarCollapsed() {
      this.setSidebarCollapsed(!this.sidebarCollapsed)
    },
  },
})
