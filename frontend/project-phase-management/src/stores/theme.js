import { defineStore } from 'pinia'

const STORAGE_KEY = 'ppm_theme'

function getPreferredMode() {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
}

function applyThemeMode(mode) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = mode
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: 'light',
    initialized: false,
  }),
  getters: {
    isDark: (state) => state.mode === 'dark',
  },
  actions: {
    init() {
      if (this.initialized) return

      let mode = null
      try {
        mode = window?.localStorage?.getItem(STORAGE_KEY) || null
      } catch {
        mode = null
      }

      if (mode !== 'dark' && mode !== 'light') mode = getPreferredMode()
      this.mode = mode
      applyThemeMode(this.mode)
      this.initialized = true
    },
    setMode(mode) {
      if (mode !== 'dark' && mode !== 'light') return
      this.mode = mode
      applyThemeMode(mode)
      try {
        window?.localStorage?.setItem(STORAGE_KEY, mode)
      } catch {
        // ignore storage errors
      }
    },
    toggle() {
      this.setMode(this.isDark ? 'light' : 'dark')
    },
  },
})

