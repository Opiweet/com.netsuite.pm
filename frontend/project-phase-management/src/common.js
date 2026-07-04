export const formatMoney = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return '$0'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
  } catch (e) {
    return `$${n.toFixed(2)}`
  }
}

export const formatMoneyCompact = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return '$0'
  if (Math.abs(n) < 1000000) return formatMoney(n)
  const abs = Math.abs(n)
  const tiers = [
    { min: 1_000_000_000_000, suffix: 'T' },
    { min: 1_000_000_000, suffix: 'B' },
    { min: 1_000_000, suffix: 'M' },
  ]
  const tier = tiers.find((t) => abs >= t.min)
  if (!tier) return formatMoney(n)

  const scaled = abs / tier.min
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
  const scaledText = scaled
    .toFixed(decimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1')

  return `${n < 0 ? '-' : ''}$${scaledText}${tier.suffix}`
}

export const getRevPlanBannerUi = (code) => {
  const key = String(code || '')
    .trim()
    .toLowerCase()
  if (!key) return { message: '', html: false }

  const map = {
    locked_for_jnl_proc: {
      message:
        'Project is locked for Rev Rec journal background processing. Revenue plan actions are temporarily disabled.',
      html: false,
    },
    project_completed: {
      message:
        'This project has been completed. Revenue plan editing is no longer allowed, but Rev Rec journals may still be generated.',
      html: false,
    },
    project_closed: {
      message:
        'This project has been closed. Revenue plan editing and Rev Rec journal generation are no longer allowed.',
      html: false,
    },
    plan_generation_blocked_no_phase: {
      message:
        'Revenue plans can’t be generated because the project has no phases. Go to the Project page to add phases first.',
      html: false,
    },
    plan_generation_blocked_inactive: {
      message:
        'Revenue plans can’t be generated because the project is not active. Please activate the project first.',
      html: false,
    },
    plan_generation_blocked_financial_mismatch: {
      message:
        'Revenue plans can’t be generated because there’s a mismatch between the project and the sales order amount(s). Please resolve the discrepancy first.',
      html: false,
    },
    plan_generation_blocked_inactive_financial_mismatch: {
      message:
        'Revenue plans can’t be generated because the project is not active and there’s a mismatch with the sales order amount(s). Please fix the discrepancy and activate the project.',
      html: false,
    },
    plan_generation_blocked_financial_error: {
      message:
        'Revenue plans can’t be generated because project financials/variance could not be calculated. Please check configuration and try again.',
      html: false,
    },
    plan_generation_blocked_other: {
      message: 'Revenue plans can’t be generated for this project.',
      html: false,
    },
    variance_mismatch: {
      message:
        'There’s a mismatch between the project and the sales order amount(s). Please resolve the discrepancy before updating rev plans.',
      html: false,
    },
    no_rev_plans: {
      message: 'No revenue plans found for this project.',
      html: false,
    },
    month_mismatch: {
      message:
        'Warning: Revenue plan months do not match the project start/end date range. Please generate/update the revenue plan before allocation.',
      html: false,
    },
    plan_tally_mismatch: {
      message:
        'Some phases have missing revenue plans. Please generate the missing revenue plans before continuing.',
      html: false,
    },
    revplan_status_conflict: {
      message: 'This project has mixed rev plan statuses. Align statuses before bulk upload.',
      html: false,
    },
    rev_rec_ready_locked: {
      message: 'Rev plans are marked Rev Rec Ready and are locked for editing.',
      html: false,
    },
    completion_ready_hint: {
      message:
        'This project has been fully recognised and can be completed. Please click <strong>Go to Project</strong> and update the project status.<br/><br/>Note: Once completed, rev plans can still be viewed and Rev Rec journals can still be generated, but rev plans can no longer be edited.</strong>',
      html: true,
    },
    close_ready_hint: {
      message:
        'This project has been fully recognised and invoiced and can be closed. Please click <strong>Go to Project</strong> and update the project status.',
      html: true,
    },
    post_journal_forecast_only: {
      message:
        'Rev Rec journal has been generated for the latest completed actual month scope. Actual rev plans already completed are locked. You can still edit the remaining open month allocations and forecast rev plans.',
      html: false,
    },
    rev_rec_journal_ready: {
      message:
        'Revenue plans with status <code>Rev Rec Ready</code> have been detected. Please click on <strong>Generate Rev Rec Journal</strong> to generate the revenue recognition journal.',
      html: true,
    },
    missing_rev_plans_detected: {
      message:
        'Missing rev plans detected. Please click on Generate Revenue Plan to fix this before you continue.',
      html: false,
    },
    revplan_notice_missing_plans: {
      message:
        'There are some missing rev plans that need to be generated. Please click on Generate Revenue Plan button.',
      html: false,
    },
    revplan_notice_ready_to_generate: {
      message: 'Rev plans are ready to be generated.',
      html: false,
    },
  }

  return map[key] || { message: 'Rev plans are not editable for this project.', html: false }
}

export const getProjectBannerUi = (code) => {
  const key = String(code || '')
    .trim()
    .toLowerCase()
  if (!key) return { message: '', html: false }

  const map = {
    locked_for_jnl_proc: {
      message:
        'Project is currently locked for Rev Rec journal background processing. No project, phase, rev plan, or bulk update actions are allowed right now.',
      html: false,
    },
    project_completed_frozen: {
      message:
        'This project has been completed. Allocation editing is no longer allowed, but it can still be closed once invoiced amount (excl. credit notes) reaches the project total.',
      html: false,
    },
    project_closed_frozen: {
      message: 'This project has been closed. Editing is not allowed.',
      html: false,
    },
    activate_hint: {
      message:
        'This project can be activated. Click the menu (⋮) and choose <strong>Activate Project</strong>.',
      html: true,
    },
    completion_ready_hint: {
      message:
        'This project can be completed. Click the menu (⋮) and choose <strong>Mark Complete</strong>.<br/><br/>Note: Once completed, rev plans can still be viewed and Rev Rec journals can still be generated, but rev plans can no longer be edited.</strong>',
      html: true,
    },
    close_ready_hint: {
      message:
        'This project has been fully recognised and invoiced and can be closed. Click the menu (⋮) and choose <strong>Close Project</strong>.',
      html: true,
    },
    missing_sales_order: {
      message:
        'Please link a sales order to the project. Note that no phases can be added until a sales order is linked.',
      html: false,
    },
    no_phases_hint: {
      message:
        'No phases yet. To add a phase, click <strong>Edit</strong> in the Project Phases section below, then click <strong>Add</strong>.',
      html: true,
    },
    revplan_notice_missing_plans: {
      message:
        'There are some missing rev plans that need to be generated. Please click on <strong>Manage Rev Plans</strong> to do this.',
      html: true,
    },
    revplan_notice_ready_to_generate: {
      message:
        'Rev plans are ready to be generated. Please click on <strong>Manage Rev Plans</strong> to do this.',
      html: true,
    },
  }

  return map[key] || { message: '', html: false }
}
