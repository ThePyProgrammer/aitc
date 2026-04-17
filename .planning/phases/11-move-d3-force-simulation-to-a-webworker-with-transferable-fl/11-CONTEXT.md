# Phase 11: d3-force WebWorker Relocation - Context

**Gathered:** 2026-04-17
**Mode:** `--auto` (recommended defaults auto-selected; see DISCUSSION-LOG.md for per-question log)
**Status:** Ready for planning

<domain>
## Phase Boundary

Relocate the existing d3-force simulation from the React main thread (currently living in `src/hooks/useGraphLayout.ts`, owning `forceSimulation<SimNode, SimEdge>` + `forceCluster` + `forceClusterCollide`) into a dedicated WebWorker. Positions flow back to the main thread every tick as a **Transferable `Float32Array`**. The RadarCanvas rAF render loop reads node positions from that typed array instead of from `simNodesRef.current`, eliminating main-thread jank during force settles and live force-config slider drags on 5k–10k node graphs.

This is a **relocation refactor**, not a visual change. No new user-visible features. The simulation's physics, tuning constants, re-warm thresholds, continuous-tick behavior, force-config slider semantics, and pin/unpin drag behavior from Phase 7 (D-01..D-26) carry over unchanged — only their execution context moves. Success = identical visual output with `PerformanceObserver` showing zero long tasks (>50ms) on the main thread during settles.

