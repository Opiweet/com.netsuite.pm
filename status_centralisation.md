# Status Centralisation (Backend Complete)

## Summary
Backend status centralisation is now implemented with NetSuite as source of truth for raw status IDs/text.

Enforced backend policy:
- Mutations fail fast when required status mapping is missing/unknown.
- Reads also fail when status mapping is missing/unknown.
- No fallbacks.
- No compatibility adapters.

Backend contract:
- `status: { id, key, label }`

---

## Implemented Backend Changes

## 1) Backend canonical status layer
Create `backend/src/FileCabinet/SuiteApps/com.netsuite.pm/project-phase/core/statuses.js` as the only status translation and rule source.

Responsibilities:
- Canonical key sets (code-managed):
  - `project`: `draft`, `active`, `on_hold`, `completed`, `closed`
  - `phase`: canonical app keys for phase statuses
  - `revplan`: `open`, `rev_rec_ready`, `completed`, `cancelled`
- NetSuite -> canonical translator:
  - `fromNetSuiteStatus(entityType, { id, text }) -> { id, key, label, known }`
- Key semantics helpers:
  - `isOperationalProjectStatus(key)`
  - `isFrozenProjectStatus(key)`
  - `isRevPlanEditableStatus(key, monthCtx)`
- Key/label helpers:
  - `statusLabelForKey(entityType, key)`

Constraints:
- Never hardcode NetSuite list IDs in business logic.
- No local status normalizers outside `core/statuses.js`.

## 2) NetSuite truth enforcement policy (strict)
Apply strict mapping across all paths.

Mutation paths (must fail fast with explicit config error):
- `project_upsert`
- project status transitions
- phase create/update/bulk update
- rev plan update/reopen/generate
- rev rec generation paths that depend on rev plan statuses

Read paths (must also fail when mapping is unknown/missing):
- project list/load
- phase list/load
- rev plan list/load/rollups
- dashboards and status-derived payloads

Error contract:
- `STATUS_MAPPING_MISSING`
- include entity type + raw NetSuite status `{id,text}` in error details.

Logging:
- structured error logs for mapping failures (`entityType`, `statusId`, `statusText`, `contextAction`).

## 3) Backend payload contract standardization
Standardize all status-bearing payloads to:
- `status: { id, key, label }`

Apply to:
- projects list rows
- project load response
- phase rows
- rev plan rows and month/rollup status payloads
- any status-dependent banner/action metadata

Rules:
- Business logic compares only `status.key`.
- Display uses `status.label`.
- Writes requiring NetSuite list value use `status.id`.

## 4) Documentation
Update:
- `status_centralisation.md` (this document)
- `RBAC.md` with a short backend note about NetSuite status truth + strict mapping policy
- `VALIDATIONS.md` references where status semantics are mentioned

---

## Public Interface Changes
- Backend response shape for statuses is strict object form:
  - `status: { id, key, label }`
- Rev plan meta status shape is now structured:
  - `revPlanStatus: { id, key, label }`
  - `revPlanStatusMonthKey`
- Remove mixed legacy fields for status semantics:
  - no compatibility adapter
  - no fallback fields for old consumers
- New error for invalid/missing status mapping:
  - `STATUS_MAPPING_MISSING`

### FE Migration Mapping (Breaking)
- Project/phase status:
  - `statusId` -> `status.id`
  - `statusKey` -> `status.key`
  - `statusName` -> `status.label`
- Rev plan meta status:
  - `revPlanStatusKey` -> `revPlanStatus.key`
  - `revPlanStatus` (string label) -> `revPlanStatus.label`
  - `revPlanStatusMonthKey` remains `revPlanStatusMonthKey`

---

## Assumptions & Defaults
- NetSuite status list records remain the source of truth for raw IDs/text.
- Canonical keys are internal app semantics derived from NetSuite values.
- Strict mode is enabled globally:
  - no fallback mapping
  - no compatibility adapters
- Prefixed display labels (`Project: ...`, `Phase: ...`, `Rev Plan: ...`) are presentation-only concerns outside backend canonical mapping.
