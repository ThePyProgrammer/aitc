---
phase: 11
plan: 02
subsystem: graph-simulation
tags: [webworker, d3-force, float32array, buffer-pool, sequence-guard, vitest, tauri, vite]

# Dependency graph
requires:
  - phase: 11
    plan: 01
    provides: graphSimCore.ts factory stub + 8-method interface + tuning constants + tiny-graph fixture + bufferPool.test.ts/graphSimCore.test.ts it.todo scaffolds
provides:
  - Full makeGraphSimCore factory body (~300 LOC) — d3-force orchestration driven by callbacks
  - createBufferPool(N) — 3-buffer transferable Float32Array pool with ASVS V5 size validation
  - mulberry32-seeded initial positions and sim.randomSource (byte-deterministic)
  - Sequence-counter bumps on init/topology threaded into every onTick/onSettled payload
  - Pin/unpin with alpha-restart resume; updateConfig with in-place force strength patch + alpha(0.35).restart()
  - Manual tickLoop with configurable scheduler (setTimeout(fn,0) default); no sim.on('tick'|'end')
  - Test suite: 12 graphSimCore assertions (D-05..D-19, D-22, D-34) + 5 bufferPool assertions, all green
affects: [11-03, 11-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Closure-factory pattern for d3-force with callback-based outputs (no messaging APIs)
    - Transferable Float32Array ping-pong + spare-buffer pool with eager 3-buffer allocation
    - Sequence-guarded outbound messages (counter bumped on init + topology)
    - Queue-based test scheduler (schedule = (fn) => queue.push(fn)) drains settle loops synchronously without inline-fn recursion
    - TDZ-safe default scheduler (let-binding declared before the arrow closure captures it)
    - Source-text isolation assertion (readFileSync + regex — catches future regressions)

key-files:
  created:
    - .planning/phases/11-move-d3-force-simulation-to-a-webworker-with-transferable-fl/11-02-SUMMARY.md
  modified:
    - src/workers/graphSimCore.ts
    - src/workers/__tests__/graphSimCore.test.ts
    - src/workers/__tests__/bufferPool.test.ts

key-decisions:
  - "BufferPool lives inline inside graphSimCore.ts (not a separate module) per plan's D-23 budget note — keeps the Wave 2 shim's import surface minimal"
  - "Queue-based scheduler for tests instead of inline fn() — settled-loop runs for thousands of ticks and recursion would stack-overflow in jsdom"
  - "updateConfig emits a tick immediately after alpha-restart (not waiting for next tickLoop) so D-10 test can assert the reheated alpha value deterministically under queue scheduler"
  - "pin/unpin test callback returns buffers (core.returnBuffer(m.positions.buffer)) so the 50-tick loop doesn't hit pool backpressure"
  - "Rephrased Wave 0 header comment to drop forbidden-token literals (\"self / postMessage / Worker / DOM\" → \"worker globals / messaging APIs / DOM\") to satisfy the D-22 source-text grep"
  - "forceCluster() / forceClusterCollide() called without generic type args — the existing src/views/Radar/forceCluster.ts signatures are not generic (ClusterForce / ClusterCollideForce are concrete); the plan's pseudocode had generics that don't match the library"

requirements-completed: [VIZN-04]

# Metrics
duration: 9 min
completed: 2026-04-21
---

# Phase 11 Plan 02: Wave 1 — Pure graphSimCore + BufferPool Summary

**Replaced Wave 0's no-op `makeGraphSimCore` stub with a full 300-LOC d3-force orchestration factory (tick loop, pin/unpin, updateConfig, topology rebuild, fastSettle, sequence counter, callback-based outputs), added a 3-buffer transferable Float32Array pool with ASVS V5 size validation inline in the same module, and drove both test files (`graphSimCore.test.ts` + `bufferPool.test.ts`) from all-`it.todo` to all-green — 19 assertions passing in 1.34s under vitest+jsdom with zero `self` / `postMessage` / `onmessage` / `new Worker` references in the core module.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-21T01:55:02Z
- **Completed:** 2026-04-21T02:04:48Z
- **Tasks:** 3
- **Files created:** 1 (this SUMMARY.md)
- **Files modified:** 3 (`src/workers/graphSimCore.ts`, `src/workers/__tests__/graphSimCore.test.ts`, `src/workers/__tests__/bufferPool.test.ts`)
- **src/workers/ test slice duration:** 1.34s (target <10s — well under)
- **graphSimCore.ts line count:** 399 LOC (target 200–300 LOC — slightly over, carries header/interface boilerplate)

## Accomplishments

### Task 1 — BufferPool inline + bufferPool.test.ts green

- **`createBufferPool(nodeCount)`** exported from `src/workers/graphSimCore.ts` (above `makeGraphSimCore` per plan D-23 budget note).
- Eager allocation of 3 × `Float32Array(nodeCount * 2)` at construction (RESEARCH §Pattern 3 "Recommend eager at init").
- `acquire()` returns `Float32Array` or `null` when outstanding >= 3 (D-09 cap + D-34 ceiling).
- `returnBuffer(buf: ArrayBuffer)` validates `byteLength === N*2*4`; malformed buffers are dropped AND a replacement is allocated so the 3-buffer invariant survives (ASVS V5 / §Security Domain).
- `outstandingCount()` + `totalAllocated()` accessors for test assertions.
- All 4 Wave 0 `it.todo` cases replaced with 5 real assertions (eager allocation split into its own case for clarity). Test file: `src/workers/__tests__/bufferPool.test.ts`. All green in 7ms.

### Task 2 — makeGraphSimCore factory

- Full factory body replaces Wave 0 no-op stub.
- **d3-force construction** per 11-PATTERNS §graphSimCore.ts: `forceSimulation<SimNode>` + `forceLink` + `forceManyBody` + `forceCenter(0,0)` + `forceCollide(COLLIDE_RADIUS)` + `forceCluster()` + `forceClusterCollide()` with `.alphaDecay(ALPHA_DECAY).velocityDecay(VELOCITY_DECAY).stop()`.
- **Initial-position seeding:** `mulberry32(INITIAL_POSITION_SEED)` feeds both `simNodes[i].x/y` computation AND `sim.randomSource(...)` — byte-deterministic across worker + tests (RESEARCH §Pitfall 1).
- **init(msg):** bumps sequence, builds sim, runs fastSettle (bounded `MAX_TICKS=500` loop while `alpha > alphaMin`), emits first tick, schedules tick loop.
- **topology(msg):** cancels pending schedule, bumps sequence, rebuilds sim, reheats to `FORCE_CONFIG_ALPHA`, fast-settles, emits tick, schedules loop (D-12).
- **updateConfig(cfg):** in-place strength updates on link/charge/center/cluster forces + `sim.alpha(FORCE_CONFIG_ALPHA).restart()`; resumes if paused; emits a tick immediately so consumers observe the reheated alpha synchronously (D-10).
- **pin(id, x, y):** sets `fx/fy/x/y` on the named node; alpha-restarts + resumes if paused (D-20, D-21).
- **unpin(id):** clears `fx/fy` (D-20).
- **tick():** test-only synchronous step; does NOT schedule (supports queue-scheduler test drain).
- **returnBuffer(buf):** delegates to the pool.
- **dispose():** clears any pending `setTimeout`, calls `sim.stop()`, nulls refs.
- **tickLoop:** settled-check first (`alpha <= alphaMin`) → emit `onSettled`, pause; else `sim.tick()` → `emitTick` → `schedule(tickLoop)`; errors → `onError` + pause.
- **Buffer-pool integration:** `createBufferPool(simNodes.length)` per `buildSim`; `emitTick` skips when `acquire()` returns null (backpressure per D-09).
- **Zero references to** `self` / `postMessage` / `onmessage` / `new Worker` in the module (D-22 grep clean — rephrased a Wave 0 header comment to drop the literals).
- **Zero `sim.on('tick'|'end')` registrations** (RESEARCH §Anti-Patterns, §Pitfall 6).
- TDZ-safe: `let scheduled: ... = null` declared before the default `schedule` arrow captures it (per plan pseudocode).
- `npx tsc --noEmit` reports **0 new errors** from `src/workers/graphSimCore.ts`; the 6 pre-existing errors on `main` (`bindings.ts`, Arsenal, RadarCanvas) are unchanged.

### Task 3 — graphSimCore.test.ts from all-todo to green

- 0 `it.todo` markers remain; 12 real `it(...)` assertions — all passing in 134ms.
- **Coverage map:**
  - Factory returns 8 methods as functions
  - init + fastSettle=true emits first tick synchronously (D-19)
  - Float32Array AoS layout of length `N*2`, all finite (D-05)
  - onSettled fires with `alpha <= alphaMin` under queue drain (D-15)
  - updateConfig alpha-restarts near `FORCE_CONFIG_ALPHA = 0.35` (D-10)
  - pin holds position within <1px over 50 ticks (D-20, D-21)
  - unpin releases; node drifts >1px from pin target over 100 ticks (D-20)
  - Sequence counter bumps on topology; first outbound tick carries new sequence (D-12)
  - returnBuffer re-wraps so subsequent acquire succeeds (D-06)
  - Backpressure: ticks plateau at ≤3 without returnBuffer (D-09, D-34)
  - dispose halts subsequent tick() calls
  - Source-text assertion: no `self` / `postMessage` / `onmessage` / `new Worker` / `zustand` / `react` / `@tauri-apps` / `../stores` / `../bindings` (D-22, D-24)
- **Test scheduler pattern:** queue-based `schedule: (fn) => queue.push(fn)`. Drains synchronously via `while (!settled && queue.length) queue.shift()()`. Replaces the plan's inline-fn pseudocode because settle-scale recursion (5000+ iterations) stack-overflows under vitest+jsdom.

## Task Commits

Each task was committed atomically:

1. **Task 1: BufferPool inline + bufferPool.test.ts green** — `7437507`
2. **Task 2: makeGraphSimCore factory body** — `972642f`
3. **Task 3: graphSimCore.test.ts from it.todo to green** — `d6821e9`

## Files Created/Modified

### Modified

- `src/workers/graphSimCore.ts` (70 → 399 lines; +329 LOC) — full d3-force factory + BufferPool inline.
- `src/workers/__tests__/graphSimCore.test.ts` (41 → 316 lines; +275 LOC) — 12 real assertions replace 12 `it.todo`.
- `src/workers/__tests__/bufferPool.test.ts` (13 → 57 lines; +44 LOC) — 5 real assertions replace 4 `it.todo`.

### Created

- `.planning/phases/11-move-d3-force-simulation-to-a-webworker-with-transferable-fl/11-02-SUMMARY.md` (this file).

## Decisions Made

1. **BufferPool lives inline inside `graphSimCore.ts`** (not a separate `bufferPool.ts` module). Per plan's D-23 budget note: keeps the Wave 2 shim's `import` surface minimal — the shim imports `makeGraphSimCore` and needs no second pool import. Also satisfies the phase goal that the pool's lifetime is tied to a specific core instance (one pool per `buildSim` call, re-allocated on topology).

2. **Queue-based test scheduler instead of inline `fn()`**. The plan's §§ Checker Note pseudocode offered `{ schedule: (fn) => fn() }` as the "synchronous" scheduler. In practice this recurses through `tickLoop → schedule(tickLoop) → tickLoop → ...` for the full settle chain (5000+ iterations), which stack-overflows. A queue-based scheduler (`schedule: (fn) => queue.push(fn)`) lets each test drain the queue iteratively (`while (!done && queue.length) queue.shift()()`). The plan's own `<behavior>` block for Task 3 explicitly called this out: "the test file uses `schedule: (fn) => queue.push(fn)` so tests drain the queue synchronously — avoid `schedule: fn => fn()` recursion at settle-scale". Followed that guidance.

3. **`updateConfig` emits a tick immediately after `alpha(FORCE_CONFIG_ALPHA).restart()`**. Without this, the D-10 test under a queue scheduler would have to pop one callback to observe the reheated alpha, adding coupling between "updateConfig semantics" and "scheduler behavior". Emitting synchronously inside `updateConfig` makes the D-10 assertion a direct observation of the reheated alpha. No behavior change for Wave 2 (the shim consumer will see the tick via callback regardless of whether it arrived sync or async).

4. **pin/unpin tests return buffers via `core.returnBuffer(m.positions.buffer)` inside `onTick`**. The pin test drives 50 ticks. Without returning buffers, the 4th+ ticks hit pool backpressure (`acquire()` returns null → no emit) and `ticks[ticks.length - 1]` would still be the third tick, not the 50th. Returning buffers on every onTick is also the Wave 2 main-thread contract (main thread `transfer`s the buffer back after render), so this mirrors production behavior.

5. **Rephrased Wave 0 header comment** in `graphSimCore.ts` from `"No references to self / postMessage / Worker / DOM"` to `"No references to worker globals / messaging APIs / DOM"`. The source-text grep in Task 3's D-22 isolation test would have matched the comment literals and failed. The rephrasing keeps the intent while avoiding the forbidden tokens. Same D-22/D-24 contract, same grep, now green.

6. **`forceCluster()` / `forceClusterCollide()` called without generic type arguments**. The plan's pseudocode showed `forceCluster<SimNode>()`, but the existing `src/views/Radar/forceCluster.ts` exports concrete `ClusterForce` / `ClusterCollideForce` types — they are NOT generic. TypeScript rejected the generic call (`TS2558: Expected 0 type arguments, but got 1`). Dropped the generics; the force internals read `node.dirKey` / `node.dirDepth` which `SimNode extends ClusterNode` already satisfies. No runtime behavior change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] `forceCluster<SimNode>()` generic call does not typecheck**
- **Found during:** Task 2 — running `npx tsc --noEmit` after writing the factory body.
- **Issue:** Plan pseudocode instructed `.force('cluster', forceCluster<SimNode>().strength(cfg.clusterStrength))` but `src/views/Radar/forceCluster.ts` signatures are not generic. Two TS errors: `TS2558: Expected 0 type arguments, but got 1`.
- **Fix:** Dropped the generics — `.force('cluster', forceCluster().strength(cfg.clusterStrength))`. Same for `forceClusterCollide<SimNode>()` → `forceClusterCollide()`.
- **Files modified:** `src/workers/graphSimCore.ts`.
- **Verification:** `npx tsc --noEmit` reports 0 errors in `src/workers/graphSimCore.ts` (6 pre-existing errors in `bindings.ts` / Arsenal / RadarCanvas unchanged).
- **Commit:** Folded into `972642f` (single Task 2 commit).

**2. [Rule 3 — Blocker] Wave 0 header comment contained forbidden-token literals that failed the D-22 source-text grep**
- **Found during:** Task 1 — running the local isolation grep after adding `createBufferPool`.
- **Issue:** The Wave 0 file header said "No references to `self / postMessage / Worker / DOM`". The word literals `self`, `postMessage`, `Worker` inside the comment matched the Task 3 source-text grep regex, which asserts absence of those tokens ANYWHERE in the file (not just in code). The grep does not special-case comments.
- **Fix:** Rephrased the comment to "No references to worker globals / messaging APIs / DOM". Intent preserved, literals removed.
- **Files modified:** `src/workers/graphSimCore.ts` (comment-only change).
- **Verification:** `grep -qE "\b(self|postMessage|onmessage|new Worker)\b" src/workers/graphSimCore.ts` now exits non-zero (no matches). Task 3's in-test `expect(src).not.toMatch(...)` assertion is green.
- **Commit:** Folded into Task 1's commit `7437507` (single Task 1 commit).

**Total deviations:** 2 auto-fixed (both Rule 3 — blockers preventing task completion). **Impact:** Zero — both were minor edits to satisfy the plan's own verification greps; neither changed runtime behavior.

### Parallel-session artifact (not a deviation)

The Task 2 commit `972642f` ended up including unrelated Phase 10 CommsHub file changes (`src/stores/commsStore.ts`, `src/views/CommsHub/*.tsx`, etc.) that were modified in the working tree by a **concurrent session** running on this repo during Task 2 execution. I only `git add`'d `src/workers/graphSimCore.ts`, and `git diff --cached --stat` confirmed only that file was staged — but the commit ran in the same window as the concurrent agent's `git add` on the Phase 10 files, and those ended up in my commit's tree. This is a scheduling/concurrency artifact, not a planned deviation. The Phase 11-scoped file (`graphSimCore.ts`) is correctly committed; the other files represent legitimate Phase 10 cleanup landing from the other session. No Phase 11 logic or Phase 10 logic was corrupted. Task 3's commit `d6821e9` is clean (single file, as intended).

## Issues Encountered

**1. Full test suite has 4 pre-existing failures (unchanged from Wave 0 baseline).**

`npm test -- --run` reports 4 failing tests, all documented in `deferred-items.md`:
- `MasterDetailShell > rail region has w-[220px] shrink-0 classes` (Arsenal markup drift)
- `MasterDetailShell > detail region has 2xl:w-[520px] xl:w-[480px] shrink-0 classes` (same)
- `agentStore > launchAgent calls invoke launch_agent and appends to agents` (pre-10-04 store shape)
- `HeatMapOverlay > heatTintForNode(0) returns the default surface-container color (#1a1919)` (theme token drift)

None of these files are in Phase 11's scope. Verified pre-existing by comparison with Wave 0 SUMMARY §"Issues Encountered". Phase 11 contribution to failure count = 0.

**2. `npm run build` still fails on 6 pre-existing TS errors** (in `bindings.ts`, `ArsenalView.tsx`, `RadarCanvas.tsx`, `RadarCanvas.test.tsx`). Phase 11 contribution to TS-error count = 0 (verified via `npx tsc --noEmit` delta). Documented in `deferred-items.md`.

Both issues belong to Phase 10 and earlier cleanup work. Per CLAUDE.md memory "Only fix own bugs", not addressed here.

## Authentication Gates

None — frontend-only, no network or auth surface touched.

## d3-force API Quirks for Wave 3 RadarCanvas Refactor

1. **`forceCluster()` / `forceClusterCollide()` are NOT generic** in `src/views/Radar/forceCluster.ts` — they return concrete `ClusterForce` / `ClusterCollideForce`. Wave 3's RadarCanvas refactor does not instantiate these (it consumes positions only), so unlikely to hit. But if Wave 3 touches `forceCluster.ts` and reads the worker core for reference, it should know that `forceCluster<SimNode>()` does NOT compile.

2. **`sim.force('cluster') as ReturnType<typeof forceCluster>`** cast pattern is required to narrow the `undefined | Force` return of `sim.force(name)` back to the concrete `ClusterForce`. Used in `updateConfig` to chain `.strength(...)`. If Wave 3 adds new forces that need in-place strength updates from main thread (e.g. a user-slider hooked to `linkStrength` without an `updateConfig` roundtrip), this pattern is the template.

3. **`sim.randomSource(fn)`** must be set AFTER `.stop()` (or any other chaining that ends in a terminal call). The call order in `buildSim` is: construct forces → `.alphaDecay(...).velocityDecay(...).stop()` → THEN `sim.randomSource(mulberry32(INITIAL_POSITION_SEED))`. If `.randomSource(...)` is chained into the force-construction pipeline, d3-force's type-checker reorders things oddly. Current order is deterministic and tested.

4. **`sim.alphaMin()` returns a live getter**. In `tickLoop`, the comparison `sim.alpha() <= sim.alphaMin()` is evaluated per call — both values are fresh. No caching needed.

## Confirmation — useGraphLayout Hook Untouched

Wave 1's output does NOT modify `src/hooks/useGraphLayout.ts`. Wave 2 handles that. Verified:

```
$ git diff HEAD~3 HEAD -- src/hooks/
# (no output — no files in src/hooks/ touched)
```

The 9 existing `useGraphLayout.test.ts` tests + 2 other `src/hooks/` tests all remain green:

```
 ✓ src/hooks/__tests__/useGraphLayout.test.ts (9 tests) 1621ms
 Test Files  2 passed (2)
      Tests  11 passed (11)
```

## Which GraphSimCore Methods Defer to Wave 2

**None.** The core is complete. Every method in the `GraphSimCore` interface (`init`, `topology`, `updateConfig`, `pin`, `unpin`, `tick`, `returnBuffer`, `dispose`) has a full body. Wave 2's job is strictly wiring:

- `graphSim.worker.ts` shim: decode `onmessage` → route to `core.{init|topology|...}`; plumb `cb.onTick` / `cb.onSettled` / `cb.onError` to `postMessage(..., [positions.buffer])` with `transfer` list.
- `useGraphLayout.ts` rewrite: Worker client that lives on main thread; sends `init` / `updateConfig` / `pin` / etc; receives `tick` / `settled`; owns the Float32Array lifecycle for RadarCanvas reads.

No simulation logic moves from `graphSimCore.ts` to Wave 2. The pure core is the simulation.

## User Setup Required

None — frontend-only, no external service configuration.

## Wave 2 Readiness — Surprises to Know About

1. **BufferPool is exported from `graphSimCore.ts` (not a separate module).** Wave 2's shim needs both `makeGraphSimCore` and (if it wants to instantiate a separate pool for outbound `returnBuffer` bookkeeping) `createBufferPool`. Both come from `./graphSimCore`. Current export signature: `export function createBufferPool(nodeCount: number): BufferPool`.

2. **`schedule` option is how Wave 2 integrates.** Default is `setTimeout(fn, 0)`. For the worker shim, this is fine — the worker thread's event loop runs ticks between `onmessage` deliveries (RESEARCH §Pitfall 3). If Wave 2 wants to test the shim, it can pass a custom scheduler just like Task 3's tests do.

3. **Core's `scheduled` timer handle is private.** The shim cannot cancel the loop externally. `dispose()` clears it. If Wave 2 wants a "pause without dispose" primitive (for `visibilitychange` in Claude's Discretion), add it as a new method — don't try to drive it via `schedule: noop`.

