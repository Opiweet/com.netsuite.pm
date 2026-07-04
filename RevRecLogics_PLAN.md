# Rev Rec Logics Plan

## Goal

Refactor Revenue Recognition workflow so action targeting is driven by rev-plan month status, not by assuming the effective current month or relying primarily on journal history.

This change is needed for delayed finance workflows, where previous months may still be pending during the current month.

## Core Rules

### 1. Prior months must be cleared before current month

The effective current month cannot be the target for:

- `Submit to Finance` if any prior actual month is not yet `Completed`
- `Generate Rev Rec Journal` if any prior actual month is not yet `Completed`

### 2. Submit to Finance targets all prior open backlog months at once

If prior months before the effective current month are still pending and have rev plans in `Open`, clicking `Submit to Finance` should target all those prior open months together.

Example:

- Effective current month: June 2026
- April 2026: `Open`
- May 2026: `Open`

Result:

- `Submit to Finance` confirmation should say:
  `This will submit rev plan allocations to finance for:
  - May 2026
  - April 2026`

June 2026 must not be submitted yet.

### 3. Generate Rev Rec Journal targets all prior ready backlog months at once

If prior months before the effective current month are pending and are already `Rev Rec Ready`, clicking `Generate Rev Rec Journal` should generate journals for all those prior ready months together.

Example:

- Effective current month: June 2026
- April 2026: `Rev Rec Ready`
- May 2026: `Rev Rec Ready`
- June 2026: `Open`

Result:

- `Generate Rev Rec Journal` confirmation should say:
  `This will generate rev rec journal for:
  - May 2026
  - April 2026`

June 2026 must not be journaled yet.

### 4. Both buttons can appear at the same time

If prior months are already `Rev Rec Ready` but current month is still `Open`, FE should show both:

- `Generate Rev Rec Journal` for prior ready months
- `Submit to Finance` for current month

Example:

- April 2026: `Rev Rec Ready`
- May 2026: `Rev Rec Ready`
- June 2026: `Open`

Result:

- `Generate Rev Rec Journal` targets April 2026 and May 2026
- `Submit to Finance` targets June 2026

Maybe we can add a visual indicator so we know the buttons will action for previous or current

### 5. Completed months are done even if no journal exists

Month backlog detection must not rely only on journal existence.

If rev plans for a month are already fully `Completed`, that month must be treated as done even if no journal transaction exists in NetSuite history.

Example:

- January to April 2026 rev plans manually set to `Completed`
- No journals exist for those months
- May 2026 is pending
- Effective current month: June 2026

Result:

- Journal generation should target only May 2026
- January to April 2026 must not be regenerated

## Source Of Truth

The primary source of truth for month workflow must be rev-plan status aggregation by month.

Journal history should be treated as:

- supporting information
- audit/reference information
- optional validation input

Journal history should not be the primary determinant of whether a month is still pending.

## Month Classification

For each actual month up to the effective period, backend should classify the month from rev-plan statuses:

- `Open`
- `Rev Rec Ready`
- `Completed`
- `Mixed` or `Invalid` if statuses are inconsistent and need special handling (we need to be able to flag it to the user)

Only months before the effective current month participate in backlog resolution.

## Intended Action Resolution

### Submit to Finance

1. Find prior actual months before the effective current month that are not `Completed`
2. If any of those months are `Open`, target all eligible prior `Open` months
3. If there are no prior non-completed months, allow current month submission

### Generate Rev Rec Journal

1. Find prior actual months before the effective current month that are not `Completed`
2. If any of those months are `Rev Rec Ready`, target all eligible prior `Rev Rec Ready` months
3. If there are no prior non-completed months, allow current month journal generation

## Backend Changes

### 1. Refactor month backlog detection in `rev_rec_mod.js`

Replace journal-driven missing-month detection with rev-plan-status-driven month aggregation.

Needed outcomes:

- backlog months derived from rev-plan status
- completed months excluded even when journal history is missing
- explicit separation between prior open months and prior ready months

### 2. Refactor submission logic in `rev_plan_mod.js`

Current confirmed submission only targets the effective current month.

Required change:

- prior non-completed open months must be submitted first
- all eligible prior open months should be targeted together
- current month should only be targeted when no prior open backlog blocks it

### 3. Refactor journal generation in `rev_rec_mod.js`

Current generation still leans on effective current month plus journal-based gap detection.

Required change:

- target only prior ready backlog months first
- skip fully completed months even if no journals exist
- allow current month generation only after prior backlog becomes completed

### 4. Extend `project_load` output in `project_mod.js`

Backend should return explicit month-scoped action metadata instead of only generic booleans.

Suggested payload structure:

