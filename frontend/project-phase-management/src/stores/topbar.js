import { defineStore } from 'pinia'
import { markRaw } from 'vue'

export const useTopbarStore = defineStore('topbar', {
  state: () => ({
    title: '',
    subtitle: '',
    backRouteName: null,
    actions: [],
  }),
  actions: {
    setTopbar({ title = '', subtitle = '', backRouteName = null, actions = [] } = {}) {
      this.title = title
      this.subtitle = subtitle
      this.backRouteName = backRouteName
      const safeActions = Array.isArray(actions) ? actions : []
      this.actions = safeActions.map((action) => {
        const icon = action?.icon
        const shouldMarkRaw = icon && (typeof icon === 'object' || typeof icon === 'function')
        return { ...action, icon: shouldMarkRaw ? markRaw(icon) : icon }
      })
    },
    setActionLoading(key, isLoading) {
      const action = this.actions.find((item) => item.key === key)
      if (!action) return
      action.loading = isLoading
    },
    clearTopbar() {
      this.title = ''
      this.subtitle = ''
      this.backRouteName = null
      this.actions = []
    },
  },
})
