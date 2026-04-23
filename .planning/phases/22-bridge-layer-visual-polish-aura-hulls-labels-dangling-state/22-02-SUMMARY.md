---
phase: 22-bridge-layer-visual-polish-aura-hulls-labels-dangling-state
plan: 02
subsystem: ui
tags: [radar, canvas-2d, bridge-renderer, theme-tokens, visual-polish, vitest]

# Dependency graph
requires:
  - phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
    provides: BridgeRenderer drawBoundaryAnchorLabels + drawBridgeNodes (D-17 channel double-stroke invariant); V-12-21 / V-12-22 witnesses and test harness
provides:
  - FRONTEND/BACKEND anchor labels resolve from theme.fileLabelColor (not folderLabelColor) at globalAlpha 1.0 (bold) / 0.85 (thin)
  - Zero-radius fillRect backdrop pill per label stack at `${theme.canvasBackground}cc` (80%-alpha), emitted before the stack's first fillText
  - composeBackdropFill helper (hex regex -> +'cc' suffix) adjacent to drawBoundaryAnchorLabels
  - drawBridgeNodes three-way fillStyle ternary — dangling resolves to theme.nodeFill; populated retains cyan fallback chain
  - setLineDash(BRIDGE_DASH_PATTERN) call removed from runtime; constant retained with eslint-disable + retention comment (D-14)
  - W-22-04 .. W-22-07 witnesses GREEN across the BridgeRenderer surface
affects: [any future phase touching BridgeRenderer.ts, any phase re-surfacing a theme.axisLabelColor token, any phase reviving stroke-pattern bridge signals]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Theme-token fallback chain extension: `theme.fileLabelColor ?? theme.nodeStroke` (matches existing `theme.edgeGlow ?? theme.arrowFill ?? '#00cffc'` idiom in the same file)"
    - "Hex+alpha composition helper: `composeBackdropFill` guarded by `/^#[0-9a-f]{6}$/i` — passthrough for non-hex tokens"
    - "Three-way fillStyle ternary on selected/dangling/populated state (color as primary dangling signal; stroke pattern retired)"
    - "Mock canvas context extension: add `fillRect: record('fillRect')` + `measureText: (t) => ({ width: t.length * 6 })` to BoundaryLine.test.ts recorder"
    - "Atomic test-evolution commit: both legacy-case deletion AND new W-22-NN insertion land in the same test-file-only commit so the suite is never momentarily incoherent between RED production code and replacement witness"

key-files:
  created: []
  modified:
    - src/views/Radar/BridgeRenderer.ts — drawBoundaryAnchorLabels body rewritten (Fix 3); drawBridgeNodes inner-diamond block (Fix 4); composeBackdropFill helper added; BRIDGE_DASH_PATTERN retention comment
    - src/views/Radar/__tests__/BoundaryLine.test.ts — makeMockCtx gained fillRect+measureText; V-12-22 folderLabelColor case replaced with W-22-04; W-22-05 added
    - src/views/Radar/__tests__/BridgeRender.test.ts — two V-12-21 dangling-dash cases deleted; W-22-06 x 3 and W-22-07 added (populated-regression uses explicit bare-theme rungs per V-12-21 pattern)

key-decisions:
  - "W-22-06 populated regression test: use explicit bare themes (edgeGlow rung + no-rung fallback) instead of the plan's default-theme + '#00cffc' assertion. Rationale: FALLBACK_THEME (phosphor-classic) ships arrowFill='rgba(42, 77, 36, 0.7)' — the plan's '#00cffc' literal would never be reached with the default theme. Explicit-theme form mirrors the existing V-12-21 bare-theme pattern (BridgeRender.test.ts:106) and exercises rung 1 (edgeGlow) + rung 3 (hardcoded literal) of the fallback chain"
  - "Backdrop alpha: 0.8 (80% via 'cc' hex-suffix) per CONTEXT D-11; not tuned per theme — the 9-theme eyeball pass was NOT performed in this plan (D-23 optional and non-gating)"
  - "Pill padding: 8px horizontal, 4px vertical per CONTEXT D-09 recommendation — not tuned"
  - "BRIDGE_DASH_PATTERN: retained with retention comment + eslint-disable per D-14 (recommended retain-and-comment over outright delete)"
  - "composeBackdropFill placed as module-level private function directly before drawBoundaryAnchorLabels — discoverable next to its sole consumer per CONTEXT Claude's Discretion on helper extraction"
  - "drawBridgeNodes defensive `ctx.setLineDash([])` reset retained (minimal diff; now a no-op but zero-cost and guards against upstream dirty state)"

