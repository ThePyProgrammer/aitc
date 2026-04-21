---
phase: 11
plan: 01
subsystem: testing
tags: [webworker, d3-force, typescript, scaffold, vitest, tauri, vite]

# Dependency graph
requires:
  - phase: 07
    provides: d3-force tuning constants, useGraphLayout hook, forceCluster/forceClusterCollide modules
provides:
  - src/workers/ directory with four compilable module stubs (graphSimConfig, graphSimProtocol, graphSimCore, graphSim.worker)
  - Four test-file stubs + shared tiny-graph fixture under src/workers/__tests__/
  - Tuning constants relocated from useGraphLayout.ts into the React/zustand-free graphSimConfig.ts
  - WorkerIn / WorkerOut discriminated-union protocol (7 + 3 message variants) + locally-inlined ForceConfig
  - graphSimCore factory signature + eight-method GraphSimCore interface surface (body is Wave 1)
affects: [11-02, 11-03, 11-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Worker-safe module isolation (no React / zustand / Tauri / store imports under src/workers/)
    - Re-export preservation pattern (import + `export ... from` in a single module keeps existing test imports resolving after extraction)
    - Vitest it.todo scaffold (pending assertions in stubs ship green; later waves flip them to real tests)
    - describe.skipIf env gating for perf benchmarks (RUN_BENCHMARKS=1)
    - Exhaustive-switch `const _exhaustive: never = m;` guard on discriminated-union message types

key-files:
  created:
    - src/workers/graphSimConfig.ts
    - src/workers/graphSimProtocol.ts
    - src/workers/graphSimCore.ts
    - src/workers/graphSim.worker.ts
    - src/workers/__tests__/graphSimCore.test.ts
    - src/workers/__tests__/graphSimProtocol.test.ts
    - src/workers/__tests__/bufferPool.test.ts
    - src/workers/__tests__/graphSimBenchmark.test.ts
    - src/workers/__tests__/fixtures/tiny-graph.ts
    - .planning/phases/11-move-d3-force-simulation-to-a-webworker-with-transferable-fl/deferred-items.md
  modified:
    - src/hooks/useGraphLayout.ts

key-decisions:
  - "ForceConfig inlined locally in graphSimProtocol.ts rather than re-exported from radarStore.ts — radarStore.ts imports zustand at module scope, so re-export would violate D-03 worker isolation"
  - "useGraphLayout.ts keeps its 14 Phase-7 constant exports via `export { ... } from './workers/graphSimConfig'` so useGraphLayout.test.ts:15-23 continues resolving unchanged"
  - "tsconfig.json `lib` list NOT updated — the `/// <reference lib=\"webworker\" />` triple-slash directive scopes DedicatedWorkerGlobalScope to graphSim.worker.ts only; deferred to Wave 2 if the active worker needs it"
  - "Benchmark file gated behind process.env.RUN_BENCHMARKS (matches plan's updated env var name) — describe.skipIf(!process.env.RUN_BENCHMARKS)"
  - "Wave 0 stubs use void-statement tricks to satisfy noUnusedLocals + noUnusedParameters under TS strict while keeping the real method bodies deferred to Wave 1/2"

patterns-established:
  - "src/workers/ isolation boundary: enforced by grep (`! grep -qE \"^import.*from '(zustand|@tauri-apps|react|\\.\\./stores|\\.\\./bindings)'\" src/workers/*.ts`)"
  - "Shared test fixture under src/workers/__tests__/fixtures/ (tiny-graph.ts) with mulberry32 + seedGraph + DEFAULT_FORCE_CONFIG + tinyGraph for deterministic ≤50-node unit tests"
  - "Stub-then-flesh-out execution model: Wave 0 lands compilable skeletons; Waves 1/2/3 flip `it.todo(...)` cases into real assertions"

requirements-completed: [VIZN-04]

# Metrics
duration: 9 min
completed: 2026-04-21
---

# Phase 11 Plan 01: Wave 0 Scaffolding Summary

**Scaffolded `src/workers/` with four compilable module stubs + four test stubs + a shared deterministic fixture, extracted Phase 7 d3-force tuning constants into `graphSimConfig.ts`, and rewired `useGraphLayout.ts` via re-exports so the existing 9 hook tests keep resolving every Phase-7 constant without churn — zero runtime behavior change, zero new TS errors.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-21T01:42:17Z
- **Completed:** 2026-04-21T01:51:25Z
- **Tasks:** 3
- **Files created:** 10 (9 source + 1 tracker)
- **Files modified:** 1 (`src/hooks/useGraphLayout.ts`)

## Accomplishments

- Four worker-safe module files under `src/workers/` (graphSimConfig, graphSimProtocol, graphSimCore, graphSim.worker) — all compile under Vite 8 + TS strict (`noUnusedLocals`, `noUnusedParameters`) and transitively import zero React / zustand / Tauri / store code (D-03 enforced by grep).
- 14 Phase-7 tuning constants relocated into `graphSimConfig.ts`, plus `FORCE_CONFIG_ALPHA` promoted from non-exported const, plus two new Phase 11 constants: `QUADTREE_REBUILD_TICK_INTERVAL = 10` (D-16) and `INITIAL_POSITION_SEED = 0x5eedf04c` (RESEARCH §Pitfall 1 for seeded `simulation.randomSource`).
- `WorkerIn` (7 variants) + `WorkerOut` (3 variants) discriminated-union protocol with a locally-inlined `ForceConfig` (not re-exported from radarStore because radarStore pulls zustand at module scope — would break D-03 isolation).
- `makeGraphSimCore` factory stub with the full `GraphSimCore` interface (8 methods) + `GraphSimCallbacks` + `SimNode` / `SimEdge` types — body no-ops, Wave 1 fills it.
- `graphSim.worker.ts` module stub with `/// <reference lib="webworker" />` + `export {};` — Wave 2 wires the `ctx.onmessage` router.
- Four test files + one fixture module: `graphSimCore.test.ts` (1 real assertion + 12 `it.todo`), `graphSimProtocol.test.ts` (2 compile-time exhaustiveness tests), `bufferPool.test.ts` (4 `it.todo`), `graphSimBenchmark.test.ts` (gated behind `RUN_BENCHMARKS=1` with 4 `it.todo`), `fixtures/tiny-graph.ts` (mulberry32 + seedGraph + DEFAULT_FORCE_CONFIG + tinyGraph).
- All 9 existing `useGraphLayout.test.ts` cases stay green — re-export preserves every constant import path.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract tuning constants into `src/workers/graphSimConfig.ts`** — `b514f57` (refactor)
2. **Task 2: Scaffold graphSimProtocol.ts + graphSimCore.ts + graphSim.worker.ts stubs** — `4e47190` (scaffold)
3. **Task 3: Scaffold four test files and the shared tiny-graph fixture** — `0615274` (test)

## Files Created/Modified

### Created — source modules

- `src/workers/graphSimConfig.ts` (35 lines) — 17 exported constants (14 Phase-7 carry-overs + FORCE_CONFIG_ALPHA + QUADTREE_REBUILD_TICK_INTERVAL + INITIAL_POSITION_SEED). Zero external imports beyond primitive number literals.
- `src/workers/graphSimProtocol.ts` (58 lines) — `InitMessage`, `TopologyMessage`, `WorkerIn` (7-variant union), `WorkerOut` (3-variant union), locally-declared `ForceConfig`. No runtime code.
- `src/workers/graphSimCore.ts` (69 lines) — `makeGraphSimCore` factory stub returning 8-method `GraphSimCore`; exports `SimNode`, `SimEdge`, `GraphSimCallbacks`, `MakeGraphSimCoreOpts`.
- `src/workers/graphSim.worker.ts` (23 lines) — triple-slash `webworker` lib reference + module marker; imports `makeGraphSimCore` + `WorkerIn`/`WorkerOut` types (the only imports Wave 2's router will need). void-statements keep `noUnusedLocals` happy.

### Created — test scaffolds

- `src/workers/__tests__/fixtures/tiny-graph.ts` (45 lines) — `mulberry32`, `seedGraph`, `DEFAULT_FORCE_CONFIG`, `tinyGraph` (20-node).
- `src/workers/__tests__/graphSimCore.test.ts` (41 lines) — 1 real factory-shape assertion + 12 `it.todo` cases (D-05..D-19, D-34).
- `src/workers/__tests__/graphSimProtocol.test.ts` (46 lines) — 2 compile-time exhaustive-switch tests with `const _exhaustive: never = m;` guards.
- `src/workers/__tests__/bufferPool.test.ts` (13 lines) — 4 `it.todo` cases for D-06 / D-09 / D-34 / ASVS V5.
- `src/workers/__tests__/graphSimBenchmark.test.ts` (14 lines) — `describe.skipIf(!process.env.RUN_BENCHMARKS)` gate + 4 `it.todo` perf cases (D-31..D-34).

### Created — tracker

- `.planning/phases/11-.../deferred-items.md` — logs the 4 pre-existing test failures + 6 pre-existing TS errors on `main` that are out of Phase 11 scope (per project memory "Only fix own bugs").

### Modified

- `src/hooks/useGraphLayout.ts` — removed the 14 local constant declarations + the non-exported `FORCE_CONFIG_ALPHA`; added one `import { ... } from '../workers/graphSimConfig'` (for local use inside `buildSimulation` / `shouldRewarm`) and one `export { ... } from '../workers/graphSimConfig'` (for external consumers). Net: +34 / −20 lines. Zero behavior change.

## Decisions Made

1. **ForceConfig inlined locally in graphSimProtocol.ts (not re-exported from radarStore.ts).** `src/stores/radarStore.ts:18` does `import { create } from 'zustand'` at module scope — any re-export would transitively pull zustand into the worker bundle, violating D-03. The local declaration is structurally identical to `radarStore.ts:66-72` (verified at plan time 2026-04-17). Wave 2's shim will translate at the postMessage boundary. If the two shapes ever drift, Wave 2 will reconcile — out of scope here.

2. **Single import + single `export from` pattern in useGraphLayout.ts** — `isolatedModules: true` (tsconfig.json line 13) requires the constants used inside `buildSimulation` / `shouldRewarm` to be locally imported (otherwise they're not in scope), while test consumers need them re-exported from the hook path. The plan offered two shapes; I chose the cleaner one: one `import { ... }` for the 10 locally-used constants, one `export { ... } from` for all 15 re-exports. No duplicated tuple.

3. **tsconfig.json `lib` list NOT updated.** The `/// <reference lib="webworker" />` triple-slash directive at the top of `graphSim.worker.ts` scopes `DedicatedWorkerGlobalScope` to that file only — no need to pollute the global `lib: ["ES2020", "DOM", "DOM.Iterable"]`. Wave 2 can revisit if needed, but the stub compiles as-is.

4. **Benchmark env var: `RUN_BENCHMARKS`, not `BENCH`.** The plan's `<behavior>` grep (`describe.skipIf(!process.env.RUN_BENCHMARKS)`) explicitly specifies the longer name. I followed the plan.

5. **Wave 0 stubs use `void …;` statements to satisfy `noUnusedLocals`.** `graphSim.worker.ts` has to import `makeGraphSimCore`, `WorkerIn`, `WorkerOut`, and reference `ctx`, but none are used yet (Wave 2 does the wiring). `void` keeps them alive without a runtime side effect.

## Deviations from Plan

None — plan executed exactly as written.

The plan's task instructions, acceptance greps, commit-message templates, and file contents were all followed to the letter. The locally-inlined `ForceConfig` (Task 2) is documented in the plan itself as the expected outcome when radarStore pulls zustand at module scope (which it does), not a deviation.

## Issues Encountered

**1. `npm run build` fails on 6 pre-existing TS errors on `main`.**
Plan's `<verification>` block calls `npm run build`. It currently fails because of 6 pre-existing TS errors in `src/bindings.ts`, `src/views/Arsenal/ArsenalView.tsx`, `src/views/Radar/RadarCanvas.tsx`, and `src/views/Radar/__tests__/RadarCanvas.test.tsx` — all from Phase 10 / generated bindings drift, none in Phase-11-touched files. Verified by stashing Phase 11 work and re-running `tsc --noEmit` — identical 6-error set appears pre and post Phase 11. Phase 11 adds zero new TS errors (count 6 before, 6 after). Logged in `deferred-items.md`. The stronger witness for Wave 0 compile-ability is `npx tsc --noEmit` with an error count identical to baseline, which passes.

**2. 4 pre-existing vitest failures on `main`** (Arsenal `MasterDetailShell` layout classes, `agentStore.launchAgent`, `HeatMapOverlay.heatTintForNode`). None in Phase-11 files. Verified pre-existing by the same stash-and-rerun technique. Logged in `deferred-items.md`. The Phase-11-scoped command `npm test -- --run src/workers src/hooks/__tests__/useGraphLayout.test.ts` is fully green (3 files passed, 2 skipped, 12 real passing assertions + 20 `it.todo`).

Both issues belong to other phases' cleanup work, not Phase 11 — per CLAUDE.md memory rule "Only fix own bugs — only fix bugs caused by current-session work", they are not addressed here.

## Authentication Gates

None — frontend-only, no network or auth surface touched.

## User Setup Required

None — no external service configuration required.

## Wave 1 Readiness — Surprises to Know About

1. **`npm run build` is not green on `main`.** If Wave 1's planner or verifier uses `npm run build` as a witness, they will hit the 6 pre-existing errors documented in `deferred-items.md`. The error count delta (baseline vs. post-plan) is the valid witness. Consider updating Wave 1's plan to use `npx tsc --noEmit` + error-count-compare if the pre-existing errors haven't been fixed by then.

2. **4 pre-existing vitest failures** in files unrelated to Phase 11 will appear in the full-suite run. `npm test -- --run src/workers src/hooks` is green; the phase-level full suite is not. See `deferred-items.md` for the exact failing tests.

3. **ForceConfig is locally declared in graphSimProtocol.ts, NOT re-exported from radarStore.ts.** Wave 2's `useGraphLayout` rewrite must translate between `radarStore.ForceConfig` (main-side) and `graphSimProtocol.ForceConfig` (worker-side) at the `postMessage` call sites. Shapes are structurally identical, so `... satisfies ForceConfig` on both sides is sufficient.

4. **`QUADTREE_REBUILD_TICK_INTERVAL = 10`** (D-16) and **`INITIAL_POSITION_SEED = 0x5eedf04c`** (RESEARCH §Pitfall 1) are already exported from `graphSimConfig.ts` — Wave 1 just needs to import them.

5. **tsconfig.json `lib` list not updated.** If Wave 2's fleshed-out worker body needs types beyond `DedicatedWorkerGlobalScope` (e.g. `ImageBitmap`, `OffscreenCanvas`), the triple-slash `/// <reference lib="webworker" />` at the top of `graphSim.worker.ts` should be sufficient. Only add `"WebWorker"` to tsconfig's `lib` array if a third file needs worker types.

6. **Phase 10 landed a worker-unrelated `test(10-06)` commit (52b95db) between my Task 2 and Task 3 commits.** This was a concurrent parallel-session write to `main` during the 9-minute execution window. It does not touch `src/workers/` or `src/hooks/useGraphLayout.ts` and does not affect Phase 11. Noted here for anyone tracing `git log` context.

7. **`graphSim.worker.ts` Wave 0 stub uses `void …;` statements** to keep `noUnusedLocals`/`noUnusedParameters` happy. Wave 2 must delete the four `void ...;` lines when wiring the actual router — they are not harmless in fleshed-out code (will become dead-code / `noUnusedLocals` violations once the symbols are genuinely used).

## Next Phase Readiness

- Wave 0 (this plan) is complete. `src/workers/` directory + test scaffolds + fixture are in place.
- Wave 1 (`11-02-PLAN.md`) can start immediately: implement `makeGraphSimCore` body, flip the 12 `it.todo` cases in `graphSimCore.test.ts` into real assertions, and seed the simulation with `sim.randomSource(mulberry32(INITIAL_POSITION_SEED))`.
- Wave 2 (`11-03`) depends on Wave 1 — worker shim router + ping-pong buffer pool + `useGraphLayout.ts` Worker-client rewrite.
- Wave 3 (`11-04`) depends on Wave 2 — `RadarCanvas` hot path refactor + perf harness + visual invariance check.

## Self-Check: PASSED

- [x] `src/workers/graphSimConfig.ts` exists
- [x] `src/workers/graphSimProtocol.ts` exists
- [x] `src/workers/graphSimCore.ts` exists
- [x] `src/workers/graphSim.worker.ts` exists
- [x] `src/workers/__tests__/graphSimCore.test.ts` exists
- [x] `src/workers/__tests__/graphSimProtocol.test.ts` exists
- [x] `src/workers/__tests__/bufferPool.test.ts` exists
- [x] `src/workers/__tests__/graphSimBenchmark.test.ts` exists
- [x] `src/workers/__tests__/fixtures/tiny-graph.ts` exists
- [x] Commit `b514f57` present (Task 1)
- [x] Commit `4e47190` present (Task 2)
- [x] Commit `0615274` present (Task 3)
- [x] All 9 existing `useGraphLayout.test.ts` cases green
- [x] `npm test -- --run src/workers` green (3 passed + 20 todo, 0 failed)
- [x] Zero new TS errors (baseline 6 vs. current 6)
- [x] D-03 isolation grep passes for all 4 worker modules
- [x] `npm run build` fails on pre-existing errors (NOT Phase 11 — documented)

---
*Phase: 11-move-d3-force-simulation-to-a-webworker-with-transferable-fl*
*Completed: 2026-04-21*
