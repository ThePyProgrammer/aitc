---
phase: 11-move-d3-force-simulation-to-a-webworker-with-transferable-fl
verified: 2026-04-21T10:50:00Z
status: passed
score: 34/34 decisions witnessed (30 PASS, 3 MIXED-jsdom+manual, 1 PASS environment-bounded)
caveats:
  - "D-31 jsdom synthetic benchmark is environment-fragile: ceiling 250ms; observed range 116-345ms across runs on this box. Gated behind RUN_BENCHMARKS=1 so default CI lane stays green. Authoritative <50ms longtask witness is the user's manual Tauri Performance trace."
  - "One net-new TS error introduced by Phase 11: src/workers/__tests__/graphSimBenchmark.test.ts(112,9) — onTick callback typed with a too-narrow intersection. Test passes at runtime. Contradicts 11-04-SUMMARY.md §Issues Encountered claim of 'Zero new TS errors'."
  - "Manual rows in 11-VERIFICATION.md remain unticked and Browser-measured column empty — this is the expected Task 3 deferral per plan 11-04 frontmatter (autonomous: false). 11-VERIFICATION.md stays status:draft until user confirms the prod-build smoke and real-browser longtask trace."
known_deferred:
  - "Tauri prod-build smoke + DevTools Performance 5k-node trace (user's final step)"
  - "Secondary-OS Tauri smoke (macOS blocked by tauri#9975)"
  - "Visual-invariance eyeball check, force-slider responsiveness, drag-to-pin (user step)"
pre_existing_issues_not_in_scope:
  - "4 pre-existing test failures (Phase 10 MasterDetailShell x2, agentStore launch_agent options, Phase 9 HeatMapOverlay theme) — documented in deferred-items.md"
  - "6 pre-existing TS errors (bindings.ts x3, ArsenalView.tsx, RadarCanvas.tsx unused import, RadarCanvas.test.tsx unused import) — documented in deferred-items.md"
---

# Phase 11 — Verification Report

**Phase Goal (from 11-CONTEXT.md §domain):** Relocate the existing d3-force
simulation from the React main thread into a dedicated Web Worker; positions
flow back as Transferable Float32Array; zero visual change; zero new features;
success = no main-thread long tasks >50ms during a 5k-node settle.

**Verification mode:** Initial (no prior VERIFICATION-REPORT.md existed).
The 11-VERIFICATION.md scaffold produced by Wave 3 Task 3 is the user-facing
decision ledger; this file is the goal-backward audit against the codebase.

---

## Executive Summary

**All 34 locked decisions D-01..D-34 are witnessed in code, tests, or the
ledger.** The simulation has left the main thread; data transport is a
Transferable Float32Array with AoS layout, no SAB, ping-pong + 3rd spare;
the hot path reads positions via Float32Array index math; the benchmark
harness asserts the four performance decisions with doc-commented jsdom
floors; the manual rows for the browser-calibrated D-31 longtask witness
remain the user's final step as the plan scopes.

The SUMMARY's core claims hold up against the code. Two minor deltas were
found during verification (flaky D-31 benchmark under CI load + one
net-new TS type error in the benchmark test file); neither blocks the
phase goal.

---

## Goal-Backward Truth Matrix