patterns-established:
  - "Test evolution with breaking legacy assertions: when a Phase 12 witness assertion is invalidated by a Phase 22 decision (D-07 swap, D-14 delete), replace the case in the same plan-scoped RED test commit rather than patch the production code and an old assertion in opposite directions across multiple commits"
  - "Hex+alpha composition helper: `${hex}cc` for 80% alpha where all theme fields are guaranteed 6-char hex; defensive regex guard for future rgba/hsl authorship"
  - "Plan-level commit cadence for TDD: RED test commit first, then one production-code commit per fix (Fix 3, Fix 4 independent); commit-after-each-change rule honored by the per-fix split"

requirements-completed: []

# Metrics
duration: 7min
completed: 2026-04-23
---

# Phase 22 Plan 02: BridgeRenderer visual tokens Summary

**FE/BE anchor labels now read as axis markers via theme.fileLabelColor + 1.0/0.85 alpha + `${canvasBackground}cc` backdrop pills; dangling bridges render with theme.nodeFill (color as primary signal) with the dashed-stroke call dropped — Phase 12 D-17 channel double-stroke invariant preserved.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-23T06:33:27Z
- **Completed:** 2026-04-23T06:40:50Z
- **Tasks:** 2 (one Wave 0 RED test-evolution task; one Wave 1 GREEN production-edit task split into 2 commits per fix)
- **Files modified:** 3 (1 production + 2 test files)
- **Commits:** 3 (1 RED + 2 GREEN)
- **Witnesses closed:** 4 unique (W-22-04, W-22-05, W-22-06 with 3 sub-cases, W-22-07)
- **Phase 12 regression status:** all V-12-21 + V-12-22 remaining cases GREEN; the two dangling-applies-BRIDGE_DASH_PATTERN cases at :188-226 and the folderLabelColor assertion at :171-183 were legitimately retired per RESEARCH §5.3 test-evolution note

## Accomplishments

- **Fix 3 — Anchor label contrast shipped.** `drawBoundaryAnchorLabels` now resolves label color from `theme.fileLabelColor ?? theme.nodeStroke`; bold rows (FRONTEND / BACKEND) render at globalAlpha 1.0; thin rows (TypeScript / Rust) at 0.85. Each stack emits a zero-radius `fillRect` backdrop pill sized via `ctx.measureText(glyph).width + 8px PAD_X` × `28px PAD_Y-inclusive` at fill `${theme.canvasBackground}cc`. Pill is drawn BEFORE the stack's first `fillText` so it sits behind the glyphs.
- **Fix 4 — Dangling bridge signal rewritten.** `drawBridgeNodes` inner-diamond fillStyle is now a three-way ternary — selected wins → `theme.nodeFillHover ?? baseFill`; otherwise dangling → `theme.nodeFill`; populated → cyan fallback chain (`theme.edgeGlow ?? theme.arrowFill ?? '#00cffc'`). The `if (isDangling) ctx.setLineDash(BRIDGE_DASH_PATTERN)` call is deleted. `BRIDGE_DASH_PATTERN` constant is retained with an eslint-disable + retention comment per D-14.
- **Phase 12 D-17 channel-double-stroke invariant proven preserved.** W-22-07 regression witness asserts identical `moveTo` (2) + `lineTo` (6) counts across dangling + populated `{ hasChannelArg: true }` states — orthogonal code topology (channel ring at :146-160 consults `hasChannelArg` only, never `isDangling`). GREEN.
- **Test harness extended.** `BoundaryLine.test.ts` mock now records `fillRect` + stubs `measureText`. `BridgeRender.test.ts` mock unchanged (already had `setLineDash`).
- **Full radar regression clean.** `npm run test -- --run src/views/Radar/__tests__/` passes 184/185; the single remaining failure is the Phase 12 deferred-items.md pre-existing `HeatMapOverlay heatTintForNode(0)` expectation drift that predates this plan (confirmed — got `#0f1a0e` from `phosphor-classic.nodeFill`, expected hardcoded `#1a1919`).
- **`npm run build` green** — TypeScript + Vite build passes; `eslint-disable-next-line @typescript-eslint/no-unused-vars` on `BRIDGE_DASH_PATTERN` compiles cleanly.

