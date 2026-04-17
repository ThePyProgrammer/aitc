# Phase 11: d3-force WebWorker Relocation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 11-CONTEXT.md — this log preserves the reasoning behind each auto-selected default.

**Date:** 2026-04-17
**Phase:** 11-move-d3-force-simulation-to-a-webworker-with-transferable-fl
**Mode:** `--auto` (no interactive questions; recommended defaults selected)
**Areas discussed:** Worker Architecture & Lifecycle, Transfer Protocol, Message Protocol, Tick Cadence & Backpressure, Quadtree Location, Continuous vs Settle Mode, Pinning & Drag, Testing Strategy, Main-Thread Integration, Shared Constants & Types

---

## Worker Architecture & Lifecycle (D-01..D-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Single long-lived worker | One dedicated worker owned by useGraphLayout; matches current simRef pattern | ✓ |
| Per-simulation worker | New worker on every topology rebuild; more isolation, more overhead | |
| Shared worker across views | Shared Worker visible to all tabs/iframes; overkill for single-view desktop app | |

**Auto-selected:** Single long-lived worker.
**Reasoning:** The existing `useGraphLayout.ts` already has a singleton-per-hook pattern via `simRef`. Relocating that singleton into a worker preserves the shape. Per-simulation workers add terminate/recreate cost. Shared Worker is irrelevant for Tauri (one window).

| Option | Selected |
|--------|----------|
| `new Worker(new URL(...), { type: 'module' })` via Vite 8 native bundling | ✓ |
| Dedicated Vite worker plugin with inline config | |
| Build worker separately as a standalone JS file | |

**Auto-selected:** Vite 8 native `new URL(...)` import.
**Reasoning:** Vite 8 + Rolldown handles this natively; no plugin, no config. Standalone builds break the TS type sharing story.

---

## Transfer Protocol (D-05..D-09)

| Option | Description | Selected |
|--------|-------------|----------|
| Transferable Float32Array, ping-pong 2 buffers | Zero-copy transfer; no cross-origin-isolation headers needed | ✓ |
| SharedArrayBuffer | Zero latency but requires COOP/COEP headers on every asset request | |
| Structured clone of `SimNode[]` | Current path; fails at 10k nodes | |

**Auto-selected:** Transferable Float32Array with ping-pong double buffering.
**Reasoning:** Phase title explicitly says "Transferable Float32Arrays" — this is a locked constraint from the roadmap, not an open question. SAB also breaks Vite dev server HMR (cross-origin-isolation kills the iframe). Transfer cost at 80 KB is ~0.01 ms — negligible.

| Option | Description | Selected |
|--------|-------------|----------|
| AoS `[x0, y0, x1, y1, ...]` | 2 floats/node; simple; cache-friendly for per-node reads | ✓ |
| SoA `[x0, x1, ..., y0, y1, ...]` | Better for vectorized math; not relevant for single-thread JS reads | |
| Include velocities `[x, y, vx, vy]` | 16 bytes/node; rendering doesn't need velocity | |

**Auto-selected:** AoS x,y pairs.
**Reasoning:** Renderer reads `{x, y}` per node. AoS matches the access pattern. Velocities stay inside the worker.

---

## Message Protocol (D-10..D-12)

| Option | Description | Selected |
|--------|-------------|----------|
| Discriminated union with `type` tag | TypeScript-friendly; exhaustive switch checking | ✓ |
| Command-name + payload (two args) | Stringly-typed; no compile-time safety | |
| RPC-style promise returns | Adds round-trip latency; force events don't need responses | |

**Auto-selected:** Discriminated-union message types.
**Reasoning:** Standard TS pattern. Preserves type safety across the postMessage boundary without extra libraries.

| Option | Description | Selected |
|--------|-------------|----------|
| Sequence numbers on every message | Drop stale ticks after topology rebuild | ✓ |
| Rely on message ordering | postMessage is ordered per-port; but a `topology` + subsequent ticks may straddle the main thread's rAF | |
| No ordering guard | Accepts occasional stale-tick flicker | |

**Auto-selected:** Sequence numbers.
**Reasoning:** Cheap (one uint32 per message), prevents a rare but visible bug where a stale tick from the old topology overwrites positions right after a rewarm.

---

## Tick Cadence & Backpressure (D-13..D-15)

| Option | Description | Selected |
|--------|-------------|----------|
| Manual `setTimeout(tickLoop, 0)` loop in worker | Portable; works in all worker globals | ✓ |
| `requestAnimationFrame` in worker | Non-standard in DedicatedWorkerGlobalScope; Firefox doesn't expose it | |
| Fixed `setInterval(16ms)` | Caps at 60Hz; defeats the point of moving to a dedicated thread | |

**Auto-selected:** Manual microtask tick loop.
**Reasoning:** `requestAnimationFrame` in workers is non-standard; Firefox in particular doesn't ship it. Manual loop is portable and lets the worker saturate a core during a settle.

| Option | Description | Selected |
|--------|-------------|----------|
| No fps cap; main rAF consumes latest | Simplest; intermediate ticks stay in worker's internal state | ✓ |
| Cap worker ticks at 60Hz | Wastes CPU headroom; doesn't help main | |
| Cap at render fps (measured) | Premature optimization | |

