# Phase 11: d3-force WebWorker Relocation — Research

**Researched:** 2026-04-17
**Domain:** Frontend performance refactor — relocate d3-force from React main thread to a dedicated module WebWorker with Transferable `Float32Array` position streaming. Zero visual change.
**Confidence:** HIGH (stack + patterns verified against live docs; two CONTEXT claims contradicted by upstream docs — flagged below)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-34)

Worker architecture & lifecycle (D-01..D-04):
- Single long-lived dedicated Worker (`type: 'module'`) owned by `useGraphLayout`; created on first `init`, terminated on unmount.
- Worker at `src/workers/graphSim.worker.ts`, loaded via `new Worker(new URL('../workers/graphSim.worker.ts', import.meta.url), { type: 'module' })`. No Vite plugin.
- Worker imports ONLY `d3-force`, `d3-quadtree` (optional), `forceCluster`/`forceClusterCollide`. No `zustand`, `@tauri-apps/api`, `react`, `../bindings`.
- Worker-construction failure = log + leave positions empty (no fallback).

Transfer protocol (D-05..D-09):
- `Float32Array` AoS `[x0,y0,x1,y1,...]` (8 bytes/node).
- Ping-pong double-buffering; worker transfers fresh buffer, main transfers empty one back.
- Explicitly NOT `SharedArrayBuffer` (COOP/COEP cost > zero-copy benefit at 40–80 KB).
- `ids: string[]` ordered index established in `init`/`topology`; main caches `idIndex: Map<string, number>`.
- Spare 3rd buffer when both main-owned buffers are outstanding; cap at 3 buffers.

Message protocol (D-10..D-12):
- Main→Worker: `init`, `topology`, `updateConfig`, `pin`, `unpin`, `returnBuffer`, `dispose`.
- Worker→Main: `tick`, `settled`, `error` — all tagged with `sequence: number`.
- Sequence-number guard: main drops messages older than last acknowledged topology.

Tick cadence & backpressure (D-13..D-15):
- Worker drives `sim.tick()` manually in `setTimeout(tickLoop, 0)` microtask loop (rationale in CONTEXT: rAF-in-worker non-standard — see Contradictions below).
- No worker-side fps cap.
- Worker pauses when `alpha <= alphaMin`; resumes on `topology`/`updateConfig`/rewarm.

Quadtree location (D-16..D-17):
- Rebuild on MAIN from Float32Array + ids. Triggers: every `settled`; every N=10 tick messages during active sim.
- `d3-quadtree` NOT transferred (non-transferable reference graph).

Simulation lifecycle (D-18..D-19):
- Preserve Phase 7 continuous-tick behavior (cooling alpha → pause; alpha-restart on config/topology/drag).
- Initial fast-settle runs INSIDE worker (up to `MAX_TICKS=500` synchronous ticks before first `tick` message).

Pinning (D-20..D-21):
- Pin/unpin uncoalesced (~60Hz pointermove rate). If queue depth grows during drag, add rAF coalescer (deferred gate).
- Pinned nodes participate in sim; `pinnedNodeIds` stays in `radarStore` main-only.

Testing (D-22..D-24):
- Extract pure `graphSimCore.ts` (no `self`, `postMessage`, `Worker`, DOM). Callback-driven: `onTick`/`onSettled`.
- Worker shim `graphSim.worker.ts` ≤~50 LOC (postMessage router + buffer pool).
- Unit tests target `graphSimCore` under vitest+jsdom. Existing `useGraphLayout.test.ts` refactored to mock Worker constructor with synchronous `graphSimCore`. Real-Worker smoke test only if refactor cost is low.

Main-thread integration (D-25..D-28):
- `simNodesRef` reshape to `{ ids: string[]; positions: Float32Array; idIndex: Map<string, number> }`.
- `livePositions` Map built once per frame by iterating `ids` + Float32Array.
- `drawEdges` / `drawArrowHeads` / `drawNodes` signatures unchanged (still consume `Map<string, {x, y}>`).
- `isSimulatingRef` set from worker lifecycle.
- `commitSettledPositions` still fires on `settled` (for minimap, pin overlay, persistence consumers).

Shared state (D-29..D-30):
- Tuning constants → `src/workers/graphSimConfig.ts` (importable from worker + tests).
- `forceCluster.ts` / `forceClusterCollide.ts` keep location; planner may optionally relocate.

Perf targets (D-31..D-34):
- Zero `>50ms` long tasks on main during 5k-node settle (success criterion).
- Main per-frame cost < 2ms at 5k nodes during active sim.
- Worker ≥30 effective ticks/sec @ 5k, ≥10 ticks/sec @ 10k.
- In-flight transfer count ≤2 under steady state.

### Claude's Discretion

Per CONTEXT.md §"Claude's Discretion":
- Exact scheduling primitive inside worker (`setTimeout` vs `queueMicrotask` vs `Promise.resolve().then()`).
- Spare-3rd-buffer allocation timing (eager vs lazy).
- Sequence-number overflow (no-op for v1).
- `visibilitychange` pause (Claude decides for v1).
- Worker `error` → tracing pipeline wiring (`console.error` acceptable for v1).
- `returnBuffer` batching cadence (immediate vs per-rAF).
- Alpha-in-tail-float vs separate field (separate field recommended; structured-clone of one number ≈ 0).
- `WorkerClient` class extraction vs inline in `useGraphLayout`.
- `ids` array ownership (both sides; worker generates, main caches).
- Topology diff messages (v1 = full rebuild).
- Dev-only diagnostic overlay (may propose, not implement).

### Deferred Ideas (OUT OF SCOPE)

Per CONTEXT.md §"Deferred Ideas":
- SharedArrayBuffer (COOP/COEP cost).
- Quadtree-in-worker.
- OffscreenCanvas rendering in 2nd worker (Phase 14).
- Graph-topology diff messages.
- Multi-worker sharding for >10k nodes.
- Drag-message coalescing (unless benchmark shows queue growth).
- `visibilitychange` auto-pause (discretion).
- Dev-only worker diagnostics overlay.
- Persisted pin positions across restart.
</user_constraints>

<phase_requirements>
## Phase Requirements

Per roadmap + CONTEXT §"Requirements": **no new requirement IDs**. Phase 11 is a performance-quality rewrite of Phase 7 infrastructure backing VIZN-01 / VIZN-04.

| ID | Description | Research Support |
|----|-------------|------------------|
| VIZN-04 (spirit) | "Radar renders performantly via Canvas 2D for 10k+ files" | Success = zero `>50ms` long tasks on main during 5k settle + 30 ticks/sec worker. Proved via `PerformanceObserver({type:'longtask'})` + `performance.now()` bracketing (see Validation Architecture). |
| VIZN-01 (preserved) | "2D spatial radar plotting agents as dots on a file-tree-based codebase map" | Zero visual change required. Pixel-equivalence is a test gate — see §Pitfall 1 below. |
| CLAUDE.md §Performance | "File watchers must handle large codebases (10k+ files) without excessive CPU/memory" | CONTEXT extends "in spirit" to main-thread responsiveness — same 10k target. |
</phase_requirements>

## Summary

Phase 11 is a **pure relocation refactor** of Phase 7's d3-force simulation. All 34 decisions are locked in CONTEXT.md; research's job is verification against live docs and surfacing implementation-level gotchas. Three classes of findings matter for the planner:

1. **Stack is sound.** Vite 8 supports the `new Worker(new URL(...), { type: 'module' })` idiom natively; Tauri v2's default CSP (`default-src 'self'; script-src 'self'`) permits same-origin workers via `script-src` fallback — no Tauri config change required. d3-force@3 exposes `.stop()` + manual `.tick()` cleanly. Transferable `Float32Array` round-trip overhead at 40–80 KB is sub-millisecond.