## Task Commits

Each task committed atomically per the commit-after-each-change memory rule:

1. **Task 1 (Wave 0 RED — atomic test-evolution):** `4b31a13` `test(22-02): replace obsolete dangling-dash + folderLabelColor cases with W-22-04..W-22-07`
   - Both test-file edits in ONE commit per RESEARCH §5.3 (never leaves the suite incoherent between test-delete and test-add).
2. **Task 2 Commit 1 (Wave 1 GREEN — Fix 3):** `bf2282f` `feat(22-02): Fix 3 - FE/BE anchor labels use fileLabelColor + alpha raise + backdrop pills`
3. **Task 2 Commit 2 (Wave 1 GREEN — Fix 4):** `7e6c152` `feat(22-02): Fix 4 - dangling bridges use theme.nodeFill; drop setLineDash call`

_Total: 3 commits. TDD cadence: 1 RED → 1 GREEN per fix. No refactor commits (the code was already idiomatic post-edit)._

## Files Created/Modified

- `src/views/Radar/BridgeRenderer.ts` — (1) Added `composeBackdropFill(canvasBg)` helper directly above `drawBoundaryAnchorLabels`; (2) rewrote `drawBoundaryAnchorLabels` body: swap folderLabelColor→fileLabelColor; raise alpha 0.8→1.0 (bold) and 0.55→0.85 (thin); measure glyphs; emit pill `fillRect` then reset fillStyle for text; per stack; (3) changed `drawBridgeNodes` inner-diamond `fillStyle` assignment from 2-way to 3-way ternary; deleted `if (isDangling) ctx.setLineDash(BRIDGE_DASH_PATTERN)`; (4) added retention comment + eslint-disable on `BRIDGE_DASH_PATTERN` export. Channel ring (:146-160) and selected ring (:163-176) bytes-unchanged.
- `src/views/Radar/__tests__/BoundaryLine.test.ts` — (1) Extended `makeMockCtx` with `fillRect` recorder + `measureText` stub; (2) replaced `V-12-22: uses theme.folderLabelColor for fills` with `W-22-04: uses theme.fileLabelColor (not folderLabelColor) for label fills; bold alpha 1.0, thin alpha 0.85` (adds alpha assertions); (3) added `W-22-05: emits one zero-radius fillRect backdrop pill per label stack BEFORE each fillText; pill fill = canvasBackground@80%` (asserts fillRect count ≥ 2, per-stack precedence of fillRect index before respective fillText index, and pill fillStyle = `${canvasBackground}cc`).
- `src/views/Radar/__tests__/BridgeRender.test.ts` — (1) Deleted `V-12-21: dangling bridge (callerCount=0) applies BRIDGE_DASH_PATTERN` and `V-12-21: dangling bridge (handlerFile="") applies BRIDGE_DASH_PATTERN`; (2) added `W-22-06 (callerCount=0)`, `W-22-06 (handlerFile="")` — both assert `fillStyle.toContain(theme.nodeFill)` and no `setLineDash` call with `BRIDGE_DASH_PATTERN` arg; (3) added `W-22-06 populated regression` using explicit bare themes (rung 1: edgeGlow=`#00cffc`; rung 3: neither edgeGlow nor arrowFill → hardcoded `#00cffc`); (4) added `W-22-07 channel double-stroke geometry identical across dangling AND populated` asserting moveTo=2 + lineTo=6 across both states.

## Decisions Made

