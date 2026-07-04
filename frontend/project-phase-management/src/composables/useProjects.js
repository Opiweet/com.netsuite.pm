import { computed, ref } from 'vue'
import { useProjectsStore } from '@/stores/projects'

const error = ref(null)
const isLoading = ref(false)

export function useProjects() {
  const projectsStore = useProjectsStore()

  const projects = computed(() => projectsStore.projects || [])
  const fetchedAt = computed(() => projectsStore.projectsFetchedAt || 0)

  async function fetchProjects(options) {
    error.value = null
    isLoading.value = true
    try {
      return await projectsStore.fetchProjects(options)
    } catch (e) {
      error.value = e
      throw e
    } finally {
      isLoading.value = false
    }
  }

  return {
    projects,
    fetchedAt,
    isLoading,
    error,
    fetchProjects,
  }
}

