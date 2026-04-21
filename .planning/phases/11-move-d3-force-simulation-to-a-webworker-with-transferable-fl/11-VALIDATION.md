---
phase: 11
slug: move-d3-force-simulation-to-a-webworker-with-transferable-fl
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 11 — Validation Strategy

> Per-phase validation contract. Phase 11 is a non-visual performance refactor — validation is heavily unit-test + benchmark-driven. See 11-RESEARCH.md §Validation Architecture for the per-decision assertion witnesses and §Performance Benchmark Harness for the success-criterion diagnostic.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x + jsdom 26 (already installed) |
| **Config file** | `vite.config.ts` (inherited) |
| **Quick run command** | `npm test -- src/workers src/hooks/__tests__/useGraphLayout.test.ts src/views/Radar/__tests__/RadarCanvas.test.tsx` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | Quick ~8s · Full ~45s · Benchmark ~60s (gated by `RUN_BENCHMARKS=1`) |

---

## Sampling Rate

- **After every task commit:** Run quick command (worker + hook + canvas slice).
- **After every plan wave:** Run full `npm test` plus `npm run build` (catches Vite worker-bundling regressions at build time — required for D-02 / T-1 in RESEARCH §Pitfalls).
- **After Wave 3 (final wave):** Run the benchmark test (`RUN_BENCHMARKS=1 npm test -- src/workers/__tests__/graphSimBenchmark.test.ts`) and the Tauri production smoke (`npm run tauri build` on a dev workstation). Attach the longest-task measurement from `PerformanceObserver` to the plan summary so the verifier can audit D-31 compliance.
- **Before `/gsd-verify-work`:** Full suite must be green + benchmark must report zero `>50ms` long tasks during a 5k-node settle (D-31 success criterion).
- **Max feedback latency:** 45 seconds for the full suite.

---

## Per-Task Verification Map

Plans are sliced in 11-RESEARCH.md §Planner Guidance into four waves. The planner will finalize task IDs; this table seeds the witness patterns the verifier will grep for.