- **W-22-06 populated-fill assertion form (deviation from plan text — see `Deviations from Plan` below).** The plan specified a test case passing the default FALLBACK_THEME and asserting `fillStyle.toContain('#00cffc')`, but phosphor-classic (= FALLBACK_THEME) ships `arrowFill: 'rgba(42, 77, 36, 0.7)'` — so the chain resolves to `arrowFill`, not `#00cffc`. Mirrored the existing `V-12-21: diamond fill uses theme.edgeGlow fallback chain` pattern at BridgeRender.test.ts:106 which uses bare themes to exercise each rung of the chain independently. This is a Rule 1 test-plan fix.
- **composeBackdropFill location.** Placed as a module-private function directly above `drawBoundaryAnchorLabels`. Alternative (extract a shared `drawLabelWithBackdrop` helper) was deferred — CONTEXT Claude's Discretion permits either; a shared helper is worth creating only when/if the right-edge label mirror (Phase 12 `<deferred>`) lands.
- **Backdrop alpha = 0.8 (not tuned per theme).** CONTEXT D-23 makes the 9-theme eyeball pass OPTIONAL; it was NOT performed in this plan. If a future UAT round surfaces a theme where 0.8 reads wrong, the `composeBackdropFill` helper is the single-line tuning point.
- **Defensive `ctx.setLineDash([])` reset kept.** Now a no-op but costs nothing and guards against upstream dirty dash-state on the ctx. CONTEXT D-14 explicitly permitted either retain or delete; chose retain for minimal diff.
- **Phase 12 D-17 channel double-stroke invariant verified via geometry-count equality (not geometry-value equality).** Because `d` varies with `zoom`, asserting specific `moveTo`/`lineTo` coordinates would be brittle. The witness asserts call counts (2 moveTo + 6 lineTo per bridge) AND cross-state equality — which is a sufficient and stable form given the existing code topology.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] W-22-06 populated-bridge regression test would never pass against live code**

- **Found during:** Task 1 RED verification — after writing the W-22-06 populated-regression case exactly as the plan specified, the test failed against pre-Fix-4 code with `expected [ 'rgba(42, 77, 36, 0.7)' ] to include '#00cffc'`. This would have remained RED even after Fix 4 because Fix 4 does not touch the populated fill path — the assertion is simply wrong.
- **Issue:** The plan (22-02-PLAN.md Task 1 Step B1, verbatim from 22-PATTERNS.md §BridgeRender.test.ts — EXTENDED) asserts `expect(ctx._assignments.fillStyle).toContain('#00cffc')` with no theme argument. But `FALLBACK_THEME = THEMES['phosphor-classic']` (BridgeRenderer.ts:28) ships `arrowFill: 'rgba(42, 77, 36, 0.7)'` (themes.ts:69). The chain `theme.edgeGlow ?? theme.arrowFill ?? '#00cffc'` resolves to `arrowFill` for phosphor-classic, never falling through to the hardcoded literal. The `#00cffc` literal is only reached when BOTH edgeGlow AND arrowFill are absent — which no THEMES entry satisfies.
- **Fix:** Replaced the single default-theme assertion with the existing Phase 12 `V-12-21: diamond fill uses theme.edgeGlow fallback chain` bare-theme pattern at BridgeRender.test.ts:106. New test exercises two rungs: (rung 1) explicit bare theme with `edgeGlow: '#00cffc'` → asserts `toContain('#00cffc')`; (rung 3) explicit bare theme with no edgeGlow AND no arrowFill → asserts hardcoded `#00cffc` literal is reached. This is precisely the idiomatic form Phase 12 established for the same surface.
- **Files modified:** `src/views/Radar/__tests__/BridgeRender.test.ts` (Task 1 commit `4b31a13`).
- **Verification:** GREEN post-Fix 4 (W-22-06 populated-regression passes); RED pre-Fix 4 only for the dangling cases (not this one — rung 1 already resolves correctly to `edgeGlow='#00cffc'` in the bare theme). No regression to V-12-21.
- **Committed in:** `4b31a13` (part of the atomic RED test-evolution commit). The commit message explicitly documents this as a `[Rule 1 - Plan spec fix]`.

---

