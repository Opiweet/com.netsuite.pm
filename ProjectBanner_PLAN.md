# Project Banner Canonicalization Plan

## Goal

Make `Project.vue` banner behavior backend-authoritative, similar to `RevPlanEditability_PLAN.md`, so all action-required banners are consistent, deterministic, and not re-derived in frontend logic.

## Summary

- Backend will emit a canonical project banner object with `code` and `variant` (and optional payload metadata if required).
- Frontend will use a centralized mapper in `common.js` to generate final banner message (including optional HTML).
- `Project.vue` will stop composing banner precedence/messages from mixed local conditions.

## Scope

### In scope

- Banners currently shown in the project hero section of `Project.vue` that are state/action driven.
- Canonical backend output from `project_load`.
- Frontend mapper + `Project.vue` consumption.

## Canonical BE Contract

Add to `project_load` response:

```json
{
  "projectBanner": {
    "code": "...",
    "variant": "info|warning|error|success"
  }
}
```

Notes:

- Keep this minimal (no message from BE).
- FE maps `code` to message + html rendering centrally.

## Proposed Banner Codes

- `locked_for_jnl_proc`
- `project_completed_frozen`
- `activate_hint`
- `complete_hint`
- `missing_sales_order`
- `no_phases_hint`
- `revplan_notice_missing_plans`
- `revplan_notice_ready_to_generate`
- null

## Precedence (BE authoritative)

First match wins:

1. `locked_for_jnl_proc`
2. `project_completed_frozen`
3. `activate_hint`
4. `complete_hint`
5. `missing_sales_order`
6. `no_phases_hint`
7. `revplan_notice_missing_plans`
8. `revplan_notice_ready_to_generate`
9. null

Rationale:

- Hard locks first.
- Lifecycle/finalization next.
- Next-best user action hints after lock states.
- Informational notices last.

## Variant Mapping (BE)

- `locked_for_jnl_proc` -> `warning`
- `project_completed_frozen` -> `success` (preserve current behavior)
- `activate_hint` -> `info`
- `complete_hint` -> `info`
- `missing_sales_order` -> `warning`
- `no_phases_hint` -> `info`
- `revplan_notice_missing_plans` -> `info`
- `revplan_notice_ready_to_generate` -> `info`
- null

## Frontend Mapping (`common.js`)

Add centralized function:

```js
getProjectBannerUi(code) => { message, html }
```

- `code` is required.
- Supports HTML where necessary via `html: true`.

### Rendering behavior in `Project.vue`

- Use backend `projectBanner.variant` directly.
- Use `getProjectBannerUi(projectBanner.code)` for message.
- Render with `ProjectBanner`.
- If `html` true -> `v-html`, else plain text.
- Do not keep local if/else precedence branches for these canonical banners.

## Backend Implementation Tasks

1. In `project_phase_mod.js`, compute canonical `projectBanner.code` + `projectBanner.variant` during `getProjectLoad`.
2. Reuse existing booleans already computed in load path (lock/frozen/canActivate/canMarkComplete/hasSalesOrder/phases/rev plan notice).
3. Return `projectBanner` in payload.
4. Keep legacy fields for now (backward compatibility), but do not rely on them in updated `Project.vue` banner path. Show a comment next to them as todo in backend so later these fields can be removed as they are now deprecated

## Frontend Implementation Tasks

1. Add `getProjectBannerUi` to `frontend/project-phase-management/src/common.js`.
2. Refactor `Project.vue` hero banner block to consume only canonical `projectBanner` + mapper output.
3. Remove duplicated message/precedence logic from `Project.vue` for canonicalized banner cases.

## Backend Granular Codes: Definitions

- `locked_for_jnl_proc`
  - Meaning: project is locked due to background journal processing.
  - Rationale: hard operational lock; no actions should proceed.

- `project_completed_frozen`
  - Meaning: project is completed/frozen.
  - Rationale: lifecycle lock; editing is intentionally disabled.

- `activate_hint`
  - Meaning: project is eligible to be activated.
  - Rationale: provide the next action to move project into active workflow.

- `complete_hint`
  - Meaning: project is eligible to be marked complete.
  - Rationale: provide completion guidance when criteria are met.

- `missing_sales_order`
  - Meaning: project has no linked sales order.
  - Rationale: blockers that prevent phase/revenue workflows should be surfaced early but project edit is allowed but not phases edit/create.

- `no_phases_hint`
  - Meaning: project has no phases yet.
  - Rationale: onboarding hint to guide user to add phases.

- `revplan_notice_missing_plans`
  - Meaning: backend indicates there are missing rev plans that must be generated.
  - Rationale: explicit actionable notice code; FE does not infer from a generic notice blob.

- `revplan_notice_ready_to_generate`
  - Meaning: backend indicates rev plans are ready to generate.
  - Rationale: explicit informational notice code; FE does not infer from a generic notice blob.

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
    "condition": "isProjectFrozen === true",
    "code": "project_completed_frozen",
    "variant": "success"
  },
  {
    "priority": 3,
    "condition": "canActivate === true",
    "code": "activate_hint",
    "variant": "info"
  },
  {
    "priority": 4,
    "condition": "canMarkComplete === true",
    "code": "complete_hint",
    "variant": "info"
  },
  {
    "priority": 5,
    "condition": "hasSalesOrder === false",
    "code": "missing_sales_order",
    "variant": "warning"
  },
  {
    "priority": 6,
    "condition": "showNoPhaseBanner === true",
    "code": "no_phases_hint",
    "variant": "info"
  },
  {
    "priority": 7,
    "condition": "revPlanNotice.show === true && revPlanNotice.key === 'missing'",
    "code": "revplan_notice_missing_plans",
    "variant": "info"
  },
  {
    "priority": 8,
    "condition": "revPlanNotice.show === true && revPlanNotice.key === 'ready'",
    "code": "revplan_notice_ready_to_generate",
    "variant": "info"
  }
]
```
