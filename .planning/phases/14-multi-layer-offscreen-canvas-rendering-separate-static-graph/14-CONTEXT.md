# Phase 14: Multi-layer offscreen canvas rendering - Context

**Gathered:** 2026-05-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement multi-layer cached rendering for the Radar view. The phase separates expensive static graph rendering from live animated overlays: static graph work is cached into offscreen or in-memory canvas buffers, then composited each frame while agent trails, agent dots, pulses, and other live overlays continue to redraw at animation cadence.

This is a render-layer performance/composition phase. It does not change graph physics, semantic zoom behavior, bridge extraction, agent tracking, conflict semantics, minimap behavior, code-preview product behavior, or Phase 15's future enhanced ATC overlay scope.

</domain>

<decisions>
## Implementation Decisions

### Layer Split
- **D-01:** The exact cached-static contents are Claude discretion, but the required boundary is clear: static graph rendering must be separated from live agent/trail animation. Agents, trails, and pulse animations must not be baked into the static cache.
- **D-02:** The product mental model should remain “cached static graph + live animated agent layer.” Claude may use multiple internal offscreen buffers if that improves correctness, performance, or testability, but Phase 14 should not add user-facing layer controls.
- **D-03:** Preserve Phase 13 code-preview behavior. `CodePreviewOverlay` may remain a DOM overlay above the canvas unless planning finds a safer equivalent; do not turn Phase 14 into a code-card UI rewrite.
- **D-04:** Hover, selection, bridge-selection, and conflict badge placement are Claude discretion, but interaction must remain instant and must not force unnecessary static-cache rebuilds.

### Invalidation
- **D-05:** The cache-key contract is Claude discretion, but cache invalidation should prioritize navigation smoothness over perfect raster crispness during active pan/zoom.
- **D-06:** During active graph simulation, bypass static caches for position-dependent graph content. Build or refresh caches after the graph settles (`settledAt`/worker idle path), because worker positions change every tick.
- **D-07:** Reusing a last-good cached static raster during active pan/zoom is allowed if it avoids jank. Rebuild after meaningful structural/semantic changes or after movement settles rather than doing expensive work on every wheel event.
- **D-08:** Exact rebuild scheduling is Claude discretion. Avoid one expensive synchronous rebuild inside the hot 60fps branch if a scheduled/dirty-cache approach can keep frames smooth.

### API Fallback
- **D-09:** Use progressive enhancement: prefer `OffscreenCanvas` when available, but provide a regular in-memory/hidden canvas fallback behind the same layer abstraction. Tauri/WebView support variation must not break the Radar.
- **D-10:** Worker-based rendering is Claude discretion. Phase 11 already moved graph physics into a worker; Phase 14 should only add worker rendering if research/planning shows it is low-risk and does not widen the phase into a second worker-protocol rewrite.
- **D-11:** Test strategy for OffscreenCanvas absence is Claude discretion, but downstream planning must account for environments where Vitest/jsdom or a WebView lacks real `OffscreenCanvas` support.

### Layer Ownership
- **D-12:** File/module ownership is Claude discretion. Prefer maintainability over cramming more lifecycle into `RadarCanvas.tsx`, which is already the orchestration hotspot.
- **D-13:** Refactor depth is Claude discretion. Wrapping existing pure draw functions is preferred unless a targeted split is necessary; avoid broad renderer rewrites that would risk Phase 13/22 regressions.
- **D-14:** Developer diagnostics are Claude discretion. Reusing the existing `localStorage.radarPerfDebug = '1'` path for cache hit/miss/rebuild timing is allowed and likely useful, but no user-facing debug HUD is required.

### Claude's Discretion
- Exact static/live pass split beyond the hard boundary that agents/trails remain live.
- Whether static cache is one composite buffer or several internal buffers.
- Whether `CodePreviewOverlay` stays DOM-only or gets any motion-aware treatment, as long as Phase 13 behavior remains intact.
- Exact cache keys, cache dirty flags, and rebuild scheduling.
- Whether OffscreenCanvas rendering stays on the main thread or uses a Worker after research.
- Exact module/file split for a layer manager and tests.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap and product scope
- `.planning/ROADMAP.md` — Phase 14 entry is the authoritative scope: “Multi-layer offscreen canvas rendering — separate static graph (hulls, edges, nodes) from animated agent layer (trails, dots, pulses). Cache layers 1-5 to offscreen canvases, composite per frame. Only the agent layer (6) and DOM overlay (7) redraw at 60fps.”
- `.planning/PROJECT.md` — Core constraints: Command Horizon design system, Canvas 2D radar, Tauri + React + TypeScript stack, and 10k+ file performance expectations.
- `.planning/REQUIREMENTS.md` — Visualization requirements `VIZN-01`, `VIZN-04`, and `VIZN-05` remain the relevant product requirements.