**Auto-selected:** No worker-side fps cap.
**Reasoning:** Worker on a separate core should run as fast as physics allows. Main's rAF-driven render reads whatever the latest transferred buffer is; stale ticks are silently dropped by the 3-buffer pool limit (D-09).

---

## Quadtree Hit-Testing Location (D-16..D-17)

| Option | Description | Selected |
|--------|-------------|----------|
| Build on main from Float32Array | ~1 ms at 5k nodes; no transfer needed | ✓ |
| Build in worker, ship flat kd-tree array | Requires designing a transferable tree format; complex | |
| Build in worker, ship object (non-transferable) | Structured-clone cost scales with node count; defeats the point | |

**Auto-selected:** Build quadtree on main thread.
**Reasoning:** 1 ms amortized across ~N ticks is cheap. d3-quadtree references aren't transferable. Avoiding new serialization formats keeps the phase focused.

---

## Continuous vs Settle-Then-Freeze Mode (D-18..D-19)

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve current continuous behavior | Matches Phase 7 `useGraphLayout.ts` as it stands today | ✓ |
| Revert to strict settle-then-freeze | Would break the live force-config slider UX | |
| Hybrid with explicit "live" / "frozen" modes | New UI surface; out of scope | |

**Auto-selected:** Preserve current continuous simulation.
**Reasoning:** Phase 7's D-03 originally proposed settle-then-freeze but the implementation evolved to continuous (see comments at top of `useGraphLayout.ts`). Phase 11 relocates code; it does not re-litigate lifecycle decisions.

---

## Pinning & Drag (D-20..D-21)

| Option | Description | Selected |
|--------|-------------|----------|
| Send pin/unpin on every pointer event | Natural ~60Hz throttle; simple | ✓ |
| Coalesce pin updates per rAF | Premature; no data showing message-queue overflow | |
| Send only on drag end | Breaks live feedback during drag | |

**Auto-selected:** Direct pin/unpin messages, no coalescing in v1.
**Reasoning:** pointermove events are already throttled by the browser. Add coalescing only if measurement shows a problem.

---

## Testing Strategy (D-22..D-24)

| Option | Description | Selected |
|--------|-------------|----------|
| Pure core module + thin worker shim | Sync unit tests, no Worker polyfill | ✓ |
| Real Worker in happy-dom for every test | Slow; polyfill quirks | |
| No worker-specific tests | Would regress the Phase 7 useGraphLayout coverage | |

**Auto-selected:** Extract `graphSimCore.ts` pure module; worker is a thin shim.
**Reasoning:** Testability trumps purity-of-structure. Phase 7 already has `useGraphLayout.test.ts` + `forceCluster.test.ts` patterns; extending them via `graphSimCore.test.ts` is the low-friction path.

---

## Main-Thread Integration (D-25..D-28)

| Option | Description | Selected |
|--------|-------------|----------|
| Refactor RadarCanvas hot path to index-based Float32Array reads | Preserves per-frame perf; small diff | ✓ |
| Wrap Float32Array in a `Map`-like adapter on main | Extra allocation per frame | |
| Push positions into Zustand and re-render | Re-render storm at 60Hz; unacceptable | |

**Auto-selected:** Ref-based Float32Array reads; materialize `Map` once per frame.
**Reasoning:** Current hot path uses `simPositionMap` built each frame from `simNodesRef`. Phase 11 keeps that shape but sources from the Float32Array + id-index instead of SimNode objects.

---

## Main-Thread Fallback (D-04)

| Option | Description | Selected |
|--------|-------------|----------|
| No fallback; log and degrade gracefully | Tauri v2 webviews all support workers; fallback is dead code | ✓ |
| Inline main-thread simulation on worker failure | Doubles maintenance surface | |
| Block the app and show error modal | User-hostile; workers always work in Tauri | |

**Auto-selected:** No fallback.
**Reasoning:** Webview2, WKWebView, and WebKitGTK all ship Worker. If construction fails, CSP is misconfigured — fix CSP, don't ship fallback code.

---

## Shared Constants & Types (D-29..D-30)

| Option | Description | Selected |
|--------|-------------|----------|
| Extract constants to `src/workers/graphSimConfig.ts` | Worker + tests import without React deps | ✓ |
| Keep constants in `useGraphLayout.ts` | Worker imports React-ful file | |
| Duplicate constants | Drift risk | |

**Auto-selected:** Extract to `graphSimConfig.ts`.
**Reasoning:** Clean separation; no React in worker-imported modules.

---

## Claude's Discretion

- Micro-scheduling inside worker (`setTimeout(0)` vs `queueMicrotask`)
- Eager vs lazy allocation of the spare 3rd buffer
- Whether to add `visibilitychange` pause
- Whether `returnBuffer` should batch per-rAF or send immediately
- Exact telemetry overlay design (if any)
- Module-extraction class shape (`WorkerClient` class vs inline in hook)

## Deferred Ideas

- SharedArrayBuffer path
- Quadtree-in-worker
- OffscreenCanvas worker (Phase 14)
- Topology diffs (full rebuild is current behavior)
- Multi-worker sharding for >10k nodes
- Drag message coalescing
- `visibilitychange` pause
- Dev-only diagnostic overlay
- Persisted pin positions
