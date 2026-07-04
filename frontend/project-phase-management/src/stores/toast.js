import { defineStore } from 'pinia'

let nextToastId = 1

export const useToastStore = defineStore('toast', {
  state: () => ({
    items: [],
  }),
  actions: {
    show({ message, variant = 'info', durationMs } = {}) {
      const text = String(message || '').trim()
      if (!text) return null

      const id = String(nextToastId++)
      const normalizedVariant = String(variant || 'info')
      const toast = {
        id,
        message: text,
        variant: normalizedVariant,
        createdAt: Date.now(),
      }

      this.items.push(toast)

      const defaultDurationMs = normalizedVariant === 'error' ? 10000 : 2500
      const resolvedDurationMs =
        durationMs == null ? defaultDurationMs : Math.max(0, Number(durationMs) || 0)
      const ms = resolvedDurationMs
      if (ms > 0) {
        setTimeout(() => this.dismiss(id), ms)
      }

      return id
    },
    dismiss(id) {
      const key = String(id || '')
      this.items = this.items.filter((t) => String(t?.id || '') !== key)
    },
    clear() {
      this.items = []
    },
  },
})