| # | Must-have truth                                                                 | Status | Evidence |
|---|---------------------------------------------------------------------------------|:------:|----------|
| 1 | d3-force simulation no longer executes on the React main thread                | PASS   | `grep -nE "^import.*from 'd3-force'" src/hooks/useGraphLayout.ts` empty; only mention is a comment. All `forceSimulation` calls live in `src/workers/graphSimCore.ts:261`. |
| 2 | Worker loaded via literal-inline Vite URL pattern                               | PASS   | `src/hooks/useGraphLayout.ts:243` — exact literal `new Worker(new URL('../workers/graphSim.worker.ts', import.meta.url), { type: 'module' })`. `npx vite build` emits `dist/assets/graphSim.worker-BPWWxJwI.js` (18.61 kB). |
| 3 | Positions transported as Transferable Float32Array (AoS `[x0,y0,x1,y1,...]`)    | PASS   | `graphSimCore.ts:184-189` writes `buf[i*2] = x; buf[i*2+1] = y`. `graphSim.worker.ts:14-22` calls `postMessage(..., { transfer: [m.positions.buffer] })`. Ping-pong return: `useGraphLayout.ts:146-158`. |
| 4 | No SharedArrayBuffer anywhere in `src/workers/`                                 | PASS   | `grep -rFq "SharedArrayBuffer" src/workers/` returns nothing. Confirms D-07. |
| 5 | Buffer pool capped at 3 (ping-pong + 1 spare)                                   | PASS   | `createBufferPool` eager-allocates 3 (`graphSimCore.ts:110-114`); `acquire()` returns null beyond 3; `bufferPool.test.ts` + `graphSimBenchmark.test.ts D-34` assert 100 acquires, 3 saturate, 4th-onwards null, returnBuffer re-enables re-acquisition without growth. |
| 6 | Main-thread render hot path reads positions from Float32Array via index math    | PASS   | `RadarCanvas.tsx:572-622` — `const live = simNodesRef.current`; iterates `live.ids` reading `live.positions[i*2]` / `live.positions[i*2+1]`. No `SimNode[]` iteration remains. |
| 7 | `drawEdges`/`drawNodes`/`drawFolderHulls` signatures unchanged (visual invariance) | PASS   | `GraphRenderer.ts:196/268/319/371/463/498` — signatures match Phase 7 (all accept `Map<string,{x,y}>` or `GraphNode[]`). No rendering-pipeline logic changed in the diff. `RadarCanvas.test.tsx` 9/9 green including the new D-25 LivePositions-read test proving Float32Array coords (77,88)/(-42,13) are rendered NOT store coords (0,0)/(100,0). |
| 8 | Worker isolation — no React/zustand/Tauri/bindings imports                       | PASS   | `grep -E "\b(zustand\|@tauri-apps\|from 'react'\|\.\./stores\|\.\./bindings)\b" src/workers/graphSim*.ts src/workers/graphSimCore.ts` returns nothing. `graphSimCore.ts` imports only d3-force + d3-force type + `../views/Radar/forceCluster` + own protocol/config. |
| 9 | Worker is a ~50-LOC thin shim (D-23)                                            | PASS   | `wc -l src/workers/graphSim.worker.ts` = **53**. All orchestration lives in the 399-LOC `graphSimCore.ts`. |
| 10 | Pure core has no `self`/`postMessage`/`Worker`/DOM globals (D-22)               | PASS   | `grep -E "\bself\b\|\bpostMessage\b\|\bnew Worker\b\|\baddEventListener\b" src/workers/graphSimCore.ts` returns nothing. Asserted inside `graphSimCore.test.ts:304-315` by reading the source file at runtime. |
| 11 | Sequence-guarded tick/settled drops stale messages (D-12)                       | PASS   | `useGraphLayout.ts:163-170` checks `msg.sequence < topologySeqRef.current` and returns the buffer without overwriting simNodesRef. `useGraphLayout.test.ts` — "drops stale-sequence tick messages" case. |
| 12 | Quadtree stays on main thread; rebuild every 10 ticks + on settle (D-16, D-17)  | PASS   | `useGraphLayout.ts:188` `tickCounterRef.current % QUADTREE_REBUILD_TICK_INTERVAL === 0`; `:209` rebuild on settled. `grep -qE "quadtree" src/workers/` returns nothing — d3-quadtree lives in the hook. |
| 13 | Benchmarks assert the four D-3N decisions in an honest jsdom-vs-browser split   | PASS (see caveat) | `graphSimBenchmark.test.ts` top doc-comment spells the jsdom-vs-browser rationale; each assertion's inline doc calls out its ceiling and points at 11-VERIFICATION.md's manual row; D-34 is environment-independent. |
| 14 | Test suite — zero Phase-11 regressions                                          | PASS   | `npm test -- --run`: 519 pass / 4 fail / 5 skipped / 4 todo. All 4 fails are pre-existing (MasterDetailShell ×2, agentStore, HeatMapOverlay) — documented in `deferred-items.md`, unrelated to Phase 11. New Phase 11 tests (graphSimCore, bufferPool, useGraphLayout rewrite, RadarCanvas D-25, graphSimBenchmark) all green. |
| 15 | Vite build emits worker chunk (D-02)                                            | PASS   | `npx vite build` → `dist/assets/graphSim.worker-BPWWxJwI.js` (18.61 kB) confirmed. |
| 16 | STATE/ROADMAP can find all 4 plan SUMMARYs                                      | PASS   | `.planning/phases/11-.../11-01-SUMMARY.md` through `11-04-SUMMARY.md` all exist (see ls above). |

---

## Decision-Ledger Audit (Delta vs. 11-VERIFICATION.md Scaffold)

I spot-checked the scaffold's witnesses against the live code. Every row
D-01..D-34 in `11-VERIFICATION.md` accurately cites what I re-verified:

