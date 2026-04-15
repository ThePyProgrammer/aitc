# Phase 7: Graph-Based Codebase Map - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the existing squarified-treemap radar (Phase 4 `RadarCanvas` + `useTreemapLayout`) with a force-directed graph view of the codebase. Nodes are source files; edges are import/dependency relationships extracted from the repo. Filesystem proximity acts as gravity so co-located files cluster into folder islands. Agent activity is visualized as ephemeral animated comet trails travelling along edges between recently-touched files, leaving a 10-second fading tail per agent (per-agent color from `AGENT_DOT_PALETTE`).

This phase is a full replacement of the radar's spatial layout — treemap, sibling-rect insets, and treemap-driven minimap go away. Heat-map contention scoring, conflict badges, the right-side agent manifest panel, and the minimap are preserved by porting their data sources onto the graph layout.

Pulls forward `EMON-01` (dependency-graph codebase map) from v2 requirements. Replaces / supersedes the treemap-specific portions of `VIZN-01`, `VIZN-02`, `VIZN-04`, `VIZN-05`. Does NOT change `FMON-01..05` (file watcher), `AGNT-*`, `CNFL-*`, or `COMM-*` — those backend pipelines feed the new view unchanged.

</domain>

<decisions>
## Implementation Decisions

### Graph Engine + Layout
- **D-01:** Use `d3-force` for the force simulation. Verlet integration with configurable forces (`forceLink`, `forceManyBody` charge, `forceCenter`, custom `forceCluster` for per-directory gravity, `forceCollide`). ~30KB, mature, paired cleanly with our existing Canvas 2D + visx math approach.
- **D-02:** Render via Canvas 2D, reusing the existing `RadarCanvas` render-loop scaffolding (HiDPI scaling, `requestAnimationFrame` dirty-flag loop, ResizeObserver). No SVG, no WebGL. Node hit-testing via spatial index (quad-tree from d3 or visx `quadtree`) for cursor interactions.
- **D-03:** Layout cadence is **settle-then-freeze**: run the d3-force simulation on tree load until alpha cools (~500 ticks or alpha < 0.01), cache final node positions in `radarStore`, only re-warm the simulation when (a) the file tree mutates significantly (added/removed files exceed a threshold), or (b) the user drags a node to pin it. Matches the existing `installRadarPipelineBridge` debounce cadence (500ms).
- **D-04:** **Full replacement** of the treemap. Delete `useTreemapLayout`, `RadarCanvas`'s treemap render code, and treemap-specific subcomponents that don't carry over. Single radar view = graph. Roadmap explicitly says "replace current blocked Codebase Map" — no toggle, no hybrid mode.

### Dependency Extraction
- **D-05:** Dependency parsing runs in the **Rust backend**, integrated into the existing `pipeline` module. Parsing is parallelized via `rayon` over the file list produced by `build_tree_index`. Results exposed via a new Tauri command (e.g. `get_dependency_graph`) returning `Vec<{ from: PathBuf, to: PathBuf, kind: EdgeKind }>` alongside the existing tree index.
- **D-06:** Use **tree-sitter** for cross-language import extraction. Bundle grammars for the languages this project's monitored repos likely contain. **Default grammar set:** TypeScript, TSX, JavaScript, JSX, Rust, Python. Grammar bundle adds ~5-10MB to the binary — accepted tradeoff for clean, correct cross-language parsing. Planner will pin exact grammar versions and identify whether to compile grammars at build time vs lazy-load.
- **D-07:** External dependencies (anything resolving outside the repo root — `node_modules`, vendored crates, system packages) are **skipped entirely**. Only in-repo edges appear in the graph. Keeps the framing as a "codebase map" and avoids flooding the graph with thousands of external nodes.
- **D-08:** Edges are **directed** (A imports B = arrow A→B). Render a small arrow head at the target node end of each edge. Lets in-degree drive future visual encodings (selection emphasis, conflict ranking) even though node size itself is fixed (D-10).
- **D-09:** Imports must be **resolved to absolute repo-relative paths** before becoming graph edges. Resolution rules per language: TS/JS honor `tsconfig.json` paths + `package.json` exports for in-repo packages; Rust honors `Cargo.toml` workspace members + `mod` declarations; Python honors package `__init__.py`. Unresolved imports are dropped silently (logged for debug).