```json
{
  "submitToFinanceAction": {
    "visible": true,
    "enabled": true,
    "targetMonthKeys": ["2026-04", "2026-05"],
    "targetMonthLabels": ["April 2026", "May 2026"],
    "reason": null
  },
  "generateJournalAction": {
    "visible": true,
    "enabled": true,
    "targetMonthKeys": ["2026-04", "2026-05"],
    "targetMonthLabels": ["April 2026", "May 2026"],
    "reason": null
  }
}
```

This keeps FE simple and avoids frontend inference.

## Frontend Changes

### 1. Update `projects.js`

Normalize the new backend action payloads:

- `submitToFinanceAction`
- `generateJournalAction`

Do not infer action month scope locally, backend should provide it.

### 2. Update Revenue Management buttons and modals

Buttons should render independently based on backend-provided action state.

Modal copy should be driven by backend target month labels.

Examples:

- `This will submit rev plan allocations to finance for:
- May 2026
- April 2026`

- `This will generate rev rec journal for:
- May 2026
- April 2026`

- `This will submit rev plan allocations to finance for:
- May 2026
- April 2026`

### 3. Review banner behavior

Generic current-month-only messaging will become misleading.

Review:

- `frontend/project-phase-management/src/common.js`
- `frontend/project-phase-management/src/composables/useBannerUi.js`

Goal:

- banners should not contradict month-scoped backlog actions
- Confirmation modals should be shown whenever action is not being done for current month

## Missing Completed Journals Warning

Completed rev-plan months can still be missing journal transactions if journals were deleted manually or lost outside the normal app flow.

This should not put those months back into the normal backlog workflow, but finance should still be warned when attempting journal generation.

### Intended Behavior

When finance clicks `Generate Rev Rec Journal`, backend should detect months where:

- rev plans are fully `Completed`
- but no matching journal exists in journal history

If any such months exist, frontend should first show a warning modal:

- `Journals could not be found for completed month(s):`
- list the affected month labels

Actions:

- `Re-generate Missing Journals`
- `Dismiss`

### Rules

- This is a warning flow, not a normal backlog action.
- Missing completed journals must not automatically be mixed into standard current/prior ready generation.
- Re-generation of these months must be explicit.
- Backend should support a dedicated generation mode for these completed missing-journal months only.

### Backend Payload

Suggested preview fields:

```json
{
  "hasMissingCompletedJournals": true,
  "missingCompletedJournalMonthKeys": ["2026-04", "2026-05"],
  "missingCompletedJournalMonthLabels": ["April 2026", "May 2026"]
}
```

### Frontend Flow

1. Finance clicks `Generate Rev Rec Journal`
2. FE requests preview
3. If missing completed journals exist, show warning modal first
4. `Dismiss` closes only
5. `Re-generate Missing Journals` calls backend with dedicated mode, for example:
   `completed_missing_journals_only`

## Implementation Order

1. Define month aggregation rules and decision table
2. Refactor backend month targeting logic
3. Expose explicit action metadata from backend
4. Normalize backend action metadata in frontend store
5. Update Revenue Management detail page buttons and confirmation copy

## Remaining Implementation Iterations

### Iteration 1. Align Revenue Management list and bulk journal flow

The list page still contains old assumptions around:

- current-month eligibility
- missing-month refetch
- force-open handling for prior months

Required work:

- use backend-provided `generateJournalAction` instead of inferring eligibility from status only
- preselect only projects whose journal action is visible and enabled
- remove or replace missing-month refetch behavior that belonged to the old journal-gap logic
- keep modal copy consistent with the new month-scoped journal workflow

### Iteration 2. Clean up banner and generic copy

Some rev rec / rev plan banners still speak in current-month-only terms.

Required work:

- review `frontend/project-phase-management/src/common.js`
- review `frontend/project-phase-management/src/composables/useBannerUi.js`
- update any generic “ready to generate” or “current month journal generated” wording that can contradict backlog-first behavior

### Iteration 3. Scan remaining frontend consumers of old rev rec assumptions

Required work:

- find any FE code still depending on old preview booleans as if they represented current-month-only behavior
- align those consumers to `submitToFinanceAction` and `generateJournalAction`
- remove obsolete UI branches where they are no longer valid
4. Update frontend store normalization
5. Update frontend buttons and modal copy
6. Update banners

## Mandatory guardrails

Always refer to this file for guidance on what have been done and what needs to be done.
Always stay DRY, reuse existing utilities where possible
Any unuse codes that are made redundant by this update should be removed.
Do not repeat codes, make use of shared files (always prefer existing files).
Ensure regression are not caused
Where a query is used, do not replace by saved search unless you were asked to do it
For dates, ensure we respect how its being handled in the codebase
