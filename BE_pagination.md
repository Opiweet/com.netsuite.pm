# Backend Pagination Plan (Projects)

## Why
Current flow loads the full projects list from backend and paginates only in frontend.

Evidence in code:
- Suitelet returns all projects for `projects_list`.
- Store sends only `{ action: 'projects_list' }`.
- Data table filters/sorts then slices in-memory.

This causes growing latency and payload size as projects increase.

## Current State
- Backend endpoint: `action: 'projects_list'`
- Response shape: `{ data: { projects: [...] } }`
- Frontend behavior:
  - Search/filter/sort on full in-memory list.
  - Pagination is UI-only.

## Target State
Implement true server-side pagination with server-side filtering/search/sorting.

## Phase 0 (Tackle First): Remove Per-Project Enrichment Bottleneck
Before pagination work, reduce latency in `getProjects()` by addressing expensive per-project enrichment.

### Problem
`getProjects()` loops all projects and runs extra enrichment per project (recognized/billed related lookups), which behaves like N+1 work and can dominate response time.

### Phase 0 Scope
1. Profile and log timings around:
- base project fetch
- revenue recognition enrichment
- billed-to-date enrichment
2. Move enrichment from per-project calls to batched/aggregated queries where possible.
3. If a metric cannot be batched quickly, mark it as deferred/lazy so list fetch is not blocked.
4. Keep the same response shape to avoid FE breakage.

### Phase 0 Acceptance Criteria
- `projects_list` latency is measurably reduced for current dataset.
- No behavior regressions in Projects and Revenue Management list views.
- Response payload shape remains backward-compatible.

## API Contract (Proposed)

### Request
`POST` to existing handler with:

```json
{
  "action": "projects_list",
  "page": 1,
  "pageSize": 20,
  "search": "acme",
  "filters": {
    "status": ["active", "on_hold"],
    "projectManagerId": ["123"],
    "departmentId": ["9"]
  },
  "sort": {
    "by": "name",
    "dir": "asc"
  }
}
```

### Response
```json
{
  "success": true,
  "action": "projects_list",
  "data": {
    "projects": [/* current row shape */],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 237,
      "totalPages": 12,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

## Backend Design
1. Keep `projects_list` action; extend payload parser for `page/pageSize/search/filters/sort`.
2. Add new `project_phase_mod.getProjectsPaged(params)` while preserving existing `getProjects()` for compatibility during rollout.
3. Build project base query with:
- deterministic sort (default `name ASC`, tie-break by `internalid ASC`)
- search on project name/ref (and optionally customer/project manager display values)
- filters mapped to indexed fields where possible.
4. Apply pagination in backend (SuiteQL `ROW_NUMBER` strategy or search paging API), and return `total`.
5. Preserve current project DTO shape so FE column rendering remains unchanged.
6. Add `pagination` metadata.

## Important Performance Note
Pagination should not be the first optimization step here. Phase 0 should be done first to remove the per-project enrichment bottleneck; then pagination gives cleaner and more predictable gains.

## Frontend Design
1. Update store `fetchProjects` to accept query params:
- `page`, `pageSize`, `search`, `filters`, `sort`, `force`
2. Store pagination state centrally:
- `projectsPage`, `projectsPageSize`, `projectsTotal`, `projectsTotalPages`
3. Update `DatatableCust` usage for server mode:
- emit events for page/search/filter/sort changes
- stop local `filteredRows.slice(...)` behavior in server mode
4. Debounce search (e.g., 250-400ms).
5. Reset `page=1` when search/filter changes.
6. Keep UI responsive with in-flight guard/cancel behavior.

## Backward Compatibility
- If pagination fields are absent, backend defaults to current behavior (or default page 1 size 20 after FE cutover).
- During transition, add a feature flag (`serverPaginationProjects`) to switch FE mode safely.

## Validation Checklist
- Page boundaries (`page<1`, `page>totalPages`) handled.
- Sort whitelist enforced backend-side.
- Filter values validated and sanitized.
- Stable sort across pages.
- Search + filters + sort combinations produce consistent total counts.
- Existing project creation/update flows still refresh list correctly.

## Complexity Estimate
- Backend API + query refactor: Medium
- Frontend table/store integration: Medium
- End-to-end QA for search/filter/sort/pagination combinations: Medium
- Overall: **Medium (roughly 2-4 focused dev days)**, depending on how much N+1 optimization is included.

## Suggested Rollout
1. Complete Phase 0 enrichment optimization and baseline timings.
2. Ship backend pagination contract + metadata.
3. Enable FE server pagination for Projects list only.
4. Monitor response times and payload sizes.
