# Phase 13: Implement 4-level semantic zoom - Context

**Gathered:** 2026-05-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement a four-level semantic zoom system for the Radar view: **workspace → package → file → code**. This phase replaces the current three-tier hull visibility gates with representation changes: workspace zoom shows package blobs only, package zoom shows sub-package blobs plus file dots, file zoom shows names/edges/agent indicators, and code zoom introduces focused signature/code-preview cards.

This is a Radar representation phase. It does not change graph physics, worker transport, pan/zoom controls, minimap behavior, bridge extraction, runtime invoke telemetry, typed-edge/community detection, or the Phase 14 offscreen-canvas rendering architecture.

</domain>

<decisions>
## Implementation Decisions

### Zoom levels

- **D-01:** Use the existing zoom anchors as semantic band boundaries: `0.6`, `2`, and `4`. These become the workspace/package/file/code transition anchors so Phase 13 changes representation without retuning navigation.
- **D-02:** Representation changes should crossfade over a small threshold band rather than hard-snap. The result should feel like a semantic morph during wheel zoom, not a sudden layer toggle.
- **D-03:** During crossfade bands, only the dominant representation handles hover/click. Dominance is based on the representation with higher opacity. This avoids duplicate targets during transitions.
- **D-04:** The existing numeric zoom indicator should gain a tiny semantic level label: `WORKSPACE`, `PACKAGE`, `FILE`, or `CODE`.

### Package blobs

- **D-05:** Workspace zoom shows **top-level package blobs only**. Fine file detail is hidden at this level. Existing always-on overlays that remain explicitly allowed by later decisions, such as bridges and agents, may still render.
- **D-06:** Package blobs encode both structure and activity: size reflects file count/package size; glow/heat reflects contention or recent agent activity.
- **D-07:** Package zoom shows sub-package blobs plus unlabeled file dots. This directly matches the roadmap phrase “sub-packages + file dots.”
- **D-08:** Blob labels are importance-filtered. Workspace zoom labels top-level blobs. Package zoom labels visible subpackages but suppresses tiny or low-importance labels to preserve glanceability.

### Code preview

- **D-09:** Code zoom first shows function/class signatures and exported symbols, not raw source blocks.
- **D-10:** Code previews render only for a focused subset: hovered files, selected files, or files near the current viewport focus. Do not render previews for every visible file at once.
- **D-11:** Signature data should come from existing graph/source-scan data where available, degrading to path metadata if absent. Do not introduce a full new language indexer unless research finds a cheap path already present in the codebase.
- **D-12:** Raw source is available through expandable signature cards. The default code-zoom surface starts with signatures; selected cards can expand into richer snippets.

### Overlay priority

- **D-13:** Preserve Phase 12 bridge visibility: bridge nodes stay visible at every semantic zoom level as the cross-language spine.
- **D-14:** When file nodes are collapsed into package blobs, agent dots attach to the relevant package blob centroid. At file/code levels, they snap or crossfade to exact file-node positions.
- **D-15:** Heat and conflict signals aggregate upward at workspace/package levels. Blob heat/conflict badges summarize child file contention, then resolve to file-level badges as users zoom in.
- **D-16:** When visual signals compete, conflicts win. Conflict state overrides heat/activity styling; agents remain visible; package labels may dim if necessary.
- **D-17:** Semantic zoom does not change wheel zoom, pan behavior, or minimap behavior. Only the rendered representation changes.

### Claude's Discretion

- Exact crossfade band width around `0.6`, `2`, and `4`.
- Exact formulas for package blob size, heat aggregation, and “important label” filtering.
- Whether semantic-level state is represented as a pure helper, a store selector, or a tiny module near the radar renderers.
- Whether code-preview signatures can be derived from existing dependency/source scans immediately or require a small best-effort backend extension. The constraint is no full language-indexer scope unless research proves it is already cheap.
- Exact visual styling for signature cards and expanded snippets, as long as it follows Command Horizon and does not become a built-in editor.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap and project scope

- `.planning/ROADMAP.md` — Phase 13 entry is the authoritative scope: “Implement 4-level semantic zoom — workspace (package blobs only), package (sub-packages + file dots), file (names + edges + agent indicators), code (content preview + function signatures). Replace current 3-tier shouldRenderHullAtZoom with a full semantic zoom system that changes representation, not just visibility.”
- `.planning/PROJECT.md` — Core product constraints: Command Horizon design system, Canvas 2D radar, Tauri + React + TypeScript stack, and 10k+ file performance expectations.
- `.planning/REQUIREMENTS.md` — Visualization requirements `VIZN-01`, `VIZN-04`, and `VIZN-05` remain the relevant product requirements.

### Upstream radar decisions to preserve

