import { getProjectBannerUi, getRevPlanBannerUi } from '@/common'
import { useAuthz } from '@/composables/useAuthz'

export function useBannerUi({ projectId = null } = {}) {
  const { can } = useAuthz({ projectId })

  function resolveProjectBannerUi(code) {
    const key = String(code || '')
      .trim()
      .toLowerCase()
    switch (key) {
      case 'no_phases_hint': {
        if (!can('phase.upsert')) {
          return {
            message:
              'No phases exist for this project, and you do not have sufficient permission to add them.',
            html: false,
            variant: 'warning',
          }
        }
        break
      }
      case 'activate_hint': {
        if (!(can('project.activate') || can('project.status.transition'))) {
          return {
            message:
              'This project is ready to be activated, but you do not have sufficient permission to perform this action.',
            html: false,
            variant: 'warning',
          }
        }
        break
      }
      case 'completion_ready_hint': {
        if (!(can('project.complete') || can('project.status.transition'))) {
          return {
            message:
              'This project is ready to be completed, but you do not have sufficient permission to perform this action.',
            html: false,
            variant: 'warning',
          }
        }
        break
      }
      case 'close_ready_hint': {
        if (!(can('project.close') || can('project.status.transition'))) {
          return {
            message:
              'This project is ready to be closed, but you do not have sufficient permission to perform this action.',
            html: false,
            variant: 'warning',
          }
        }
        break
      }
      case 'revplan_notice_missing_plans':
      case 'revplan_notice_ready_to_generate': {
        if (!(can('revplan.generate') || can('revplan.update'))) {
          return {
            message:
              'Revenue plans require action, but you do not have sufficient permission to perform this action.',
            html: false,
            variant: 'warning',
          }
        }
        break
      }
      default:
        break
    }
    return getProjectBannerUi(code)
  }

  function resolveRevPlanBannerUi(code) {
    const key = String(code || '')
      .trim()
      .toLowerCase()
    switch (key) {
      case 'revplan_notice_missing_plans':
      case 'revplan_notice_ready_to_generate':
      case 'missing_rev_plans_detected': {
        if (!(can('revplan.generate') || can('revplan.update'))) {
          return {
            message:
              'Revenue plans require action, but you do not have sufficient permission to perform this action.',
            html: false,
            variant: 'warning',
          }
        }
        break
      }
      default:
        break
    }
    return getRevPlanBannerUi(code)
  }

  return {
    resolveProjectBannerUi,
    resolveRevPlanBannerUi,
  }
}