2. **Two CONTEXT claims are contradicted by current upstream docs** — both are minor and do not invalidate the phase, but the planner should be aware:
   - **D-13 rationale is stale.** `requestAnimationFrame` IS standard in `DedicatedWorkerGlobalScope` (WebKit fix landed 2020, Baseline since 2023 per MDN). The `setTimeout(tickLoop, 0)` choice is still defensible on *portability* grounds but the "not standard" rationale is outdated. **Recommendation: keep `setTimeout(0)` per D-13 — it is not wrong, and rAF-in-worker doesn't actually help here** (we don't own a rendering surface in the worker; rAF would gate ticks to display refresh, limiting to ≤60 ticks/sec when we want d3-force to saturate a non-main core per D-14). The rationale in code comments should read "decouple tick rate from display vsync" rather than "not standard."
   - **D-23 implies `graphSimCore` is driven by tests without timers.** This is compatible with d3-force's API (`.stop()` + manual `.tick()`), BUT note that **d3-force's `.on('tick')` event fires only from the internal timer, NOT from manual `.tick()` calls** ([d3-force simulation docs](https://d3js.org/d3-force/simulation)). The worker (and `graphSimCore`) MUST post tick messages directly from the tick loop — not via `sim.on('tick', ...)`. The existing `useGraphLayout.ts` uses `.on('tick')` + `.on('end')` but relies on d3's internal rAF — that pattern does NOT carry into the worker. The planner must explicitly wire this in the worker shim.

3. **One hidden gotcha surfaced by determinism research:** d3-force@3 already exposes `simulation.randomSource()` with a built-in fixed-seed LCG ([d3js.org/d3-force/simulation](https://d3js.org/d3-force/simulation)). This means the existing `useGraphLayout.test.ts` "relative determinism" workaround (monkey-patching `Math.random` in Waves / mulberry32 seed) is no longer necessary for d3-force's *internal* jiggle — only for the **initial position seeding** at lines 107-108 of `useGraphLayout.ts` (`Math.random() - 0.5) * 200`). When the simulation moves into the worker, the initial-position seeding moves with it. Opportunity: seed via `sim.randomSource(mulberry32(42))` inside `graphSimCore` for byte-identical test snapshots. Optional; CONTEXT doesn't require it.

**Primary recommendation:** Execute in four waves (see Planner Guidance): (W0) create test scaffolding + pure core stub, (W1) build `graphSimCore` + `graphSimProtocol` + `graphSimConfig` + core tests, (W2) wire shim `graphSim.worker.ts` + refactor `useGraphLayout` to own the Worker + ping-pong buffers + sequence guard, (W3) refactor `RadarCanvas` hot path to consume Float32Array + add perf benchmark harness + visual equivalence check.

## Architectural Responsibility Map

Phase 11 is frontend-only, but spans the worker/main thread boundary cleanly. Each capability must land on the correct tier:

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| d3-force simulation (tick loop) | Worker | — | Whole point of the phase (D-01, D-14). |
| `forceCluster` / `forceClusterCollide` | Worker | — | Pure modules imported by worker (D-30); no DOM deps. |
| Tuning constants | Shared (`graphSimConfig.ts`) | — | Imported by worker + tests; no React (D-29). |
| Message protocol types | Shared (`graphSimProtocol.ts`) | — | `WorkerIn`/`WorkerOut` discriminated unions (D-10, D-11). |
| Worker lifecycle (construct/terminate) | Frontend Server (React hook) | — | `useGraphLayout` owns Worker (D-01); React effect cleanup handles StrictMode + unmount. |
| Worker message routing | Frontend Server (React hook) | — | `useGraphLayout` hosts `postMessage` / `onmessage` adapter; updates refs (D-25). |
| Ping-pong buffer pool management | Worker (allocation) + Frontend Server (return) | — | Worker allocates (D-06, D-09); main transfers back via `returnBuffer` (D-10). |
| Sequence-number guard | Both (bumped on main, tagged on worker) | — | Main bumps on `topology`/`init`; worker tags outgoing messages; main drops stale (D-12). |
| Quadtree (hit-testing) | Frontend Server (hook) | Browser (RadarCanvas mousemove) | Rebuild on main from Float32Array (D-16, D-17); reads via `quadtreeRef`. |
| `radarStore` `commitSettledPositions` / `pinNode` / `unpinNode` | Frontend Server (Zustand store) | — | Main-only; worker doesn't touch stores (D-21, D-28). |
| Render loop (rAF, draw fns) | Browser (Canvas 2D in RadarCanvas) | — | Unchanged from Phase 7; only consumer contract shifts (D-26). |
| `livePositions: Map<string, {x,y}>` materialization | Browser (rAF callback) | — | Per-frame build from Float32Array + ids (D-26). |
| Pinning UI (pointer events) | Browser (canvas handler) | Frontend Server (`pinNode` / `postMessage pin`) | Pointer events hit main; translated to `pin`/`unpin` messages (D-20). |
| Long-task observation | Browser (`PerformanceObserver`) | — | Dev-only perf harness; see Performance Benchmark Harness. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| d3-force | ^3.0.0 (current latest: 3.0.0) [VERIFIED: npm view d3-force version → 3.0.0] | Force simulation inside worker | Already pinned. v3 exposes `simulation.randomSource()` for deterministic LCG by default; `.stop()` + manual `.tick()` pattern is the official way to disable the internal rAF timer [CITED: d3js.org/d3-force/simulation]. |
| d3-quadtree | ^3.0.1 [VERIFIED: npm view d3-quadtree version → 3.0.1] | Hit-test index (stays on main, D-17) | Already pinned; rebuild cost at 5k ≈ 1ms. Not transferable (reference graph). |
| vite | ^8.0.8 (dev uses ^8.0.0 per package.json) [VERIFIED: npm view vite version → 8.0.8] | Worker bundling via `new URL(...)` | Native support for `new Worker(new URL('./w.ts', import.meta.url), { type: 'module' })` [CITED: vite.dev/guide/features.html#web-workers]. Production default `worker.format: 'iife'` [CITED: vite.dev/config/worker-options]; ESM `import` statements inside the worker file are supported — Vite "compiles them away" into the IIFE bundle at build time (see §Pitfall 2 below). |
| vitest | ^3.0.0 (current: 4.1.4 available but 3.x pinned) [VERIFIED: npm view vitest versions] | Test harness for `graphSimCore` | Already pinned. jsdom env configured. For real-Worker integration smoke, `@vitest/web-worker` exists (see Testing). |
| jsdom | ^26.0.0 | Vitest DOM env | Already pinned. Does NOT implement `Worker` — real-Worker tests require `@vitest/web-worker` or equivalent shim (D-24 explicitly chose pure-core-tests + mocked-Worker path; jsdom's lack of Worker doesn't block). |

### Supporting (already in package.json — nothing new needed for Phase 11)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zustand | ^5.0.0 | `radarStore` consumer | Main only — worker must NOT import zustand (D-03). |
| React | ^19.2.0 | `useGraphLayout` hook host | Main only; StrictMode double-mount handled via effect cleanup. |

### Candidates — Claude's Discretion (recommendation: skip all three for v1)

| Package | Why You'd Use It | Recommendation | Source |
|---------|------------------|----------------|--------|
| `@vitest/web-worker` @ 4.1.4 | Real-Worker shim for vitest (in-thread simulation of `new Worker(new URL(...))`). | **Skip for v1.** CONTEXT D-24 explicitly prefers mocking the Worker constructor with a synchronous `graphSimCore` instance. `@vitest/web-worker@4.1.4` requires `vitest@4.1.4` [VERIFIED: `npm view @vitest/web-worker@4.1.4 peerDependencies → { vitest: '4.1.4' }`] which would force an upgrade from the pinned 3.x. Not worth the churn. | [npmjs.com/package/@vitest/web-worker](https://www.npmjs.com/package/@vitest/web-worker) |
| `comlink` | RPC sugar over postMessage. | Skip. Our message set is six types with discriminated unions; comlink hides the Transferable flow that is the entire point of the phase. | — |
| `@naoak/workerize-transferable` | Decorator to mark worker args as transferable. | Skip. Four `postMessage(msg, [buffer])` call sites don't justify a dep. | [search result: "workerize-transferable"] |

### Alternatives Considered (rejected)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Transferable Float32Array (D-05) | `SharedArrayBuffer` | Requires COOP `same-origin` + COEP `require-corp` on Tauri asset responses → dev-server HMR iframe breaks. CONTEXT D-07 already rejected. |
| `setTimeout(tickLoop, 0)` in worker (D-13) | `requestAnimationFrame` in worker | rAF IS supported in DedicatedWorkerGlobalScope on all three Tauri webviews ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope/requestAnimationFrame), Baseline since 2023) — so the D-13 "non-standard" rationale is stale. BUT: rAF in a worker without a rendering surface is effectively gated to display refresh, capping ticks at ≤60/sec. D-14 explicitly wants no cap. **Keep `setTimeout(0)`** but update the rationale. |
| `setTimeout(0)` inside worker | `queueMicrotask` | `queueMicrotask` is synchronous-in-event-loop — it would starve incoming messages (`onmessage` only fires after the microtask queue drains). `setTimeout(0)` yields to the task queue so `onmessage` for `updateConfig`/`pin`/`returnBuffer` gets a turn between ticks. **`setTimeout(0)` is correct.** [CITED: MDN Event Loop] |
| `setTimeout(0)` | `MessageChannel`+postMessage-self trick | Same outcome as `setTimeout(0)`; no measurable improvement. Not worth the complexity. |

**Installation:** Zero new deps. Everything needed is already in package.json.

**Version verification:**
```bash
npm view d3-force version   # 3.0.0 (verified 2026-04-17)
npm view d3-quadtree version # 3.0.1
npm view vite version       # 8.0.8
npm view vitest versions --json | tail -1  # 4.1.4 latest; project pinned ^3
```

## Architecture Patterns

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                         MAIN THREAD                                │
│                                                                    │
│  RadarCanvas (rAF render loop)                                     │
│      ↑  reads Float32Array via idIndex                             │
│      │                                                             │
│  useGraphLayout (hook)        ← graphNodes/graphEdges/forceConfig  │
│      ├── Worker ref  ────────────────────────┐                     │
│      ├── buffer pool {A, B}                  │ postMessage         │
│      ├── idIndex: Map<string, number>        │ (transfer buffer)   │
│      ├── quadtreeRef                         │                     │
│      └── simNodesRef: {ids, positions, idIndex}                    │
│                                                                    │
│  radarStore (Zustand)                                              │
│      ├── commitSettledPositions  ← on 'settled' msg                │
│      ├── pinNode / unpinNode     → postMessage 'pin'/'unpin'       │
│      └── pinnedNodeIds (UI-only)                                   │
└──────────────────────────────────────┬─────────────────────────────┘
                                       │
              ══════════════ Worker boundary (structured clone / transfer)
                                       │
┌──────────────────────────────────────▼─────────────────────────────┐
│                   DEDICATED WORKER (module)                        │
│                                                                    │
│  graphSim.worker.ts (~50 LOC shim)                                 │
│      ├── onmessage router → graphSimCore methods                   │
│      ├── buffer pool owner (3 × Float32Array)                      │
│      └── postMessage('tick', positions, {transfer: [buf]})         │
│                                                                    │
│  graphSimCore.ts  (pure, no self/Worker/DOM)                       │
│      ├── forceSimulation<SimNode, SimEdge>                         │
│      │      .force('link', forceLink)                              │
│      │      .force('charge', forceManyBody)                        │
│      │      .force('center', forceCenter)                          │
│      │      .force('collide', forceCollide)                        │
│      │      .force('cluster', forceCluster)        ← D-30          │
│      │      .force('clusterCollide', forceClusterCollide)          │
│      │      .stop()                                                │
│      ├── tickLoop: setTimeout(tick, 0) while alpha>alphaMin        │
│      ├── sequence: number (bumped on init/topology)                │
│      └── API: init, topology, updateConfig, pin, unpin,            │
│               tick, getPositions(buf), dispose                     │
│                                                                    │
│  graphSimProtocol.ts (shared types)                                │
│  graphSimConfig.ts   (shared tuning constants)                     │
└────────────────────────────────────────────────────────────────────┘
```

Data flow — primary use case "force slider dragged, nodes glide":
1. User drags `forceConfig.linkStrength` slider (UI in main).
2. `radarStore.setForceConfig()` writes new config.
3. `useGraphLayout` subscription fires: `worker.postMessage({type:'updateConfig', config})`.
4. Worker's `onmessage` → `graphSimCore.updateConfig({linkStrength, ...})` → updates forces in-place + `sim.alpha(FORCE_CONFIG_ALPHA).restart()`.
5. `tickLoop` resumes (alpha > alphaMin). Each tick: `sim.tick()`, write positions to next-free `Float32Array`, `postMessage({type:'tick', positions, sequence}, {transfer:[buffer]})`.
6. Main `onmessage('tick')`: drops if `sequence < lastAckTopologySequence`; else writes `simNodesRef.current.positions = evt.data.positions`, sets `dirty=true`, every N=10 ticks rebuilds quadtree from the new positions.
7. RadarCanvas rAF tick: builds `livePositions: Map<string,{x,y}>` once per frame from `simNodesRef.current.positions + ids + idIndex`; passes map unchanged to `drawEdges`/`drawArrowHeads`/`drawNodes`. After draw: `worker.postMessage({type:'returnBuffer', buffer: previousBuffer}, {transfer:[previousBuffer]})`.
8. Alpha cools below alphaMin → worker emits `settled` with final positions → main rebuilds quadtree + calls `commitSettledPositions()` → `isSimulatingRef = false`.

### Recommended Project Structure

```
src/
├── workers/                        # NEW directory
│   ├── graphSim.worker.ts          # ~50-line shim: postMessage router + buffer pool (D-23)
│   ├── graphSimCore.ts             # Pure core: factory + tick loop (D-22)
│   ├── graphSimProtocol.ts         # WorkerIn / WorkerOut discriminated unions (D-10/D-11)
│   ├── graphSimConfig.ts           # Tuning constants (D-29)
│   └── __tests__/
│       └── graphSimCore.test.ts    # Unit tests for pure core
├── hooks/
│   ├── useGraphLayout.ts           # REWRITTEN — Worker owner + message adapter (D-01, D-25)
│   └── __tests__/
│       └── useGraphLayout.test.ts  # REFACTORED — mocks Worker with sync graphSimCore (D-24)
├── views/Radar/
│   ├── RadarCanvas.tsx             # MODIFIED hot path (~lines 543-557) — Float32Array consumer (D-25, D-26)
│   ├── forceCluster.ts             # UNCHANGED — imported by worker (D-30)
│   └── __tests__/forceCluster.test.ts  # UNCHANGED
└── stores/
    └── radarStore.ts               # UNCHANGED contract — commitSettledPositions/pinNode/unpinNode (D-28)
```

### Pattern 1 — Module Worker Construction (Vite 8)

**What:** The canonical Vite 8 idiom. Worker URL resolved at build time; Vite emits worker as separate chunk with hashed filename in production.

**When:** Once in `useGraphLayout` on first `init` (lazy). Terminated on hook unmount.

**Example:**
```typescript
// Source: https://vite.dev/guide/features.html#web-workers
// Vite requires the new URL() to be inline inside new Worker() — it is detected
// statically by the bundler; dynamic URLs are not bundled.
const worker = new Worker(
  new URL('../workers/graphSim.worker.ts', import.meta.url),
  { type: 'module' }
);
```

**Production behavior [VERIFIED: vite.dev/config/worker-options]:**
- Default `worker.format: 'iife'`. Despite `{ type: 'module' }` in source, Vite's build emits an IIFE bundle for the worker by default.
- **Static ESM imports inside the worker (e.g., `import { forceSimulation } from 'd3-force'`) are "compiled away"** into the IIFE — works transparently.
- **Dynamic `import()` inside the worker is INCOMPATIBLE with IIFE** and will break the build [CITED: github.com/vitejs/vite/issues/18585]. For Phase 11 we only need static imports, so the default `iife` format is fine.
- **Do NOT set `worker.format: 'es'` in vite.config.ts.** ES-format module workers require Safari 15+ at runtime. macOS Monterey (12.5) ships Safari 15.6 per [Tauri webview versions](https://v2.tauri.app/reference/webview-versions/); older macOS WKWebView may fail. IIFE has no runtime module-worker requirement — universal support.

### Pattern 2 — d3-force Manual-Tick Loop (inside worker)

**What:** `.stop()` + explicit `.tick()` call in a `setTimeout(0)` loop. This is the documented way to drive d3-force without its internal rAF timer [CITED: d3js.org/d3-force/simulation].

**When:** Every non-paused tick cycle inside the worker.

**Example:**
```typescript
// Source: d3js.org/d3-force/simulation (simulation.stop, simulation.tick)
// Inside graphSimCore.ts — no self/postMessage here.

const sim = forceSimulation<SimNode>(simNodes)
  .force('link', forceLink<SimNode, SimEdge>(simEdges).id(n => n.id)...)
  .force('charge', forceManyBody<SimNode>()...)
  .force('center', forceCenter(0, 0).strength(cfg.centerStrength))
  .force('collide', forceCollide(COLLIDE_RADIUS))
  .force('cluster', forceCluster().strength(cfg.clusterStrength))
  .force('clusterCollide', forceClusterCollide())
  .alphaDecay(ALPHA_DECAY)
  .velocityDecay(VELOCITY_DECAY)
  .stop();  // disable internal timer

// Initial fast-settle (D-19) — SYNCHRONOUS ticks before first onTick:
for (let i = 0; i < MAX_TICKS && sim.alpha() > sim.alphaMin(); i++) {
  sim.tick();
}

// Continuous-tick loop (D-14, D-15):
function tickLoop() {
  if (sim.alpha() <= sim.alphaMin()) {
    paused = true;
    onSettled({ positions: currentBuffer, alpha: sim.alpha(), sequence });
    return;
  }
  sim.tick();
  const buf = acquireBuffer();  // buffer pool — see Pattern 3
  writePositionsInto(sim.nodes(), buf);
  onTick({ positions: buf, alpha: sim.alpha(), sequence });
  // setTimeout(0), NOT queueMicrotask — yield to onmessage queue between ticks.
  scheduled = setTimeout(tickLoop, 0);
}
```

**Critical gotcha [CITED: d3js.org/d3-force/simulation]:** `simulation.on('tick', ...)` fires **only from the internal timer**, NOT from manual `.tick()` calls. The existing `useGraphLayout.ts` lines 166-182 use `sim.on('tick', ...)` + `sim.on('end', ...)` — that pattern does NOT carry into the worker. The worker must emit `tick`/`settled` messages directly from the tick loop. This is the load-bearing departure from Phase 7's code.

### Pattern 3 — Transferable Float32Array Ping-Pong Buffer Pool

**What:** Worker owns three pre-allocated `Float32Array(N*2)` instances. At any time: ≤1 being written to, ≤2 in-flight/held by main. Worker transfers a fresh buffer each tick; main transfers an empty one back via `returnBuffer` after draw. When main holds both A+B, worker uses spare C and skips transferring the lagging tick.

**When:** Every tick transfer. Initialized at `init` time (or lazily on first `topology` per allocation-timing discretion).

**Example:**
```typescript
// Source: ecosystem convention (MDN postMessage+transfer) + CONTEXT D-06/D-09
// Worker side (inside graphSim.worker.ts shim):

const N = ids.length;
const pool: Float32Array[] = [
  new Float32Array(N * 2),   // A
  new Float32Array(N * 2),   // B
  new Float32Array(N * 2),   // C (spare, D-09)
];
let inFlightCount = 0;  // how many buffers are currently held by main

function acquireBuffer(): Float32Array | null {
  const b = pool.shift();
  if (!b || b.byteLength === 0) return null;  // detached — skip tick transfer
  return b;
}
function onReturnBuffer(buf: ArrayBuffer) {
  // main sent it back empty — re-wrap as Float32Array view and push to pool
  pool.push(new Float32Array(buf));
  inFlightCount--;
}

function emitTick(posBuf: Float32Array, alpha: number, sequence: number) {
  if (inFlightCount >= 2) {
    // D-09: both main-owned buffers outstanding — use spare or skip
    pool.unshift(posBuf);  // keep for next tick
    return;  // skip this tick's transfer; physics continues internally
  }
  postMessage(
    { type: 'tick', positions: posBuf, alpha, sequence },
    { transfer: [posBuf.buffer] }   // zero-copy; posBuf becomes 0-length on this side
  );
  inFlightCount++;
}
```

**Key constraint:** After `postMessage(msg, {transfer: [buf.buffer]})`, the worker's view `buf` becomes a zero-length `Float32Array` backed by a detached `ArrayBuffer` [CITED: MDN postMessage]. Detection: `buf.byteLength === 0`. **Never touch a transferred buffer without checking.**

**Measured overhead [CITED: developer.chrome.com/blog/transferable-objects-lightning-fast]:** Structured clone of 32 MB `ArrayBuffer` ≈ 302 ms (Firefox). Transferable equivalent ≈ 6.6 ms — a 45× speedup. Extrapolating to our 40–80 KB Float32Array: **<0.1 ms per transfer** (the fixed postMessage/structured-clone overhead of the tiny metadata envelope dominates; the buffer itself is zero-copy). Negligible compared to the 33 ms budget of a 30Hz tick.

**Spare-buffer allocation (D-09 + Claude's discretion):** Recommend **eager at `init`** — three `Float32Array(N*2)` allocations total ~240 KB @ 10k nodes. Lazy allocation introduces a branch in the hot path that the planner will then have to benchmark away. Eager is cheaper and simpler.

### Pattern 4 — Sequence-Number Staleness Guard (D-12)

**What:** Main-side counter bumped whenever topology changes (`init` or `topology` message). Worker tags every outbound `tick`/`settled`/`error` with the current `sequence`. Main drops messages where `sequence < lastAckTopologySequence`.

**When:** Every message worker→main, every topology message main→worker.

**Prior art:** This is the same pattern used internally by React Fiber for out-of-order renders, by Redux-Saga for race cancellation, and by many MMO client-prediction libraries. **It doesn't have a named library idiom**; implement inline. [SEARCH: "sequence number staleness guard postMessage worker" — no popular npm package, confirming this is load-bearing custom logic.]

**Example:**
```typescript
// In useGraphLayout.ts (main):
const topologySeqRef = useRef(0);

function sendInit(nodes, edges, config, alpha) {
  topologySeqRef.current++;
  worker.postMessage({
    type: 'init',
    sequence: topologySeqRef.current,
    nodes, edges, config, alpha,
    fastSettle: true,
  });
}

worker.onmessage = (evt: MessageEvent<WorkerOut>) => {
  const msg = evt.data;
  if ((msg.type === 'tick' || msg.type === 'settled') && msg.sequence < topologySeqRef.current) {
    // Stale — return the buffer but don't commit positions.
    worker.postMessage(
      { type: 'returnBuffer', buffer: msg.positions.buffer },
      { transfer: [msg.positions.buffer] }
    );
    return;
  }
  // ... handle fresh message
};
```

**Invariant:** Worker honors the sequence it received in the last `init`/`topology`. If worker receives `init(seq=5)` mid-tick, it bumps its internal sequence immediately and the next `tick` carries `seq=5`. Any in-flight `tick` messages from the `seq=4` era on the main side are correctly dropped.

**Wraparound:** `number` in JS is double-precision float; integer-safe up to 2^53. Bumping once per topology change, wrap won't happen in this lifetime. CONTEXT's "uint32 wraps at ~4.3B ticks" is a red herring — we're not using uint32, and we bump on topology, not tick.

### Pattern 5 — Main-Thread Hot Path Consumer Refactor (D-25, D-26)

**What:** Replace `simNodesRef.current: SimNode[]` with `simNodesRef.current: { ids: string[]; positions: Float32Array; idIndex: Map<string, number> }`. Rebuild `livePositions: Map<string,{x,y}>` once per rAF frame from that shape.

**When:** Inside the rAF render loop, only when `isSimulatingRef.current === true`.

**Current code (RadarCanvas.tsx:549-557):**
```typescript
if (simulating && simNodesRef.current.length > 0) {
  liveNodes = simNodesRef.current as typeof s.graphNodes;
  simPositionMap.clear();
  for (const n of simNodesRef.current) {
    if (n.x !== undefined && n.y !== undefined) {
      simPositionMap.set(n.id, { x: n.x, y: n.y });
    }
  }
  livePositions = simPositionMap;
}
```

**New code (target):**
```typescript
if (simulating && simNodesRef.current.positions.byteLength > 0) {
  const { ids, positions } = simNodesRef.current;
  simPositionMap.clear();
  // Reuse xyPool to avoid per-frame {x,y} allocation (5k nodes × 60fps = 300k allocs/sec).
  for (let i = 0; i < ids.length; i++) {
    const p = xyPool[i] ?? (xyPool[i] = { x: 0, y: 0 });
    p.x = positions[i * 2];
    p.y = positions[i * 2 + 1];
    simPositionMap.set(ids[i], p);
  }
  livePositions = simPositionMap;
}
```

**Allocation-pool rationale:** V8 handles short-lived `{x,y}` allocations well (scalar-replaces into the stack when the object doesn't escape), but `simPositionMap.set(...)` forces escape. 5k × 60 = 300k escaped allocs/sec is ~5 MB/sec of garbage, enough to trigger minor GC at inconvenient times. The `xyPool` eliminates this. [ASSUMED: V8 minor GC pressure at 5 MB/sec on a 2 ms budget is meaningful — defer to benchmark harness for validation; may be a no-op on modern V8.]

**Alternative (simpler, maybe fine):** Don't pool — trust the JIT. Benchmark both in Wave 3; pick the winner.

**`liveNodes` reshape:** Current code does `liveNodes = simNodesRef.current as typeof s.graphNodes` — a cast lie. In the new world, `liveNodes` must come from `s.graphNodes` (which holds `dirKey`/`dirDepth` metadata) — we no longer have `SimNode[]` on main. The positions-by-id lookup is satisfied by `livePositions`. `drawFolderHulls`/`drawNodes` already consume `s.graphNodes` + `livePositions` separately — check the call sites and verify the split already works. [Reading RadarCanvas.tsx 560-587, they take `liveNodes` as positional data for hulls. Need to ensure `liveNodes` remains the `GraphNode[]` (with dirKey/dirDepth) and only position-read paths use `livePositions`.]

### Pattern 6 — React 19 StrictMode Cleanup (Worker Lifecycle)

**What:** React 19 StrictMode double-invokes effects in dev. The worker must be terminated in cleanup so the second mount gets a fresh worker.

**When:** `useGraphLayout` effect that constructs the worker.

**Example:**
```typescript
// Source: react.dev/reference/react/useEffect#my-cleanup-logic-runs-even-though-my-component-didnt-unmount
useEffect(() => {
  const worker = new Worker(
    new URL('../workers/graphSim.worker.ts', import.meta.url),
    { type: 'module' }
  );
  workerRef.current = worker;

  worker.onmessage = handleMessage;
  worker.onerror = handleError;

  // Send initial state after worker is ready...
  // (initial `init` posts once nodes are available — see graphNodes effect)

  return () => {
    worker.onmessage = null;
    worker.onerror = null;
    worker.postMessage({ type: 'dispose' });
    worker.terminate();
    workerRef.current = null;
  };
}, []); // Empty deps — worker lifetime = hook lifetime, not graph lifetime
```

**StrictMode invariant:** First mount creates worker A, cleanup terminates A, second mount creates worker B, cleanup eventually terminates B. No orphaned workers, no dual-simulation races. **Never skip `worker.terminate()` in cleanup.**

### Pattern 7 — Testing via Pure Core + Mocked Worker (D-22, D-24)

**What:** Three-tier test strategy:
1. **`graphSimCore.test.ts` (new):** Synchronous tests of the pure core via direct factory calls. Fastest; highest coverage.
2. **`useGraphLayout.test.ts` (refactored):** Mock the `Worker` constructor with a sync `graphSimCore` instance. Preserves the 7 existing test cases with minimal reshaping.
3. **Real-Worker smoke (optional):** Skip for v1 unless trivial. Requires either `@vitest/web-worker` (incompatible peer dep, see Stack) or manual Worker polyfill. Not worth it.

**Mock pattern for `useGraphLayout.test.ts`:**
```typescript
// src/hooks/__tests__/useGraphLayout.test.ts (refactored)
import { makeGraphSimCore } from '../../workers/graphSimCore';

// Global Worker mock — drives graphSimCore synchronously via its callbacks.
beforeEach(() => {
  const listeners = new Map<string, (e: MessageEvent) => void>();
  vi.stubGlobal('Worker', class MockWorker {
    private core = makeGraphSimCore({
      onTick: (msg) => this.dispatch({ type: 'tick', ...msg }),
      onSettled: (msg) => this.dispatch({ type: 'settled', ...msg }),
      onError: (msg) => this.dispatch({ type: 'error', ...msg }),
    });
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    postMessage(msg: WorkerIn) {
      // Drive core synchronously — d3-force ticks inside each call.
      if (msg.type === 'init') this.core.init(msg);
      else if (msg.type === 'topology') this.core.topology(msg);
      else if (msg.type === 'updateConfig') this.core.updateConfig(msg.config);
      else if (msg.type === 'pin') this.core.pin(msg.id, msg.x, msg.y);
      else if (msg.type === 'unpin') this.core.unpin(msg.id);
      else if (msg.type === 'returnBuffer') this.core.returnBuffer(msg.buffer);
      else if (msg.type === 'dispose') this.core.dispose();
    }
    terminate() { this.core.dispose(); }
    private dispatch(data: WorkerOut) {
      this.onmessage?.({ data } as MessageEvent<WorkerOut>);
    }
  });
});
```

**Critical:** The mock makes `postMessage` synchronous — a deliberate choice matching D-24's "drive inline" directive. All 7 existing test cases (constants, settle, quadtree, rewarm threshold, cleanup, determinism, cluster) should survive the refactor with minimal reshaping since they already use `act()` + synchronous hook invocation.

### Anti-Patterns to Avoid

- **`sim.on('tick', cb)` inside the worker.** Fires only from internal rAF timer. Our tick is manual. Use the tick loop's own emit step. [CITED: d3js.org/d3-force/simulation]
- **`queueMicrotask(tickLoop)` instead of `setTimeout(0)`.** Microtasks run to completion before `onmessage` can fire. Worker would never receive `updateConfig`/`pin`/`returnBuffer` during active simulation. [CITED: MDN Event Loop]
- **`worker.format: 'es'` in vite.config.ts.** Breaks on Safari <15 / older macOS WKWebView. Not needed; IIFE handles our static imports fine.
- **Touching a transferred buffer.** After `postMessage(..., {transfer:[buf.buffer]})`, `buf.byteLength === 0`. Writes silently fail or throw. Always `acquireBuffer()` from the pool. [CITED: MDN postMessage]
- **Using `structuredClone` for the nodes/edges on each `init`.** Fine for 10k nodes (~100ms worst case per Chrome V8 numbers) but wasteful if the plan can reuse the cached topology between runs. v1 just eats the structured-clone cost on `init`/`topology` — we send these rarely. Don't prematurely optimize by pre-serializing node/edge arrays into Float32Arrays + id-index — adds complexity for no measured gain.
- **`sim.on('end', cb)` from within the worker shim.** Same issue as tick. Emit `settled` from the tick loop's "alpha ≤ alphaMin" branch.
- **Forgetting `worker.terminate()` on React cleanup.** Under StrictMode double-mount, you orphan the first worker and it keeps ticking. Memory + CPU leak.
- **Letting `simNodesRef.current` leak out-of-shape.** If any code path treats it as `SimNode[]`, tests pass but runtime crashes. Use a named type `LivePositions = {ids, positions, idIndex}` and enforce by type.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Force simulation | Custom spring physics | `d3-force@3` | Already in deps; Phase 7 already tuned. Verlet integration + Barnes-Hut manyBody is non-trivial to reimplement. |
| Spatial index | kd-tree or R-tree in JS | `d3-quadtree@3` | Already in deps; 1 ms rebuild at 5k nodes. |
| Deterministic PRNG | Math.random monkey-patch | `simulation.randomSource(mulberry32(seed))` | d3-force@3 built-in; fixes the existing test-determinism workaround at `useGraphLayout.test.ts:229-239`. |
| Worker bundling | Manual `?worker` imports / plugins | `new Worker(new URL(...), { type: 'module' })` | Vite 8 handles it; no plugin needed. |
| postMessage type safety | Ad-hoc `typeof msg.type === 'string'` checks | Discriminated union `WorkerIn` / `WorkerOut` + a single `switch` | TS exhaustiveness catches protocol drift at compile time (D-10, D-11). |
| Tick-rate throttling | `setInterval` with manual drift correction | `setTimeout(0)` loop with alpha gate | d3-force already has alpha cooldown as the natural termination signal. |
| Buffer pool | Array-based queue with locks | Three `Float32Array` references + int counter | Single-thread worker = no locks needed. |

**Key insight:** Every item above already exists in the codebase or npm stack. Phase 11 introduces **zero new dependencies**. The discipline here is to **wire existing libraries with the correct message protocol** — not to invent new abstractions.

## Runtime State Inventory

Not applicable. Phase 11 is a code refactor with no persistent state, no secrets, no OS-registered state, no build artifacts outside of Vite's normal output.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None. | — |
| Live service config | None. | — |
| OS-registered state | None. | — |
| Secrets/env vars | None. | — |
| Build artifacts | `dist/assets/graphSim.worker-*.js` — new worker chunk emitted by Vite 8 production build. Verify via `npm run build` in Wave 3. | One-time sanity check. |

## Common Pitfalls

### Pitfall 1 — Pixel-equivalence regression (VIZN-01 preservation)

**What goes wrong:** Worker relocation introduces tick-ordering drift. d3-force's internal `jiggle()` (used by `forceCollide` and `forceManyBody` for coincident nodes) calls the simulation's random source. If the worker and main-thread code paths differ in when they call `jiggle`, the final positions differ — screenshots drift.

**Why it happens:** d3-force@3 uses a fixed-seed LCG by default [CITED: d3js.org/d3-force/simulation], so same inputs → same outputs ACROSS worker and main boundaries as long as:
1. The node array is constructed in identical order.
2. The forces are attached in identical order.
3. No intervening `Math.random()` calls (including `useGraphLayout.ts:107-108` initial positions) drift.

**How to avoid:**
- **Move the initial-position seeding (`Math.random() - 0.5) * 200`) INTO `graphSimCore`** so both the worker's initial-position generation and the test's initial-position generation use the same (seeded) source.
- Optional, strongly recommended: `sim.randomSource(mulberry32(INITIAL_POSITION_SEED))` — eliminates non-determinism, makes tests byte-reproducible. The existing test's "relative determinism" workaround (`useGraphLayout.test.ts:229-239`) becomes unnecessary.
- Visual equivalence gate: Wave 3 should include a screenshot comparison test (or approximate — per-node position within 0.01 world-units of Phase 7 baseline).

**Warning signs:** `useGraphLayout.test.ts` determinism test starts failing; manual A/B visual smoke shows subtly different cluster shapes.

### Pitfall 2 — Vite worker chunk not emitting / 404 on production

**What goes wrong:** In production build, the worker script returns HTML (index.html) instead of JS → "SyntaxError: Unexpected token '<'" at worker startup. The exact failure reported in Tauri issue #9975.

**Why it happens:** Either (a) the `new URL(...)` is not a literal inline expression, or (b) Tauri's asset resolver serves `index.html` as the 404 fallback instead of a 404, and the worker URL didn't match any emitted asset.

**How to avoid:**
- ALWAYS use the inline literal pattern exactly: `new Worker(new URL('../workers/graphSim.worker.ts', import.meta.url), { type: 'module' })`. No variables, no template literals, no dynamic paths. Vite's detector is strict.
- Smoke-test the production build before merging: `npm run build && npm run tauri build` — then inspect `src-tauri/target/release/bundle/` app and run it on the target platform (Windows WebView2, minimum). Confirm the worker chunk loads.
- Wave 3 must include a "production build smoke" acceptance task.

**Warning signs:** Dev works, production throws `SyntaxError` or `Failed to execute 'Worker'`.

### Pitfall 3 — `onmessage` starvation during fast tick loops

**What goes wrong:** Worker's `onmessage` for `updateConfig`/`pin`/`returnBuffer` never fires while tick loop is running. Force sliders appear unresponsive during simulation.

**Why it happens:** If `tickLoop` uses `queueMicrotask` or `Promise.resolve().then()`, microtasks block the event loop from returning to the task queue — `onmessage` is a task, not a microtask.

**How to avoid:** Use `setTimeout(tickLoop, 0)`. The 4 ms minimum-timer clamping in Chromium is a non-issue (our 30 Hz target = 33 ms/tick, ≫ 4 ms). Firefox has no clamp for workers.

**Warning signs:** Sliders stop working while graph is settling; `pin` events queue up and fire in a burst after settle.

### Pitfall 4 — Detached buffer writes inside worker

**What goes wrong:** Worker writes to a `Float32Array` whose underlying `ArrayBuffer` was just transferred. Writes silently no-op (byteLength is 0); positions never propagate.

**Why it happens:** Mistaking buffer pool state — thinking a buffer is still owned when it isn't.

**How to avoid:** Single source of truth for pool state. After `postMessage({...}, {transfer:[buf.buffer]})`, immediately `buf = null` in the worker's local reference; only re-acquire from the pool.

**Warning signs:** Worker looks busy (tick loop running), but main-thread positions stay stale. `buf.byteLength === 0` after a write.

### Pitfall 5 — Float32Array precision loss

**What goes wrong:** d3-force internally uses `number` (float64). Downcasting positions to `Float32Array` loses precision (~7 decimal digits). For a world-coordinate range of -2000 to 2000, precision ≈ 0.0005 world-units — imperceptible for pixel rendering.

**Why it happens:** `Float32Array[i] = someFloat64` truncates silently.

**How to avoid:** Accept it. Tests must assert `Math.abs(a-b) < 0.01` rather than `a === b`. Not a real problem at our scale, but worth knowing.

**Warning signs:** None at typical zoom levels. Would surface only at extreme zoom-in (>100×) on specific pixel boundaries.

### Pitfall 6 — d3-force `.on('tick')` / `.on('end')` carryover

**What goes wrong:** Copy-pasting `useGraphLayout.ts:166-182` into the worker. Events never fire because manual `.tick()` doesn't dispatch. Worker silently does nothing.

**Why it happens:** d3-force doc ambiguity — `on('tick')` sounds like it fires on every tick, but it only fires when the internal timer ticks [CITED: d3js.org/d3-force/simulation]. When you `.stop()` + manually `.tick()`, the event system is bypassed.

**How to avoid:** In worker: emit `tick`/`settled` messages directly from the tick loop body. Do NOT register `sim.on('tick', ...)` or `sim.on('end', ...)` inside `graphSimCore`.

**Warning signs:** Zero worker→main messages after init; simulation appears frozen.

### Pitfall 7 — Pin-event avalanche during drag

**What goes wrong:** User drags a pinned node; `pointermove` fires at 120 Hz on precision trackpads; 120 `pin` messages/sec; worker message queue grows unboundedly; drag feels laggy.

**Why it happens:** D-20 explicitly ships v1 without coalescing.

**How to avoid:** D-20 pre-authorizes a mitigation: add rAF-aligned coalescer if benchmark shows queue depth growing. Wave 3 benchmark should test precision-trackpad drag and measure queue depth before declaring done.

**Warning signs:** Noticeable lag during sustained drag; `inFlightCount` in worker grows over time.

### Pitfall 8 — `sim.nodes()` returns the live array

**What goes wrong:** `sim.nodes()` returns the internal node array [CITED: d3-force source]. Mutating it during a tick causes undefined behavior.

**Why it happens:** Tempting to write `sim.nodes()[i].fx = x` for pinning.

**How to avoid:** Cache the `SimNode[]` reference returned by `sim.nodes()` at sim construction time; use that ref for pin mutations. Never re-query `sim.nodes()` during a tick.

## Code Examples

### Example A — `graphSimCore` factory signature

```typescript
// src/workers/graphSimCore.ts
// Source: d3js.org/d3-force/simulation + CONTEXT D-22/D-23

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type Simulation, type SimulationLinkDatum } from 'd3-force';
import { forceCluster, forceClusterCollide, type ClusterNode } from '../views/Radar/forceCluster';
import { LINK_DISTANCE, LINK_STRENGTH, CHARGE_STRENGTH, CHARGE_THETA, CHARGE_DISTANCE_MAX, CENTER_STRENGTH, COLLIDE_RADIUS, ALPHA_DECAY, VELOCITY_DECAY, MAX_TICKS, FORCE_CONFIG_ALPHA } from './graphSimConfig';

export interface SimNode extends ClusterNode { id: string }
export interface SimEdge extends SimulationLinkDatum<SimNode> { source: string | SimNode; target: string | SimNode; kind: string }

export interface GraphSimCallbacks {
  onTick: (msg: { positions: Float32Array; alpha: number; sequence: number }) => void;
  onSettled: (msg: { positions: Float32Array; alpha: number; sequence: number }) => void;
  onError: (msg: { message: string; stack?: string }) => void;
}

export interface GraphSimCore {
  init(msg: InitMessage): void;
  topology(msg: TopologyMessage): void;
  updateConfig(cfg: ForceConfig): void;
  pin(id: string, x: number, y: number): void;
  unpin(id: string): void;
  returnBuffer(buf: ArrayBuffer): void;
  tick(): void;          // Test-only: drive one tick synchronously, no scheduling.
  dispose(): void;
}

export function makeGraphSimCore(cb: GraphSimCallbacks, opts?: { schedule?: (fn: () => void) => void }): GraphSimCore {
  // opts.schedule defaults to setTimeout(fn, 0) in worker, identity (sync) in tests.
  // Implementation: holds Simulation<SimNode, SimEdge>, sequence number, buffer pool.
}
```

### Example B — Worker shim

```typescript
// src/workers/graphSim.worker.ts  (~50 LOC target per D-23)
// Source: CONTEXT D-23 + Pattern 3 buffer pool
/// <reference lib="webworker" />

import { makeGraphSimCore } from './graphSimCore';
import type { WorkerIn, WorkerOut } from './graphSimProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const core = makeGraphSimCore({
  onTick: (msg) => ctx.postMessage({ type: 'tick', ...msg } satisfies WorkerOut,
                                    { transfer: [msg.positions.buffer] }),
  onSettled: (msg) => ctx.postMessage({ type: 'settled', ...msg } satisfies WorkerOut,
                                       { transfer: [msg.positions.buffer] }),
  onError: (msg) => ctx.postMessage({ type: 'error', ...msg } satisfies WorkerOut),
}, {
  schedule: (fn) => setTimeout(fn, 0),  // Pattern 2 choice
});

