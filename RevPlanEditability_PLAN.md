### Canonical Rev Plan Banner with BE-Supplied Variant

#### Summary

Backend will own rev-plan banner outcomes and UI severity by returning `revPlanBanner` with `code` and `variant`. Editability will be provided separately through `canEditRevPlan`. Frontend will consume backend `variant` directly and only generate message/html from `code` via centralized mapping in `common.js`. This keeps message consistency while removing FE severity logic.

#### Implementation Changes

1. **Backend: extend canonical object in `project_load`**

- In `getProjectLoad` (`project_phase_mod.js`), return:
  - `revPlanBanner: { code: string, variant: 'info'|'warning'|'error'|'success' }`
  - `canEditRevPlan: boolean`
- Keep full granular code set in `revPlanBanner.code` (see definitions below):
  - null
  - `locked_for_jnl_proc`
  - `project_completed`
  - `plan_generation_blocked_no_phase`
  - `plan_generation_blocked_inactive`
  - `plan_generation_blocked_financial_mismatch`
  - `plan_generation_blocked_inactive_financial_mismatch`
  - `plan_generation_blocked_financial_error`
  - `plan_generation_blocked_other`
  - `variance_mismatch`
  - `no_rev_plans`
  - `month_mismatch`
  - `plan_tally_mismatch`
  - `revplan_status_conflict`
  - `rev_rec_ready_locked`
  - `completion_ready_hint`
  - `post_journal_forecast_only`
  - `rev_rec_journal_ready`
  - `missing_rev_plans_detected`
  - `revplan_notice_missing_plans`
  - `revplan_notice_ready_to_generate`
- Precedence (BE authoritative, for `revPlanBanner.code`):
  1. `locked_for_jnl_proc`
  2. `project_completed`
  3. `plan_generation_blocked_*`
  4. `variance_mismatch`
  5. `no_rev_plans`
  6. `month_mismatch`
  7. `plan_tally_mismatch`
  8. `revplan_status_conflict`
  9. `rev_rec_ready_locked`
  10. `completion_ready_hint`
  11. `post_journal_forecast_only`
  12. `rev_rec_journal_ready`
  13. `missing_rev_plans_detected`
  14. `revplan_notice_missing_plans`
  15. `revplan_notice_ready_to_generate`
  16. null
- Variant mapping in BE (`revPlanBanner.variant`):
  - `error`: all `plan_generation_blocked_*` codes, `variance_mismatch`
  - `warning`: `locked_for_jnl_proc`, `no_rev_plans`, `month_mismatch`, `plan_tally_mismatch`, `revplan_status_conflict`, `rev_rec_ready_locked`, `missing_rev_plans_detected`
  - `info`: `completion_ready_hint`, `post_journal_forecast_only`, `rev_rec_journal_ready`, `revplan_notice_missing_plans`, `revplan_notice_ready_to_generate`
  - `success`: `project_completed`, null

2. **Frontend: centralized message mapping only**

- Add/adjust mapper in `src/common.js`:
  - `getRevPlanBannerUi(code)` -> `{ message, html }`
  - No FE variant logic.
- Remove FE message-precedence logic for rev-plan editability from:
  - `RevenueManagementDetail.vue`
  - `BulkUploadRevPlan.vue`
- Both pages must:
  - gate editability from `projectLoad.canEditRevPlan`
  - render message from `getRevPlanBannerUi(code)`
  - render banner variant from `projectLoad.revPlanBanner.variant`
  - read code from `projectLoad.revPlanBanner.code`
  - use `v-html` only when mapper returns `html: true`\
- When code is null, do not show banner:

3. **Deprecate direct FE use of legacy fields for this concern**

- Stop using `planGeneration.message`, `hasVariance`, `monthMismatch`, etc. directly for editability banner text/variant decisions in these two pages.
- Keep those fields in payload for unrelated UI/data flows and show a comment next to them as todo in backend so later these fields can be removed as they are now deprecated.

## Backend Granular Codes: Definitions

- `locked_for_jnl_proc`
  - Meaning: project is locked due to background Rev Rec journal processing.
  - Rationale: temporary system lock; highest operational priority.

- `project_completed`
  - Meaning: project is completed/frozen; rev plans are no longer editable.
  - Rationale: lifecycle lock; distinct from temporary processing lock.

- `plan_generation_blocked_no_phase`
  - Meaning: rev plans cannot be generated because the project has no phases.
  - Rationale: missing required phase setup.

- `plan_generation_blocked_inactive`
  - Meaning: rev plans cannot be generated because the project is not operationally active.
  - Rationale: status prerequisite failure.

- `plan_generation_blocked_financial_mismatch`
  - Meaning: rev plans cannot be generated due to project vs sales order financial mismatch.
  - Rationale: financial integrity prerequisite failure.

- `plan_generation_blocked_inactive_financial_mismatch`
  - Meaning: rev plans cannot be generated because project is inactive and financials mismatch.
  - Rationale: combined status + financial prerequisite failure.

- `plan_generation_blocked_financial_error`
  - Meaning: rev plans cannot be generated because financials/variance could not be computed.
  - Rationale: backend calculation/configuration failure path.

- `plan_generation_blocked_other`
  - Meaning: fallback blocked reason when a specific blocker code is not available.
  - Rationale: safe catch-all for unknown blocker conditions.

- `variance_mismatch`
  - Meaning: project vs sales order financial variance blocks edits.
  - Rationale: financial integrity gate.

- `no_rev_plans`
  - Meaning: no rev plans exist for the project.
  - Rationale: explicit empty-data blocker.

- `month_mismatch`
  - Meaning: rev plan months are outside/unaligned with project month range.
  - Rationale: timeline consistency blocker.

- `plan_tally_mismatch`
  - Meaning: expected plans per phase don’t match actual plans.
  - Rationale: incomplete phase coverage blocker.

- `revplan_status_conflict`
  - Meaning: mixed/conflicting rev plan statuses prevent safe edits.
  - Rationale: status inconsistency blocker.

- `rev_rec_ready_locked`
  - Meaning: rev plans are in `rev_rec_ready` lock state (except allowed post-journal behavior).
  - Rationale: workflow-state lock.

## Priority Matrix (Backend-Authoritative)

```json
[
  {
    "priority": 1,
    "condition": "isLockedForJnlProc === true",
    "code": "locked_for_jnl_proc",
    "variant": "warning"
  },
  {
    "priority": 2,
    "condition": "isCompleted/isFrozen === true",
    "code": "project_completed",
    "variant": "success"
  },
  {
    "priority": 3,
    "condition": "planGeneration.message is present (with granular blocker classification)",
    "code": "plan_generation_blocked_*",
    "variant": "error"
  },
  {
    "priority": 4,
    "condition": "hasVariance === true",
    "code": "variance_mismatch",
    "variant": "error"
  },
  {
    "priority": 5,
    "condition": "hasRevPlans === false",
    "code": "no_rev_plans",
    "variant": "warning"
  },
  {
    "priority": 6,
    "condition": "monthMismatch === true",
    "code": "month_mismatch",
    "variant": "warning"
  },
  {
    "priority": 7,
    "condition": "hasPlanTallyMismatch === true",
    "code": "plan_tally_mismatch",
    "variant": "warning"
  },
  {
    "priority": 8,
    "condition": "revPlanStatusConflict === true",
    "code": "revplan_status_conflict",
    "variant": "warning"
  },
  {
    "priority": 9,
    "condition": "isPostJournalState === false && revPlanStatusKey === 'rev_rec_ready'",
    "code": "rev_rec_ready_locked",
    "variant": "warning"
  }
]
```