### Upstream radar decisions to preserve
- `.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md` — Semantic zoom bands, crossfade behavior, package blobs, bridge visibility across levels, code-preview behavior, and overlay priority.
- `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-CONTEXT.md` — Bridge diamonds, boundary line, boundary labels, bridge z-order, and bridge interaction expectations.
- `.planning/phases/11.1-fix-zoom-scroll-lag-in-radarcanvas-wheel-event-raf-coalescin/11.1-CONTEXT.md` — Wheel smoothness, hull-cache discipline, viewport writeback, and `radarPerfDebug` diagnostic precedent.
- `.planning/phases/11-move-d3-force-simulation-to-a-webworker-with-transferable-fl/11-CONTEXT.md` — Worker-hosted graph simulation and Float32Array hot path. Phase 14 must not move physics back onto the main thread.

### Existing frontend code
- `src/views/Radar/RadarCanvas.tsx` — Main render-loop orchestration and likely integration point. Current single-canvas pass draws boundary, package blobs, file graph, bridges, selected node, comet trails, agent dots, conflict pulses/badges, and DOM overlays.
- `src/views/Radar/GraphRenderer.ts` — Pure static graph draw functions: folder labels, edges, arrows, nodes, file labels, selection halo.
- `src/views/Radar/PackageBlobRenderer.ts` — Package blob drawing and hit-testing introduced by semantic zoom.
- `src/views/Radar/BridgeRenderer.ts` — Boundary line, bridge diamonds, bridge labels, and screen-space boundary labels.
- `src/views/Radar/CometTrail.ts` — Live animated comet trails and agent dots; must remain live-layer work.
- `src/views/Radar/CodePreviewOverlay.tsx` — DOM overlay for code-level cards; preserve behavior.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `RadarCanvas` already has a clear draw sequence and dirty-flag rAF loop; Phase 14 can split this sequence into cached static composition and live overlay composition.
- `GraphRenderer`, `PackageBlobRenderer`, `BridgeRenderer`, and `CometTrail` expose pure draw functions that can be reused by a layer manager without changing their rendering semantics first.
- `resolveSemanticZoom` and semantic opacity values already centralize representation bands; cache invalidation can key off semantic level/band rather than inventing a second zoom taxonomy.
- `settledAt`, `isSimulatingRef`, and `simNodesRef` already distinguish worker-active positions from settled store positions; this is the natural cache-bypass boundary.
- `localStorage.radarPerfDebug = '1'` already gates render timing logs and can be extended for cache diagnostics if useful.

### Established Patterns
- Canvas draw functions are pure and data-driven; orchestration lives in `RadarCanvas` today.
- Worker simulation owns graph layout; renderer reads live positions during simulation and store positions when idle.
- Bridges and file nodes are already filtered into separate render subsets.
- Phase 13 code previews are DOM overlays above the canvas and pointer-capable.
- Performance fixes should avoid per-wheel/per-frame recomputation and should preserve the feel validated by Phase 11.1.

### Integration Points
- `src/views/Radar/RadarCanvas.tsx` — integrate cache lifecycle, feature detection, and compositing.
- Potential new helper/module near `src/views/Radar/` — layer manager/cache abstraction if planning chooses to extract ownership.
- `src/views/Radar/__tests__/` — add tests for cache invalidation, fallback behavior, and static/live split.
- `src/hooks/useGraphLayout.ts` / worker refs — read-only integration for simulation-active cache bypass; do not change physics protocol unless explicitly justified.

</code_context>

<specifics>
## Specific Ideas

- The user delegated many exact choices to Claude. Downstream agents should make pragmatic engineering decisions from code context rather than re-asking.
- The few locked preferences are important: progressive OffscreenCanvas fallback, smoothness-first invalidation, and bypassing caches during active graph simulation.
- Treat this phase as performance plumbing for the existing radar, not a visible redesign.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 14-multi-layer-offscreen-canvas-rendering-separate-static-graph*
*Context gathered: 2026-05-03*
