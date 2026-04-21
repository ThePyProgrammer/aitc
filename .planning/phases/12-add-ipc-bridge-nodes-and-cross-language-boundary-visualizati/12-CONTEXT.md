# Phase 12: IPC Bridge Nodes + Cross-Language Boundary - Context

**Gathered:** 2026-04-21
**Mode:** `--auto` (recommended defaults auto-selected; see 12-DISCUSSION-LOG.md for per-question log)
**Status:** Ready for planning

<domain>
## Phase Boundary

Teach the Phase 7 graph-based radar to surface the **Tauri IPC surface** as a first-class visual layer. Every `#[tauri::command]` handler in `src-tauri/` paired with its `invoke('snake_name', …)` / `commands.camelName(…)` call-sites across `src/` becomes an **IPC bridge node** drawn on a horizontal **frontend/backend boundary line** (world-space y = 0). File nodes cluster above the line (TypeScript / TSX / JS) or below the line (Rust) via a new boundary-bifurcation force added to the existing d3-force simulation. Two new edge kinds, `invokes` (caller file → bridge) and `handles` (bridge → handler file), connect bridges into the existing dependency graph. Heat map, conflict pulses, agent dots, comet trails, force-config panel, and minimap keep working unchanged.

The data side runs on the Rust backend as a new `pipeline/ipc_bridges/` module that parses `src/bindings.ts` (canonical tauri-specta output — 52 commands today), grep-scans `src-tauri/src/**/*.rs` for `#[tauri::command]` attributes, and tree-sitter-scans frontend TS/TSX for the two call-site shapes. Returns a new DTO via a new `get_ipc_bridges` Tauri command. Indexed once on watch start and debounced on file-watcher events that touch the relevant sources — the same `installRadarPipelineBridge` cadence Phase 7 already established for `fetchGraph`.

This is a **structural visualization** phase, not an instrumentation phase. Bridges are static structural nodes derived from source. Phase 12 does NOT log live invocations, animate agent-driven command traversals, drag-to-pin bridges, or deep-link to editor. Those are explicitly deferred (see `<deferred>` below). The phase title's "bridge nodes" binds the deliverable visually; the phase title's "boundary line" binds it spatially.

Out of scope: Tauri event push bridges (the specta events section in `bindings.ts` is empty today), the Phase 8 `/hook` axum sidecar route (different architectural surface — HTTP not `tauri::invoke`), MCP server endpoints (Phase 10), and long-lived `Channel<T>` streaming semantics beyond rendering the outer `#[tauri::command]` that owns the channel as a regular bridge.

Requirements: no new requirement IDs. This phase extends the Phase 7 graph map (VIZN-01 / VIZN-05 in spirit — the radar shows architectural structure) with a new architectural dimension. `EMON-01` (dependency-graph codebase map, pulled forward from v2 in Phase 7) widens naturally to include cross-language IPC structure.

</domain>

<decisions>
## Implementation Decisions

### Parser Location & Source of Truth

- **D-01:** Bridge extraction runs on the **Rust backend** in a new module `src-tauri/src/pipeline/ipc_bridges/` (peer to `pipeline/deps/`). Parallel to Phase 7's dependency extractor: parses source, returns a DTO, exposes via a new Tauri command. Keeps "graph data lives on Rust side" as a cross-cutting invariant — frontend never parses source.

- **D-02:** **`src/bindings.ts` is the canonical source of truth** for the command surface. Parsed as plain text (regex over `async <camelName>(...) : Promise<Result<...>>` — the tauri-specta output is stable and machine-generated). Produces the authoritative `camelName ↔ snake_name` mapping plus argument / return type strings for tooltip display. Rationale: bindings.ts is the single file that tauri-specta guarantees stays in sync with `collect_commands![…]`; re-deriving from Rust macro expansion would require rustc, and using `collect_commands![…]` parsing would miss the camelCase name tauri-specta mints.