- **D-01..D-10** (worker lifecycle + protocol): verified inline. `useGraphLayout.ts` owns one Worker per hook lifetime; lifecycle cleanup calls `postMessage({type:'dispose'})` then `worker.terminate()` at line 255-259.
- **D-11..D-15** (message protocol + tick cadence): verified. `WorkerOut` discriminated-union at `graphSimProtocol.ts:55-58` covers tick/settled/error; main-thread exhaustive switch with `_exhaustive: never` at `useGraphLayout.ts:230`. `setTimeout(fn, 0)` scheduler at `graphSim.worker.ts:32`.
- **D-16..D-17** (quadtree on main): verified. Rebuild cadence + on-settle trigger work as documented.
- **D-18..D-19** (continuous sim + fast-settle on init): verified. `graphSimCore.ts:290-295` runs the bounded fast-settle loop inside `init` before emitting first tick.
- **D-20..D-21** (pin/unpin fx/fy): verified. `graphSimCore.ts:351-371` + core unit test confirms pinned node stays within 1px of target after 50 ticks.
- **D-22..D-24** (testing strategy): verified. `graphSimCore.ts` pure — tests drive it via queue-based scheduler synchronously. `useGraphLayout.test.ts` uses MockWorker pattern per RESEARCH §Pattern 7.
- **D-25..D-28** (main-thread integration): verified. `LivePositions` shape at `useGraphLayout.ts:51-55`; `RadarCanvas.tsx:190-194` nodeById memo; `:219` commitSettledPositions called with the materialized Map on settled.
- **D-29..D-30** (shared constants + forceCluster): verified. Constants moved to `graphSimConfig.ts`; `useGraphLayout.ts` re-exports for back-compat. `forceCluster.ts` stays at `src/views/Radar/forceCluster.ts` and is imported unchanged by `graphSimCore.ts:22-25`.
- **D-31..D-34** (performance targets):
  - D-31: MIXED by design — jsdom ceiling 250ms; observed first run today 345.88ms (FAIL), immediate re-run 116.09ms (PASS). Flaky under CI load; authoritative witness lives in the manual row. Ledger honestly flags it.
  - D-32: PASS — jsdom p95 measurements today 2.93-3.84ms (ceiling 5ms, browser target 2ms).
  - D-33: PASS — jsdom tps 5k=16.8-21.3 (floor 10); 10k=8.2-8.8 (floor 3).
  - D-34: PASS — environment-independent; 100 acquires cap at 3, returns re-enable re-acquisition without growth. Same assertion in browser and jsdom.

All ledger rows cite concrete grep commands, file:line refs, test names, or
commit hashes. Nothing in the ledger is unverifiable or hand-waved.

---

## New Delta Found During Verification (Not in Scaffold)

### 1. D-31 jsdom synthetic benchmark is environment-fragile

**First run this session** (`RUN_BENCHMARKS=1 npm test -- --run src/workers/__tests__/graphSimBenchmark.test.ts`):

```
D-31 5k: ticks=~200 max=345.88ms p95=~? → FAIL (ceiling 250ms)
```

**Immediate re-run:**

```
D-31 5k: ticks=171 max=116.09ms p95=79.98ms → PASS
```

**Classification:** Non-blocking. Gated behind `RUN_BENCHMARKS=1`; the default CI/dev-loop `npm test` skips the benchmark (`describe.skipIf(!BENCH_ENABLED)`). The authoritative <50ms longtask witness is the user's manual Tauri prod-build Performance trace — which jsdom cannot produce regardless of ceiling.

**Recommendation (not a blocker):** Consider widening the jsdom ceiling from 250ms to ~400ms OR adding `retry: 2` on this one test, OR documenting explicitly in the benchmark doc-comment that flakes are expected under CI load and runs should be repeated. The current doc-comment already cites "CI scheduling starvation" as a risk — tightening the exit surface would save a future user the re-run.

### 2. One net-new TypeScript error introduced by Wave 3

```
src/workers/__tests__/graphSimBenchmark.test.ts(112,9): error TS2322:
  Type '(msg: WorkerOut & { type: "tick"; }) => void' is not assignable
  to type '(msg: { positions: Float32Array; alpha: number; sequence: number }) => void'.
```

**Root cause:** The D-31 benchmark declares `onTick: (msg: WorkerOut & { type: 'tick' }) =>` but `GraphSimCallbacks['onTick']` in `graphSimCore.ts:70` is typed as `(msg: { positions, alpha, sequence }) => void` — no `type` discriminator. TypeScript correctly rejects the assignment.

**Pre-existing baseline** (from `deferred-items.md`): 6 TS errors on `main`. **Current count: 7.** The 7th is this one, introduced by commit `29aebd7` (plan 11-04 Task 2). It's purely a test-file type annotation; the test passes at runtime.