**Total deviations:** 1 auto-fixed (Rule 1 test-plan correctness).
**Impact on plan:** The fix is a test-assertion correction, not a scope expansion. It preserves the plan's intent (regression witness that populated fill remains cyan) and uses the existing V-12-21 idiomatic pattern. No impact on Fix 3/Fix 4 scope, no impact on the commit cadence, no impact on W-22-06's negative (no-setLineDash) assertions which remain exactly as specified.

## Issues Encountered

- **Pre-existing Phase 12 deferred failure encountered (NOT this plan's scope).** `HeatMapOverlay.test.ts > heatTintForNode(0) returns the default surface-container color (#1a1919)` expects `#1a1919` but receives `#0f1a0e` (phosphor-classic.nodeFill). Documented in `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/deferred-items.md` D-01 as "expectation drift." Per the "only fix own bugs" memory rule and CONTEXT D-22, this is NOT Phase 22's scope. Confirmed pre-existing: (a) documented in Phase 12 deferred-items; (b) not introduced by any Fix 3/Fix 4 edit in this plan; (c) my changes touch `BridgeRenderer.ts` and two test files only — `HeatMapOverlay.ts` is untouched.

## User Setup Required

None — no external service configuration required. All changes are in-process Canvas 2D draw-function surgery + Vitest test updates.

## Optional 9-theme Smoke (D-23)

**NOT performed in this plan** (CONTEXT D-23 explicitly marks it OPTIONAL and non-gating). Automated witnesses W-22-04..W-22-07 cover the contract surface. If a reviewer wants a visual confirmation of pill readability + dangling-vs-populated contrast across all 9 themes (electric-ice expected to show the most dramatic dangling/#ffffff vs populated/cyan delta per RESEARCH §2), it can be added as a `22-NN-CHECKPOINT.md` in a future pass — the executor did not create one.

## Next Phase Readiness

- **Plan 22-01 (composition fixes — RadarCanvas aura filter + hullCache bridge exclusion) is independent** of this plan (disjoint files — `RadarCanvas.tsx` + `hullCache.ts` vs `BridgeRenderer.ts`). CONTEXT D-19 explicitly notes no execution-order dependency. This plan's success does not gate 22-01; 22-01's success does not gate this plan.
- **Phase 22 closeout readiness** — after Plan 22-01 lands, the roadmap's Phase 22 goals (4 visual polish fixes) are met. No deferred items generated by this plan; no new threat surface; no schema/DTO/worker/IPC changes; no dependencies added.
- **Future-phase hooks** — if a right-edge mirror label surface ever lands (Phase 12 `<deferred>`), `composeBackdropFill` + the `measureText + fillRect + fillText` ordering are directly reusable. If a `theme.axisLabelColor` token is ever promoted to a first-class GraphTheme field (CONTEXT Claude's Discretion), the single swap site is `drawBoundaryAnchorLabels` line 234 `const labelColor = theme.fileLabelColor ?? theme.nodeStroke;`.

## Self-Check: PASSED

Files claimed as modified all exist on disk:
- FOUND: `src/views/Radar/BridgeRenderer.ts`
- FOUND: `src/views/Radar/__tests__/BoundaryLine.test.ts`
- FOUND: `src/views/Radar/__tests__/BridgeRender.test.ts`
- FOUND: `.planning/phases/22-bridge-layer-visual-polish-aura-hulls-labels-dangling-state/22-02-SUMMARY.md`

All three claimed commit hashes are reachable in git history:
- FOUND: `4b31a13` (Task 1 — RED test evolution)
- FOUND: `bf2282f` (Fix 3 — anchor label contrast)
- FOUND: `7e6c152` (Fix 4 — dangling bridge signal)

Plan-level automated gate GREEN: `npm run test -- --run src/views/Radar/__tests__/BridgeRender.test.ts src/views/Radar/__tests__/BoundaryLine.test.ts` → `Tests 26 passed (26)`.
Build GREEN: `npm run build` → `built in ~3s` with no errors and no new warnings (the existing `INEFFECTIVE_DYNAMIC_IMPORT` and chunk-size warnings pre-date this plan).

---
*Phase: 22-bridge-layer-visual-polish-aura-hulls-labels-dangling-state*
*Completed: 2026-04-23*