Out of scope: changing the force algorithm, adding new forces, changing tuning constants, moving dependency-graph parsing (already in Rust per Phase 7 D-05), moving the quadtree hit-testing into the worker, moving edge/hull rendering into the worker, or moving rendering itself to OffscreenCanvas (that is Phase 14's scope).

Requirements: no new requirement IDs; this is a performance-quality rewrite of the Phase 7 infrastructure backing VIZN-01 / VIZN-04. Addresses the implicit "main thread stays responsive" guarantee from `CLAUDE.md §Performance` ("File watchers must handle large codebases (10k+ files) without excessive CPU/memory" — extended in spirit to the UI thread).

</domain>

<decisions>
## Implementation Decisions

### Worker Architecture & Lifecycle
- **D-01:** Single long-lived dedicated Worker (`type: 'module'`) owned by `useGraphLayout`. Created on first `init` call, terminated on hook unmount. Mirrors the existing `simRef.current` ownership pattern — the worker is simply the new home for the d3-force instance.
- **D-02:** Worker lives at `src/workers/graphSim.worker.ts`, loaded via the Vite idiom `new Worker(new URL('../workers/graphSim.worker.ts', import.meta.url), { type: 'module' })`. No Vite plugin needed (native Vite 8 + Rolldown support); the worker is auto-bundled as a separate chunk.
- **D-03:** Worker imports ONLY `d3-force`, `d3-quadtree` (if used inside), and the shared `forceCluster` / `forceClusterCollide` modules. It does NOT import `zustand`, `@tauri-apps/api`, `react`, or `../bindings`. Enforced via a lint rule or directory convention (planner picks).
- **D-04:** Worker construction failure (unlikely on Tauri v2 webviews, but possible under CSP tightening) falls through to **no fallback**: log `console.error` + `tracing::error!` equivalent via bindings, leave `simNodesRef`/positions buffer empty. Radar renders nodes at random init positions — degraded but not crashed. Revisit if a target platform rejects workers; today none do.

### Transfer Protocol — Transferable Float32Array (explicitly NOT SharedArrayBuffer)
- **D-05:** Positions flow as `Float32Array` laid out AoS: `[x0, y0, x1, y1, ...]` = 2 floats per node (8 bytes/node; 5k nodes = 40 KB; 10k nodes = 80 KB). Velocity and alpha stay inside the worker — rendering only needs `x`, `y`.
- **D-06:** **Ping-pong double-buffering** using two pre-allocated `Float32Array(N*2)` instances, each wrapping an `ArrayBuffer`. Worker transfers the freshly-written buffer to main each tick (zero-copy); main transfers the previous buffer back when render finishes.
- **D-07:** Explicitly **NOT SharedArrayBuffer**. Reasons: (a) requires cross-origin-isolation (COOP `same-origin` + COEP `require-corp`), which would force headers on all Tauri asset requests and break the dev server's HMR iframe; (b) the phase title binds us to Transferable; (c) Transferable 40–80 KB transfers are ~0.01ms — not the bottleneck.
- **D-08:** Node `id ↔ array-index` mapping is established by the `init` message (ordered `string[]` of node ids). Both sides cache the map. Rebuilt on every `topology` message. Main thread materializes a `Map<string, {x, y}>` lazily per frame for consumers that demand it (edges, arrow heads, hit-testing), using `indexOf` lookup via the cached `id → index` Map.
- **D-09:** When main is slow to return a buffer (stalled render, devtools paused, etc.), worker allocates a **spare (3rd) Float32Array** once and keeps simulating. If BOTH main-owned buffers are still outstanding at tick time, worker skips that tick's transfer (physics continues internally); the next available transfer carries the freshest positions. Cap total allocations at 3 buffers to bound memory.

### Message Protocol
- **D-10:** Main → Worker messages (discriminated-union `type` tag):
  - `init`: `{ type: 'init', nodes: {id, dirKey, dirDepth, fx?: number|null, fy?: number|null}[], edges: {source, target, kind}[], config: ForceConfig, alpha: number, fastSettle: boolean }` — establishes full topology + initial alpha.
  - `topology`: same shape as `init` minus `alpha`/`fastSettle` — full rebuild on rewarm (matches current `buildSimulation(fastSettle=true)`).
  - `updateConfig`: `{ type: 'updateConfig', config: ForceConfig }` — alpha-restart at `FORCE_CONFIG_ALPHA = 0.35`.
  - `pin`: `{ type: 'pin', id: string, x: number, y: number }` — sets `node.fx/fy`.
  - `unpin`: `{ type: 'unpin', id: string }` — clears `node.fx/fy`.
  - `returnBuffer`: `{ type: 'returnBuffer', buffer: ArrayBuffer }` — main transfers an empty buffer back to worker after rendering.
  - `dispose`: `{ type: 'dispose' }` — stop sim + prepare for terminate.
- **D-11:** Worker → Main messages:
  - `tick`: `{ type: 'tick', positions: Float32Array, alpha: number, sequence: number }` — transferred zero-copy.
  - `settled`: `{ type: 'settled', positions: Float32Array, alpha: number, sequence: number }` — alpha crossed `alphaMin`, sim paused. Rebuilds quadtree on main.
  - `error`: `{ type: 'error', message: string, stack?: string }` — for observability only.
- **D-12:** **Sequence-number-guarded** tick messages. Each `init` / `topology` bumps a `sequence` counter. Worker tags every outbound message with the current sequence. Main drops any message whose sequence is older than the last acknowledged topology — prevents stale ticks from a just-superseded graph from overwriting positions for the new graph.

### Tick Cadence & Backpressure
- **D-13:** Worker drives `sim.tick()` manually in a `setTimeout(tickLoop, 0)` microtask loop while `sim.alpha() > sim.alphaMin()`. Rationale: `requestAnimationFrame` is not standard in `DedicatedWorkerGlobalScope` (Chrome/WebKit expose it non-standardly; Firefox doesn't). Manual loop is portable and predictable.
- **D-14:** **No artificial worker-side fps cap.** Let d3-force tick as fast as CPU allows; the whole point of the worker is to saturate a non-main core. Main thread's rAF-driven render consumes the latest buffer; intermediate ticks simply update the worker's internal state without transferring (per D-09's in-flight cap).
- **D-15:** Worker **pauses** ticking when `alpha <= alphaMin` (mirrors current `d3-force .on('end')` behavior). Resumes on `topology`, `updateConfig`, or `rewarm`. During pause: the last transferred buffer remains valid on main; RadarCanvas `isSimulatingRef` becomes false; edges + agent dots keep rendering from the final positions via the per-frame map.

### Quadtree (Hit-Testing) Location
- **D-16:** Quadtree is **rebuilt on the main thread** from the transferred `Float32Array` + cached `ids` list. Rebuild triggers:
  - On every `settled` message (primary trigger — matches current end-of-sim rebuild).
  - Every N ticks while simulating (N = 10 tick messages = ~167ms at 60fps; tunable) so hover hit-testing doesn't feel frozen during long settles.
- **D-17:** `d3-quadtree` is NOT transferred. Its reference graph is non-transferable and rebuilding on main from 5k points is ~1ms — cheaper than serializing + shipping.

### Continuous-tick vs Settle-then-Freeze Mode
- **D-18:** Preserve current `useGraphLayout.ts` behavior unchanged: continuous sim with `alpha` cooling to zero, then pause; alpha-restart on `updateConfig` / `topology` / user-drag; fast-settle on `init`. Phase 11 relocates this lifecycle; Phase 7 D-03 "settle-then-freeze" already evolved to continuous in useGraphLayout.ts and is the current reality.
- **D-19:** **Initial fast-settle** (current `fastSettle: true` path) runs INSIDE the worker: before emitting the first `tick`, worker synchronously runs up to `MAX_TICKS = 500` tick iterations or until `alpha < alphaMin`. First `tick` message carries already-settled positions so first paint shows a stable graph, not chaos.

### Pinning & Drag Interaction
- **D-20:** Pin/unpin are discrete events, sent as they occur — no coalescing. Live-drag (user dragging a pinned node) fires a `pin(id, x, y)` on every `pointermove` event (~60Hz natural rate). v1 ships without message coalescing; planner to benchmark — if message queue depth grows during drag, add a rAF-aligned coalescer.
- **D-21:** Pinned nodes continue to participate in the simulation (d3-force honors `fx/fy` as fixed constraints, still computes collisions/links against them). The `pinnedNodeIds` Set in `radarStore` stays on main (UI-only concern — worker doesn't need to know pinned identity, only the `fx/fy` values).

### Testing Strategy
- **D-22:** Simulation lifecycle extracted into a **pure core module** `src/workers/graphSimCore.ts`:
  - Exports a factory returning `{ init, updateConfig, pin, unpin, tick, getPositions, dispose }`.
  - Has no references to `self`, `postMessage`, `Worker`, or DOM globals.
  - Takes callback `onTick({positions, alpha, sequence})` + `onSettled(...)` instead of posting.
  - Drives `sim.tick()` itself (no internal timers) — tests call `tick()` deterministically.
- **D-23:** The `graphSim.worker.ts` file is a thin (~50-line) shim: imports `graphSimCore`, wires `postMessage` / `onmessage` to the core's API, manages the ping-pong buffer pool. Worker shim has minimal testable logic.
- **D-24:** Unit tests target `graphSimCore` synchronously under Vitest + jsdom. Existing `useGraphLayout.test.ts` (7 cases) refactors to mock the Worker constructor with a synchronous `graphSimCore` instance driven inline — preserves the test shape without needing a real Worker polyfill. A single smoke test may instantiate a real `Worker` in happy-dom if the refactor cost is low; otherwise skip.

### Main-Thread Integration Refactor
- **D-25:** `simNodesRef` in `useGraphLayout` changes shape from `SimNode[]` to `{ ids: string[]; positions: Float32Array; idIndex: Map<string, number> }`. RadarCanvas's hot path (rAF render loop, line ~549 of `RadarCanvas.tsx`) changes from iterating `simNodesRef.current` to reading positions via `idIndex.get(id)` → Float32Array offset.
- **D-26:** `livePositions` Map materialization in `RadarCanvas.tsx` (~line 551–557): build it once per render by iterating `ids` and reading from the Float32Array. Cheap (5k entries ≈ 0.1ms). No change to `drawEdges` / `drawArrowHeads` / `drawNodes` signatures — they keep consuming `Map<string, {x, y}>`.
- **D-27:** `isSimulatingRef.current` is set from the worker lifecycle: true from `init` / `topology` / `updateConfig` until the next `settled` message; false after. Exposed to RadarCanvas exactly as today.
- **D-28:** `commitSettledPositions()` in `radarStore` still fires on `settled` so `graphNodes` stay in sync for non-hot-path consumers (minimap, pin overlay, RadarMinimap, persistence). Build the `Map<string, {x, y}>` from the Float32Array + `ids` in the `settled` handler.

### Shared Constants & Types
- **D-29:** Phase 7 tuning constants (`LINK_DISTANCE`, `LINK_STRENGTH`, `CHARGE_STRENGTH`, `CHARGE_THETA`, `CHARGE_DISTANCE_MAX`, `CENTER_STRENGTH`, `COLLIDE_RADIUS`, `ALPHA_DECAY`, `VELOCITY_DECAY`, `MAX_TICKS`, `REWARM_*`, `FORCE_CONFIG_ALPHA`) move from `useGraphLayout.ts` into a shared module `src/workers/graphSimConfig.ts` importable by both the worker and tests without pulling in React.
- **D-30:** `forceCluster.ts` / `forceClusterCollide.ts` already have no DOM dependencies — import from the worker unchanged. Keep their current location under `src/views/Radar/` to avoid gratuitous moves (planner may optionally relocate to `src/workers/forces/` for cleanliness — Claude's discretion).

### Performance Targets (carry from Phase 7 D-23)
- **D-31:** **Main-thread long-task budget: zero `>50ms` long tasks** during a settle on a 5k-node graph, measured via `PerformanceObserver({ type: 'longtask' })`. This is the phase's acceptance criterion in numbers.
- **D-32:** Main-thread per-frame cost (render + message handling + Float32Array → Map materialization) stays under **2ms** on a 5k-node graph during active simulation. Measured via `performance.now()` bracketing the rAF callback.
- **D-33:** Worker tick rate: **≥30 effective ticks/sec at 5k nodes**, **≥10 ticks/sec at 10k nodes** on the dev Windows box. "Effective" = ticks that resulted in a transfer to main.
- **D-34:** Message-queue back-pressure: worker's outstanding-transfer count stays ≤2 under steady state; no unbounded buffer allocation.

### Claude's Discretion
- Exact `setTimeout(tickLoop, 0)` vs `queueMicrotask` vs `Promise.resolve().then()` micro-scheduling inside the worker — pick what profiles best without blocking the event loop.
- Whether to ship the "spare 3rd buffer" eagerly (allocated at init) or lazily (on first backpressure event).
- Sequence-number overflow handling (uint32 wraps at ~4.3B ticks, i.e. centuries; no-op for v1).
- Whether `visibilitychange` / `window.hidden` should pause the worker's tick loop (probably yes; Claude decides whether to ship in v1).
- How to log worker error messages into the existing `tracing` pipeline (likely: worker `postMessage` an `error`, main proxies to a future diagnostics channel — for now, `console.error` is fine).
- Whether the `returnBuffer` message should be batched per-rAF or sent immediately (ping-pong implies immediate; benchmark first).
- Alpha-on-tick buffer tail (carrying `alpha` as a 32-bit float appended to the array) vs separate numeric field in the message payload (likely: separate field; structured-clone cost for one number is ~0).
- Whether to extract a `WorkerClient` class to wrap the postMessage protocol or inline in `useGraphLayout`. Either is fine; the hook-sized shape stays similar.
- Worker-side vs main-side ownership of the `ids` array (both need it; canonical answer: worker generates on init from the topology message, main caches a copy for lookups — O(n) memory on both sides is cheap).
- Whether `topology` messages should include only a diff for large graphs (v1 = full rebuild to match current rewarm behavior; Phase 11 doesn't add diffing).
- Telemetry/metrics: add a dev-only diagnostic overlay showing `ticksPerSec`, `transferLag`, `longTaskCount`? Claude may propose but should not implement in v1.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 11" — Phase scope statement ("Move d3-force simulation to a WebWorker with Transferable Float32Arrays for non-blocking layout computation")
- `.planning/REQUIREMENTS.md` — `VIZN-04` (Radar renders performantly via Canvas 2D for 10k+ files) — Phase 11 is the implementation of "performantly" for the force-directed layout era
- `.planning/PROJECT.md` §"Constraints" — 10k+ files target, Tauri v2 + React + TS stack

### Phase 7 (the code being relocated)
- `.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-CONTEXT.md` — D-01..D-24: all force-directed graph decisions; D-23 is the 5k/10k perf budget that Phase 11 must preserve while improving main-thread responsiveness
- `.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-RESEARCH.md` §Pattern 2 — Custom `forceCluster` derivation and per-tick centroid recompute cost analysis
- `.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-03-PLAN.md` + `07-03-SUMMARY.md` — `useGraphLayout` settle-then-freeze, `radarStore.fetchGraph`, `commitSettledPositions` wiring
- `.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-04-PLAN.md` + `07-04-SUMMARY.md` — GraphRenderer pure functions + RadarCanvas rewrite: positions-Map consumer contract Phase 11 must preserve

### Design System (visual invariance — Phase 11 changes nothing visible)
- `wireframes/vector_terminal/DESIGN.md` — Command Horizon design system. Phase 11 must produce pixel-equivalent output; any drift is a bug.

### Tech Stack
- `CLAUDE.md` §"Data Visualization" — Canvas 2D + visx math; WebGL explicitly rejected; Worker offloading is in-scope for main-thread protection
- `CLAUDE.md` §"Build tool" — Vite 8 + Rolldown supports `new Worker(new URL(...), { type: 'module' })` natively; no plugin needed
- `CLAUDE.md` — React 19.2 concurrent features (useTransition, Suspense) are orthogonal to Phase 11; no React-level changes

### Existing Frontend Code (to modify)
- `src/hooks/useGraphLayout.ts` — **primary rewrite target**; all d3-force orchestration relocates into worker, hook becomes a WorkerClient adapter that preserves the `UseGraphLayoutResult` interface (quadtreeRef, simNodesRef-equivalent, isSimulatingRef, markDirtyRef)
- `src/hooks/__tests__/useGraphLayout.test.ts` — 7 existing cases; refactor to mock Worker with synchronous graphSimCore
- `src/views/Radar/forceCluster.ts` — shared force module; no API change, imported by worker
- `src/views/Radar/__tests__/forceCluster.test.ts` — existing tests; unchanged
- `src/views/Radar/RadarCanvas.tsx` — hot-path reader at line ~549; refactor to consume `{ ids, positions: Float32Array, idIndex }` instead of `SimNode[]`; `livePositions` Map materialization at ~line 551 adapts to index-based reads
- `src/views/Radar/GraphRenderer.ts` — `drawEdges` / `drawArrowHeads` / `drawNodes` signatures unchanged; consume `Map<string, {x,y}>` as today
- `src/stores/radarStore.ts` — `commitSettledPositions` contract unchanged; keep `graphNodes`, `pinnedNodeIds`, `fx/fy` store slots for non-hot consumers (minimap, persistence)
- `src/views/Radar/RadarMinimap.tsx` — reads positions from `radarStore.graphNodes`; unchanged (settled-only consumer)
- `src/views/Radar/HeatMapOverlay.ts` / `CometTrail.ts` / `drawConflictPulses` — all consume `Map<string, {x,y}>`; unchanged

### Files to Create
- `src/workers/graphSim.worker.ts` — Worker shim (postMessage router + buffer pool)
- `src/workers/graphSimCore.ts` — Pure d3-force orchestration module (testable without Worker)
- `src/workers/graphSimConfig.ts` — Shared tuning constants (extracted from `useGraphLayout.ts`)
- `src/workers/graphSimProtocol.ts` — Discriminated-union message types (`WorkerIn` / `WorkerOut`)
- `src/workers/__tests__/graphSimCore.test.ts` — unit tests for the pure core

### Phase Context (prior decisions that constrain this phase)
- `.planning/phases/01-foundation-app-shell/01-CONTEXT.md` — Vite + Tauri v2 build toolchain; Worker bundling works out of the box in Vite 8
- `.planning/phases/02-real-time-data-pipeline/02-CONTEXT.md` — `Channel<T>` IPC on Rust side; irrelevant to Phase 11 (which is frontend-only) but establishes the batched-transfer idiom
- `.planning/phases/04-core-ui-views/04-CONTEXT.md` — Radar D-11 (zoom/pan) carries over; Radar D-12 (manifest panel) carries over
- `.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-CONTEXT.md` — Every D-01..D-26 carries over unchanged; Phase 11 implements D-23 perf target via worker relocation

### Related Future Phases (do NOT implement here)
- Phase 14 (multi-layer offscreen canvas) — will be easier to build on top of a worker-hosted simulation but must not be anticipated here; keep the render loop on main in Phase 11
- Phase 16 (typed edges + temporal coupling) — adds new edge kinds; protocol in D-10 is `kind: string` so new kinds flow through without protocol changes

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/hooks/useGraphLayout.ts` — The entire d3-force orchestration to relocate. Tuning constants, simulation build, rewarm detection, force-config alpha-restart, pin/unpin behavior all already exist and must be preserved.
- `src/views/Radar/forceCluster.ts` + `forceClusterCollide` — Pure force modules; no DOM deps; import directly from the worker.
- `src/stores/radarStore.ts` — `commitSettledPositions`, `pinNode`, `unpinNode`, `settledAt`, `pinnedNodeIds`, `forceConfig` slots — reusable; only the on-main-thread sim pointer goes away.
- `src/views/Radar/RadarCanvas.tsx` — Render loop scaffolding (rAF, HiDPI, ResizeObserver, dirty flag) unchanged; only the positions-read path changes.
- `useCanvasZoomPan` — viewport + screen↔world transforms; unchanged.
- `d3-quadtree` import — unchanged; rebuild location moves from `useGraphLayout` tick/end handlers to the `tick`/`settled` message handlers on main.
- Vite 8 `new Worker(new URL(...), { type: 'module' })` bundling — native, no plugin required.
- Vitest + jsdom environment — already configured; `graphSimCore` tests slot in alongside existing `forceCluster.test.ts` / `useGraphLayout.test.ts`.

### Established Patterns
- One Zustand store per domain — `radarStore` keeps its shape; the worker does not touch stores directly (main-thread hook proxies messages).
- Hot-path refs over store subscriptions — Phase 7 established that `simNodesRef` is read at 60fps without going through Zustand. Phase 11 preserves that shape: the positions Float32Array is ref-exposed, not store-exposed.
- Pure-function rendering — `drawEdges`, `drawNodes`, `drawArrowHeads`, `drawFolderHulls` take plain data; unchanged.
- Test co-location — `__tests__/` folders next to modules.
- Repo-relative paths as node ids — carries over into the worker protocol (`nodes[i].id`).
- Tuning constants exported for tests — Phase 7 established this pattern in `useGraphLayout.ts` and `forceCluster.ts`; `graphSimConfig.ts` continues it.

### Integration Points
- `src/hooks/useGraphLayout.ts` — Becomes a Worker lifecycle + message-protocol adapter; public API (return type) stays compatible so `RadarCanvas` consumer rewrite is minimal.
- `src/views/Radar/RadarCanvas.tsx` — Hot-path read (around line 549): swap `simNodesRef.current as typeof s.graphNodes` and `simPositionMap` build loop for Float32Array-indexed reads.
- `src/stores/radarStore.ts` — `commitSettledPositions` still called; now by the `settled` message handler in `useGraphLayout`.
- `src/workers/` — New directory for worker + core + protocol + config.
- `vite.config.ts` — No change required; Vite 8 handles `new URL(...)` worker imports out of the box.
- `tsconfig.json` / types — `lib: ["WebWorker", ...]` may need adding for worker-side type declarations (planner to verify; today the codebase uses the default `lib: ["DOM"]`).
- No change to Rust side, no change to `bindings.ts`, no change to any `#[tauri::command]`, no DB migration.

</code_context>

<specifics>
## Specific Ideas

- The ATC metaphor is literal here: the main thread is the tower radar screen, and the worker is the separate comp running the physics. The tower should stay responsive even when the physics is chewing a 10k-node graph. If a user drags a force slider and the UI hitches for 200ms, the phase has failed.
- The "Transferable Float32Array" phrasing in the roadmap title is a constraint, not a hint. No SharedArrayBuffer, no JSON round-trip, no structured clone of `SimNode[]`. Zero-copy or zero phase.
- Render output must be pixel-equivalent with Phase 7. If screenshots diverge, the worker relocation introduced behavior (probably via floating-point ordering differences in a non-deterministic force ordering) — fix the determinism, don't accept the drift.
- "The worker is the simulation; main is the view" — this is the mental model. Anyone reading `useGraphLayout.ts` post-refactor should immediately see that main-thread code does no physics.

</specifics>

<deferred>
## Deferred Ideas

- **SharedArrayBuffer path** — if per-frame transfer overhead ever shows up in profiling (unlikely at 40–80 KB), revisit COOP/COEP cost vs transfer cost. Today: not worth the config hazard.
- **Quadtree-in-worker** — if hit-testing feels stale under heavy settle, move the quadtree into the worker and ship a flat kd-tree array back. Deferred until profiling shows quadtree rebuild (~1ms at 5k) as a bottleneck.
- **OffscreenCanvas rendering in a 2nd worker** — explicitly Phase 14's scope; Phase 11 keeps render on main.
- **Graph-topology diffs** — Phase 11 does full rebuild on rewarm (matches current). If rewarm frequency + graph size ever crosses a pain threshold, add diff messages (`addNodes`, `removeNodes`, `addEdges`, `removeEdges`). Not needed for v1.
- **Multi-worker sharding for >10k nodes** — spatial partitioning + stitching at boundary. Interesting but premature; 10k is the current ceiling per Phase 7 D-23.
- **Worker pool for parallel pipelines** — dependency-graph parsing is already in Rust (Phase 7 D-05); no frontend worker pool needed.
- **Drag-message coalescing** — if drag event rate grows (precision trackpads can fire at 120Hz+), coalesce `pin` messages per rAF. Measure first.
- **`visibilitychange` pause** — pause worker ticks when window is hidden. Claude's discretion for v1.
- **Dev-only worker diagnostics overlay** — ticks/sec, transfer lag, long-task count. Nice-to-have for future profiling; not a phase deliverable.
- **Persisted pin positions across app restarts** — still deferred from Phase 7; worker relocation doesn't change the story.

</deferred>

---

*Phase: 11-move-d3-force-simulation-to-a-webworker-with-transferable-fl*
*Context gathered: 2026-04-17*
*Auto-selected defaults; see 11-DISCUSSION-LOG.md for per-question reasoning.*