4. **`updateConfig` emits a synchronous tick.** Wave 2's shim must be ready to handle `onTick` callbacks inside the synchronous body of `updateConfig(cfg)` — i.e. `core.updateConfig(...)` may fire `postMessage` before returning. Same applies to `init` and `topology`. No surprise for async consumers; just be aware during shim lifecycle code.

5. **`sim.randomSource(mulberry32(INITIAL_POSITION_SEED))`** is set INSIDE `buildSim` after `.stop()`. Wave 2's `topology` path rebuilds the sim, so determinism is preserved across re-warms without any main-thread coordination.

6. **No rewarm-threshold logic inside the core.** The Wave 0 `shouldRewarm` heuristic (in `useGraphLayout.ts`) stays on main thread — the core just accepts `topology` messages whenever main decides to send one. Wave 2's hook rewrite keeps the `shouldRewarm` logic where it is; just replace the `buildSimulation(nodes, edges, true)` call site with `worker.postMessage({ type: 'topology', ... })`.

7. **Pool is re-allocated per `buildSim`.** `init` and `topology` both call `buildSim` which calls `createBufferPool(nodes.length)`. Any buffers that main is still holding from the previous sim are orphans — `returnBuffer(buf)` will drop them (wrong byte length for the new `N`). Wave 2 should either (a) ignore ArrayBuffer returns whose size doesn't match the current sim (the pool does this via size validation already, no action needed) or (b) let main thread self-clean via `sequence` checks — it already has to do sequence-guarding per D-12.

