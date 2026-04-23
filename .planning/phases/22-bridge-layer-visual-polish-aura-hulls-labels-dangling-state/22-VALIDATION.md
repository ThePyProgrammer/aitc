---
phase: 22
slug: bridge-layer-visual-polish-aura-hulls-labels-dangling-state
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-23
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Phase 22 is POLISH-ONLY — four discrete visual/rendering fixes on top of
> the shipped Phase 12 bridge-layer deliverable. Phase 12 witnesses
> V-12-15..V-12-24 remain the acceptance gate; new W-22-01..W-22-07
> witnesses cover the specific fixes.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (jsdom environment) — already installed, already used by all Phase 12 radar tests |
| **Config file** | Inherited from repo root `vitest.config.ts` (no Wave 0 changes) |
| **Quick run command** | `npm run test -- --run src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts src/views/Radar/__tests__/BridgeRender.test.ts src/views/Radar/__tests__/BoundaryLine.test.ts` |
| **Full suite command** | `npm run test -- --run` |
| **Estimated runtime** | Quick run ~2s; full suite ~60s (pre-existing failures in HeatMapOverlay / MasterDetailShell / useGraphLayout are NOT Phase 22 scope — see Phase 12 deferred-items.md) |

---

## Sampling Rate

- **After every task commit:** Run the quick command above (4 radar test files). ≤2s feedback.
- **After every plan wave:** Run `npm run test -- --run src/views/Radar/__tests__/` — full radar test surface (~5s).
- **Before `/gsd-verify-work`:** Full suite must be green, excepting the 4 pre-existing failures documented in `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/deferred-items.md` (they predate Phase 22; "only fix own bugs" memory rule applies).
- **Max feedback latency:** 2 seconds for the quick command.

---

## Per-Task Verification Map

Phase 22 has no REQ-IDs (polish-only); this table maps witnesses to tasks instead. Plan IDs assigned per CONTEXT.md D-17 (Plan 22-01: composition fixes; Plan 22-02: visual tokens).

| Witness  | Plan  | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|----------|-------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| W-22-01  | 22-01 | 1    | N/A (polish) | N/A       | `drawNodes` receives bridge-free `liveNodes` snapshot when bridges present | unit | `npm run test -- --run src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts` | ❌ W0 | ⬜ pending |
| W-22-02  | 22-01 | 1    | N/A (polish) | N/A       | `drawFileLabels` receives the same bridge-free snapshot | unit | `npm run test -- --run src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts` | ❌ W0 | ⬜ pending |
| W-22-03  | 22-01 | 1    | N/A (polish) | N/A       | `getHullCache` excludes `kind === 'bridge'` across themes + zoom buckets | unit | `npm run test -- --run src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts` | ❌ W0 | ⬜ pending |
| W-22-04  | 22-02 | 1    | N/A (polish) | N/A       | `drawBoundaryAnchorLabels` resolves label color from `theme.fileLabelColor` (not `folderLabelColor`); bold glyph globalAlpha = 1.0 | unit | `npm run test -- --run src/views/Radar/__tests__/BoundaryLine.test.ts` | ✅ (extend) | ⬜ pending |
| W-22-05  | 22-02 | 1    | N/A (polish) | N/A       | Anchor label emits zero-radius `fillRect` per label stack BEFORE `fillText`; rect fill = `canvasBackground@80%` | unit | `npm run test -- --run src/views/Radar/__tests__/BoundaryLine.test.ts` | ✅ (extend) | ⬜ pending |
| W-22-06  | 22-02 | 1    | N/A (polish) | N/A       | `drawBridgeNodes` dangling fill = `theme.nodeFill`; populated fill = `edgeGlow ?? arrowFill ?? '#00cffc'`; NO `setLineDash(BRIDGE_DASH_PATTERN)` call-log entry for either state | unit | `npm run test -- --run src/views/Radar/__tests__/BridgeRender.test.ts` | ✅ (extend) | ⬜ pending |
| W-22-07  | 22-02 | 1    | N/A (polish) | N/A       | Channel-bearing double-stroke geometry (`BRIDGE_CHANNEL_STROKE_OFFSET` ring) unchanged across dangling AND populated states — regression witness for Phase 12 D-17 invariant | unit | `npm run test -- --run src/views/Radar/__tests__/BridgeRender.test.ts` | ✅ (extend) | ⬜ pending |
| V-12-15..V-12-24 | regression | — | N/A | N/A | Phase 12 acceptance witnesses remain green (with planned updates to dangling-dash test cases in BridgeRender.test.ts:188–226 and folderLabelColor assertion in BoundaryLine.test.ts:171–183 — RESEARCH.md §5.3) | regression | `npm run test -- --run src/views/Radar/__tests__/` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

New test files to create before fix production code can be witnessed:

- [ ] `src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts` — stubs for W-22-01 + W-22-02 (asserts `drawNodes` and `drawFileLabels` receive a `liveNodes.filter(n => n.kind !== 'bridge')` snapshot when `bridgeNodes.length > 0`). Mock via the existing `makeMockCtx` pattern used in `BridgeRender.test.ts`.
- [ ] `src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts` — stub for W-22-03 (asserts `getHullCache` output map contains zero bridge points across a mixed file+bridge node fixture; iterate 9 themes × 3 zoom buckets = 27 micro-assertions or a single parameterized test).
- [ ] Optional refactor: extract shared `makeMockCtx` helper into `src/views/Radar/__tests__/_canvasMock.ts` (currently duplicated across `BridgeRender.test.ts` and `BoundaryLine.test.ts`; W-22-05's backdrop `fillRect` assertion + W-22-06's `setLineDash` call-log assertion need the same recorder plumbing). Planner's discretion per RESEARCH.md §6.3.
- [ ] No framework install required — Vitest + jsdom already in place.

---

## Manual-Only Verifications

All W-22-XX witnesses are automated via Vitest. An OPTIONAL 9-theme × 2-fix human smoke (Fix 3 pill readability + Fix 4 dangling-vs-populated distinction) is recommended by CONTEXT.md D-23 but NOT gating. If the planner adds it:

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 9-theme readability of FE/BE anchor pill backdrop + pill alpha | N/A (polish) | Subjective "reads as axis marker, not chrome" — requires eyeball across all 9 themes | Run `npm run tauri dev`, open the aitc repo as workspace, cycle through all 9 themes via Theme picker, confirm FRONTEND/BACKEND labels read as axis markers at every theme on the currently-loaded bridge layer |
| 9-theme readability of dangling-vs-populated bridge fill contrast | N/A (polish) | Subjective — requires eyeball that dangling bridges read as "inert" and populated bridges read as "active" across all 9 themes | Same dev harness; locate a dangling bridge (rare in aitc repo; synthesise by temporarily adding a dead `#[tauri::command]` in src-tauri) and confirm visible contrast against populated bridges in all 9 themes |

If the optional human smoke is added, create `22-NN-CHECKPOINT.md` following the Phase 12 `12-05-CHECKPOINT.md` pattern — named file with explicit checklist and resume signal.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (W-22-01..W-22-07 + regression on V-12-15..V-12-24)
- [ ] Sampling continuity: quick command runs after every task commit; no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (2 new test files + optional shared mock helper)
- [ ] No watch-mode flags (`--run` is explicit in every command)
- [ ] Feedback latency < 2s for the scoped quick command
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 lands

**Approval:** pending
