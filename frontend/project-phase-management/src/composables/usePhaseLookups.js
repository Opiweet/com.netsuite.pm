import { computed, ref } from 'vue'
import { useProjectsStore } from '@/stores/projects'

const error = ref(null)
const isLoading = ref(false)

export function usePhaseLookups() {
  const projectsStore = useProjectsStore()

  const salesOrders = computed(() => projectsStore.phaseLookups.salesOrders || [])
  const serviceItems = computed(() => projectsStore.phaseLookups.serviceItems || [])
  const fetchedAt = computed(() => projectsStore.phaseLookups.fetchedAt || 0)

  async function fetchPhaseLookups(options) {
    error.value = null
    isLoading.value = true
    try {
      return await projectsStore.fetchPhaseLookups(options)
    } catch (e) {
      error.value = e
      throw e
    } finally {
      isLoading.value = false
    }
  }

  return {
    salesOrders,
    serviceItems,
    fetchedAt,
    isLoading,
    error,
    fetchPhaseLookups,
  }
}