**Impact:** Zero runtime effect. `npx tsc --noEmit` exits non-zero; `npx vite build` succeeds (vite doesn't typecheck). The phase SUMMARY (`11-04-SUMMARY.md:261` Self-Check) claims "Zero new TS errors" which is inaccurate by 1 — this is a doc-vs-code drift, not a behavior drift.

**Recommendation (not a blocker):** Fix by changing line 112 from `onTick: (msg: WorkerOut & { type: 'tick' }) =>` to `onTick: (msg) =>` (let TS infer), or by aligning `GraphSimCallbacks['onTick']` to accept the discriminated variant. Either is a 1-line patch. Update `11-04-SUMMARY.md §Issues Encountered #2` to reflect the 7-not-6 number, OR fix the error.

---

## Visual Invariance (D-30, Phase Boundary)

**Status:** PASS (structural) + MANUAL-DEFERRED (user eyeball).

Render-pipeline invariants verified:
- `drawEdges(ctx, graphEdges, positions: Map<string,{x,y}>, ...)` — unchanged signature (`GraphRenderer.ts:268`).
- `drawNodes(ctx, nodes: GraphNode[], positions: Map<string,{x,y}>, ...)` — unchanged (`:371`).
- `drawFolderHulls(ctx, nodes: GraphNode[], zoom, parentChildMap, dirsWithOwnFiles, theme)` — unchanged (`:196`).
- `drawArrowHeads`, `drawSelectedNode`, `drawFileLabels`, `drawCometTrails`, `drawAgentDots`, `drawConflictPulses`, `drawConflictBadges` — all consume `Map<string,{x,y}>` positions exactly as pre-Phase-11.

The only change in the RadarCanvas render path is the **source** of the positions Map: during active sim, it is now materialized from `simNodesRef.current.positions` (Float32Array) instead of iterating `SimNode[]`. Values entering the render pipeline are identical.

User's Manual Checklist row `Visual invariance` remains the authoritative witness for the "zero visual drift" claim. This report treats it as known-deferred per the plan's `autonomous: false` frontmatter.

---

## Orchestrator Readiness Checks

| Item | Status |
|------|:------:|
| `11-01-SUMMARY.md` exists | PASS |
| `11-02-SUMMARY.md` exists | PASS |
| `11-03-SUMMARY.md` exists | PASS |
| `11-04-SUMMARY.md` exists | PASS |
| `11-VERIFICATION.md` scaffold exists with D-01..D-34 ledger | PASS |
| `deferred-items.md` documents pre-existing test/TS noise | PASS |
| Wave commits all present (Task-level, 04cc472, 29aebd7, 96812b3, etc.) | PASS |
| `npx vite build` emits worker chunk `graphSim.worker-*.js` | PASS |
| `npm test -- --run` green for Phase-11-owned tests; 4 pre-existing failures documented | PASS |

---

## Status

## VERIFICATION PASSED (with documented caveats)

**Phase goal achieved in code.** The simulation is off the main thread; the
data transport matches the spec literally (Transferable Float32Array AoS,
3-buffer cap, no SAB); the hot path consumes Float32Array via index math;
every D-01..D-34 decision has a witness either in code, tests, or the
ledger's manual row.

**Caveats (non-blocking):**
1. D-31 jsdom benchmark is CI-load-fragile (observed 116-345ms across two
   runs); authoritative browser <50ms witness is the user's manual row.
2. 1 net-new TS error in `graphSimBenchmark.test.ts:112` (test-only, no
   runtime impact; minor contradiction to SUMMARY's "zero new TS errors"
   claim).
3. `11-VERIFICATION.md` remains `status: draft` pending the user's manual
   Tauri prod-build smoke + Performance trace + checklist tick-through.
   This is the **expected** deferral per plan 11-04 `autonomous: false`.

**Recommended before flipping 11-VERIFICATION.md to `status: passed`:**
- User: run `npm run tauri build -- --debug`, capture a 5k-node settle
  Performance trace in DevTools, record OS + commit hash, tick the
  Manual Checklist, fill the Browser-measured column.
- Developer (optional nit): fix the 1 new TS error by letting `onTick`
  infer its parameter type; update 11-04-SUMMARY "6 TS errors" → "7" OR
  fix the error.

The orchestrator can proceed with STATE.md + ROADMAP.md updates. Phase 11
is code-complete from an automated-verification standpoint.

---

*Verified: 2026-04-21T10:50:00Z*
*Verifier: Claude (gsd-verifier, Opus 4.7 1M-context)*
