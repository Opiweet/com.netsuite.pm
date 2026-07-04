import { createRouter, createWebHashHistory } from 'vue-router'
import Projects from '../views/Projects.vue'
import Project from '../views/Project.vue'
import RevenueManagementList from '../views/RevenueManagementList.vue'
import RevenueManagementDetail from '../views/RevenueManagementDetail.vue'
import BulkUpload from '../views/BulkUpload.vue'
import BulkUploadPhase from '../views/BulkUploadPhase.vue'
import BulkUploadRevPlan from '../views/BulkUploadRevPlan.vue'
import AdminRbac from '../views/AdminRbac.vue'
import { useProjectsStore } from '@/stores/projects'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'projects',
      component: Projects,
      meta: { title: 'Projects' },
    },
    {
      path: '/projects/bulk-upload',
      name: 'bulk-upload',
      component: BulkUpload,
      meta: {
        title: 'Bulk Upload',
        subtitle: 'Choose what you want to upload.',
      },
    },
    {
      path: '/projects/bulk-upload/phases',
      name: 'bulk-phase-upload',
      component: BulkUploadPhase,
      meta: {
        title: 'Bulk Upload Phases',
        subtitle: 'Upload multiple phases into a selected project.',
        requiredCapability: 'phase.upsert',
      },
    },
    {
      path: '/projects/bulk-upload/rev-plans',
      name: 'bulk-revplan-upload',
      component: BulkUploadRevPlan,
      meta: {
        title: 'Bulk Upload Revenue Allocations',
        subtitle: 'Upload revenue plans allocations into a selected project.',
        requiredCapability: 'revplan.update',
      },
    },
    {
      path: '/projects/:projectId',
      name: 'project-detail',
      component: Project,
      props: true,
      meta: { title: 'Project Details' },
    },
    {
      path: '/revenue-management',
      name: 'revenue-list',
      component: RevenueManagementList,
      meta: {
        title: 'Revenue Management',
        subtitle: 'Select a project to view revenue details and allocations.',
        requiredCapability: 'revplan.view',
      },
    },
    {
      path: '/revenue-management/:projectId',
      name: 'revenue-detail',
      component: RevenueManagementDetail,
      props: true,
      meta: { title: 'Revenue Management', requiredCapability: 'revplan.view' },
    },
    {
      path: '/admin/rbac',
      name: 'admin-rbac',
      component: AdminRbac,
      meta: {
        title: 'RBAC Admin',
        subtitle: 'View and manage role capability mappings.',
        requiredCapability: 'rbac.manage',
      },
    },
  ],
})

router.beforeEach(async (to, from) => {
  const projectsStore = useProjectsStore()

  // On browser reload the initial navigation has from.matched === [] (no previous route).
  // Always await initData in that case so RBAC is established before any capability check.
  const isInitialLoad = from.matched.length === 0
  if (isInitialLoad && !projectsStore.initData?.fetchedAt) {
    await projectsStore.fetchInitData().catch(() => {})
  }

  const requiredCapability = String(to.meta?.requiredCapability || '').trim()
  if (!requiredCapability) return true

  // fetchedAt is the real indicator that initData has been loaded — the store's
  // default state already has capabilities: [] so Array.isArray() is always true
  // and cannot be used as a loaded-check.
  if (!projectsStore.initData?.fetchedAt) {
    await projectsStore.fetchInitData().catch(() => {})
  }

  // If the fetch failed and RBAC data is unavailable, redirect with a distinct
  // error flag so the user sees "failed to load permissions" rather than a false
  // "unauthorized" message. Do not let them through to a restricted page.
  if (!projectsStore.initData?.fetchedAt) {
    return { name: 'projects', query: { authLoadError: '1' } }
  }

  const globalCaps = new Set(
    projectsStore.initData.authz.capabilities.filter(Boolean).map(String),
  )
  const pid = String(to.params?.projectId || to.query?.projectId || '').trim()
  if (pid) {
    if (!projectsStore.projectLoadByProject?.[pid]) {
      await projectsStore.fetchProjectLoad({ projectId: pid }).catch(() => {})
    }
    const scoped = Array.isArray(projectsStore.projectLoadByProject?.[pid]?.authz?.capabilities)
      ? projectsStore.projectLoadByProject[pid].authz.capabilities
      : []
    scoped.forEach((capability) => globalCaps.add(String(capability)))
  }

  if (globalCaps.has(requiredCapability)) return true
  return { name: 'projects', query: { unauthorized: '1' } }
})

export default router