ctx.onmessage = (evt: MessageEvent<WorkerIn>) => {
  const m = evt.data;
  switch (m.type) {
    case 'init': core.init(m); break;
    case 'topology': core.topology(m); break;
    case 'updateConfig': core.updateConfig(m.config); break;
    case 'pin': core.pin(m.id, m.x, m.y); break;
    case 'unpin': core.unpin(m.id); break;
    case 'returnBuffer': core.returnBuffer(m.buffer); break;
    case 'dispose': core.dispose(); ctx.close(); break;
  }
};
```

### Example C — Hot-path Float32Array consumer (RadarCanvas.tsx hunk)

```typescript
// src/views/Radar/RadarCanvas.tsx (replaces lines 543-557)
// Source: CONTEXT D-25, D-26

const simulating = isSimulatingRef.current;
let liveNodes = s.graphNodes;           // graphNodes has dirKey/dirDepth metadata (unchanged)
let livePositions = s.positions;
const live = simNodesRef.current;       // {ids, positions: Float32Array, idIndex: Map}
if (simulating && live.positions.byteLength > 0) {
  simPositionMap.clear();
  const { ids, positions } = live;
  for (let i = 0; i < ids.length; i++) {
    const p = xyPool[i] ?? (xyPool[i] = { x: 0, y: 0 });
    p.x = positions[i * 2];
    p.y = positions[i * 2 + 1];
    simPositionMap.set(ids[i], p);
  }
  livePositions = simPositionMap;
}
// drawFolderHulls(ctx, liveNodes, ...) and drawNodes(ctx, liveNodes, ...) consume
// liveNodes for dirKey/dirDepth; drawEdges/drawArrowHeads/drawConflictPulses consume
// livePositions. Signatures unchanged (D-26).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monkey-patch `Math.random` for d3-force determinism | `simulation.randomSource(prng)` | d3-force v2.1.x (~2020) | Tests become byte-deterministic; can drop the mulberry32 workaround in `useGraphLayout.test.ts:229-239`. |
| `importScripts('worker.js')` inside workers | ESM `import` in module workers | Chrome 80, Safari 15, Firefox 114 (2019-2023) | Our Tauri targets (WebView2 Chromium ≥100, macOS WKWebView ≥Safari 15.6) all support it; Vite handles the bundling. [CITED: caniuse.com/mdn-api_worker_worker_ecmascript_modules_parameter] |
| `setInterval(tick, 33)` for fixed-rate simulation | `setTimeout(tick, 0)` + alpha-driven termination | d3-force v3 (continuous-tick era) | Our D-14 "no fps cap" fits the modern pattern. Old `setInterval` wastes CPU when alpha has cooled. |
| Classic workers + `onmessage` strings | Module workers + discriminated-union types | TS 4+ era | Compile-time exhaustiveness check on message types. |
| SharedWorker for large-graph viz | DedicatedWorker + Transferable | 2018+ | Our 40–80 KB transfer is sub-ms; SharedArrayBuffer's COOP/COEP overhead isn't worth paying. |

