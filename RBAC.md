# Centralized RBAC Full Cutover Plan (No Fallbacks)

## Summary
Implement a strict centralized authorization model where:
- Backend is the sole policy/enforcement source.
- Frontend uses only backend-provided capabilities via `can(...)`.
- All existing FE role/permission booleans used for gating are removed in the same cutover (no temporary fallback layer).

## Implementation Changes

### 1. Create a single backend RBAC policy module
- Add `rbac_mod` with:
  - canonical capability catalog (e.g., `project.update`, `phase.bulk_upsert`, `revplan.update`, `revplan.confirm`, `revrec.generate`, `documents.manage`, `notes.create`)
  - role-to-capability mapping in backend code constants
  - principal resolution (`userId`, `roleId`, finance permission context)
  - ABAC predicates for scoped access (admin / PM / creator style project ownership checks)
  - one entrypoint: `authorize({ action, projectId?, payload? })`

### 2. Enforce RBAC centrally for all mutation actions in the Suitelet handler
- In `BC_PM_SSU_ProjectPhase_Handler.js`, require RBAC authorization before mutation logic for every write action:
  - project: upsert, activate, status transition
  - phases: upsert/single, upsert/bulk, delete
  - rev plans: update, reopen, generate
  - rev rec: generate single/bulk
  - documents: upload/delete
  - notes: create
- Standardize deny response:
  - HTTP `403`
  - `{ success:false, error:{ name:"FORBIDDEN", message, details:{ action, reasonCode }}}`
- Preserve business-state checks (freeze, variance, status constraints) as separate domain validations after RBAC pass.

### 3. Expose centralized capabilities in `init_data`
- Extend `init_data` response to include `authz.capabilities` (and optional `authz.roles` for transparency).
- Keep `user.roleId/roleName` for display/debug only, not FE gating.

### 4. Frontend full-gating cutover to `can(...)`
- Add `useAuthz` helper backed by `projectsStore.initData.authz`.
- Replace all FE permission gating logic with capability checks, including:
  - Revenue Management actions (save/confirm/reopen/generate rev rec)
  - Bulk upload phase submit and rev-plan submit
  - Document upload/delete controls
  - Any other action visibility/enablement checks currently derived from role booleans
- Remove legacy FE permission-gating flags and branches (no fallback code path retained).

### 5. Route-level authorization alignment
- Add route guard capability requirements in router meta for restricted pages/actions.
- Redirect unauthorized navigation to a safe route with a standardized unauthorized toast/banner.

### 6. Centralization and maintainability hardening
- Add structured backend deny logs (`userId`, `roleId`, `action`, `projectId`, `reasonCode`).
- Add RBAC reference doc (capabilities, role mapping, ABAC rules, action-to-capability mapping).
- Add handler convention: all new mutating actions must register action-to-capability mapping in `rbac_mod`.

## Public Interfaces / Contract Changes
- `init_data` now returns `authz` capability payload consumed by FE.
- Write endpoints now consistently return `403 FORBIDDEN` when unauthorized.
- No request payload shape changes required for existing endpoints.

## Assumptions
- Canonical policy remains code-managed in backend (not runtime-configurable).
- This is a single full FE gating cutover; legacy role/permission booleans used for authorization are removed in the same release.
- FE authorization decisions come only from backend capability payload; domain-state flags remain for business constraints, not permission checks.

## Backend Status Truth Note
- NetSuite remains the source of truth for raw status IDs/text values.
- Backend canonical status mapping is enforced in `project-phase/core/statuses.js`.
- Status mapping is strict:
  - no fallback mappings
  - no compatibility adapters
  - unknown/missing mappings raise `STATUS_MAPPING_MISSING` (including mutation paths).