### Forces + Node Sizing
- **D-10:** Node visual size is **fixed** — every file is the same dot. No size encoding. Cleanest readability; lets clustering and edge density carry the information channels. (Implication: hub files don't visually dominate; user infers importance from in-degree and edge density.)
- **D-11:** Filesystem proximity gravity uses **per-directory cluster centroids**: each directory has an invisible centroid pulling its children toward it. Centroid attraction strength is inversely proportional to directory depth (deeper directories = tighter clusters). Sibling directories repel mildly via the global `forceManyBody` charge. Implemented as a custom `forceCluster` registered with d3-force.
- **D-12:** Folders are rendered as **labeled bounded regions**: a soft outline (convex hull or alpha-shape) drawn around each folder's cluster of file nodes, with the folder name floating as a label above/at the centroid. Outlines use the Command Horizon `outlineVariant` color (#494847) at low opacity so they recede behind nodes and edges. Top-level folders get larger labels; nested folders get smaller, lower-opacity labels with progressive detail (visible only at moderate zoom).
- **D-13:** Edge thickness is **uniform 1px** across all edges. No weight encoding. Density does the talking. Matches Command Horizon minimalism.

### Agent Trail Visualization
- **D-14:** When an agent touches file B after file A (consecutive `FileEvent`s for the same agent), animate a **glowing comet head** travelling along the edge A→B over ~400ms. The comet leaves a fading tail; the tail uses the agent's color from `AGENT_DOT_PALETTE` (D-21). If no edge exists between A and B, draw the trail along a straight line (or curved spline) between the two node positions.
- **D-15:** Trail **color is per-agent**, sourced from the existing `getAgentColor(agentId)` hash-to-palette function. Maintains visual attribution when multiple agents are active.
- **D-16:** Each trail remains visible (with fading opacity) for **10 seconds** after it animates, then disappears entirely. Trails are not user-configurable in v1 (deferred). Decay curve: 100% opacity for first 2s, linear fade 100%→0% over remaining 8s.
- **D-17:** The **agent's "current position" dot snaps to the most-recently-touched file node**, with a small pulse (reuse `RadarPulse` pattern). The comet trail (D-14) animates the snap motion. When an agent has no recent activity, its dot remains on the last file it touched but stops pulsing.
- **D-18:** Cap **active comet trails at MAX_LEAD_LINES_PER_AGENT (currently 10) per agent**, mirroring the existing treemap lead-line cap. Older trails older than 10s are culled even if the cap is not reached.

### Carry-over from Phases 4-6
- **D-19:** **Heat map overlay (FMON-05)** is preserved. The existing `radarStore.contentionScores` (computed from conflicts + agent file events) is rendered as a node fill tint instead of the treemap rect tint. Reuse `computeContentionScore` and the heat-map toggle UI unchanged.
- **D-20:** **Minimap (Phase 6 work)** is preserved. Re-implement the minimap to render the graph extents (graph bounding box, viewport rect) instead of the treemap. The minimap remains in the bottom-right and shifts when the manifest panel opens (preserve commit `e62272d` behavior).
- **D-21:** **Right-side agent manifest panel (Phase 4 D-12)** is preserved unchanged — it lists agents from `agentStore` independent of the radar layout. `selectAgent` behavior carries over: clicking an agent in the panel highlights its dot + trails on the graph.
- **D-22:** **Conflict alert dots/badges on contended nodes (Phase 5)** are preserved. When a `CNFL-01` conflict fires for a file, the corresponding graph node pulses red and shows a conflict badge ring. Wire via the existing `conflictStore` subscription.

### Performance Targets (carry from VIZN-04 / FMON-03)
- **D-23:** Graph rendering target: **5,000 nodes + edges at 60fps** during pan/zoom on a typical dev laptop. 10,000 nodes acceptable with progressive culling (skip rendering nodes/edges outside viewport at high zoom). Beyond 10k nodes, fall back to "graph too large — viewing degraded mode" warning. Researcher should benchmark d3-force tick cost at 5k/10k node counts.
- **D-24:** Dependency-graph build target: **<2s** for 10k-file repos on the dev Windows box (matches the spirit of FMON-03). Tree-sitter parse cost is the dominant variable; researcher should benchmark.

### Claude's Discretion
- Exact d3-force parameter tuning (charge strength, link distance, alpha decay rate, velocity decay) — derive from research benchmarks.
- Custom `forceCluster` implementation details (centroid recomputation cadence, depth-decay function shape).
- Folder hull algorithm: convex hull vs alpha-shape vs Voronoi region — pick whatever renders cleanly at 60fps.
- Comet trail curve: straight line vs Bézier vs Catmull-Rom spline — pick what reads best.
- Tree-sitter grammar loading strategy (statically linked vs dynamic via WASM at runtime) — research-driven.
- Spatial index implementation for hit-testing (d3-quadtree vs visx quadtree vs hand-rolled R-tree).
- Threshold for "significant tree mutation" that re-warms the simulation (D-03).
- New Tauri command name and shape (`get_dependency_graph` is a suggestion, not binding).
- New `radarStore` shape: how to store node positions, pinned-by-user flag, simulation handle. Keep store-per-domain pattern.
- Whether to extract a separate `graphStore` from `radarStore` or keep everything in `radarStore`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 7" — Phase scope statement (graph-based map, gravity, agent trails)
- `.planning/REQUIREMENTS.md` — `VIZN-01..05` (radar requirements being rewritten), `FMON-05` (heat map preserved), `EMON-01` (dependency-graph codebase map, pulled forward from v2)
- `.planning/PROJECT.md` §"Constraints" — Performance constraint (10k+ files), Tauri v2 + React + TS

### Design System
- `wireframes/vector_terminal/DESIGN.md` — Command Horizon design system (colors, typography, elevation, components, do's/don'ts) — phosphor green palette, zero-radius, minimal lines

### Tech Stack
- `CLAUDE.md` §"Data Visualization" — Canvas 2D + visx math + React-Konva for interactive overlays. WebGL flagged as overkill.
- `CLAUDE.md` §"Animation" — Motion (Framer) for transitions. Use sparingly here; the comet animation runs in the Canvas render loop, not Motion.
- `CLAUDE.md` §"Rust Supporting Crates" — `tokio`, `rayon` (implicit via parallel walker), `tracing`

### Phase Context (prior decisions that constrain this phase)
- `.planning/phases/01-foundation-app-shell/01-CONTEXT.md` — Sidebar + window chrome (radar lives in main pane)
- `.planning/phases/02-real-time-data-pipeline/02-CONTEXT.md` — Channel-based IPC (use for graph-related events), file tree index (`tree_index.rs`) is the data baseline
- `.planning/phases/03-agent-management-conflict-detection/03-CONTEXT.md` — Agent registry, conflict engine (graph nodes consume conflict events)
- `.planning/phases/04-core-ui-views/04-CONTEXT.md` — Radar D-09..D-12 (treemap layout, agent dots, zoom/pan, manifest panel) — D-09 / D-10 are being replaced; D-11 (zoom/pan) and D-12 (manifest panel) carry over
- `.planning/phases/04-core-ui-views/04-UI-SPEC.md` — `AGENT_DOT_PALETTE`, dot pulse animation, manifest panel spec
- `.planning/phases/05-conflict-resolution-history/05-CONTEXT.md` — Heat map overlay (FMON-05) and conflict badge behavior preserved
- `.planning/phases/06-pipeline-activation-integration-wiring/06-CONTEXT.md` — D-08 (pipeline → radar reactive bridge via Zustand subscribe — keep this pattern for graph), minimap fixes (commit `e62272d`)

### Existing Backend Code
- `src-tauri/src/pipeline/tree_index.rs` — Walker that produces `HashMap<PathBuf, FileNode>` — feeds graph node list
- `src-tauri/src/pipeline/commands.rs` — Existing Tauri commands (`start_watch`, `stop_watch`, `get_tree_index`) — add `get_dependency_graph` here
- `src-tauri/src/pipeline/mod.rs` — Pipeline module structure
- `src-tauri/src/pipeline/ignore_filter.rs` — gitignore-aware walker (reuse for dep parsing scope)
- `src-tauri/src/pipeline/pipeline_state.rs` — `ActiveWatch`, `PipelineState` (extend with cached dependency graph)
- `src-tauri/src/pipeline/events.rs` — `FileEvent`, `FileEventBatch`, `Attribution` (drives agent comet trails on the frontend)
- `src-tauri/src/agents/` — Agent registry; agent dot positions consume agent list from here

### Existing Frontend Code (to delete or rewrite)
- `src/views/Radar/RadarCanvas.tsx` — Treemap renderer; rewrite for graph
- `src/views/Radar/HeatMapOverlay.ts` — Heat map renderer; refactor to render on graph nodes (D-19)
- `src/views/Radar/RadarMinimap.tsx` — Minimap; rewrite for graph extents (D-20)
- `src/views/Radar/RadarManifest.tsx`, `AgentManifestRow.tsx`, `AgentTooltip.tsx`, `AlertDetail.tsx` — Agent manifest panel; preserved unchanged (D-21)
- `src/hooks/useTreemapLayout.ts` — DELETE after replacement
- `src/hooks/useCanvasZoomPan.ts` — Reuse for graph viewport
- `src/stores/radarStore.ts` — Refactor: replace `treeData: TreeIndexEntry[]` baseline with graph nodes/edges + cached positions. Keep `viewport`, `selectedAgentId`, `isManifestOpen`, `heatMapEnabled`, `contentionScores`, `installRadarPipelineBridge`. Update `fetchTreeIndex` to also fetch dependency graph.
- `src/stores/conflictStore.ts`, `src/stores/agentStore.ts`, `src/stores/pipelineStore.ts` — No changes; consumed by graph view
- `src/lib/contention.ts` — Reuse `computeContentionScore` unchanged
- `src/components/ui/RadarPulse.tsx` — Reuse for agent dot pulse
- `src/bindings.ts` — Auto-regenerated by tauri-specta after new Rust commands added

### Existing Tests
- `src/views/Radar/__tests__/` — Existing radar tests; rewrite for graph
- `src/stores/__tests__/` — radar/contention store tests
- `src-tauri/src/pipeline/tree_index.rs` `mod tests` — Pattern for walker tests; replicate for dep-graph builder

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `RadarCanvas` Canvas 2D scaffolding — HiDPI scaling, ResizeObserver, dirty-flag `requestAnimationFrame` loop, mouse interactions. Keep the shell, replace the layout/render body.
- `useCanvasZoomPan` hook — viewport state + screen↔world coordinate transforms. Works for any 2D layout (treemap or graph).
- `radarStore` — keep the slot for `viewport`, `selectedAgentId`, `isManifestOpen`, `heatMapEnabled`, `contentionScores`, `installRadarPipelineBridge`. Replace `treeData` shape.
- `getAgentColor(agentId)` + `AGENT_DOT_PALETTE` — drives per-agent comet color (D-15) without new infrastructure.
- `RadarPulse` — agent-dot pulse (D-17).
- `installRadarPipelineBridge` — debounced pipeline → radar refresh; reuse for graph re-fetch on file events (D-03).
- `computeContentionScore` — heat map data source (D-19).
- `RadarManifest`, `AgentManifestRow`, `AgentTooltip`, `AlertDetail` — manifest panel components (D-21), unchanged.
- `tree_index.rs` `build_tree_index` — repo file walker; reuse the file list as dep-graph node candidates.
- `ignore_filter.rs` `build_walker` — gitignore-aware walker; reuse for dep-graph parsing scope.
- `Channel<T>` IPC pattern (Phase 2) — use if dependency graph updates need streaming back to the frontend (likely not in v1; one-shot refetch suffices given the 500ms debounce).
- `tauri-specta` binding generation — regenerates `src/bindings.ts` automatically when new Rust commands land.

### Established Patterns
- One Zustand store per domain — keep `radarStore` as the home for graph state (or split into `graphStore` if it grows; D-Discretion).
- Tauri commands: `#[tauri::command] #[specta::specta]` with managed state, registered via `tauri_specta::Builder` in `lib.rs`.
- Real-time events: `Channel<T>` for high-throughput pipeline events; `listen()` for low-volume domain events (conflicts).
- Canvas 2D dirty-flag rendering with `requestAnimationFrame` — established by `RadarCanvas`.
- Test conventions: vitest for TS, `cargo test` for Rust, `#[cfg(test)] mod tests` colocated.
- Repo-relative path serialization for tree_index entries (commit `a1b15b6`) — apply same convention to graph nodes/edges.
- Single-child directory chain collapsing (commit `a8fe89b`) — consider whether folder labels in the graph should apply the same collapse for `src/views/Radar/` style chains.

### Integration Points
- `src/views/Radar/RadarCanvas.tsx` — primary surface to rewrite
- `src/stores/radarStore.ts` — refactor to hold graph state
- `src/hooks/` — add `useGraphLayout` (mirrors the `useTreemapLayout` pattern), keep `useCanvasZoomPan`
- `src-tauri/src/pipeline/` — add `dependency_graph.rs` (or `deps/` submodule) for tree-sitter parsing and edge resolution
- `src-tauri/src/pipeline/commands.rs` — register new `get_dependency_graph` command
- `src-tauri/src/lib.rs` — register new command in `tauri_specta::Builder` so bindings regenerate
- `Cargo.toml` — add tree-sitter + grammar deps
- `package.json` — add `d3-force` (and `@types/d3-force`)
- Phase 6 minimap shift behavior (commit `e62272d`) — keep the minimap-shift-on-manifest-open in the rewritten graph minimap

</code_context>

<specifics>
## Specific Ideas

- The "comet head along edge" trail is the key visual signature — should evoke a phosphor blip travelling along a wire on a CRT. Per Command Horizon, motion should feel ATC-like: deliberate, brief, glanceable.
- Per-directory gravity creating cohesive folder islands gives the user something the treemap couldn't: visible architectural shape. They should be able to glance at the graph and see "ah, the agents module is over there, separate from pipeline."
- Tree-sitter cost is accepted because the alternative (regex per language) was rejected explicitly. The planner should research whether to ship grammars statically (larger binary, no runtime fetch) vs WASM grammars loaded on first use.
- Heat map ports cleanly because contention scores key off file paths, which graph nodes already carry. No data layer change.
- Conflict pulse on graph nodes is a direct visual upgrade over the treemap: a contended node in a force-directed layout naturally draws the eye via its high in-degree position.
- The 10s trail duration is a "watch a sequence unfold" window. Three consecutive touches show as three overlapping comets at different decay stages — that visual stacking is the point.

</specifics>

<deferred>
## Deferred Ideas

- User-configurable trail duration (D-16) — exposed as a settings slider. Phase 8+ if requested.
- Edge color/thickness encoding by import type (runtime vs type-only vs re-export) — D-13 chose uniform; revisit if read-density becomes a problem.
- Node size encoding by in-degree or LOC (D-10 chose fixed size) — revisit if hub-file discoverability is poor.
- Hybrid graph + treemap zoom mode — explicitly rejected (D-04).
- External dependency aggregation as supernodes — explicitly rejected (D-07); revisit if "what does this file depend on outside the repo" becomes a real workflow.
- Pinned-position persistence across app restarts — pinning works in-session (D-03), but persisted pins are out of scope until the workflow demands it.
- Edge bundling for clutter reduction — defer until a real repo proves the need.
- Lasso/multi-select interaction — deferred; click + agent-driven selection suffices.
- Saving/exporting graph snapshots — out of scope.

</deferred>

---

*Phase: 07-replace-current-blocked-codebase-map-with-a-graph-based-code*
*Context gathered: 2026-04-15*