- **D-03:** **Rust handler file + line** for each command is discovered by scanning `src-tauri/src/**/*.rs` for the pattern `#[tauri::command]\n(?:…)\n(?:pub )?(?:async )?fn <snake_name>(` via a Rust regex. Does NOT require tree-sitter Rust (trivially identifiable from the attribute + fn-definition pair). Multiple matches for the same name → ambiguous; pick the first and log a warning (shouldn't happen given `collect_commands!` uniqueness).

- **D-04:** **Frontend call-site detection** uses the **tree-sitter TypeScript + TSX grammars already bundled for Phase 7** (see `src-tauri/src/pipeline/deps/extract.rs`). Two patterns:
  - `invoke('snake_name', …)` — match `call_expression` where `callee` is identifier `invoke` and first arg is a string literal.
  - `commands.camelName(…)` — match `call_expression` where `callee` is a member access on identifier `commands` or an aliased import of `commands` from `../bindings` / `./bindings`.
  Both shapes are already present in this repo (typed: `src/views/TowerControl/DeployDialog.tsx:53`; string-literal: 17 other sites). Tree-sitter avoids false positives from comments, strings, and variable invokes. Unresolved variable invokes are logged to tracing::debug and skipped.

- **D-05:** **Fallback regex** is NOT added. Tree-sitter handles both shapes. If a caller writes `invoke(someVar, args)` with a variable command name, that call-site is correctly skipped (no way to resolve statically). Listed in `<deferred>` as a future polish via type-checker inspection.

### Bridge Data Model

- **D-06:** **`IpcBridgeDto`** (serde + specta):
  ```rust
  pub struct IpcBridgeDto {
      pub command_name: String,           // camelCase, from bindings.ts
      pub rust_name: String,              // snake_case, Rust fn name
      pub handler_file: String,           // repo-relative FS path
      pub handler_line: u32,              // 1-indexed line of `fn` declaration
      pub caller_files: Vec<IpcCallSite>, // aggregated from tree-sitter
      pub signature_summary: String,      // truncated args/return from bindings.ts, for tooltip
      pub has_channel_arg: bool,          // true if a `TAURI_CHANNEL<…>` arg appears (long-lived stream)
  }

  pub struct IpcCallSite {
      pub file: String,                   // repo-relative caller path
      pub line: u32,
      pub shape: CallShape,               // Literal | Typed
  }

  pub enum CallShape { Literal, Typed }
  ```
  Serialized via specta as `IpcBridgeDto[]` so the frontend receives a flat list.

- **D-07:** **Commands only; no events, no HTTP, no MCP.** v1 restricts bridges to `#[tauri::command]` handlers registered in the `tauri_specta::Builder::commands(collect_commands![…])` block. `Channel<T>`-taking commands (e.g. `startWatch`, chat runtime relaunch path if any) are captured as regular bridges with `has_channel_arg: true` — lets the frontend render them with a subtle distinct glyph (e.g. double-stroke border). Tauri events (currently none registered in this project's bindings.ts) are deferred. HTTP endpoints exposed by the Phase 8 self-register axum sidecar are explicitly out of scope — different architectural surface.

- **D-08:** **Cardinality: one bridge node per command**, regardless of caller count. `invokes` edges fan in from each caller file to the single bridge; the bridge fans out a single `handles` edge to the handler file. 52 commands today × typical 1–3 callers ≈ < 200 new edges — negligible against the existing dep-graph edge cap (`MAX_TOTAL_EDGES = 100_000`). One-per-command is the cleanest mental model ("the bridge IS the command").

- **D-09:** **Dangling bridges are rendered explicitly.** If a command has no frontend caller (possible for commands exposed but not yet consumed) OR no resolvable Rust handler (should not happen given `collect_commands!` invariants but surface defensively), the bridge is still rendered with a **dashed outline** as an actionable dead-code signal. Log a `tracing::warn!` for missing handlers; `tracing::info!` for missing callers (only warn once per snapshot to avoid noise on watch refresh).

### Graph Integration

- **D-10:** **Bridge nodes and file nodes share the same `graphNodes` array** in `radarStore`. `GraphNode` gains a discriminator: `kind: 'file' | 'bridge'`. Bridges carry additional optional fields (`commandName`, `handlerFile`, `hasChannelArg`, `callerCount`). File nodes leave those undefined. Rationale: bridges participate in force simulation, hit-testing, hover tooltip routing, and selection the same way file nodes do — storage parallelism minimizes render-path branching.

- **D-11:** **`EdgeKind` union extends with two new variants: `invokes` and `handles`.** Both are registered in Rust (`pipeline::deps::EdgeKind`) and flow through `DependencyEdgeDto` — but they come from the bridges endpoint, not `build_dependency_graph`. Graph edges retain a single `kind: EdgeKind` field across both sources, so `GraphRenderer.drawEdges` can style `invokes` / `handles` distinctly without a separate draw pass. Existing variants (`import` / `reexport` / `typeOnly` / `dynamicImport` / `use` / `modDecl` / `fromImport` / `importStmt`) remain unchanged.

- **D-12:** **Single store (`radarStore`) holds everything.** No new `ipcBridgeStore`. `fetchGraph()` gains a third parallel invoke call (`get_ipc_bridges`); its output is merged into the existing `graphNodes` + `graphEdges` set before the settle-reset at the end of `fetchGraph`. A single settle covers dep + bridge topology. Subscribers do not need to distinguish.

### Boundary Line & Layout Force

- **D-13:** **Boundary strategy = hard-pin bridges to y=0 + directional force on file nodes.** Bridge nodes get `fx: <sim-computed x>, fy: 0` after an initial one-pass x-spread layout (see D-14). The force simulation honors `fy` as a fixed constraint so bridges stay on the horizontal line. A new custom force, **`forceBoundary`**, pushes file nodes with `kind: 'file'` away from y=0 based on their language: TS/TSX/JS → negative y (up, toward "frontend" half-plane); Rust → positive y (down, toward "backend" half-plane). Strength is a new `ForceConfig.boundaryStrength` slider (default 0.15, small alongside `clusterStrength`'s 0.08).

- **D-14:** **Bridge x-spread uses a one-pass alphabetic layout across viewport width at `init` time.** 52 bridges spread evenly from `x = -GRAPH_HALF_WIDTH` to `x = +GRAPH_HALF_WIDTH` sorted alphabetically by `commandName`. The `fx` is re-computed whenever the bridge set changes (topology rewarm). Bridges do NOT jostle each other on the x axis — their positions are deterministic and stable across refreshes (fewer perception-of-flux issues for the user).

- **D-15:** **Boundary line is drawn as a thin horizontal line across the world at y=0** — world-space pixels, stroke = theme.outline at 60% opacity, drawn before file nodes (z-order below nodes, above folder hulls). Two **labels at the viewport's left edge**: "FRONTEND · TypeScript" (above line) and "BACKEND · Rust" (below line), in JetBrains Mono 10px uppercase, `onSurfaceVariant` color, fixed-x (screen-space) so they remain readable during pan. Visible at all zoom levels per D-19.

- **D-16:** **Language classification uses path prefix first, extension second.** Any node under `src-tauri/` → backend. Any node with `.rs` extension under unrecognized prefix → backend. Any node with `.ts` / `.tsx` / `.js` / `.jsx` extension → frontend. Any other file (Markdown, JSON, images, lockfiles, config) → **no boundary force applied** (defaults to y near origin, lets clusterStrength govern). This repo's binary src/ vs src-tauri/ split makes classification unambiguous; the extension fallback keeps the heuristic portable if Phase 12's logic is ever reused on a different repo.

### Bridge Node Visual Treatment

- **D-17:** **Bridge nodes render as a rotated square (diamond)**, world-space half-diagonal = `NODE_RADIUS_DEFAULT * 1.6` (~8px at zoom 1). Fill: theme `secondary` (Command Horizon cyan `#00cffc`). Stroke: theme `primary` (phosphor green `#8eff71`), 1px. Channel-bearing bridges (`hasChannelArg: true`) get a **double-stroke** (inner stroke `primary`, outer stroke `primary` at 40% opacity, 2px gap) — small readable signal without cluttering the palette. Dangling bridges (D-09) get a **dashed stroke** using the existing phase of the `[4, 3]` dash pattern already supported by Canvas 2D.

- **D-18:** **Label rendering: command name in JetBrains Mono above the diamond** at zoom levels where file-name labels also show (`FILE_LABEL_ZOOM_THRESHOLD = 4` carries over). Below that zoom, bridges are unlabeled dots on the boundary line — still visible, just anonymous. Hover tooltip (D-20) carries the label information at any zoom.

- **D-19:** **Bridges visible at all zoom levels** — including workspace zoom where file nodes are typically subsumed into package blobs. Bridges are the "skeleton of the cross-language surface" and hiding them defeats the phase's purpose. At workspace zoom, bridge nodes stay rendered at their pinned y=0 positions even while file nodes disappear into hull regions. Phase 13 (semantic zoom) is aware of this via a carve-out decision in its own CONTEXT.md (not this phase's scope).

### Interaction Behaviors

- **D-20:** **Hover → existing AgentTooltip pattern.** Re-use `AgentTooltip.tsx` structure (or extract a generic `RadarTooltip`) to show: `{commandName}` in headline, signature summary in monospace, "Handler: {handlerFile}:{handlerLine}" + "Callers: N" rows. Auto-dismiss on mouseout, 200ms delay-in matches existing pattern. Data sourced from `IpcBridgeDto` carried on the bridge `GraphNode`.

- **D-21:** **Click → select bridge.** Add a `selectedBridgeId` slot to `radarStore` parallel to `selectedAgentId`. Selected state renders the bridge with a white outer ring (matches `drawSelectedNode`'s current pattern for file nodes) + a persistent detail panel in the Radar's right-side manifest that lists caller paths with line numbers. Clicking a caller path entry highlights the file node on the graph (visual lead-line connector via existing `drawLeadLine` infrastructure; ephemeral 2s highlight).

- **D-22:** **No deep-link to source editor.** PROJECT.md Out-of-Scope already forbids built-in code editors and explicitly says "link to external" — v1 renders paths as copyable text only. An optional VS Code / Cursor URI handler (`vscode://file/...`) is logged as a deferred polish in `<deferred>`.

### Data Pipeline Cadence

- **D-23:** **Indexed on watch start**, invoked in parallel with `get_tree_index` and `get_dependency_graph` inside `radarStore.fetchGraph()` (third `Promise.all` parallel leg). Failure to parse is best-effort — same contract as dep graph: backend errors leave existing bridges intact, UI degrades gracefully.

- **D-24:** **Refreshed via the existing `installRadarPipelineBridge` 500ms debounce** on pipeline file events. The debounce already fires `fetchGraph()` on any file change; bridges come along for the ride. If perf profiling ever shows bridge re-parsing dominates the 500ms budget, a filter (only re-parse when `src/bindings.ts` OR `src-tauri/**/*.rs` OR `src/**/*.ts(x)` changed) is trivially added — planner's discretion.

- **D-25:** **No caching in v1.** The expected cost is <100ms total (52 commands × regex + ~300 frontend files × tree-sitter TS parse). If benchmarking shows cost spikes on 10k+ file codebases, cache keyed on file-mtime is a straightforward add. Phase 7 set the precedent: rebuild-from-source each snapshot, no caching.

### Schema & IPC Contract Changes

- **D-26:** **New Tauri command: `get_ipc_bridges`** in `pipeline/commands.rs`. Signature: `async fn get_ipc_bridges(state: State<'_, PipelineState>) -> Result<Vec<IpcBridgeDto>, String>`. Registered in `lib.rs::collect_commands![…]`. Registers `IpcBridgeDto`, `IpcCallSite`, `CallShape` types via `.typ::<…>()`. Regenerates `src/bindings.ts` on build (existing workflow). Frontend typed-wrapper is `commands.getIpcBridges()`.

- **D-27:** **New `EdgeKind` variants `invokes` + `handles`** added to `src-tauri/src/pipeline/deps/mod.rs`. Ensures the same type flows through both dep edges and bridge edges; `GraphRenderer.drawEdges` switches on kind for styling. Bindings regen picks up the new union variants.

- **D-28:** **No DB migration.** Bridge index is ephemeral — rebuildable from source, not persisted. SQLite stays untouched.

### Force-Config Panel

- **D-29:** **`ForceConfigPanel.tsx` gains a `boundaryStrength` slider** (0 to 0.5, default 0.15). At 0, the boundary bifurcation collapses — file nodes cluster freely around bridges on y=0, useful for debugging. At high values, the FE/BE halves separate cleanly. Existing `centerStrength` / `clusterStrength` / `linkStrength` / `chargeStrength` sliders unchanged.

- **D-30:** **`DEFAULT_FORCE_CONFIG` gains `boundaryStrength: 0.15`.** All existing persistence / reset / UI round-trip paths that serialize `ForceConfig` adapt in one place. Backward-compatible via `?? DEFAULT_FORCE_CONFIG.boundaryStrength` at read sites so old serialized shapes don't break on first load.

### Rendering Order (z-order)

- **D-31:** RadarCanvas render sequence extends (existing order in parentheses):
  1. Background clear (existing)
  2. Heat map background tint (existing, D-19 Phase 7)
  3. **Boundary line** (new — behind hulls so hulls can cover parts of it without z-fighting)
  4. Folder hulls (existing)
  5. Edges — includes new `invokes` / `handles` variants (existing function, new styling)
  6. Arrow heads (existing)
  7. File nodes (existing `drawNodes`)
  8. **Bridge nodes** (new — `drawBridgeNodes` called after `drawNodes` so bridges overlay any overlapping file nodes)
  9. File labels (existing)
  10. Selection rings + pinned badges (existing)
  11. **Boundary labels FRONTEND/BACKEND** (new — screen-space, topmost so they never occlude, drawn after all world-space content)
  12. Comet trails (existing)
  13. Agent dots (existing)
  14. Conflict pulses + badges (existing)

### Testing

- **D-32:** **Rust unit tests live in `src-tauri/src/pipeline/ipc_bridges/mod.rs` with fixtures in `src-tauri/src/pipeline/ipc_bridges/test_fixtures/`** — mirrors `pipeline/deps/test_fixtures/` pattern. Fixtures include: `sample_bindings.ts` (miniaturized tauri-specta output), `sample_handler.rs` (multiple `#[tauri::command]` attributes incl. one `async fn`, one `pub fn`, one channel-bearing), `sample_caller_literal.ts` (5 `invoke(...)` shapes incl. one var-callee), `sample_caller_typed.tsx` (3 `commands.x()` shapes incl. one aliased import). Assertions cover: correct command enumeration, handler-file resolution, caller attribution, dangling detection, channel-arg detection.

- **D-33:** **Frontend Vitest tests** cover: `drawBridgeNodes` output (diamond geometry, cyan fill, channel-arg double-stroke), `forceBoundary` pushes TS-path nodes to negative y and Rust-path nodes to positive y over N ticks, bridge click sets `selectedBridgeId`, hover tooltip renders command name + handler path. Co-located under `src/views/Radar/__tests__/`.

- **D-34:** **Visual verification checkpoint** (optional Phase 12 plan) — user runs Tauri prod build on this repo, confirms the boundary line, bridge diamonds, labels, tooltip, selection behavior. Analogous to Phase 7 Plan 06 / Phase 11.1 verifier checkpoint. Only triggered if the automated evidence is insufficient.

### Performance

- **D-35:** **Target: bridge-index build <100ms** on this repo (52 commands, ~300 frontend TS files). Tree-sitter TS parse is the dominant variable; planner should benchmark early. Build runs on `tauri::async_runtime::spawn_blocking` per Phase 7 D-24 pattern to avoid blocking the async runtime during the parse.

- **D-36:** **Target: 60fps maintained with bridges present on a 5k-file graph.** Add no more than 52 nodes + 200 edges — negligible against the existing budget. Boundary force cost is O(N) per tick (one `y += k * sign(targetY - y)` term per file node) — well within d3-force tick budget.

- **D-37:** **No worker protocol changes.** Phase 11's worker protocol (`graphSimProtocol.ts`) treats all nodes uniformly via their `ForceConfig`-driven forces; the new `forceBoundary` is registered inside the worker alongside `forceCluster` / `forceClusterCollide`. `GraphNode.kind`, if needed for force-per-kind branching, travels through the existing `nodes[i]` payload shape — one new optional field. The worker already imports `forceCluster` from `src/views/Radar/`; `forceBoundary` lives next to it at `src/views/Radar/forceBoundary.ts` or in `src/workers/forces/forceBoundary.ts` (planner's discretion, aligns with Phase 11 D-30 deferred reorganization).

### Claude's Discretion

- Tree-sitter TypeScript AST path for detecting the aliased `commands` identifier (e.g. `import { commands as C } from '../bindings'; C.fooBar();`) — extend the tree-sitter query or stop at direct `commands.xxx` sites. v1 acceptable to cover direct only; aliased imports are zero in this repo.
- Whether `forceBoundary` uses linear (distance * k) or spring (k * sign * alpha) response math. Spring matches the other forces' idiom in d3-force and is recommended.
- Whether to extract `forceBoundary.ts` next to `forceCluster.ts` (Phase 11 convention) or relocate both into `src/workers/forces/` (Phase 11 deferred cleanup). Pick one; don't introduce both locations.
- Exact diamond geometry: rotated square vs proper isometric diamond (height ≠ width). Rotated square is simpler and matches the "node" visual weight.
- Whether the detail panel on bridge selection extends the existing `RadarManifest` sidebar or opens as a secondary panel. Easier to extend; do that.
- Whether to dim file nodes outside the selected bridge's caller set when a bridge is selected (focus mode). Nice-to-have; Claude may ship if cheap.
- Whether the boundary-line labels should use the active theme's text color (`onSurfaceVariant`) or a fixed phosphor green. Theme-matched is more consistent with Phase 7 D-12 patterns.
- Exact alphabetic x-spread — strict A→Z vs grouped-by-subsystem (`agents.*` adjacent, `pipeline.*` adjacent, ...). Alphabetic is simpler; grouped is more readable. v1 ships alphabetic; grouped is a polish decision post-ship.
- Whether to pre-expand `signature_summary` in the bridge DTO or derive it from bindings.ts client-side. Server-side derivation is simpler and keeps bindings.ts parsing in one place.
- Whether to annotate bridge edges with their call-site line numbers in the tooltip (e.g. "invoked from src/stores/agentStore.ts:74"). Yes, cheap, useful for navigation.
- Whether to track `#[specta::specta]` presence separately. Not needed — tauri-specta requires it for every exposed command; it's noise in the parser.
- Whether the 52-bridge x-spread should be re-run on every topology rewarm or only on genuine command-set change. Only on change — keeps bridge x stable during unrelated file mutations. Compute a cheap hash of `commands.map(c.name).join(',')` and cache.
- Whether the `forceBoundary` strength dips toward zero inside a deadband (`|y| < SMALL`) to avoid jitter near the line. Yes, small deadband of ~5 world-units.
- Whether agent dots that land on a file currently invoking a bridge get a brief phosphor-green ring. Nice-to-have but requires wiring invoke telemetry — explicitly deferred. v1: agent dots stay unchanged on bridges.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 12" — phase scope statement ("Add IPC bridge nodes and cross-language boundary visualization — parse tauri-specta bindings.ts for the command surface, cross-reference invoke() callers with #[tauri::command] handlers, render bridge nodes on a visible frontend/backend boundary line")
- `.planning/REQUIREMENTS.md` — `VIZN-01` / `VIZN-05` (radar rendered; graph-based codebase map — extended to IPC surface in spirit), `EMON-01` (dependency-graph codebase map, pulled forward from v2 in Phase 7)
- `.planning/PROJECT.md` §"Constraints" — Tauri v2 + React + TS stack; 10k+ file performance target
- `.planning/PROJECT.md` §"Out of Scope" — "No built-in code editor; link to external" governs D-22

### Phase 7 Context (the graph substrate being extended)
- `.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-CONTEXT.md` — D-01..D-26; D-05..D-09 (dep extraction) is the pattern Phase 12 mirrors for bridge extraction; D-11/D-12 (folder hull + gravity) is the force pattern Phase 12 extends with `forceBoundary`; D-21 (agent manifest panel) is the surface that gains a bridge-detail panel in D-21 of this phase
- `.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-RESEARCH.md` — tree-sitter-based parsing patterns, rayon parallelization, resolution strategies

### Phase 11 Context (worker that must absorb the new force)
- `.planning/phases/11-move-d3-force-simulation-to-a-webworker-with-transferable-fl/11-CONTEXT.md` — D-01..D-24, especially D-29 (shared `graphSimConfig.ts`), D-30 (`forceCluster.ts` / `forceClusterCollide.ts` location — same question for `forceBoundary.ts`), and the worker protocol (`graphSimProtocol.ts`) that the new `boundaryStrength` `ForceConfig` field must round-trip through
- `.planning/phases/11.1-fix-zoom-scroll-lag-in-radarcanvas-wheel-event-raf-coalescin/11.1-CONTEXT.md` — D-05..D-11 (hull cache + viewport writeback) — Phase 12 must not regress this (no new wheel-event Zustand writebacks, no per-frame hull recomputes)

### Phase 8 Context (why HTTP/hook surface is explicitly out of scope)
- `.planning/phases/08-real-claude-code-hook-integration-pretooluse-approvals/08-CONTEXT.md` — The `/hook` axum route is a separate architectural surface (HTTP, not tauri::invoke); Phase 12 D-07 explicitly excludes it

### Phase 10 Context (why MCP surface is explicitly out of scope)
- `.planning/phases/10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s/10-CONTEXT.md` — MCP server endpoints live on the self-register axum port (Phase 8 infrastructure); Phase 12 D-07 explicitly excludes them

### Design System
- `wireframes/vector_terminal/DESIGN.md` — Command Horizon: phosphor greens, zero-radius, radar indicators, dark-room aesthetic. Bridge nodes use `secondary` cyan `#00cffc` for visual separation from file nodes (phosphor green) while staying in palette.

### Tech Stack
- `CLAUDE.md` §"Data Visualization" — Canvas 2D + visx math; no WebGL, no dedicated chart libs. Bridge diamond is a custom Canvas 2D primitive.
- `CLAUDE.md` §"Rust Supporting Crates" — `tokio`, `rayon` (implicit), `serde`, `serde_json`, `tracing`. New `pipeline/ipc_bridges` module re-uses the same stack.
- `CLAUDE.md` §"Frontend Framework" — React 19.2 concurrent features; no direct relevance to Phase 12 UI, which remains Canvas-driven.

### Existing Backend Code (to extend or mirror)
- `src-tauri/src/pipeline/deps/mod.rs` — Phase 7 dependency extractor; `build_dependency_graph` entrypoint pattern to mirror; `DependencyEdgeDto` / `EdgeKind` — extend with `invokes` / `handles` variants
- `src-tauri/src/pipeline/deps/extract.rs` — tree-sitter TS/TSX parsing pattern (450 lines) — bridge extractor re-uses the same grammar-loading approach
- `src-tauri/src/pipeline/deps/resolve.rs` — resolver pattern; not strictly needed for bridges (no import-path resolution), but the module shape (pure functions, `#[cfg(test)]` mod tests) is the convention
- `src-tauri/src/pipeline/commands.rs` — Tauri command registration; add `get_ipc_bridges` here
- `src-tauri/src/pipeline/pipeline_state.rs` — `PipelineState` managed state; new bridge index cache hangs off here if caching is added later (D-25 defers)
- `src-tauri/src/lib.rs:42-92` — `tauri_specta::Builder::collect_commands![…]` + `.typ::<…>()` registration block — the single registration point; add new command + types here

### Existing Frontend Code (to modify)
- `src/bindings.ts` — auto-regenerated by tauri-specta; commands for Phase 12 land here on build; NEVER edit manually
- `src/stores/radarStore.ts` — extend `GraphNode` with `kind` + bridge fields; extend `EdgeKind` type alias (comes via bindings regen); extend `fetchGraph` with parallel `get_ipc_bridges` call; add `selectedBridgeId` slot
- `src/views/Radar/RadarCanvas.tsx` — render-loop additions: boundary line, `drawBridgeNodes` call, boundary labels (screen-space), tooltip dispatch branching on `kind`
- `src/views/Radar/GraphRenderer.ts` — add `drawBoundaryLine`, `drawBridgeNodes`, extend `drawEdges` to style `invokes` / `handles` variants
- `src/views/Radar/AgentTooltip.tsx` — generalize to `RadarTooltip` (or add a sibling `BridgeTooltip` that reuses the same shell chrome) for bridge hover
- `src/views/Radar/RadarManifest.tsx` + `AgentManifestRow.tsx` — add bridge-selected detail panel (caller list + handler path + signature)
- `src/views/Radar/ForceConfigPanel.tsx` — add `boundaryStrength` slider
- `src/hooks/useGraphLayout.ts` — no interface changes; the new `boundaryStrength` flows through `ForceConfig` which already rides the worker protocol
- `src/workers/graphSimCore.ts` — register the new `forceBoundary` inside `buildSimulation`; alpha-restart on `updateConfig` already handles the slider
- `src/workers/graphSimProtocol.ts` — protocol `ForceConfig` type already widens through `bindings.ts`-free local interface, but keep it manually in sync with `radarStore.ForceConfig`
- `src/workers/graphSimConfig.ts` — add `BOUNDARY_STRENGTH_DEFAULT` constant adjacent to existing tuning constants

### Files to Create
- `src-tauri/src/pipeline/ipc_bridges/mod.rs` — module entrypoint, `IpcBridgeDto` / `IpcCallSite` / `CallShape` types, `build_ipc_bridges` function
- `src-tauri/src/pipeline/ipc_bridges/bindings_parser.rs` — `src/bindings.ts` parser (camelCase ↔ snake_case + signature extraction)
- `src-tauri/src/pipeline/ipc_bridges/rust_handler_scanner.rs` — `#[tauri::command]` attribute grep + file/line resolution
- `src-tauri/src/pipeline/ipc_bridges/frontend_callsite_scanner.rs` — tree-sitter TS/TSX scan for `invoke(literal, …)` and `commands.camelName(…)` shapes
- `src-tauri/src/pipeline/ipc_bridges/test_fixtures/` — `sample_bindings.ts`, `sample_handler.rs`, `sample_caller_literal.ts`, `sample_caller_typed.tsx` (mirrors `pipeline/deps/test_fixtures/`)
- `src/views/Radar/forceBoundary.ts` (or `src/workers/forces/forceBoundary.ts` — planner's discretion) — custom d3-force boundary force
- `src/views/Radar/BridgeTooltip.tsx` OR reuse/extract a shared `RadarTooltip` component
- `src/views/Radar/__tests__/forceBoundary.test.ts` — force unit tests (convergence in N ticks, respects `kind` flag)
- `src/views/Radar/__tests__/BridgeRender.test.ts` — bridge geometry + selection-ring tests

### Existing Tests (patterns to follow)
- `src-tauri/src/pipeline/deps/mod.rs` `#[cfg(test)] mod tests` — fixture-based test pattern
- `src/hooks/__tests__/useGraphLayout.test.ts` — worker-mocked hook tests; Phase 12 doesn't change the hook but boundaryStrength must round-trip
- `src/views/Radar/__tests__/forceCluster.test.ts` — custom-force test pattern
- `src/views/Radar/__tests__/RadarCanvas.test.tsx` — visual regression / integration pattern

### Existing Subscribers That Stay Untouched
- `src/views/Radar/HeatMapOverlay.ts` / heat-map tint → unchanged (bridges are file-path-keyed like file nodes; bridges can receive heat if they map to a contended command, which is an interesting emergent signal left intact)
- `src/views/Radar/CometTrail.ts` — agent comet animation; file-path-based; bridges don't participate (bridges are not files)
- `src/stores/conflictStore.ts` — file-conflict domain; irrelevant to bridges

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src-tauri/src/pipeline/deps/*` — the entire dep-extraction module is the template for `ipc_bridges/`: tree-sitter grammar loading, rayon parallel scan, repo-relative path normalization, `tauri::async_runtime::spawn_blocking` wrapping, `DependencyEdgeDto` / `EdgeKind` DTO shape
- `src-tauri/src/lib.rs:42-92` — single `collect_commands![…]` + `.typ::<…>()` registration block. New command + types added here in one place
- `src/bindings.ts` — canonical tauri-specta output; 52 commands today in a stable textual shape amenable to regex parsing
- `src/stores/radarStore.ts` — `fetchGraph` already runs two commands in `Promise.all`; adding a third leg is a single-line addition. `ForceConfig`, `GraphNode`, `GraphEdge` extend cleanly
- `src/views/Radar/GraphRenderer.ts` — pure draw functions; adding `drawBridgeNodes` + `drawBoundaryLine` follows the existing shape
- `src/views/Radar/AgentTooltip.tsx` — existing tooltip shell; extract shared chrome or add a sibling `BridgeTooltip`
- `src/views/Radar/forceCluster.ts` — custom d3-force example; `forceBoundary.ts` mirrors its structure (takes nodes, exposes `initialize`/`tick`)
- `src/workers/graphSimCore.ts` — simulation factory with registered forces; new force slots in next to existing ones
- `src/views/Radar/ForceConfigPanel.tsx` — slider panel for `ForceConfig` sliders; add the boundaryStrength slider here
- tree-sitter grammars for TS, TSX, JS, JSX, Rust, Python already bundled (Phase 7 D-06); zero new dependencies required

### Established Patterns
- One Zustand store per domain — `radarStore` absorbs bridge state (D-12)
- Rust-side graph parsing + TypeScript-side rendering — Phase 7 invariant, extends to bridges
- Tauri commands: `#[tauri::command] #[specta::specta]` + `collect_commands!` registration + `.typ::<…>()` for DTOs
- `tauri::async_runtime::spawn_blocking` for CPU-heavy parsing
- Repo-relative forward-slash paths as node ids (commit `a1b15b6`)
- Tree-sitter queries colocated in `src-tauri/src/pipeline/deps/queries/` — bridge scanner gets its own queries subdirectory
- `DEFAULT_FORCE_CONFIG` + per-slider `setForceConfig` partial update — extend with `boundaryStrength`
- Canvas 2D world-space rendering with `ctx.setTransform(zoom, 0, 0, zoom, panX, panY)` — bridge labels flip to screen-space via `ctx.save` + identity transform for the label pass
- `#[cfg(test)] mod tests` colocated with modules; fixture files under `test_fixtures/` subdir

### Integration Points
- `src-tauri/src/pipeline/mod.rs` — add `pub mod ipc_bridges;`
- `src-tauri/src/pipeline/commands.rs` — register `get_ipc_bridges`
- `src-tauri/src/lib.rs` — `collect_commands!` + `.typ::<IpcBridgeDto>()` + `.typ::<IpcCallSite>()` + `.typ::<CallShape>()`
- `src-tauri/src/pipeline/deps/mod.rs` — extend `EdgeKind` enum with `Invokes` + `Handles` variants
- `src/bindings.ts` — regenerated on `cargo build`; NO manual edit
- `src/stores/radarStore.ts` — `fetchGraph` Promise.all extension, `selectedBridgeId` slot, `ForceConfig.boundaryStrength`, `DEFAULT_FORCE_CONFIG.boundaryStrength`
- `src/views/Radar/RadarCanvas.tsx` — draw-loop z-order extension (D-31) + hover/click dispatch branching on `kind`
- `src/views/Radar/GraphRenderer.ts` — new `drawBoundaryLine`, `drawBridgeNodes` exports
- `src/workers/graphSimCore.ts` — `sim.force('boundary', forceBoundary(nodes))` registration; alpha-restart plumbing is already there for `updateConfig`
- `src/workers/graphSimProtocol.ts` — `ForceConfig` shape widens by one field; worker inbound handler adapts
- No DB migration. No new Tauri plugin. No new runtime dependency (tree-sitter grammars already there).

</code_context>

<specifics>
## Specific Ideas

- **"Bridges on a line" is the money shot.** When the user sees 52 cyan diamonds strung along a horizontal line bisecting their graph, with TS files clustering above and Rust files clustering below, they immediately understand this codebase's spine without being told. That visual first-impression is the phase's whole deliverable — don't bury it behind a toggle, don't hide it at low zoom, don't make the line faint enough to miss. The ATC metaphor holds: the bridge layer is the airspace boundary; air traffic on either side is isolated but communication flows through the line.
- **Tauri-specta earns its keep here.** The 52 commands already exist in a typed, single-file representation. Any version of Phase 12 that hand-maintains a command list or hand-tracks which files invoke which is building its own bindings.ts. The parser should be 300 lines total; if it grows past that, something is wrong.
- **Channel<T> commands deserve a visible signal.** Phase 2's `start_watch` and the Phase 10 chat commands are architecturally distinct from fire-and-forget commands — they open long-lived streams. The double-stroke treatment (D-17) is a subtle "this one is more than a function call" flag. Future phases may animate active channels with pulses; v1 just draws them with weight.
- **The danger of "surface area" visualizations is they become read-only architecture diagrams nobody updates.** Because this one is regenerated from source every 500ms, it cannot drift. Drift is the reason most IPC-boundary diagrams go stale in 6 months. This one stays correct by construction.
- **Naming: "bridge" over "boundary" over "interface".** "Bridge" is concrete and visually evokes a crossing. "Boundary" is the line; "interface" is an abstract programming term already overloaded. The command surface is the bridges; the y=0 axis is the boundary. Keep those two words distinct in docs.
- **Alphabetic x-spread beats clever grouping for v1.** A user looking for `launch_agent` scans left-to-right; a user looking for "all agent commands" scrolls the selected-bridge detail panel. Alphabetic keeps the bridges' x-positions stable across file churn, which matters more than adjacency when the user is building a mental map of the command surface.
- **Dangling bridges (D-09) are actionable dead-code intel.** If a command exists in bindings.ts but nothing calls it, that's either a recently-written feature waiting on frontend integration or a retired handler. Either way, the user wants to know. The dashed-outline rendering is a feature, not a visual glitch.

</specifics>

<deferred>
## Deferred Ideas

- **Agent-driven invoke animation** — comet trail flies up to a bridge, through it, and terminates at the handler file when an agent makes a tool call that triggers a tauri command. Requires invoke-time telemetry hooks in the adapter layer. Natural v2 phase; defer.
- **Deep-link to source editor** — `vscode://file/...` or `cursor://file/...` URI handlers on caller path entries in the bridge detail panel. PROJECT.md already says "link to external editor", but the v1 UX is copy-paste paths. Polish phase candidate.
- **Drag-to-pin bridges** — user drags a bridge horizontally to reorder the FE/BE spine (e.g. group by subsystem). Requires abandoning the alphabetic deterministic layout. Deferred.
- **Event push bridges** — tauri-specta events. This project's `bindings.ts` events section is empty today; when it grows, mirror the command bridge logic with a separate `has_event_push` flag.
- **MCP server endpoints as bridges** — Phase 10's MCP two-tool surface (`get_pending_user_messages`, `request_user_input`) is technically a cross-language API surface, but it's a separate axum route + JSON-RPC not a tauri::invoke. Could be a future "HTTP bridges" layer. Deferred.
- **Phase 8 hook endpoint as a bridge** — same story: `/hook` on the self-register axum port is an IPC-like contract but not a tauri command. A unified "all cross-language surfaces" view is a post-v1 consolidation.
- **Aliased `commands` imports** — TS/TSX files that `import { commands as C }` and then call `C.fooBar()`. Zero occurrences in this repo today; add a tree-sitter query pass if it changes.
- **Variable-name invokes** — `invoke(someString, args)`. Requires TypeScript type-checker inspection (ts-morph); heavyweight for 3-4 false-negatives.
- **Grouped-by-subsystem x-spread** — bridges grouped as `agents.*` adjacent, `pipeline.*` adjacent, etc. More readable but less stable. Ship alphabetic in v1; revisit if feedback.
- **Bridge heat signal from actual invoke counts** — bridges tint based on how often they're called at runtime. Requires telemetry. Interesting but v2.
- **Bridge signature preview on hover shows full TS type (multi-line)** — v1 shows truncated single-line summary. Tooltip can grow to a collapsible multi-line form later.
- **Custom invoke wrappers** — if some hooks wrap `invoke` in a project-specific function like `safeInvoke(...)`, tree-sitter queries extend to catch it. No wrappers today; easy add when needed.
- **Bridge persistence** — save bridge-x-positions per workspace. Not needed given deterministic layout (D-14).
- **"Focus mode" on bridge selection** — dim all nodes not connected to the selected bridge. Listed in Claude's Discretion; if not shipped in v1, clearly a polish pass.
- **Rightmost viewport edge label** — mirror the FRONTEND/BACKEND labels on both ends of the boundary line. Saves scanning for a user who happens to be panned far right.

</deferred>

---

*Phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati*
*Context gathered: 2026-04-21*
*Auto-selected defaults; see 12-DISCUSSION-LOG.md for per-question log.*