| Task scope | Wave | Locked decision | Test Type | Automated Witness | Status |
|------------|------|-----------------|-----------|-------------------|--------|
| Scaffold `src/workers/` dir + Wave 0 test stubs | 0 | D-02, D-03 | file-exists | `test -f src/workers/graphSimCore.ts && test -f src/workers/graphSim.worker.ts && test -f src/workers/graphSimConfig.ts && test -f src/workers/graphSimProtocol.ts` | ⬜ pending |
| Extract tuning constants to `graphSimConfig.ts` | 0 | D-29 | unit | `grep -Fq "export const LINK_DISTANCE" src/workers/graphSimConfig.ts && grep -Fq "export const ALPHA_DECAY" src/workers/graphSimConfig.ts` | ⬜ pending |
| `graphSimProtocol.ts` discriminated unions | 1 | D-10, D-11 | unit | `grep -E "type WorkerIn = " src/workers/graphSimProtocol.ts && grep -E "type 'init'\\|'topology'\\|'updateConfig'\\|'pin'\\|'unpin'\\|'returnBuffer'\\|'dispose'" src/workers/graphSimProtocol.ts` | ⬜ pending |
| `graphSimCore.ts` pure module | 1 | D-03, D-15, D-16, D-19, D-22 | unit | Vitest asserts `createSimCore()` accepts `init` + tick-driven callbacks; no `self`/`postMessage`/`Worker` imports (`grep -E "^import" src/workers/graphSimCore.ts | grep -v -E "d3-force\\|d3-quadtree\\|./forceCluster\\|./graphSimConfig" = empty`) | ⬜ pending |
| Core: fast-settle on `init` with `fastSettle=true` | 1 | D-19 | unit | Test asserts `onTick` fires at least once with alpha <= alphaMin after `init({ fastSettle: true })` without further calls | ⬜ pending |
| Core: `updateConfig` triggers alpha-restart at 0.35 | 1 | D-10.c | unit | Test: call `init`, let settle, call `updateConfig`, assert next `onTick` reports `alpha ≈ 0.35` (±1e-3) | ⬜ pending |
| Core: `pin`/`unpin` sets/clears fx/fy | 1 | D-20, D-21 | unit | Test: pin id X at (100,200); run ticks; assert node X position ≈ (100, 200) within 0.5px | ⬜ pending |
| Core: sequence number bumps on topology | 1 | D-12 | unit | Test: `init` → sequence 1; `topology` → sequence 2; `onTick` messages carry the current sequence | ⬜ pending |
| Core: random source is seedable (determinism bonus) | 1 | Claude's Discretion | unit | Test: two cores seeded identically produce byte-identical first tick positions (Float32Array equal) | ⬜ pending |
| `graphSim.worker.ts` shim compiles + is bundleable | 2 | D-02 | build | `npm run build` passes; `dist/assets/graphSim*.js` chunk emitted (`find dist -name "graphSim*.js" | head -1`) | ⬜ pending |
| Worker shim: routes `init`/`topology`/`updateConfig`/`pin`/`unpin`/`dispose` | 2 | D-10 | unit | Unit test against exported `handleMessage` function (pure dispatcher calling core) — test by injecting core instance and calling `handleMessage({type:'init', ...})` | ⬜ pending |
| Worker shim: ping-pong buffer pool (2 + spare = 3) | 2 | D-06, D-09 | unit | Test `BufferPool` class: acquire 2 buffers, assert 3rd is allocated; release buffer, assert reused | ⬜ pending |
| Worker shim: transfers detached buffers never reused | 2 | RESEARCH §Pitfalls T-3 | unit | Test: transfer buffer → attempt to write → guarded with `buffer.byteLength === 0` check | ⬜ pending |
| `useGraphLayout.ts` rewrites to Worker client | 2 | D-01, D-04, D-25 | unit | Existing 7 test cases preserved; new ones mock `Worker` via research's Pattern 7 | ⬜ pending |
| Hook: StrictMode double-mount cleanup | 2 | RESEARCH §Pitfalls T-5 | unit | Test: mount hook, unmount, re-mount; assert `worker.terminate()` called exactly once per mount-unmount cycle; no leaked workers | ⬜ pending |
| Hook: rewarm threshold still triggers on topology diff | 2 | D-18 (carry from Phase 7 D-03) | unit | Test: change `graphNodes` past `REWARM_NODE_COUNT_THRESHOLD`; assert `topology` message was posted to mocked worker | ⬜ pending |
| Hook: settled message triggers `commitSettledPositions` + quadtree rebuild | 2 | D-17, D-28 | unit | Test: emit fake `settled` message; assert `radarStore.commitSettledPositions` called with positions Map; assert quadtreeRef non-null | ⬜ pending |
| Hook: quadtree rebuild every 10 ticks during sim | 2 | D-16 | unit | Test: emit 10 `tick` messages; assert quadtree rebuild happened exactly once (not once per tick) | ⬜ pending |
| `RadarCanvas.tsx` hot-path consumes Float32Array | 3 | D-25, D-26 | unit | Existing `RadarCanvas.test.tsx` passes; new assertion: render loop reads from `positions: Float32Array` not `SimNode[]` (grep `simNodesRef.current` absent from hot path, replaced by `positions[idx * 2]`) | ⬜ pending |
| Benchmark harness: 5k-node settle — zero long tasks >50ms | 3 | D-31 | benchmark | `src/workers/__tests__/graphSimBenchmark.test.ts` runs `PerformanceObserver({type:'longtask'})` during a 5k-node settle; asserts `longTasks.filter(t => t.duration > 50).length === 0`; gated behind `RUN_BENCHMARKS=1` env | ⬜ pending |
| Benchmark harness: 5k-node ≥30 ticks/sec (effective) | 3 | D-33 | benchmark | Same file; computes ticks/sec from sequence numbers emitted in 1-second window; asserts `>= 30` | ⬜ pending |
| Benchmark harness: main-frame cost <2ms | 3 | D-32 | benchmark | Same file; brackets `render()` with `performance.now()`; asserts 95p < 2ms over 100 frames | ⬜ pending |
| Message queue depth bounded | 3 | D-34 | unit | Test: simulate main-thread stall (don't release buffers); assert worker allocations cap at 3 buffers total | ⬜ pending |
| Visual invariance smoke | 3 | Phase boundary ("zero visual change") | UAT | Manual: launch dev; load AITC repo; verify graph renders identically to pre-Phase-11 baseline (screenshot diff, no pixel-level tool needed — eyeball check) | ⬜ pending |
| Tauri production build smoke | 3 | D-02, RESEARCH §Assumption A1 | build | `npm run tauri build -- --debug` succeeds; resulting binary launches; Radar view loads; worker console shows no "Failed to fetch" / 404 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/workers/__tests__/graphSimCore.test.ts` — stubs for core tests (init, updateConfig, pin/unpin, sequence guard, determinism)
- [ ] `src/workers/__tests__/graphSimBenchmark.test.ts` — benchmark stub (gated by `RUN_BENCHMARKS=1`; passes as `test.skip` when env not set so CI doesn't block)
- [ ] `src/workers/__tests__/bufferPool.test.ts` — stubs for the buffer-pool tests used by the shim
- [ ] `src/hooks/__tests__/useGraphLayout.test.ts` — keeps existing 7 cases; planner adds new cases for Worker-client behavior
- [ ] Fixture: `src/workers/__tests__/fixtures/tiny-graph.ts` (≤50 nodes for deterministic unit tests; seeded `randomSource` if the bonus is taken)

*Vitest + jsdom + happy-dom are already installed; no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Decision | Why Manual | Test Instructions |
|----------|----------|------------|-------------------|
| Zero visible drift from Phase 7 output | Phase boundary | Pixel-perfect diff tooling is overkill for a refactor with stable output; eyeball verification catches regressions cheaply | Launch dev (`npm run tauri dev`); load the AITC repo folder; compare the Radar view against the Phase 7 baseline (commit 5c5563f predecessor). Agent dots pulse, conflict rings pulse, hull labels render, zoom/pan works, drag-to-pin works, force-config sliders react live. |
| Tauri prod-build worker loading on Windows | D-02, RESEARCH §A1 | Cannot simulate Tauri's asset pipeline in Vitest | `npm run tauri build -- --debug`; run `src-tauri/target/debug/aitc.exe`; open devtools (Tauri v2 has an inspector in debug mode); confirm no worker fetch errors in Console. |
| macOS Tauri prod build (known issue Tauri #9975) | D-02 | Platform-specific; CI is Windows-primary | If a macOS workstation is available, repeat the prod-build smoke. If not, document it as platform-deferred and track the tauri#9975 resolution. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (this plan: all tasks automated except the 3 manual-only items above)
- [ ] Wave 0 covers all MISSING references (4 new test files scaffolded in Wave 0 before code lands in Wave 1/2/3)
- [ ] No watch-mode flags (commands all use `npm test` in one-shot mode, not `npm run test:watch`)
- [ ] Feedback latency < 45s (full vitest suite)
- [ ] `nyquist_compliant: true` set in frontmatter once planner has filled per-task ids

**Approval:** pending
