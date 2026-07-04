# Rev Plan / Rev Rec Specification

## 1) Actual vs Forecast

- `Actual` = months `<= effective (current) period`
- `Forecast` = months `> effective (current) period`
- Month determination is based on calendar month-year (NOT accounting period) in **company timezone**.

## 2) Effective Period

- `effective_period = override_period OR current_company_period`
- Override is read from script parameter `custscript_pm_simulated_period`.
- Expected format is `"mon-yyyy"` (example: `"mar-2026"`).

## 3) Journal Generation Overview

These steps are pre-computed server-side:

1. Resolve effective period of the projects.
2. Detect last posted (non-reversal) month for the project.
3. Compute missing months between last posted month and effective month for each project.
4. If locked/closed months are detected, using lock rules below (see point 5.2), block the process and inform the user accordingly.

When user triggers rev rec generation for a project:

5. If missing months exist:
Generate all missing months (as long as they are Rev Rec Ready) and current month (only if current also is Rev Rec Ready), based on selected mode/confirmation flow.

6. Set `custbody_pm_iscreatedbyportal = T` on generated journals.

## 4) How Last Posted Month Is Determined

- Use journals where project matches by `cseg_project_seg`.
- Exclude reversal journals (`isreversal = T`).
- As of now, do **not** use `custbody_pm_iscreatedbyportal` as deterministic filter for last-posted detection (this will allow manual journals to still count).

## 5) Catch-up Scope

### 5.1 Base behavior

- Example: missing `Jan–Mar`, effective `Apr`.
- As long as missing months are Rev Rec Ready, their journals are generated.
- `trandate` is set to the last day of that target month.
- `reversaldate` is set to the last day of the following month.

### 5.2 Closed/locked period behavior

- If any missing month `M` is locked/closed, block the whole generation and inform the user.
- This is intentional: user must reopen the period first, then retry generation.

## 6) Journal Granularity and Date

- For missing `Jan–Mar` + current `Apr`, create **4 separate journals** (one per month).
- Journal date (`trandate`) is always month-end for that target month:
Missing month journal => missing month-end date.
Current month journal => current month-end date.

- Always ensure target month plans are Rev Rec Ready before generation.
- Exception: if current month is `Rev Rec Ready` and missing months are not all ready, user can confirm `forceMissingOpen`. In that case missing months can be generated when their plans are in `Open`/`Rev Rec Ready`/`Completed` mix allowed by backend checks, then target month plans are moved to `Completed`.

- Backend marks generated target month plan IDs as `Completed`. It does not globally set every prior month to `Completed` unless that month is part of generation scope.

## 7) Idempotency / Re-runs

- Reversal journals do not block generation (they are ignored in last-posted detection using `isreversal = T`).
- We do **not** hard-skip all previously journaled months forever, because journals auto-reverse.
- We only prevent generation when trying to generate the **same effective current month** that is already the last posted month.
  Example: Apr is current month and last posted month is Apr (that is we have a jnl with trandate 30 Apr), we do NOT allow to recreate a jnl for Apr.

## 8) Invoice / Credit Memo Accumulation Rules

- Determine transaction month using `trandate`.
- For a target month `X`, include only invoices/credit memos where `trandate <= end_of_month(X)`.
- Ignore transactions after that month-end.
- This applies to:
Missing month generation (each missing month computed with its own month-end cutoff).
Current month generation (current month uses current month-end cutoff).

Example (missing `Jan–Mar`, effective `Apr`):

- Jan invoice `1000`, Mar credit memo `200`, Apr invoice `500`.
- Jan journal basis: `1000`
- Feb journal basis: `1000`
- Mar journal basis: `1000 - 200`
- Apr journal basis: `1000 + 500 - 200`

## 9) Journal Cutoff Principle for Catch-ups

- While generating month `X`, recognition context should only consider data up to `end_of_month(X)`.
- Nothing after `end_of_month(X)` should affect journal `X`.

## 10) User Prompt / API Flow

If missing months are detected (backend computed), current frontend behavior is:

1. Missing all ready + current ready => confirmation modal, mode `missing_and_current`.
2. Missing all ready + current not ready => confirmation modal, mode `missing_only`.
3. Missing not all ready + current ready => warning confirmation modal, mode `missing_and_current`, `forceMissingOpen = true`.
4. No missing months + current ready => auto-run generation in mode `current_only` (no modal).
5. No ready-eligible scenario => block with backend/frontend warning.

## 11) Rev Plan Status Rules

Statuses used:

- `Open`
- `Rev Rec Ready`
- `Completed`

Rules:

- Submit to Finance moves only **effective current month** relevant plans to `Rev Rec Ready`.
- Journal generation moves targeted rev plans from `Rev Rec Ready` to `Completed`.
- When missing months are not all `Rev Rec Ready` but current is `Rev Rec Ready`, generation with confirmation (`forceMissingOpen`) can still proceed and generated missing-month plans are moved to `Completed`.
- Edit locking:
`Completed` rev plans are locked for edit.
`Rev Rec Ready` plans for prior months (before effective current month) are locked for edit.
Backend validation also blocks updates on `Rev Rec Ready`/`Completed` plans.

## 12) Access / Constraints

- Only finance users can generate journals.
- Generate button is shown only when finance user **and** backend guard returns `canGenerateJournal = true`.
- When finance click on the button, if there is no rev plans with status Rev Rec Ready, we should tell the user no rev plans are rev rec ready.
- If current is not Rev Rec Ready but previous rev plans are Rev Rec Ready, we should tell the user for which month the journal is being generated mentioning its not the current month.
- If current is also Rev Rec Ready as well as previous rev plans are Rev Rec Ready, we should tell the user for which month the journal is being generated mentioning the missing months also included.

## 13) Bulk Rev Rec Jnl Generation

- Bulk generation behavior. should follow same logic as for individual project.

## 14) Metrics (Aggregate Only)

- We do **not** expose per-month metrics in the API/UI.
- Keep existing aggregate metrics (for example: recognized to date, billed/invoiced to date, revenue ready) as single values.
- Generation-time funding/recognition context uses cutoff at `end_of_month(target_month)` for each generated month.
- Current aggregate project financials module is not uniformly driven by `end_of_month(effective_period)` cutoff across all metrics.

**Note**
As much as possible, all logics are backend driven with minimal computation for reactivity on frontend.
