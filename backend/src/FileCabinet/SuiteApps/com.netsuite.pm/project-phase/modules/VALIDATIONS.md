# Validations (Project Phase / Revenue Plans)

This folder contains both **feature modules** (project, phases, rev plans) and shared **validation utilities**.

Goal: keep “core” validations centralized so it’s easy to answer:

- What is validated?
- Where is it enforced (read vs write)?
- What error message/code do we return?

## Shared validator module

`core/validator.js` is the shared source of truth for reusable rules:

- `validateActiveAndZeroVariance({ status, statusKey, statusName, financials, message })`
  - accepts canonical status object/key (`status`, `statusKey`) and compares using backend status keys
- `validatePhaseMonthKeysMatchExpected({ expectedKeys, phaseMonthKeys })`
- `isZeroVariance(financials, eps)`
- `getExpectedProjectMonthsAndKeys(startDate, endDate)`
- `buildUpdateRevenuePlansUpdates({ projectId, phasesData, phaseLineById, planInfoById })`
- `validatePhaseCumulativeQtyBounds({ phaseId, planId, currentTotal, oldQty, newQty, maxQty })`

## Feature validations

### `project_mod.js`

- `activateProject({ projectId })`
  - Project exists (lookup)
  - Project not already `Active`
  - Has at least 1 phase (`project_phase_mod.getProjectPhases`)
  - Zero variance (`validator.isZeroVariance`)
  - Can resolve the “Active” status list value id

- `upsertProject(data)`
  - Start date immutable (`validateStartDateAdvanced`)
  - End date reduction blocked if **Actual** revenue exists after new end date (`validateEndDateAdvanced`)
  - End date reduction may delete forecast plans after new end date (when validation returns `WARNING`)

### `rev_plan_mod.js`

- `generateRevenuePlans({ projectId })`
  - Project must be operational (`active`/`on_hold` key) and have zero variance (`validator.validateActiveAndZeroVariance`)
  - Project start/end date must yield at least 1 month (otherwise `WARNING`)
  - Must have phases (otherwise `WARNING`)

- `updateRevenuePlans(payload)`
  - Payload shape: `projectId`, boolean `confirmed`, non-empty `phasesData`
  - Project must be operational (`active`/`on_hold` key) and have zero variance (`validator.validateActiveAndZeroVariance`)
  - Revenue plan month keys must match project month keys **per phase**
    (`validator.validatePhaseMonthKeysMatchExpected`)
  - Phase/plan integrity checks (`validator.buildUpdateRevenuePlansUpdates`)
  - Quantity bounds protection (`validator.validatePhaseCumulativeQtyBounds`)

### `project_phase_mod.js`

- `getProjectPhases(projectId)`
  - Computes `desiredPlansPerPhase = monthsBetweenInclusive(project.startDate, project.endDate)`
  - Computes `numOfMissingPlans` for UI display (not a hard “write” validation)

### Read-path flags

- `rev_plan_mod.getProjectRevPlans(...)`
  - Sets `monthMismatch=true` if any rev plan record month is outside the project start/end month set
  - This is currently used as a UI flag and is separate from the stricter per-phase validation in `updateRevenuePlans`.
  - Computes `revPlanStatus` object and `revPlanStatusMonthKey` as:
    - Choose a representative phase for the project's rev plan status:
      - prefer a phase that has the current company month
      - otherwise choose the phase whose latest rev plan month is the most recent
    - Pick the representative month within that phase: current month if present, otherwise the latest month present
    - Use that month’s rev plan status (defaulting to `open`) and return
      `revPlanStatus: { id, key, label }`