- `.planning/phases/11-move-d3-force-simulation-to-a-webworker-with-transferable-fl/11-CONTEXT.md` — Worker-hosted graph simulation and `Float32Array` position flow. Semantic zoom must not move physics back onto the main thread.
- `.planning/phases/11.1-fix-zoom-scroll-lag-in-radarcanvas-wheel-event-raf-coalescin/11.1-CONTEXT.md` — Wheel responsiveness and hull-cache decisions. Semantic zoom must avoid per-wheel/per-frame recomputation that regresses zoom feel.
- `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-CONTEXT.md` — Bridge nodes, boundary line, bridge visibility at all zoom levels, bridge/file node separation, and Phase 12 D-19 carve-out.

### Existing frontend code

- `src/views/Radar/RadarCanvas.tsx` — Main render loop and overlay orchestration. Current bridge/file split happens via `bridgeNodes` and `filterRenderableFileNodes`; the zoom indicator is rendered here.
- `src/views/Radar/GraphRenderer.ts` — Current three-tier `shouldRenderHullAtZoom`, folder label rendering, node rendering, and file-label threshold. Phase 13 replaces representation logic here and/or in adjacent helpers.
- `src/views/Radar/hullCache.ts` — Current hull-cache build gate duplicates the three-tier hull visibility logic; semantic zoom must keep cache invalidation cheap and coherent.
- `src/stores/radarStore.ts` — Graph node/edge shapes, bridge metadata, viewport, force config, heat map, selected bridge, parent-child maps, and file-node precomputations.

### Design system

- `wireframes/vector_terminal/DESIGN.md` — Command Horizon visual language: dark-room radar aesthetic, phosphor colors, zero-radius geometry, Space Grotesk/JetBrains Mono typography.
- `CLAUDE.md` — Project stack and data-visualization constraints: Canvas 2D + visx math; no generic charting library or WebGL rewrite.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `RadarCanvas` already computes `bridgeNodes` and file-node subsets in the render loop. Phase 13 can add semantic representation subsets alongside that pattern without widening store state.
- `GraphRenderer` already exposes pure draw functions for folder labels, edges, arrows, nodes, file labels, and selection halos. Semantic zoom should preserve pure renderer boundaries and thread level/opacity data through explicit arguments.
- `hullCache` already groups nodes by `dirKey`, excludes bridge nodes, and caches expensive hull geometry. Package blob generation should reuse or extend this grouping rather than recomputing directory structure per frame.
- `radarStore` already precomputes `parentChildMap` and `dirsWithOwnFiles` during `fetchGraph`. These are natural inputs for workspace/package blob importance and nesting decisions.
- `contentionScores`, conflict paths, and agent dot/trail data already exist in the Radar layer. Phase 13 aggregates these upward; it does not need a new domain store.

### Established Patterns

- Worker-hosted graph positions are the source for live node coordinates during simulation; settled store positions are the fallback. Semantic zoom should read the same position sources.
- Canvas draw functions are pure and data-driven. Representation selection belongs in orchestration/helpers, not hidden inside unrelated draw functions.
- Bridge nodes and file nodes are separate render subsets. Bridges remain visible at all zoom levels and should not be folded into package blobs.
- Cache invalidation is coarse and tied to settled positions/zoom buckets. Semantic zoom should respect the existing performance discipline from Phase 11.1.
- Command Horizon favors glanceable status: conflicts should be visible at overview levels, not hidden until file zoom.

### Integration Points

- `src/views/Radar/RadarCanvas.tsx` — derive semantic level, crossfade opacities, dominant hit-test level, package/file/code subsets, agent-to-blob positioning, and level label.
- `src/views/Radar/GraphRenderer.ts` — replace/augment `shouldRenderHullAtZoom`; add package blob and semantic-level render functions or delegate to a new adjacent renderer module.
- `src/views/Radar/hullCache.ts` — adapt current directory grouping into reusable package-blob data or keep hull cache as the backing geometry source.
- `src/stores/radarStore.ts` — likely only needs small derived data support if existing `parentChildMap`, `dirsWithOwnFiles`, and `graphNodes` are insufficient. Avoid broad store rewrites.
- `src/views/Radar/__tests__/` — existing radar test location. Add semantic-level, crossfade, blob aggregation, overlay-priority, and code-preview tests here.

</code_context>

<specifics>
## Specific Ideas

- The semantic labels should sit near the current numeric zoom indicator, preserving the existing bottom-left zoom affordance while making the new representation model discoverable.
- Workspace zoom should feel like an ATC overview: top-level package blobs, conflict/heat summarized upward, agent dots attached to blobs, and bridge nodes still forming the cross-language spine.
- Package zoom is the “unfolding” level: sub-package blobs and unlabeled dots give structure without turning into a file-name cloud.
- Code zoom should be an inspection layer, not an editor. Signature-first cards and expandable snippets provide just enough code context while preserving the radar metaphor.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 13-implement-4-level-semantic-zoom-workspace-package-blobs-only*
*Context gathered: 2026-05-03*
