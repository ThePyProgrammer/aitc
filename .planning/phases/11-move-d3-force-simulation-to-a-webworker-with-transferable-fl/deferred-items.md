# Phase 11 — Deferred Items

Items discovered during Phase 11 execution that are OUT OF SCOPE for this phase
(per the gsd-executor scope boundary rule + project memory "Only fix own bugs —
only fix bugs caused by current-session work").

## Pre-existing test failures on `main` (logged during 11-01)

Confirmed pre-existing by running the failing test files against `git stash`
baseline (2026-04-21). All 4 failures reproduce with Phase 11 changes stashed.

| File | Test | Failure |
|------|------|---------|
| `src/views/Radar/__tests__/HeatMapOverlay.test.ts:10` | `heatTintForNode(0) returns the default surface-container color (#1a1919)` | Expected `#1a1919`, received `#0f1a0e`. Drift between the test expectation and the current `themes.ts` surface-container color token. |
| `src/__tests__/arsenal/MasterDetailShell.test.tsx:36` | `rail region has w-[220px] shrink-0 classes` | Markup regressed from expected class names. |
| `src/__tests__/arsenal/MasterDetailShell.test.tsx:49` | `detail region has 2xl:w-[520px] xl:w-[480px] shrink-0 classes` | Same drift as the rail test. |
| `src/stores/__tests__/agentStore.test.ts:71` | `launchAgent calls invoke launch_agent and appends to agents` | Appears to expect an older `launchAgent` store action shape (pre-10-04 refactor). |

These belong to Phase 10 (chat UI / Arsenal refactor landed in commits before
Phase 11 started) and to the radar theme drift tracked separately. Phase 11 is
a pure frontend refactor of the d3-force simulation; none of these files are
in scope.

## Pre-existing TS build errors on `main` (logged during 11-01)

`npm run build` fails on 6 pre-existing TS errors unrelated to Phase 11:

```
src/bindings.ts(877,26): error TS6133: 'TSend' is declared but its value is never read.
src/bindings.ts(888,2): error TS2440: Import declaration conflicts with local declaration of 'TAURI_CHANNEL'.
src/bindings.ts(909,10): error TS6133: '__makeEvents__' is declared but its value is never read.
src/views/Arsenal/ArsenalView.tsx(114,29): error TS2352: Conversion of type ...
src/views/Radar/RadarCanvas.tsx(33,3): error TS6133: 'installRadarPipelineBridge' is declared but its value is never read.
src/views/Radar/__tests__/RadarCanvas.test.tsx(13,18): error TS6133: 'fireEvent' is declared but its value is never read.
```

All surface from the Phase 10 chat UI work + the generated `bindings.ts`.
Phase 11 neither introduces nor is responsible for these. Verified by
stashing Phase 11 changes and re-running `tsc --noEmit` — identical error
set appears before and after. The Phase 11 worker stubs add zero new TS
errors.

**Impact on Phase 11 acceptance:** The plan's `<verify>` block calls
`npm run build` as a witness. It currently fails because of pre-existing
errors. Phase 11 contribution to TS errors = 0. When Phase 10 cleanup lands
(or the Phase 7 verifier fixes `bindings.ts`), `npm run build` will be green.
For Phase 11's purposes, the stronger witness is `npx tsc --noEmit` with an
error count identical to the pre-Phase-11 baseline.