**Deprecated/outdated:**
- `sim.on('tick', cb)` with manual `.tick()` — never worked, still a common mistake in 2026 tutorials.
- `importScripts('d3-force.js')` worker pattern — predates ESM modules in workers; not relevant to Vite projects.
- `new Worker('./worker.js')` (no URL wrapper) — Vite can't detect; deprecated in Vite 3+.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Tauri's default CSP (`default-src 'self'; script-src 'self'`) permits same-origin module workers via `script-src` fallback for `worker-src`. | §Validation Architecture | MEDIUM. If a platform-specific WebKit enforces `worker-src: 'none'` when `script-src` is present, worker construction fails. Mitigation: Wave 3 smoke test on Tauri prod build; if fails, add `worker-src 'self'` to CSP. [CITED: developer.mozilla.org/.../worker-src on fallback; Tauri v2 CSP docs don't contradict] |
| A2 | `Float32Array` transfer overhead at 40–80 KB is <1 ms on all Tauri webviews. | Pattern 3 | LOW. Chrome 32 MB round-trip = 6.6 ms extrapolates to 80 KB ≈ 0.016 ms. Real overhead dominated by postMessage envelope (~0.1 ms). [CITED: developer.chrome.com/blog/transferable-objects-lightning-fast] |
| A3 | Structured clone of the `init` payload (10k nodes × ~50 bytes + 30k edges × ~30 bytes ≈ 1.4 MB object graph) is <100 ms. | §Open Questions Q1 | MEDIUM. Ecosystem reports 10k objects ≈ 131 ms for deep clone. Acceptable for the rare `init`/`topology` message (not in hot path). If it's 500 ms, falls within the first-settle window and is masked by fastSettle ticks. |
| A4 | `setTimeout(tickLoop, 0)` in worker yields enough for `onmessage` to dispatch `updateConfig`/`pin` between ticks. | Pattern 2, Pitfall 3 | LOW. This is the event-loop spec guarantee; no browser deviates. |
| A5 | `PerformanceObserver({type:'longtask'})` is available in WebView2 (Chromium 100+), WKWebView (Safari 15.6+), WebKitGTK. | §Performance Benchmark Harness | MEDIUM. Chromium YES; Safari 17+ yes; WebKitGTK 2.36+ approximately Safari 16 → likely yes but not explicitly verified. Fallback: if missing, use `performance.now()` frame-bracket with a 50 ms threshold and estimate long-task count from that. |
| A6 | `simulation.randomSource()` was added in d3-force v2.1 or later (present in v3). | §Don't Hand-Roll | LOW. Verified in docs. [CITED: d3js.org/d3-force/simulation] |
| A7 | V8's allocation-and-discard of 5k `{x,y}` objects per frame triggers meaningful GC pressure. | Pattern 5 | LOW (cosmetic). Worst case: benchmark shows no difference; we keep pool anyway. Best case: 1-2% frame-time improvement. |
| A8 | `SimulationNodeDatum`'s `.fx`/`.fy` assignment inside worker correctly pins nodes when set via `pin` message after sim init. | D-20, D-21 | LOW. Verified pattern in existing `useGraphLayout.ts` — just moves into worker. |
| A9 | `graphSimCore` can synchronously drive enough ticks for `useGraphLayout.test.ts`'s 7 existing cases in <5 sec (vitest default timeout). | Pattern 7 | LOW. Existing tests already run in <5s with real simulation. The mock-driven sync core should be comparable. |
| A10 | Vite 8 production build emits worker with same-origin URL that matches CSP `'self'`. | Pitfall 2 | LOW. Documented behavior; millions of Vite apps ship workers this way. |

**User decisions requiring confirmation before execution (CONTEXT.md Discretion items — planner should confirm):**
- Scheduling primitive: **`setTimeout(fn, 0)`** (recommended) vs `queueMicrotask` (rejected per Pitfall 3) vs `Promise.resolve().then` (same as microtask).
- Spare-buffer allocation: **eager at init** (recommended; +80 KB memory, -1 branch in hot path) vs lazy.
- `visibilitychange` pause: **skip for v1** (saves battery but adds edge-case bugs; keep the worker ticking while hidden).
- Alpha on tick: **separate numeric field** (recommended; one extra structured-clone `number` is ~0 cost) vs appended to Float32Array tail.
- `WorkerClient` class extraction: **inline in `useGraphLayout`** (recommended; simpler, matches Phase 7 shape) vs separate class.
- Seeded `randomSource` for byte-deterministic tests: **yes — seed via mulberry32 in `graphSimCore`** (recommended, drops the relative-determinism workaround in existing tests). Note this is NOT in CONTEXT.md but is offered as a Claude's-discretion bonus.

## Open Questions

1. **Should `init` payload be pre-serialized to Float32Array + flat arrays instead of structured-cloning the object graph?**
   - What we know: 10k-node structured clone ≈ 100–500 ms. Not in hot path — sent on `init` and `topology` only. Rewarm frequency is per CONTEXT D-03 rare (threshold-gated).
   - What's unclear: Whether 500 ms on topology rebuild feels slow in practice.
   - Recommendation: **Ship structured-clone for v1.** If perf harness shows topology rebuild adds a 500 ms freeze, flatten into Float32Array + Uint32Array pair in Phase 11.1.

2. **Should we seed `simulation.randomSource()` for byte-deterministic tests?**
   - What we know: d3-force@3 supports it natively; would eliminate the existing tests' "relative determinism" workaround.
   - What's unclear: Whether the planner wants to expand scope or keep strict relocation-only.
   - Recommendation: **Add it** — one-line change, shrinks the test file by ~20 LOC, improves CI signal. Strictly not needed for the phase's primary goal.

3. **Should the quadtree rebuild cadence (every N=10 ticks per D-16) be configurable?**
   - What we know: D-16 specifies N=10. Tunable in CONTEXT but not in code today.
   - Recommendation: **Export as constant `QUADTREE_REBUILD_TICK_INTERVAL = 10` in `graphSimConfig.ts`.** Matches D-29 discipline (all tuning constants in shared module).

4. **Does CONTEXT D-09's "skip this tick's transfer" mean skip entirely or queue for next?**
   - What we know: D-09 says "physics continues internally; the next available transfer carries the freshest positions."
   - What's unclear: Whether "skipped" positions are lost or just deferred.
   - Recommendation: **Lost.** The next tick's buffer carries the freshest positions; intermediate ticks aren't observable to the user. Semantically fine because positions are continuous; user sees ≤30 Hz animation at max, and skipped ticks at 60+ Hz worker rate are imperceptible.

5. **Should `error` messages proxy to `tracing::error!` via a future Rust command?**
   - What we know: Claude's Discretion says `console.error` is fine for v1.
   - Recommendation: **`console.error` + `window.__AITC_DIAG__` push for v1.** A future diagnostics phase can hook them.

## Environment Availability

> Skipped — phase is pure code/config. No external tools, runtimes, or services introduced. All stack (d3-force, d3-quadtree, Vite 8, vitest 3, jsdom) is already in `package.json`.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` → include this section.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x + jsdom 26 (existing; no upgrade) |
| Config file | `vitest.config.ts` (exists; no change required) |
| Quick run command | `npm run test -- src/workers src/hooks/__tests__/useGraphLayout.test.ts` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VIZN-04 (spirit) | Zero >50 ms long tasks on main during 5k settle | benchmark (dev harness) | `npm run test -- src/workers/__tests__/graphSimBenchmark.test.ts` | ❌ Wave 3 |
| VIZN-04 (spirit) | Worker drives ≥30 effective ticks/sec at 5k | benchmark | same file | ❌ Wave 3 |
| VIZN-01 (preserved) | Node positions after settle are within 0.01 world-units of Phase 7 baseline (pixel equivalence) | snapshot | `npm run test -- src/hooks/__tests__/useGraphLayout.test.ts` (extended) | ✅ exists; extend |
| D-01..D-04 (worker lifecycle) | Worker constructed on `init`, terminated on dispose, survives StrictMode double-mount | unit | `npm run test -- src/hooks/__tests__/useGraphLayout.test.ts` | ✅ exists; extend |
| D-05..D-09 (Transferable Float32Array) | Buffer transfer detaches on sender; spare buffer activates on backpressure | unit | `npm run test -- src/workers/__tests__/graphSimCore.test.ts` | ❌ Wave 0 |
| D-10..D-12 (message protocol + sequence guard) | Stale tick from seq N-1 dropped after topology bumps seq to N | unit | same file | ❌ Wave 0 |
| D-13..D-15 (tick cadence + pause) | Tick loop runs while alpha>alphaMin, pauses at settle, resumes on updateConfig | unit | same file | ❌ Wave 0 |
| D-16..D-17 (quadtree on main) | Quadtree rebuilt on settled; rebuilt every 10 tick messages during sim | unit | `npm run test -- src/hooks/__tests__/useGraphLayout.test.ts` (new cases) | ✅ exists; extend |
| D-18..D-19 (continuous-tick + fastSettle) | Initial fast-settle runs synchronously before first tick message | unit | `graphSimCore.test.ts` | ❌ Wave 0 |
| D-20..D-21 (pin/unpin) | pin sets fx/fy on next tick; unpin clears; main's pinnedNodeIds unchanged | unit | same files | ✅+❌ |
| D-22..D-24 (testing strategy) | graphSimCore runs without self/Worker/DOM | build | TypeScript compile + `grep -E '\\b(self|postMessage|Worker)\\b' src/workers/graphSimCore.ts` returns empty | ❌ Wave 0 (CI assertion) |
| D-25..D-28 (main-thread refactor) | simNodesRef shape is {ids, positions, idIndex}; livePositions materializes from Float32Array | unit | `src/views/Radar/__tests__/RadarCanvas.test.tsx` | ✅ exists; adapt |
| D-29 (shared constants) | LINK_DISTANCE etc. exported from graphSimConfig.ts; imported by worker + tests | build | grep | ❌ Wave 0 |
| D-30 (forceCluster location) | forceCluster.ts unchanged; worker imports it | build | static assertion | ✅ |
| D-31 (zero long tasks) | PerformanceObserver({type:'longtask'}) observes 0 entries during 5k settle | benchmark | harness test | ❌ Wave 3 |
| D-32 (<2ms per frame) | rAF callback 95p duration <2 ms during active sim | benchmark | harness | ❌ Wave 3 |
| D-33 (tick rate) | effective-tick counter ≥30/sec @ 5k, ≥10/sec @ 10k | benchmark | harness | ❌ Wave 3 |
| D-34 (in-flight ≤2) | worker's inFlightCount ≤2 under steady state | unit | `graphSimCore.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test -- src/workers src/hooks/__tests__/useGraphLayout.test.ts` (~10 sec target).
- **Per wave merge:** `npm run test` (full vitest suite).
- **Phase gate:** full suite green + `npm run build` succeeds + manual prod smoke of worker loading on Tauri.

### Wave 0 Gaps

Test scaffolding + module stubs the planner must create before Wave 1 implementation:

- [ ] `src/workers/graphSimCore.ts` — stub exporting `makeGraphSimCore` factory returning a no-op `GraphSimCore`. Implementation in Wave 1.
- [ ] `src/workers/graphSimConfig.ts` — constants file, re-exports tuning values so tests can import.
- [ ] `src/workers/graphSimProtocol.ts` — `WorkerIn` / `WorkerOut` discriminated unions.
- [ ] `src/workers/graphSim.worker.ts` — stub that throws `not implemented`; fleshed out in Wave 2.
- [ ] `src/workers/__tests__/graphSimCore.test.ts` — test file scaffolded with 12+ `it.todo(...)` cases covering D-05..D-19, D-34.
- [ ] `src/workers/__tests__/graphSimProtocol.test.ts` — compile-time type tests (exhaustive switch on `WorkerIn`/`WorkerOut`).
- [ ] CI assertion for D-24 isolation: `grep -E '\bself\b|postMessage|new Worker|onmessage' src/workers/graphSimCore.ts` returns empty.

### Grep/Assertion Witnesses for Locked Decisions

For each CONTEXT decision, a mechanical assertion the planner can include in verification:

| Decision | Grep / Assert |
|----------|---------------|
| D-01 (long-lived worker) | `grep -c "worker.terminate()" src/hooks/useGraphLayout.ts` ≥ 1 |
| D-02 (Vite idiom) | `grep -F "new Worker(new URL('../workers/graphSim.worker.ts', import.meta.url), { type: 'module' })" src/hooks/useGraphLayout.ts` matches |
| D-03 (worker isolation) | `grep -E "from '(zustand\|@tauri-apps\|react\|.*bindings)'" src/workers/graphSim.worker.ts src/workers/graphSimCore.ts` → empty |
| D-05 (Float32Array AoS) | Type assertion: `type Position = Float32Array` and `const layout: { ids: string[]; positions: Float32Array; idIndex: Map<string, number> }` in simNodesRef typing |
| D-09 (≤3 buffers) | Test: after 50 ticks without returnBuffer, `workerInternalState.pool.length + inFlight <= 3` |
| D-10/D-11 (protocol) | Exhaustive `switch(m.type)` on `WorkerIn`/`WorkerOut` compiles; TS `never` check in default branch |
| D-12 (sequence) | Test: main drops stale tick; `commitSettledPositions` not called |
| D-13 (setTimeout 0) | Code review: tick loop uses `setTimeout(fn, 0)`, NOT `requestAnimationFrame`, NOT `queueMicrotask` |
| D-16 (quadtree on main) | Test: `quadtreeRef.current` rebuilt after `settled` message handler |
| D-22/D-23 (pure core) | Grep assertion in Wave 0 Gaps above |
| D-25 (simNodesRef shape) | Type check: `simNodesRef.current.positions instanceof Float32Array` |
| D-31..D-34 (perf) | Benchmark harness numeric output (see Performance Benchmark Harness) |

## Performance Benchmark Harness

The success criterion "zero long tasks >50ms on main during 5k-node settle" demands a reproducible, automated measurement. Recommend a minimal dev-only harness in Wave 3:

### File: `src/workers/__tests__/graphSimBenchmark.test.ts`

**Shape:** A single vitest test `describe.skipIf(!process.env.BENCH)` that runs only with `BENCH=1 npm run test`. Keeps it out of CI's green-gate by default; developers opt-in when profiling.

**What it does:**

1. Construct a 5k-node synthetic graph (fixed seed, fixed topology) matching the shape of a real codebase — use the `seedGraph` helper already in `useGraphLayout.test.ts`.
2. Render a `<RadarCanvas>` in jsdom (or happy-dom if required for `OffscreenCanvas`) with the mocked Worker that drives `graphSimCore` synchronously.
3. Observe long tasks via `PerformanceObserver`:
   ```typescript
   const longTasks: PerformanceEntry[] = [];
   const po = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
   po.observe({ type: 'longtask', buffered: true });
   ```
4. Assert: `longTasks.length === 0` after the settle.
5. Additionally bracket each mocked rAF callback with `performance.now()` and compute 95p frame cost. Assert `<2 ms` (D-32).

**Fallback if `PerformanceObserver({type:'longtask'})` is not supported in the test env (it isn't in jsdom):**

Since jsdom doesn't implement the Long Task API, measurement must happen in a real browser. Two options:

- **Real-browser harness:** Add `tests/playwright/perf.spec.ts` using Playwright against a Vite dev server. Mount RadarCanvas, trigger a 5k-node graph, observe long tasks. This is heavyweight for v1; defer unless benchmark test shows drift.
- **Per-frame synthetic measurement (recommended for Wave 3):** In the mocked Worker, time each `graphSimCore.tick()` call and report the distribution. Separately in the mocked rAF, time each render callback. Long-task equivalent = sum of synchronous callbacks per animation frame. Assert:
  - Max single-tick time <50 ms (likely <5 ms at 5k; forces are fast).
  - 95p rAF-callback time <2 ms.

**For production prod build perf verification (manual, Wave 3 acceptance):**

Run the Tauri build, open devtools Performance tab, record a 10-second settle. Assert:
- Zero red long-task bars on main thread.
- 60 Hz sustained on the rAF timeline.
- Worker thread timeline shows continuous ticks.

Document findings in `11-VERIFICATION.md`.

### Why this matters

D-31..D-34 are the phase's acceptance criteria in numbers. Without a harness, "it feels smooth" is the only judgment. The harness makes the phase's success claim falsifiable.

## Planner Guidance

### Wave Slicing

Given the new-files list (graphSimCore.ts, graphSim.worker.ts, graphSimConfig.ts, graphSimProtocol.ts, refactored useGraphLayout.ts + RadarCanvas.tsx hot path, tests), recommend **four waves with three plans**:

**Wave 0 — Scaffolding (Plan 11-01)**
- Create `src/workers/` directory.
- Add stubs for `graphSimCore.ts`, `graphSim.worker.ts`, `graphSimProtocol.ts`, `graphSimConfig.ts` (constants moved from `useGraphLayout.ts` but hook still imports them — allows worker and hook to coexist during refactor).
- Create `src/workers/__tests__/graphSimCore.test.ts` + `graphSimProtocol.test.ts` with `it.todo(...)` for each gap.
- Add CI grep assertion that `graphSimCore.ts` has no `self`/`postMessage`/`Worker` references.
- Verify: `npm run test` green (no new tests running yet; just compile check).
- Single task; ~30 min. Gate: existing `useGraphLayout.test.ts` still passes.

**Wave 1 — Pure Core (Plan 11-02)**
- Implement `graphSimCore.ts`: factory pattern, d3-force construction, `init`/`topology`/`updateConfig`/`pin`/`unpin`/`tick`/`dispose` methods, sequence counter, buffer pool.
- Implement `graphSimProtocol.ts`: discriminated-union types.
- Implement Wave 0 `graphSimCore.test.ts` todos:
  - init builds sim, first fast-settle ticks run synchronously.
  - tick() advances alpha, emits positions Float32Array via `onTick` callback.
  - tick() emits `settled` via `onSettled` when alpha ≤ alphaMin.
  - updateConfig alpha-restarts (alpha jumps to FORCE_CONFIG_ALPHA).
  - pin sets fx/fy on named node; unpin clears.
  - returnBuffer re-enters the pool.
  - Sequence counter bumps on init/topology; stale-return doesn't update state.
  - Detached-buffer handling: after `onTick` transfers via test callback (sim `{transfer}` with ArrayBuffer), byteLength is 0 until returnBuffer.
  - Backpressure: with only 2 buffers + no returns, worker uses spare then skips transfer.
- ~2-3 tasks; ~2 hrs. Gate: `graphSimCore.test.ts` all green.

**Wave 2 — Worker Shim + Hook Integration (Plan 11-03)**
- Implement `graphSim.worker.ts` shim (~50 LOC): postMessage router + transfer list.
- Refactor `src/hooks/useGraphLayout.ts`:
  - Remove d3-force construction, inline force updates, `sim.on('tick'/'end')` handlers.
  - Add Worker construction in `useEffect`, `onmessage` router, buffer pool management, sequence guard.
  - Reshape `simNodesRef` to `{ids, positions: Float32Array, idIndex}`.
  - Send `init` message with fast-settle flag on first graphNodes/graphEdges arrival.
  - Send `topology` message on rewarm threshold crossing.
  - Send `updateConfig` on forceConfig change.
  - Send `pin`/`unpin` on store actions (wire via subscription).
  - On `settled`: rebuild quadtree, call `commitSettledPositions`.
  - On `tick`: if seq ≥ topologySeq, update positions ref, mark dirty; if mod N==0 rebuild quadtree.
  - On cleanup: `postMessage('dispose')` + `worker.terminate()`.
- Refactor `src/hooks/__tests__/useGraphLayout.test.ts`: add Worker mock per Pattern 7; all 7 existing cases pass.
- ~3 tasks; ~3 hrs. Gate: useGraphLayout tests green; `npm run build` (Vite prod build) succeeds with worker chunk emitted.

**Wave 3 — Hot-Path Consumer + Perf Verification (Plan 11-04)**
- Refactor `RadarCanvas.tsx` lines ~543-557 per Pattern 5 / Example C.
- Create `src/workers/__tests__/graphSimBenchmark.test.ts` per §Performance Benchmark Harness.
- Manual Tauri prod build + devtools Performance verification (document in `11-VERIFICATION.md`).
- Visual-equivalence check: snapshot node positions from Phase 7 baseline vs Phase 11 output for a fixed-seed 100-node graph. Assert per-node Δ < 0.01 world-units.
- ~2-3 tasks; ~2 hrs. Gate: Zero long tasks observed in Tauri prod build + all test suites green + visual equivalence.

**Total: 3 plans (11-02 through 11-04) + 1 scaffolding plan (11-01) = 4 plans, ~8 hrs of work.**

### Task Ordering Rules

- **Inside Wave 1:** Implement `graphSimCore` methods in dependency order — `init` first (creates sim), then `tick`/`dispose`, then `updateConfig`/`pin`/`unpin`, then `topology`, then buffer pool.
- **Inside Wave 2:** Ship `graphSim.worker.ts` shim BEFORE refactoring `useGraphLayout.ts`. Verify worker loads via devtools before changing the hook.
- **Wave 3 last:** Visual equivalence checks depend on all earlier waves landing first.

### Decisions to Flag for User Confirmation Before Wave 1

Per Assumptions Log §"User decisions requiring confirmation":

1. Scheduling primitive: **`setTimeout(fn, 0)`** (recommended).
2. Spare-buffer allocation: **eager at init** (recommended).
3. `visibilitychange` pause: **skip for v1** (recommended).
4. Alpha on tick: **separate numeric field** (recommended).
5. `WorkerClient` class: **inline in `useGraphLayout`** (recommended).
6. Seeded `randomSource` for deterministic tests: **opt-in** (recommended; NOT in CONTEXT but bonus).

If the user wants to defer any, flag in the Plan and move on.

### Non-obvious Code Paths the Planner Must Not Miss

- `useGraphLayout.ts:107-108` — initial position seeding via `Math.random()`. Move INTO `graphSimCore` so worker + tests use the same (seedable) source.
- `useGraphLayout.ts:193-206` — `shouldRewarm` threshold logic. Stays on main; decides whether to send `topology`.
- `useGraphLayout.ts:230-254` — force-config update effect. Becomes a `postMessage('updateConfig')` side-effect.
- `useGraphLayout.ts:257-261` — cleanup effect. Becomes `worker.postMessage('dispose') + worker.terminate()`.
- `RadarCanvas.tsx:183` — `useGraphLayout()` call site. Return shape changes from `{quadtreeRef, simNodesRef: SimNode[], isSimulatingRef, markDirtyRef}` to `{quadtreeRef, simNodesRef: {ids, positions, idIndex}, isSimulatingRef, markDirtyRef}`. TypeScript will catch the mismatch.
- `RadarCanvas.tsx:549-557` — the hot path. Single hunk replacement per Example C.
- `radarStore.pinNode` / `unpinNode` — must also `postMessage('pin')`/`('unpin')` to worker. Wire via `useGraphLayout` subscription to `pinnedNodeIds` changes, OR intercept at the action level. Recommend the subscription approach to keep the store pure.

### Contradictions with CONTEXT.md

Research surfaced **two** CONTEXT items where the stated rationale is technically outdated, though the chosen decision remains correct:

1. **D-13 rationale ("`requestAnimationFrame` is not standard in `DedicatedWorkerGlobalScope`")** is outdated. rAF IS Baseline-available in worker global scopes since 2023 [MDN]. The correct rationale for choosing `setTimeout(0)` over rAF is: rAF gates to display vsync (≤60 Hz), preventing the worker from saturating a non-main core (contradicts D-14 "no fps cap"). Keep `setTimeout(0)`, update the rationale.

2. **D-08 implies main-side `indexOf` lookup**: "Main thread materializes a `Map<string, {x, y}>` lazily per frame for consumers that demand it (edges, arrow heads, hit-testing), using `indexOf` lookup via the cached `id → index` Map." This is fine — "indexOf lookup via Map" is `Map.get(id)`, O(1). Minor terminology issue only.

Neither contradiction changes the decision; both should be corrected in code comments / future CONTEXT updates.

## Project Constraints (from CLAUDE.md)

Extracted from `/home/prannayag/pragnition/htx/aitc/CLAUDE.md`:

- **Tech stack pinned:** Tauri v2 + React 19.2 + TypeScript. No switch. [OK — Phase 11 adds no deps.]
- **Performance constraint:** "File watchers must handle large codebases (10k+ files) without excessive CPU/memory." Extended by CONTEXT to main-thread UI responsiveness. [ALIGNED — phase success criterion.]
- **Agent integration extensibility:** irrelevant to Phase 11 (frontend-only).
- **Canvas 2D preference over WebGL:** aligned. Render stays on main Canvas 2D; worker does physics only.
- **Zustand per-domain discipline:** aligned. Worker does NOT import zustand (D-03); `radarStore` unchanged contract (D-28).
- **"Hot-path refs over store subscriptions":** aligned — D-25's `simNodesRef` is a ref, not a store field.
- **`tauri-specta` bindings regenerate on Rust command changes:** no impact; Phase 11 adds zero Rust commands.
- **GSD workflow enforcement:** all file edits happen via the GSD execute-phase flow. Research is the read-only step.

## Sources

### Primary (HIGH confidence)

- [d3-force simulation docs](https://d3js.org/d3-force/simulation) — `.stop()`, manual `.tick()`, `.on('tick'/'end')` firing only from internal timer, `simulation.randomSource()` + fixed-seed LCG default, `fx/fy` pinning semantics.
- [Vite Web Workers docs](https://vite.dev/guide/features.html#web-workers) — canonical `new Worker(new URL(...), { type: 'module' })` idiom, ESM imports compiled away in prod.
- [Vite Worker Options](https://vite.dev/config/worker-options) — `worker.format` default `'iife'`, `worker.plugins` config.
- [MDN Worker.postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage) — transfer list mechanics, detached buffer detection.
- [MDN DedicatedWorkerGlobalScope](https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope) — available scheduling primitives (setTimeout, queueMicrotask, Promise, requestAnimationFrame).
- [MDN DedicatedWorkerGlobalScope.requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope/requestAnimationFrame) — rAF in worker Baseline since 2023.
- [MDN PerformanceLongTaskTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming) — 50 ms threshold, `PerformanceObserver({type:'longtask'})` pattern.
- [MDN Content-Security-Policy/worker-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src) — `worker-src` falls back to `script-src` which falls back to `default-src`.
- [Tauri v2 Webview Versions](https://v2.tauri.app/reference/webview-versions/) — Windows WebView2 (Chromium), macOS WKWebView (Safari-equivalent), Linux WebKitGTK versions.
- `src/hooks/useGraphLayout.ts` — Phase 7 simulation owner (the code being moved).
- `src/views/Radar/forceCluster.ts` — shared force module (imported by worker).
- `src/views/Radar/RadarCanvas.tsx:543-557` — hot-path reader.
- `src/stores/radarStore.ts` — `commitSettledPositions`/`pinNode`/`unpinNode` contract.
- `src/hooks/__tests__/useGraphLayout.test.ts` — 7 existing test cases to preserve.
- `vite.config.ts`, `package.json`, `tsconfig.json`, `src-tauri/tauri.conf.json` — verified stack + CSP in working copy.
- `.planning/phases/11-move-d3-force-simulation-to-a-webworker-with-transferable-fl/11-CONTEXT.md` — all 34 locked decisions.
- `.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-RESEARCH.md` §Pattern 2 — forceCluster derivation + per-tick centroid cost.

### Secondary (MEDIUM confidence)

- [Transferable objects benchmark — Chrome Developer Blog](https://developer.chrome.com/blog/transferable-objects-lightning-fast) — 32 MB round-trip: 302 ms structured clone vs 6.6 ms transfer (45× speedup). Extrapolation to our 40–80 KB is the assumption in A2.
- [MDN Structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) — informs the `init` payload size estimate in A3.
- [caniuse.com/requestanimationframe](https://caniuse.com/requestanimationframe) — Window.rAF support across platforms; Baseline.
- [WebKit Bug 202525](https://bugs.webkit.org/show_bug.cgi?id=202525) — WebKit added DedicatedWorkerGlobalScope.requestAnimationFrame in March 2020.
- [@vitest/web-worker npm](https://www.npmjs.com/package/@vitest/web-worker) — confirms package exists but peer-deps on vitest 4.x, incompatible with our pinned 3.x. Justifies mock-Worker path per D-24.
- [Vite issue #18585 — IIFE + dynamic imports](https://github.com/vitejs/vite/issues/18585) — confirms static ESM imports in workers are fine with IIFE; dynamic imports are not.
- [Tauri v2 CSP docs](https://v2.tauri.app/security/csp/) — confirms Tauri's CSP is configurable and defaults are app-supplied.
- [d3-force issue #121 (determinism)](https://github.com/d3/d3-force/issues/121) — confirms `simulation.randomSource()` was added after v2.1 to address determinism; present in v3.

### Tertiary (LOW confidence — flagged for validation)

- [Tauri issue #9975](https://github.com/tauri-apps/tauri/issues/9975) — macOS worker 404 issue; status unclear. Flagged for Wave 3 prod-build smoke on macOS (if that platform is in scope; PLAT-01 is v2, so likely skip for v1).
- [Tauri discussion #9595](https://github.com/tauri-apps/tauri/discussions/9595) — Monaco worker issue; root cause was Monaco-specific, not Tauri. Included for context.
- [Neo4j medium article on d3 worker scaling](https://medium.com/neo4j/scale-up-your-d3-graph-visualisation-part-2-2726a57301ec) — ecosystem pattern reference; doesn't show Transferable Float32Array path (uses JSON round-trip).

## Security Domain

> `security_enforcement` is absent from config.json → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (desktop app, no remote auth) |
| V3 Session Management | no | — |
| V4 Access Control | no | — (single-user desktop) |
| V5 Input Validation | **yes** | Worker input validation: reject malformed `init`/`topology`/`pin` messages via discriminated-union `switch` (default branch logs error). Worker MUST NOT trust message shape — but the threat model is accidents, not attack, since the worker only communicates with our own main thread. |
| V6 Cryptography | no | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed Float32Array length (main→worker `returnBuffer` with wrong size) | Tampering | Worker validates `buf.byteLength === N*2*4` before re-wrapping; silently drops mismatched buffers + allocates replacement. |
| Worker receives stale sequence | Tampering (internal) | Handled by D-12 sequence guard. |
| Resource exhaustion via graph-size DoS | DoS | Same as Phase 7 — graph size is bounded by the gitignore-walked file list in Rust backend. No new surface. |
| Worker imports unvetted dependency | Supply chain | D-03 enforces imports allowlist (`d3-force`, `d3-quadtree`, `forceCluster.*`). Lint rule or grep assertion in CI. |
| Detached-buffer write (silent failure) | — (safety not security) | Pitfall 4 / Pattern 3 `byteLength === 0` check. |

No cryptography, no authentication, no network surface introduced. Security surface is entirely "main thread posts JSON + Float32Array to same-origin worker; worker posts Float32Array back."

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified via npm registry + current docs (Vite 8.0.8, d3-force 3.0.0, d3-quadtree 3.0.1).
- Architecture patterns: HIGH — d3-force manual-tick is documented; Transferable Float32Array is MDN-canonical; worker lifecycle under React 19 is standard.
- Tauri CSP compatibility: MEDIUM — `worker-src` falls back to `script-src` per CSP spec, and Tauri's default `'self'` is permissive enough, but Wave 3 smoke test is required (A1 risk).
- Determinism via `randomSource()`: HIGH — d3-force docs confirm.
- Performance benchmarks (40–80 KB transfer <1 ms): MEDIUM — extrapolation from 32 MB Chrome blog numbers; direct measurement deferred to Wave 3 harness.
- Pitfalls: HIGH — each pitfall cited to doc or upstream issue.

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days; stack is stable: Vite 8 released ~2025-Q3, Tauri v2 GA ~2024-Q4, d3-force v3 unchanged since 2020).
