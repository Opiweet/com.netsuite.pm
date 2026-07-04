import { computed } from 'vue'
import { useProjectsStore } from '@/stores/projects'

function asSet(values) {
  return new Set((Array.isArray(values) ? values : []).filter(Boolean).map(String))
}

export function useAuthz({ projectId = null } = {}) {
  const projectsStore = useProjectsStore()

  const globalCapabilities = computed(() =>
    asSet(projectsStore.initData?.authz?.capabilities || []),
  )

  const scopedCapabilities = computed(() => {
    const pid = String(projectId?.value ?? projectId ?? '').trim()
    if (!pid) return new Set()
    const load = projectsStore.projectLoadByProject?.[pid]
    return asSet(load?.authz?.capabilities || [])
  })

  const capabilities = computed(() => {
    const merged = new Set(globalCapabilities.value)
    scopedCapabilities.value.forEach((capability) => merged.add(capability))
    return merged
  })

  function can(capability) {
    return capabilities.value.has(String(capability || '').trim())
  }

  function cannot(capability) {
    return !can(capability)
  }

  return {
    capabilities,
    can,
    cannot,
  }
}