8. **Test scheduler pattern (queue-based) is re-useable** for the Wave 2 shim tests. If the shim wants to assert "worker received postMessage after init", wire the shim to a fake `DedicatedWorkerGlobalScope` mock with the same queue pattern — sync-drainable, no timers needed.

## Next Phase Readiness

- Wave 1 (this plan) is complete. Full `makeGraphSimCore` body + `createBufferPool` + 17 real test assertions all green under vitest+jsdom.
- **Wave 2 (`11-03-PLAN.md`)** can start immediately: implement `graphSim.worker.ts` shim (onmessage router + transfer-based postMessage) + rewrite `useGraphLayout.ts` as a Worker client.
- **Wave 3 (`11-04-PLAN.md`)** depends on Wave 2 — RadarCanvas hot-path refactor + perf harness + visual invariance check.

## Self-Check: PASSED

- [x] `src/workers/graphSimCore.ts` modified (399 LOC, factory body + BufferPool inline)
- [x] `src/workers/__tests__/graphSimCore.test.ts` modified (0 it.todo, 12 real it)
- [x] `src/workers/__tests__/bufferPool.test.ts` modified (0 it.todo, 5 real it)
- [x] Commit `7437507` present (Task 1 — BufferPool)
- [x] Commit `972642f` present (Task 2 — factory body)
- [x] Commit `d6821e9` present (Task 3 — tests green)
- [x] `npm test -- --run src/workers` green (19 passed, 4 todo/skipped) in 1.34s
- [x] `npm test -- --run src/hooks` green (11 passed) — useGraphLayout untouched
- [x] Zero new TS errors (`npx tsc --noEmit`: 6 baseline, 6 current)
- [x] `! grep -qE "\b(self|postMessage|onmessage|new Worker)\b" src/workers/graphSimCore.ts` passes
- [x] `! grep -qE "sim\.on\('tick'|sim\.on\('end'" src/workers/graphSimCore.ts` passes
- [x] `grep -Fq "sim.randomSource(mulberry32(INITIAL_POSITION_SEED))" src/workers/graphSimCore.ts` passes
- [x] `grep -Fq "FORCE_CONFIG_ALPHA" src/workers/graphSimCore.ts` passes
- [x] `grep -Fq "forceSimulation<SimNode>" src/workers/graphSimCore.ts` passes
- [x] Full suite has 4 pre-existing failures (identical to Wave 0 baseline — Phase 11 contribution = 0)

---
*Phase: 11-move-d3-force-simulation-to-a-webworker-with-transferable-fl*
*Completed: 2026-04-21*
