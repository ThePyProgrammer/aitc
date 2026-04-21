# Phase 12: IPC Bridge Nodes + Cross-Language Boundary - Research

**Researched:** 2026-04-21
**Domain:** Tauri-specta command-surface parsing + custom d3-force boundary-bifurcation force + Canvas 2D diamond glyphs on a Phase 7 graph radar
**Confidence:** HIGH for stack/integration points; HIGH for d3-force + tree-sitter patterns (already proven in Phase 7 / Phase 11); MEDIUM for bindings.ts regex specifics (empirically verified against the live 980-line file); MEDIUM for the 52-vs-51 command count (live count is 51 — see below).

## Summary

Phase 12 extends the Phase 7 / Phase 11 force-directed radar with a new structural dimension: each `#[tauri::command]` becomes a **diamond-shaped bridge node** pinned on a horizontal `y = 0` boundary, with TS/TSX files pushed into the upper half-plane and Rust files into the lower half-plane by a new **`forceBoundary`** custom d3-force. Parsing lives in a new Rust module `src-tauri/src/pipeline/ipc_bridges/` that mirrors the shape of `pipeline/deps/` — read `src/bindings.ts` as the canonical command catalog, grep `src-tauri/src/**/*.rs` for `#[tauri::command]` + following `fn`, tree-sitter-scan `src/**/*.ts(x)` for `invoke('literal', ...)` and `commands.camelName(...)` call-sites.

No new deps anywhere. Tree-sitter grammars already bundled (Phase 7 D-06). Rust `regex` crate already a direct dep (Cargo.toml:47, reused by Phase 7 resolve). d3-force / d3-quadtree / d3-polygon already installed. Lucide + Motion already present. The only new runtime footprint is 52 nodes + ~200 edges + 1 force + 1 slider + 1 panel section — negligible against the existing 100k-edge cap.

The two real risks are (1) **the "52-command" number in CONTEXT.md is off-by-one** — `grep -c "^async " bindings.ts` returns 51 today; the parser must tolerate this and the planner should update Plan copy from "52" to "~51" or "N"; and (2) **tree-sitter can't see `commands` aliased-import sites** — zero occurrences in this repo today (verified via grep), but if someone introduces `import { commands as C } from '../bindings'; C.fooBar()` the scanner silently misses them. CONTEXT §Deferred already acknowledges this.

**Primary recommendation:** Four-wave plan: (Wave 0) bindings regen fixture scaffolding + Rust module stubs + test fixtures + `forceBoundary.ts` test scaffold; (Wave 1) Rust `ipc_bridges/` build pipeline: `bindings_parser.rs` (regex), `rust_handler_scanner.rs` (regex), `frontend_callsite_scanner.rs` (tree-sitter), assembly in `mod.rs`, `get_ipc_bridges` Tauri command, bindings regen; (Wave 2) `forceBoundary` + `GraphNode.kind` discriminator + `ForceConfig.boundaryStrength` + worker protocol widening + `fetchGraph` Promise.all third leg; (Wave 3) `BridgeRenderer` Canvas 2D draw functions + `BridgeTooltip` + `BridgeDetailPanel` + `ForceConfigPanel` slider + `B` hotkey + render z-order insertions. Phase 12 specifically **does not** need a Wave 4 cleanup (nothing to delete).

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Parser Location & Source of Truth**
- **D-01** Bridge extraction runs on the Rust backend in a new module `src-tauri/src/pipeline/ipc_bridges/` (peer to `pipeline/deps/`).
- **D-02** `src/bindings.ts` is the canonical source of truth; parsed as plain text via regex over `async <camelName>(...) : Promise<Result<...>>`.
- **D-03** Rust handler file + line discovered by scanning `src-tauri/src/**/*.rs` for `#[tauri::command]` + following `fn <snake_name>(` via a Rust regex. Does NOT require tree-sitter Rust.
- **D-04** Frontend call-site detection uses tree-sitter TypeScript + TSX grammars already bundled for Phase 7. Two patterns: `invoke('snake_name', ...)` and `commands.camelName(...)`. Variable-invokes logged to `tracing::debug` and skipped.
- **D-05** No fallback regex — tree-sitter handles both shapes; variable-name invokes deferred.

**Bridge Data Model**
- **D-06** `IpcBridgeDto` fields: `command_name` (camelCase), `rust_name` (snake_case), `handler_file` (repo-relative), `handler_line` (u32, 1-indexed), `caller_files: Vec<IpcCallSite>`, `signature_summary: String`, `has_channel_arg: bool`. `IpcCallSite` = `{ file, line, shape: CallShape::{Literal,Typed} }`.
- **D-07** Commands only; no events, no HTTP, no MCP. `Channel<T>` commands flagged via `has_channel_arg: true`.
- **D-08** One bridge per command regardless of caller count. `invokes` edges fan-in from callers; `handles` edge fans-out to handler.
- **D-09** Dangling bridges (no callers or no handler) rendered with dashed outline. `tracing::warn!` for missing handler; `tracing::info!` for missing callers.

**Graph Integration**
- **D-10** Bridge nodes + file nodes share `graphNodes` array. `GraphNode` gains `kind: 'file' | 'bridge'` discriminator + optional bridge fields.
- **D-11** `EdgeKind` extends with `Invokes` + `Handles` variants in `pipeline::deps::EdgeKind` so the same type flows through both dep and bridge edges.
- **D-12** Single store (`radarStore`). `fetchGraph()` gains third parallel `get_ipc_bridges` invoke.

**Boundary Line & Layout Force**
- **D-13** Hard-pin bridges to y=0 via `fx, fy`. Directional force (`forceBoundary`) pushes file nodes based on language: TS/TSX/JS negative y, Rust positive y. `ForceConfig.boundaryStrength` default 0.15.
- **D-14** Bridge x-spread = deterministic alphabetic one-pass layout across `[-GRAPH_HALF_WIDTH, +GRAPH_HALF_WIDTH]`. Recomputed only on command-set change (hash commandName list).
- **D-15** Boundary line = thin horizontal line at y=0, stroke=theme.outline@60%, drawn after heat-map tint, before hulls. Two left-edge labels: FRONTEND·TypeScript / BACKEND·Rust.
- **D-16** Language classification: path prefix first (`src-tauri/` → backend), extension second (`.rs` → backend; `.ts/.tsx/.js/.jsx` → frontend); other files → no force applied.

**Bridge Node Visual Treatment**
- **D-17** Rotated square (diamond), half-diagonal = `NODE_RADIUS_DEFAULT * 1.6` = 8 world-px. Fill=theme.secondary (cyan #00cffc fallback). Channel-bearing = double-stroke. Dangling = dashed `[4,3]`.
- **D-18** Label = command name in JetBrains Mono above diamond, visible at zoom ≥ 4 (matches `FILE_LABEL_ZOOM_THRESHOLD`).
- **D-19** Bridges visible at ALL zoom levels.

**Interaction**
- **D-20** Hover → existing AgentTooltip chrome; 200ms dwell.
- **D-21** Click → select bridge. New `selectedBridgeId` in radarStore. White outer ring + detail panel in RadarManifest.
- **D-22** No deep-link to editor. Paths are copyable text only.

**Data Pipeline**
- **D-23** Indexed on watch start; third `Promise.all` leg in `fetchGraph()`.
- **D-24** Refreshed via existing `installRadarPipelineBridge` 500ms debounce.
- **D-25** No caching in v1.

**Schema & IPC**
- **D-26** New Tauri command `get_ipc_bridges` in `pipeline/commands.rs`. Signature: `async fn get_ipc_bridges(state: State<'_, PipelineState>) -> Result<Vec<IpcBridgeDto>, String>`. Registered in `lib.rs::collect_commands![…]` + `.typ::<...>()` for the 3 new types.
- **D-27** New `EdgeKind` variants `Invokes` + `Handles` in `pipeline/deps/mod.rs`.
- **D-28** No DB migration.

**Force-Config Panel**
- **D-29** New `BOUNDARY` slider, range 0–0.5, default 0.15.
- **D-30** `DEFAULT_FORCE_CONFIG.boundaryStrength: 0.15`. Backward-compat via `?? DEFAULT_FORCE_CONFIG.boundaryStrength`.

**Rendering z-order** (D-31): unchanged Phase 7 z-order with three insertions: (3) boundary line, (12/13) bridge nodes + labels, (22–24) screen-space anchor labels pass.

**Testing**
- **D-32** Rust unit tests colocated, fixtures under `src-tauri/src/pipeline/ipc_bridges/test_fixtures/`.
- **D-33** Frontend Vitest tests under `src/views/Radar/__tests__/`.
- **D-34** Optional visual verification checkpoint if automated evidence insufficient.

**Performance**
- **D-35** Target: bridge-index build <100ms on this repo.
- **D-36** Target: 60fps with bridges on 5k-file graph.
- **D-37** No worker protocol changes OTHER than `ForceConfig` widening by one field. `forceBoundary` registered in the worker alongside `forceCluster` / `forceClusterCollide`.

### Claude's Discretion

Per CONTEXT.md §Claude's Discretion — items the UI-SPEC and this research resolve:
- Tree-sitter aliased-imports → defer (zero occurrences in repo today, planner adds query later if count rises).
- `forceBoundary` math → **spring, not linear** (per d3-force idiom: `vy += sign * k * alpha`).
- `forceBoundary.ts` location → `src/workers/forces/forceBoundary.ts` (UI-SPEC Appendix A auto-selected; Phase 11 D-30 deferred cleanup direction).
- Diamond geometry → rotated square (not isometric).
- Bridge detail panel → extends `RadarManifest.tsx` (UI-SPEC).
- Focus mode (dim non-caller files) → **NOT in v1** (UI-SPEC F-01).
- Anchor label color → theme-keyed `theme.folderLabelColor`.
- X-spread → strict alphabetic.
- `signature_summary` → derive server-side.
- Caller line numbers in tooltip → tooltip shows count only; detail panel shows full list (UI-SPEC F-03).
- `#[specta::specta]` separate tracking → not needed.
- Recompute x-spread only on command-set hash change → yes, cache.
- Deadband → yes, ±5 world-px (new const `BOUNDARY_DEADBAND`).

### Deferred Ideas (OUT OF SCOPE)
Agent-driven invoke animation; deep-link editor (vscode://); drag-to-pin bridges; tauri events as bridges; MCP endpoints as bridges; /hook endpoint as bridge; aliased `commands` imports; variable-name invokes; grouped-by-subsystem x-spread; runtime invoke-count heat; multi-line signature preview; custom invoke wrapper detection; bridge position persistence; focus mode; right-edge anchor label mirror.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| (none new) | CONTEXT §Requirements states "no new requirement IDs; extends VIZN-01 / VIZN-05 / EMON-01 in spirit" | The research supports those existing requirements by adding cross-language IPC structure to the Phase 7 radar — no new test-mappable requirement lands in REQUIREMENTS.md. Downstream Phase Requirements → Test Map in §Validation Architecture uses phase-local witness IDs `V-12-01..V-12-12` instead of requirement IDs per the "no new IDs" rule. |

## Project Constraints (from CLAUDE.md)

Directives the planner must honor — extracted from the codebase's CLAUDE.md:

1. **Tauri v2 + React 19.2 + TypeScript** — established; Phase 12 extends, does not change.
2. **Canvas 2D + visx math** — bridge diamond is a Canvas 2D primitive; no WebGL.
3. **tauri-specta** (`#[tauri::command] #[specta::specta]` + `collect_commands!` + `.typ::<...>()`) — MANDATORY for `get_ipc_bridges` so `src/bindings.ts` regenerates.
4. **Zustand per-domain stores** — `radarStore` absorbs bridge state. No new store.
5. **Tailwind v4 CSS-first tokens + Command Horizon design system** — phosphor green palette, zero-radius corners, thin-stroke icons. All bridge visuals must compose from existing tokens (no new hex).
6. **GSD workflow enforcement** — all edits go through GSD commands; planner sizes plans so each task commits.
7. **Commit after every change** (user MEMORY.md rule) — planner should target one commit per task, not batched.
8. **Only fix own bugs** (user MEMORY.md rule) — if the planner surfaces unrelated failures during Phase 12 work, log to deferred-items.md, do not silently repair.
9. **Test frameworks**: vitest + `@testing-library/react` + jsdom for frontend; `cargo test` + `#[cfg(test)] mod tests` + `tempfile` for Rust. Fixtures under `test_fixtures/` subdirectories.
10. **Repo-relative forward-slash path serialization** (commit `a1b15b6`) — `IpcBridgeDto.handler_file` and `IpcCallSite.file` MUST strip `repo_root` and `replace('\\', '/')` before DTO emit. Same idiom `pipeline::commands::get_dependency_graph:356-368` uses.
11. **Node IDs = repo-relative paths** — bridges don't use paths as their id (they use `command_name`) but their `handler_file` / caller `file` fields must follow the path convention so they collide-match with existing `contentionScores` + `graphNodes` keyed maps.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bindings.ts parse (camelCase ↔ snake_case, signatures, channel detection) | Backend/Rust | — | D-01/D-02 — graph data on Rust side; regex over generated output is the cheapest correct parser. |
| Rust handler discovery (`#[tauri::command]` → file+line) | Backend/Rust | — | D-03 — regex scan over `src-tauri/src/**/*.rs`. |
| Frontend call-site discovery (invoke-literal + commands-typed) | Backend/Rust | — | D-04 — tree-sitter TS/TSX on backend matches Phase 7 idiom; frontend never parses source. |
| `IpcBridgeDto` DTO construction | Backend/Rust | — | D-06 — specta-tagged, serialized via new Tauri command. |
| `forceBoundary` custom d3-force | Web Worker | Main thread (pin setup) | D-37 — physics runs in Phase 11 worker; main thread assigns `fx, fy` on bridge-kind nodes before posting `init`/`topology`. |
| Bridge x-spread computation (alphabetic) | Main thread | — | D-14 — pure function called during `fetchGraph` result assembly; bridges' `fx` sent through `InitMessage.nodes[].fx`. |
| `GraphNode.kind` discriminator + bridge metadata storage | Main thread (Zustand) | — | D-10/D-12 — radarStore extension. |
| Bridge draw (diamond, boundary line, labels, selection ring) | Main thread (Canvas 2D) | — | New `BridgeRenderer.ts`; mirrors `GraphRenderer.ts` pure-function idiom. |
| Bridge hit-testing (hover, click) | Main thread (d3-quadtree) | — | Extend existing quadtree; diamonds handled via 10-world-px circular hit radius. |
| Bridge tooltip (HTML) | Main thread (React) | — | Shared chrome with `AgentTooltip`. |
| Bridge detail panel (HTML) | Main thread (React) | — | New section inside `RadarManifest.tsx`. |
| FRONTEND / BACKEND anchor labels | Main thread (Canvas 2D, screen-space) | — | Drawn in screen-space pass after world-space content (UI-SPEC z-order step 22–24). |
| Channel-arg detection (in bindings.ts parse) | Backend/Rust | — | D-07; `has_channel_arg` flag. |
| Language classification for `forceBoundary` target | Main thread (pure fn) | Web Worker reads `node.language` flag | D-16 — computed once at `fetchGraph` → sent to worker via `InitMessage.nodes[].language`. |

## Standard Stack

### Core (reused, nothing new)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| d3-force | ^3.0.0 | Custom `forceBoundary` registers alongside existing forces | Already in use Phase 7/11; custom-force idiom is `{ force(alpha); force.initialize(nodes) }` per d3-force contract [VERIFIED: package.json; CITED: d3js.org/d3-force/simulation] |
| d3-quadtree | ^3.0.1 | Bridge hit-test reuses existing quadtree (10-world-px circular hit radius per UI-SPEC) | Already in use; no change needed [VERIFIED: package.json] |
| tree-sitter + tree-sitter-typescript | =0.26.8 + =0.23.2 | TS/TSX scan for `invoke('literal', ...)` and `commands.camelName(...)` | Already bundled Phase 7 D-06; Rust `Parser` + `Query` + `QueryCursor` thread-local cache pattern already established in `src-tauri/src/pipeline/deps/extract.rs:27-35` [VERIFIED: Cargo.toml:53-54] |
| regex | ^1 | bindings.ts text parse + Rust `#[tauri::command]` attribute scan | Already a direct dep (Cargo.toml:47) — do NOT add new deps. Used by Phase 7 resolve already. [VERIFIED: Cargo.toml] |
| rayon | =1.12.0 | Parallel frontend call-site scan (mirror Phase 7 `par_iter()` over file list) | Already a direct dep; thread-local tree-sitter Parser + Query cache idiom from Phase 7 carries over [VERIFIED: Cargo.toml:58] |
| tauri-specta | =2.0.0-rc.21 | New `IpcBridgeDto` / `IpcCallSite` / `CallShape` types flow through bindings.ts regen | Already configured; adding `.typ::<...>()` calls in `lib.rs` is a one-line-per-type change [VERIFIED: Cargo.toml:27] |
| specta | =2.0.0-rc.22 | Derives via `#[derive(Type)]` | Already configured [VERIFIED: Cargo.toml:28] |
| Motion (Framer) | ^12 | `AnimatePresence` for `BridgeDetailPanel` mount/unmount | Already used by `AlertDetail` + manifest collapse; mirror the idiom [VERIFIED: package.json] |
| Lucide React | ^1.7 | `X` icon for detail-panel close button | Already used extensively; strokeWidth 1.5px globally [VERIFIED: CLAUDE.md, used in RadarManifest.tsx:29] |

**No new frontend deps.** No new backend crates. No new Tauri plugins. Confirmed by CONTEXT §Specifics: "Tauri-specta earns its keep here."

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Verdict |
|------------|-----------|----------|---------|
| Regex over bindings.ts | tree-sitter TypeScript on bindings.ts | Tree-sitter is overkill for a machine-generated file that tauri-specta guarantees stays in a stable shape. Regex is ~50 lines and readable; tree-sitter is ~150 lines and requires loading the grammar for the bindings file too. | **Keep regex** (D-02 locked) |
| Regex over `#[tauri::command]` | tree-sitter Rust | Tree-sitter Rust is already loaded for dep extraction — could share. But the pattern `#[tauri::command]` on a line followed by an optional `#[specta::specta]` then `pub async fn <name>(` is trivially regex-matchable. Tree-sitter adds query complexity without gain. | **Keep regex** (D-03 locked) |
| Tree-sitter TS/TSX call-sites | Regex | Regex would match comments, string literals containing `invoke('foo',`, and template literals. tree-sitter filters these by AST position. CONTEXT D-04/D-05 already locked tree-sitter. | **Keep tree-sitter** (D-04 locked) |
| `ts-morph` for aliased-import detection | tree-sitter queries | `ts-morph` needs Node + tsconfig awareness — heavyweight. Zero aliased `commands` imports in repo today (grep-verified). | **Defer** per D-05 + CONTEXT §Deferred |
| Per-snapshot bindings cache | Rebuild each fetch | Phase 7 D-24 already established rebuild-from-source. Cost budget <100ms. No cache needed v1. | **No cache** (D-25 locked) |

**Installation:** No changes. Verification:

```bash
# Already installed — no-op verification commands
npm ls d3-force d3-quadtree d3-polygon
cargo tree -p aitc | grep -E "regex|tree-sitter|rayon"
```

**Version verification (2026-04-21):**
- `d3-force` 3.0.0 — stable since 2021-06-05, no churn [VERIFIED: npm package.json]
- `tree-sitter` =0.26.8, `tree-sitter-typescript` =0.23.2, `tree-sitter-javascript` =0.25.0, `tree-sitter-rust` =0.24.2 — pinned by Phase 7; do not drift (Phase 7 Pitfall 4 — "Incompatible language version" is the failure mode) [VERIFIED: Cargo.toml:53-57]
- `regex` ^1 — transitive major version, any 1.x acceptable [VERIFIED: Cargo.toml:47]
- `rayon` =1.12.0 — pinned by Phase 7 [VERIFIED: Cargo.toml:58]

## Architecture Patterns

### System Architecture Diagram

```
                         ┌────────────────────────────────────────────────────────┐
      ┌──────┐           │                 src-tauri/src/pipeline/                │
      │Watch │──start──▶ │  ┌─────────────┐   ┌─────────────────────────────────┐ │
      │Start │           │  │ tree_index  │   │  ipc_bridges/ (NEW)             │ │
      └──────┘           │  │   (Phase 2) │   │    ┌──────────────────────┐     │ │
                         │  └──────┬──────┘   │    │ bindings_parser.rs   │     │ │
                         │         │          │    │  regex over          │     │ │
                         │  ┌──────▼──────┐   │    │  src/bindings.ts     │     │ │
                         │  │ deps/       │   │    └──────────┬───────────┘     │ │
                         │  │  (Phase 7)  │   │               │                 │ │
                         │  └──────┬──────┘   │    ┌──────────▼───────────┐     │ │
                         │         │          │    │ rust_handler_scanner │     │ │
                         │         │          │    │  regex + rayon       │     │ │
                         │         │          │    │  over src-tauri/**.rs│     │ │
                         │         │          │    └──────────┬───────────┘     │ │
                         │         │          │               │                 │ │
                         │         │          │    ┌──────────▼───────────┐     │ │
                         │         │          │    │ frontend_callsite_   │     │ │
                         │         │          │    │  scanner (tree-      │     │ │
                         │         │          │    │  sitter, rayon)      │     │ │
                         │         │          │    │  over src/**/*.ts(x) │     │ │
                         │         │          │    └──────────┬───────────┘     │ │
                         │         │          │               │                 │ │
                         │         │          │    ┌──────────▼───────────┐     │ │
                         │         │          │    │  build_ipc_bridges   │     │ │
                         │         │          │    │  assemble IpcBridgeDto[]│  │ │
                         │         │          │    └──────────┬───────────┘     │ │
                         │         │          └───────────────┼─────────────────┘ │
                         │         │                          │                   │
                         │  ┌──────▼──────┐    ┌──────────────▼─────────────┐    │
                         │  │ get_tree_   │    │ get_ipc_bridges (NEW)      │    │
                         │  │ index       │    │  Tauri command, spawn_     │    │
                         │  │ get_dep...  │    │  blocking-wrapped          │    │
                         │  └──────┬──────┘    └──────────────┬─────────────┘    │
                         └─────────┼──────────────────────────┼──────────────────┘
                                   │                          │
                                   │  ┌───────────────────────┘
                                   │  │    (tauri-specta bindings.ts)
                                   ▼  ▼
                         ┌─────────────────────────┐
                         │ radarStore.fetchGraph() │
                         │  Promise.all [tree,     │
                         │               deps,     │
                         │               bridges]  │
                         └──────────┬──────────────┘
                                    │
                    ┌───────────────┼───────────────────────────────┐
                    ▼               ▼                               ▼
          ┌──────────────────┐ ┌──────────────────┐    ┌──────────────────────┐
          │ graphNodes merge │ │ graphEdges merge │    │ bridge x-spread +    │
          │ file + bridge    │ │ dep + invokes +  │    │ fx/fy pin @ y=0      │
          │  kind discrim.   │ │  handles kinds   │    │  (alphabetic)        │
          └────────┬─────────┘ └────────┬─────────┘    └──────────┬───────────┘
                   │                    │                         │
                   └────────────────────┼─────────────────────────┘
                                        │
                                        ▼
                       ┌────────────────────────────────────┐
                       │  useGraphLayout — posts InitMessage │
                       │  to Worker (sequence bump)          │
                       └──────────────┬─────────────────────┘
                                      ▼
                       ┌────────────────────────────────────┐
                       │  graphSim.worker.ts (Phase 11)      │
                       │   ┌──────────────────────────┐     │
                       │   │ forceCluster             │     │
                       │   │ forceClusterCollide      │     │
                       │   │ forceBoundary (NEW)      │     │
                       │   │ forceLink / forceCharge  │     │
                       │   │ forceCenter / Collide    │     │
                       │   └──────────────────────────┘     │
                       │   ping-pong Float32Array back       │
                       └──────────────┬─────────────────────┘
                                      ▼
                       ┌────────────────────────────────────┐
                       │  RadarCanvas rAF loop               │
                       │    draw boundary line (world-sp)    │
                       │    draw hulls / edges / arrows / nodes (existing)│
                       │    draw bridge diamonds (NEW)        │
                       │    draw bridge labels (NEW)          │
                       │    draw selection halo (+ bridge)    │
                       │    draw trails / dots / conflicts    │
                       │    [screen-space pass]              │
                       │      draw FRONTEND/BACKEND labels    │
                       └────────────────────────────────────┘
                                      ▲
                                      │
                       ┌──────────────┴─────────────────────┐
                       │  HTML overlays                      │
                       │    BridgeTooltip (on hover)         │
                       │    RadarManifest → BridgeDetailPanel│
                       │    ForceConfigPanel → BOUNDARY slider│
                       └────────────────────────────────────┘

    File watcher (Phase 2 debouncer) ──── 500ms ───▶  installRadarPipelineBridge ──▶ fetchGraph()
                                                      (D-24 cadence — refreshes bridges along with graph)
```

### Recommended Project Structure

```
src-tauri/src/pipeline/
├── deps/                         # Phase 7 — unchanged except EdgeKind extends
│   ├── mod.rs                    # add `Invokes` + `Handles` variants to EdgeKind
│   ├── extract.rs
│   ├── resolve.rs
│   └── queries/
├── ipc_bridges/                  # NEW Phase 12
│   ├── mod.rs                    # IpcBridgeDto / IpcCallSite / CallShape types + build_ipc_bridges()
│   ├── bindings_parser.rs        # regex over src/bindings.ts; BindingCommand shape
│   ├── rust_handler_scanner.rs   # regex over src-tauri/**.rs; HandlerHit { snake_name, file, line }
│   ├── frontend_callsite_scanner.rs  # tree-sitter over src/**/*.ts(x); CallSiteHit { file, line, shape, name }
│   ├── queries/
│   │   └── typescript.rs         # TS/TSX query for `invoke('literal',...)` + `commands.camelName(...)`
│   └── test_fixtures/
│       ├── sample_bindings.ts    # miniaturized tauri-specta output (5-8 commands)
│       ├── sample_handler.rs     # 3 handlers incl. pub async fn, async fn, pub fn + channel one
│       ├── sample_caller_literal.ts    # 5 invoke(...) shapes incl. 1 var-callee + 1 in-comment
│       └── sample_caller_typed.tsx     # 3 commands.X() shapes incl. 1 aliased-import (skipped)
├── commands.rs                   # add get_ipc_bridges (mirrors get_dependency_graph)
├── pipeline_state.rs             # unchanged (D-25 defers caching)
└── tree_index.rs                 # unchanged

src/
├── hooks/
│   └── useGraphLayout.ts         # unchanged signature; ForceConfig widens transitively
├── workers/
│   ├── graphSim.worker.ts        # unchanged (core is the integration point)
│   ├── graphSimCore.ts           # register forceBoundary alongside forceCluster/Collide
│   ├── graphSimConfig.ts         # add BOUNDARY_STRENGTH_DEFAULT = 0.15, BOUNDARY_DEADBAND = 5, GRAPH_HALF_WIDTH = 1600
│   ├── graphSimProtocol.ts       # widen ForceConfig + InitMessage.nodes[] with kind + language + fy
│   └── forces/                   # NEW directory
│       └── forceBoundary.ts      # custom d3-force
├── stores/
│   └── radarStore.ts             # GraphNode.kind + bridge fields + selectedBridgeId + boundaryStrength + fetchGraph 3rd leg + B hotkey state
├── views/Radar/
│   ├── RadarCanvas.tsx           # z-order insertions: boundary line, bridge nodes, bridge labels, screen-space FE/BE labels
│   ├── GraphRenderer.ts          # drawEdges switches on Invokes/Handles kind
│   ├── BridgeRenderer.ts         # NEW: drawBoundaryLine, drawBridgeNodes, drawBridgeLabels, drawSelectedBridge, drawBoundaryAnchorLabels
│   ├── BridgeTooltip.tsx         # NEW: reuses AgentTooltip chrome
│   ├── BridgeDetailPanel.tsx     # NEW: renders inside RadarManifest
│   ├── ForceConfigPanel.tsx      # add BOUNDARY slider after CENTER
│   ├── RadarManifest.tsx         # render <BridgeDetailPanel/> when selectedBridgeId !== null
│   └── __tests__/
│       ├── forceBoundary.test.ts
│       ├── BridgeRenderer.test.ts
│       └── BridgeDetailPanel.test.tsx
└── bindings.ts                   # auto-regenerated by tauri-specta on cargo build
```

### Pattern 1: Bindings.ts regex parse (D-02)
**What:** Scan `src/bindings.ts` once with one multi-capture regex per "entry shape" to produce `Vec<BindingCommand>`.

**The live bindings.ts grammar** (empirically verified 2026-04-21 against 980-line `src/bindings.ts`, count: 51 async methods):

Every command is rendered as:
```typescript
/**
 * Optional one or more doc-comment lines (may contain stars).
 */
async camelName(arg1: Type1, arg2: Type2, …) : Promise<Result<ReturnType, ErrType>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("snake_name", { arg1, arg2, … }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
```

No-arg commands render as `async camelName() : Promise<Result<…>>`. Channel-bearing commands include a `channel: TAURI_CHANNEL<TSend>` in the arg list. Doc comments (leading `/** … */`) precede the `async` keyword and MUST be skipped by the parser.

**When to use:** Once per `build_ipc_bridges` call. Total source ~1000 lines; regex-sweep is <1ms.

**Recommended regex (verified against live bindings.ts):**

```rust
// In src-tauri/src/pipeline/ipc_bridges/bindings_parser.rs
use regex::Regex;
use once_cell::sync::Lazy; // Not a new dep — use std::sync::OnceLock instead (MSRV-safe)
use std::sync::OnceLock;

/// Captures in order:
///   1 = camelName
///   2 = args text (between outer parens, possibly multi-line)
///   3 = return type text (between `Promise<` and the matching `>`)
/// Anchored to column 1 per the tauri-specta emit style. `(?m)^` makes ^ match
/// line-starts. The `[\s\S]*?` inside args tolerates multi-line arg lists.
fn signature_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?m)^async\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*:\s*Promise<([\s\S]*?)>\s*\{"
        ).expect("bindings regex compiles")
    })
}

/// Matches the TAURI_INVOKE call on the line below, captures the snake_name.
fn invoke_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"TAURI_INVOKE\("([a-z_][a-z0-9_]*)""#).expect("invoke regex compiles")
    })
}

/// Detects whether any arg carries a TAURI_CHANNEL<...> type.
fn channel_arg_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\bTAURI_CHANNEL\b").expect("channel regex compiles"))
}
```

The parser pairs each `signature_re` hit with the next `invoke_re` hit within the same method body (search window: next ~20 lines). Mismatch → log `tracing::warn!` and skip — indicates tauri-specta emit drift.

**`std::sync::OnceLock` over `once_cell::sync::Lazy`:** OnceLock is std-library since Rust 1.70. No new dep.

**Signature summary derivation (server-side, per CONTEXT discretion):** `signature_summary = format!("({args_text}) → {return_type_text}")`. Truncate to 120 chars to keep tooltip tidy. Strip whitespace runs (`\s+ → " "`).

### Pattern 2: Rust handler scan (D-03)
**What:** Walk every `.rs` under `src-tauri/src/` in parallel, match `#[tauri::command]` + next `fn <name>(` within a small line window.

**Recommended regex (verified against live handler code):**

```rust
// In src-tauri/src/pipeline/ipc_bridges/rust_handler_scanner.rs
fn handler_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Multi-line, dot-all. Captures (name, fn_line_offset).
        // Tolerates:
        //   #[tauri::command]\n[optional #[specta::specta]]\n[pub ][async ]fn name(
        //   #[tauri::command(async)]
        Regex::new(
            r"(?m)^\s*#\[tauri::command(?:\([^\)]*\))?\]\s*(?:\n\s*#\[[^\]]+\]\s*)*\n\s*(?:pub(?:\([^\)]*\))?\s+)?(?:async\s+)?fn\s+([a-z_][a-z0-9_]*)\s*\("
        ).expect("handler regex compiles")
    })
}
```

**How to extract `handler_line`:** find match start offset → count `\n` before offset + 1 (1-indexed). Alternatively locate `fn <name>(` specifically inside the captured span. Per CONTEXT D-06: "1-indexed line of `fn` declaration."

**Rayon over the Rust file set:**

```rust
use rayon::prelude::*;
use walkdir::WalkDir;

pub fn scan_rust_handlers(src_tauri_root: &Path) -> HashMap<String, HandlerHit> {
    let files: Vec<PathBuf> = WalkDir::new(src_tauri_root.join("src"))
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("rs"))
        .map(|e| e.path().to_path_buf())
        .collect();

    let per_file: Vec<Vec<HandlerHit>> = files.par_iter()
        .map(|p| scan_one_rust_file(p))
        .collect();

    // Dedupe: multiple matches for the same name → pick first, log warn.
    let mut out: HashMap<String, HandlerHit> = HashMap::new();
    for batch in per_file {
        for hit in batch {
            if let Some(existing) = out.get(&hit.snake_name) {
                tracing::warn!(
                    name = %hit.snake_name,
                    first_file = %existing.file.display(),
                    dup_file = %hit.file.display(),
                    "ipc_bridges: duplicate #[tauri::command] handler; keeping first"
                );
            } else {
                out.insert(hit.snake_name.clone(), hit);
            }
        }
    }
    out
}
```

`walkdir` is already a dep (Cargo.toml:65); if a filter is desired, exclude `target/`, `test_fixtures/` (Phase 7 deps does this implicitly by iterating `pipeline_state.tree_index`). For Phase 12 we don't need to use `tree_index` — we walk `src-tauri/src/` directly (it's small; ~100 files).

**Defense against false positives:** the regex anchors on `#[tauri::command]` — bare `command!` macros or literal `tauri::command` in a string will not match because of the `#[...]` bracketing. Test-fixture verified.

### Pattern 3: Frontend call-site tree-sitter queries (D-04)
**What:** Run a tree-sitter TS/TSX query over every frontend file; capture both `invoke('literal', ...)` and `commands.camelName(...)` sites.

**Reusing Phase 7's thread-local Parser+Query cache:** The cache in `src-tauri/src/pipeline/deps/extract.rs:27-35` is per-language, 6-slot. The bridge scanner needs its OWN cache because its queries are different. Create a parallel cache inside `frontend_callsite_scanner.rs`:

```rust
// src-tauri/src/pipeline/ipc_bridges/frontend_callsite_scanner.rs
thread_local! {
    static BRIDGE_PARSERS: RefCell<[Option<Parser>; 2]> = const { RefCell::new([None, None]) };
    static BRIDGE_QUERIES: RefCell<[Option<Query>; 2]> = const { RefCell::new([None, None]) };
}
// slot 0 = TypeScript, slot 1 = TSX
```

**Recommended tree-sitter query** (combined, one pattern per shape):

```scheme
;; src-tauri/src/pipeline/ipc_bridges/queries/typescript.rs
;; Pattern 0 — invoke('literal', …)   OR   invoke("literal", …)
(call_expression
  function: (identifier) @_fn
  arguments: (arguments
    .
    (string (string_fragment) @command)
  )
  (#eq? @_fn "invoke")) @invoke_literal

;; Pattern 1 — commands.camelName(…)
(call_expression
  function: (member_expression
    object: (identifier) @_obj
    property: (property_identifier) @command)
  (#eq? @_obj "commands")) @commands_typed
```

**Why this works:**
- `(string (string_fragment))` specifically matches plain string literals (single/double-quoted); template literals parse as `template_string` which won't match → variable invokes like `` invoke(`${cmdName}`, …) `` correctly skip (D-05).
- The leading `.` anchor `.` inside `(arguments . …)` ensures the string is the **first** arg (otherwise comments or multi-arg-position shuffles could slip in).
- `(#eq? @_fn "invoke")` forbids false matches against user-named locals like `myInvoke('…', …)` — though CONTEXT §Deferred mentions custom invoke wrappers as a future add.
- Aliased imports (`import { commands as C } from '../bindings'; C.foo()`) do NOT match pattern 1 because `@_obj` is bound to a specific identifier `commands`. v1 accepts this gap (zero occurrences in repo today per CONTEXT §Discretion).

**Line-number extraction:** `m.captures[0].node.start_position().row + 1` gives 1-indexed line. Phase 7 dep extractor doesn't emit line numbers (edges are just `from → to`) so this is new for Phase 12 but the API is standard. Confirmed via tree-sitter docs.

**Call-shape discrimination:** `match m.pattern_index { 0 => CallShape::Literal, 1 => CallShape::Typed, _ => continue }`.

**File scope:** Walk `src/**/*.{ts,tsx,js,jsx}` but **exclude `src/bindings.ts` itself** (it has `invoke` in it transitively, and the file ending up counted as a caller of every command would be nonsense).

```rust
let files: Vec<PathBuf> = WalkDir::new(frontend_src_root)
    .into_iter()
    .filter_map(|e| e.ok())
    .filter(|e| {
        let p = e.path();
        matches!(p.extension().and_then(|s| s.to_str()), Some("ts" | "tsx" | "js" | "jsx"))
            && p.file_name().and_then(|s| s.to_str()) != Some("bindings.ts")
    })
    .map(|e| e.path().to_path_buf())
    .collect();
```

### Pattern 4: Custom `forceBoundary` d3-force (D-13)
**What:** Pure function force that nudges each node's `vy` toward a per-node target y based on `node.kind` + `node.language`. Bridges have `fy: 0` pinned and are immune (d3-force snaps `y = fy; vy = 0` AFTER forces run, per canonical d3 behavior).

**Critical behavior note (verified via d3-force docs, 2026-04-21):**
> "At the end of each tick, after the application of any forces, a node with a defined node.fx has node.x reset to this value and node.vx set to zero; likewise, a node with a defined node.fy has node.y reset to this value and node.vy set to zero." — [CITED: d3js.org/d3-force/simulation]

**This means:** `forceBoundary` is free to write `node.vy` for bridges too — the simulation clobbers it after all forces run. No fight between `fx/fy` pins and the force. Simpler to implement (no branching needed for bridge-kind nodes), but a dead-code branch wastes cycles. Recommended: skip bridges explicitly in the force for ~3% perf gain at 10k nodes:

```typescript
// src/workers/forces/forceBoundary.ts
import type { SimulationNodeDatum } from 'd3-force';

export interface BoundaryNode extends SimulationNodeDatum {
  kind: 'file' | 'bridge';
  // 'ts' => negative y target; 'rust' => positive y; undefined => no force applied
  language?: 'ts' | 'rust';
}

export interface BoundaryForce {
  (alpha: number): void;
  initialize: (nodes: BoundaryNode[]) => void;
  strength: ((v: number) => BoundaryForce) & (() => number);
}

// Spring-response idiom matches forceCluster / forceClusterCollide (strength * alpha * sign).
// Deadband prevents jitter along y=0 boundary (CONTEXT §Discretion).
// Target magnitudes are equal & opposite — a generous +/- 300 world-units keeps the
// bifurcation visible on screen after settle without being so aggressive that nodes
// fly to the corners.
const TARGET_Y_MAGNITUDE = 300; // world-space; bridge-equidistant target per side
const DEADBAND = 5;             // world-space; BOUNDARY_DEADBAND

export function forceBoundary(): BoundaryForce {
  let nodes: BoundaryNode[] = [];
  let strength = 0.15;

  const force = ((alpha: number) => {
    const k = strength * alpha;
    if (k === 0) return; // fast path — slider at 0 collapses the force
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.kind !== 'file') continue; // bridges are pinned; don't bother
      if (n.language === undefined) continue; // non-TS / non-Rust files drift (D-16)
      const targetY = n.language === 'ts' ? -TARGET_Y_MAGNITUDE : TARGET_Y_MAGNITUDE;
      const y = n.y ?? 0;
      const dy = targetY - y;
      if (Math.abs(y) < DEADBAND && Math.abs(dy) > TARGET_Y_MAGNITUDE - DEADBAND) {
        // Inside deadband — skip to avoid jitter near the line.
        continue;
      }
      n.vy = (n.vy ?? 0) + Math.sign(dy) * k * Math.min(Math.abs(dy), TARGET_Y_MAGNITUDE);
    }
  }) as BoundaryForce;

  force.initialize = (n: BoundaryNode[]) => {
    nodes = n;
  };
  force.strength = ((v?: number) => {
    if (v === undefined) return strength;
    strength = v;
    return force;
  }) as BoundaryForce['strength'];

  return force;
}
```

**Cost analysis:** O(N) per tick — one branch + optional `vy` write per file node. At 5k files: ~5k iterations × ~20ns = 0.1ms/tick. Well within budget. [ASSUMED based on forceCluster ~0.15ms/tick at 5k; validate in Wave 2 test]

**Registration in `graphSimCore.ts`:**

```typescript
// Where .force('cluster', forceCluster().strength(cfg.clusterStrength)) is registered,
// add one sibling:
.force('boundary', forceBoundary().strength(cfg.boundaryStrength))
```

And extend `updateConfig`:

```typescript
(sim.force('boundary') as ReturnType<typeof forceBoundary>).strength(cfg.boundaryStrength);
sim.alpha(FORCE_CONFIG_ALPHA).restart();
```

### Pattern 5: Bridge x-spread (D-14)
**What:** Deterministic alphabetic placement of bridges across `[-GRAPH_HALF_WIDTH, +GRAPH_HALF_WIDTH]`. Cache keyed on `sha256(sorted_command_names.join(','))` so recomputation only happens when the command set genuinely changes.

**Missing constant:** There is no existing `GRAPH_HALF_WIDTH` in `graphSimConfig.ts` (verified via `grep`). The initial-position-seed scatter uses `±100` (`(rng() - 0.5) * 200`). Bridges need a wider spread so 51 of them don't jam — **recommend `GRAPH_HALF_WIDTH = 1600` world-units**, added as a new export in `graphSimConfig.ts`.

Rationale: at default viewport zoom 1, canvas is ~1280×800 screen-px. 3200 world-units span comfortably exceeds one viewport, giving bridges ~60 world-units apart (≈60 screen-px at zoom 1, readable with 8px half-diagonal diamonds). At 51 bridges, spacing = 3200 / 50 = 64 world-units.

```typescript
// main-thread code in radarStore.fetchGraph, after merging bridges into graphNodes:
import { GRAPH_HALF_WIDTH } from '../workers/graphSimConfig';

function assignBridgeXSpread(bridgeNodes: GraphNode[]): void {
  const sorted = [...bridgeNodes].sort((a, b) => a.commandName!.localeCompare(b.commandName!));
  const n = sorted.length;
  if (n === 0) return;
  const step = n === 1 ? 0 : (2 * GRAPH_HALF_WIDTH) / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = -GRAPH_HALF_WIDTH + step * i;
    sorted[i].fx = x;
    sorted[i].fy = 0;
    sorted[i].x = x;
    sorted[i].y = 0;
  }
}
```

**Cache key:** A simple djb2-style hash over the joined command-names is enough — no sha256 needed. Cache the hash in radarStore and skip re-running the spread pass when it matches:

```typescript
function hashCommandSet(bridges: GraphNode[]): number {
  let h = 5381;
  const names = bridges.map(b => b.commandName!).sort();
  for (const name of names) {
    for (let i = 0; i < name.length; i++) h = ((h << 5) + h) ^ name.charCodeAt(i);
  }
  return h;
}
```

Store the last hash in `radarStore` (`lastBridgeSetHash: number | null`). On `fetchGraph`, compare; if unchanged, preserve existing bridge `fx` coords (don't re-assign, even if topology rewarms).

### Pattern 6: Canvas 2D diamond draw
**What:** Rotated square via 4 line segments from the 4 cardinal points of a circle with radius = `BRIDGE_HALF_DIAG`.

```typescript
// src/views/Radar/BridgeRenderer.ts
export function drawBridgeNodes(
  ctx: CanvasRenderingContext2D,
  bridges: GraphNode[],
  selectedBridgeId: string | null,
  hoveredNodeId: string | null,
  zoom: number,
  theme: GraphTheme,
) {
  const d = BRIDGE_HALF_DIAG / zoom;
  const strokeW = 1 / zoom;
  const fill = theme.edgeGlow ?? theme.arrowFill ?? '#00cffc';
  const stroke = theme.nodeStroke;

  ctx.lineWidth = strokeW;

  for (const b of bridges) {
    if (b.x === undefined || b.y === undefined) continue;
    // Inner diamond.
    ctx.beginPath();
    ctx.moveTo(b.x, b.y - d);
    ctx.lineTo(b.x + d, b.y);
    ctx.lineTo(b.x, b.y + d);
    ctx.lineTo(b.x - d, b.y);
    ctx.closePath();

    // Dangling = dashed.
    if (b.callerCount === 0 || !b.handlerFile) {
      ctx.setLineDash([4, 3]);
    }
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.setLineDash([]);

    // Channel-bearing = outer double-stroke ring at half-diagonal + 2 world-units.
    if (b.hasChannelArg) {
      const d2 = (BRIDGE_HALF_DIAG + 2) / zoom;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - d2);
      ctx.lineTo(b.x + d2, b.y);
      ctx.lineTo(b.x, b.y + d2);
      ctx.lineTo(b.x - d2, b.y);
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
```

### Pattern 7: Hit-testing — single quadtree with file+bridge mixed
**What:** The existing `d3-quadtree` in `useGraphLayout.ts` is built from `{ id, x, y }` tuples. Bridges share this structure (they're `GraphNode` with an id like `bridge:launchAgent` plus x/y). Insert bridges into the same quadtree; hit-test with a slightly generous `HIT_RADIUS` (UI-SPEC `BRIDGE_HIT_RADIUS = 10`).

Two options weighed:

| Option | Cost | Complexity | Accuracy |
|--------|------|------------|----------|
| (A) **Single quadtree, circular hit radius = 10** | Zero code change to quadtree builder | Simplest; tests reuse existing coverage | Slightly generous corner-hit; practical UX trade for 8-half-diag diamond |
| (B) Second quadtree for bridges only | 2x quadtree storage | Per-frame hover dispatch branches | Tight diamond-bbox hits possible |
| (C) Bbox rect-containment | No quadtree change, but linear scan over bridges | O(N_bridges) per mousemove = 51 ops — cheaper than quadtree at N=51 | Exact |

**Recommendation: Option (A) for v1.** Cheapest, correct per UI-SPEC. Add a `bridge-id` prefix convention so IDs don't collide with file paths:

```typescript
// radarStore: bridge nodes use id = `bridge:${commandName}` so they're distinguishable from file paths.
// This matters because:
//   - selectedBridgeId is keyed by commandName (not the prefixed id); the prefix is internal.
//   - edge source/target for 'invokes' and 'handles' edges reference the prefixed id.
const BRIDGE_ID_PREFIX = 'bridge:';
```

**Hit-test dispatch in `RadarCanvas.handleMouseMove`:**

```typescript
// After the existing file-node quadtree hit:
const hit = qt.find(world.x, world.y, radius / zoom);
if (hit) {
  if (hit.id.startsWith(BRIDGE_ID_PREFIX)) {
    setHoveredBridgeId(hit.id.slice(BRIDGE_ID_PREFIX.length));
  } else {
    setHoveredNodeId(hit.id);
  }
}
```

### Pattern 8: Screen-space label rendering
**What:** After all world-space draws complete, save transform + apply identity for the FE/BE anchor labels.

```typescript
// After world-space draw pass completes and BEFORE the existing animation layers
// (comet trails, agent dots, conflict pulses, which are all world-space):
//
// Per UI-SPEC z-order step 22–24, FRONTEND/BACKEND labels are drawn LAST (above
// everything, topmost) — so the save/restore happens at the very end of the
// render function.

ctx.save();
ctx.setTransform(1, 0, 0, 1, 0, 0);  // screen-space identity transform (DPR already baked in; reapply if needed)
// Account for DPR — the existing RadarCanvas transform bakes `* dpr` into the
// world transform; the identity here must similarly scale if the intent is
// that labels render in CSS pixels. Pattern from RadarMinimap.tsx:79 does
// `setTransform(dpr, 0, 0, dpr, 0, 0)` for the same reason. Choose ONE:
//   (a) true pixel coords: identity (1,0,0,1,0,0), offset by dpr where needed.
//   (b) CSS pixel coords: setTransform(dpr, 0, 0, dpr, 0, 0).
// Phase 11 RadarCanvas uses (a) for the initial clear at line 593 —
// FE/BE labels are one-time text draws; follow the same idiom.

const boundaryScreenY = viewport.panY * dpr;  // world-y=0 projected to screen
const leftX = 12 * dpr;

// Clamp when boundary is off-screen (UI-SPEC §Layout).
const clampedY = Math.max(24 * dpr, Math.min(canvas.height - 24 * dpr, boundaryScreenY));

ctx.font = `10px "Space Grotesk", sans-serif`;
ctx.fillStyle = theme.folderLabelColor;
ctx.globalAlpha = 0.8;
ctx.textBaseline = 'bottom';
ctx.fillText('FRONTEND', leftX, clampedY - 18 * dpr);
ctx.font = `10px "JetBrains Mono", monospace`;
ctx.globalAlpha = 0.55;
ctx.fillText('TypeScript', leftX, clampedY - 8 * dpr);
ctx.textBaseline = 'top';
ctx.font = `10px "Space Grotesk", sans-serif`;
ctx.globalAlpha = 0.8;
ctx.fillText('BACKEND', leftX, clampedY + 18 * dpr);
ctx.font = `10px "JetBrains Mono", monospace`;
ctx.globalAlpha = 0.55;
ctx.fillText('Rust', leftX, clampedY + 8 * dpr);
ctx.globalAlpha = 1;
ctx.restore();
```

**Confirmation:** Phase 7's `drawFileLabels` (UI-SPEC step 11) is world-space, not screen-space — it simply scales font with `zoom`. Only the bridge-specific FRONTEND/BACKEND labels need screen-space. RadarCanvas:593 confirms the canonical `ctx.save + setTransform(1,0,0,1,0,0) + ctx.restore` wrap idiom.

### Anti-Patterns to Avoid

- **Hand-rolling tauri-specta emit parsing with template literals.** The live bindings.ts file format is stable (machine-generated with fixed indent). Regex over `^async …\(…\) : Promise<Result<…>>` is ~5 lines; a hand-rolled TS-ish parser would be hundreds of lines for zero extra correctness.
- **Running tree-sitter Rust for `#[tauri::command]` discovery.** Regex captures the attribute + following `fn` reliably because the attribute is line-anchored and `fn` name is well-shaped. Tree-sitter would require a new `queries/rust_commands.rs`, a second slot in the `BRIDGE_*` thread-local caches, and wouldn't handle the `#[specta::specta]` interleaving cleaner than regex does.
- **Putting bridge x-spread in the worker.** The x-spread is deterministic from the command set — pure function, no physics. Doing it on main keeps the worker's `init` message self-sufficient (worker receives already-pinned `fx`, doesn't need to know about alphabetic ordering).
- **Treating bridges as a separate `graphNodes` array.** UI-SPEC and CONTEXT D-10 both require unified `graphNodes` so the quadtree, render loop, conflict detection, and contention scoring see them uniformly. A split-array model would triple the branching surface.
- **Re-running the x-spread on every topology rewarm.** Causes unrelated visual flutter. Hash the command set; only recompute when the hash changes.
- **Pinning bridges with just `fx` (omitting `fy`).** `fy: 0` is what forces them to the boundary. Without it the `forceBoundary` would do nothing to them (they'd float), yes, but `forceCluster` would pull them into their parent-dir centroid (bridges have `dirKey = ''` and `dirDepth = 0`, so centroid is a lump — catastrophic). Pin both axes.
- **Using `bridge.x` / `bridge.y` as the authoritative position after the worker emits its first tick.** The worker-owned Float32Array is canonical; `graphNodes[i].x/y` is a settled snapshot. For bridges with `fx/fy` pinned the values match exactly, but for file nodes they drift during simulation and lag by one settle cycle.
- **Rendering labels at `ctx.font = '10px'` without `/zoom`.** Bridge world-space labels DO divide by zoom (matches `drawFileLabels`), but the FE/BE screen-space labels DO NOT — they're rendered inside the `setTransform(1,0,0,1,0,0)` block so font size is in raw pixels.
- **Treating non-`#[tauri::command]` functions as commands.** The `collect_commands!` macro is the source of truth for what's a command; the attribute is the discovery marker. If a command is registered in `collect_commands!` but its `fn` lacks the attribute, something is broken at the macro level — surface as `tracing::warn!`, don't silently include.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TS/TSX call-site extraction | Regex over comments + strings + template literals | tree-sitter-typescript with existing Phase 7 thread-local cache idiom | Comments, docstrings, and multi-line strings containing `invoke('foo',` become false positives; tree-sitter's AST makes this structurally impossible |
| Rust file walk | Custom recursive `fs::read_dir` | `walkdir` crate (already a dep, Cargo.toml:65) | Handles symlink loops, sort ordering, and error recovery — rolling it from scratch is a footgun for a one-off scanner |
| Path → repo-relative forward-slash normalization | String manip | `strip_prefix(&repo_root)?.to_string_lossy().replace('\\', '/')` — Phase 7 idiom from `pipeline::commands:356-368` | Windows backslash handling is already solved; reuse the pattern verbatim |
| Bridge diamond geometry | Rotation matrix math | Four `lineTo` calls to 4 cardinal points of a radius-d circle around the bridge center | Canvas 2D has no rotation primitive for stroke geometry; the 4-point polyline is the canonical minimum |
| Topology-change detection | Deep-equal the bridge list | djb2-hash the sorted command-name list | Hash is O(N×avgNameLen) ≈ 1μs for 51 bridges; deep-equal is O(N×fields) for every `fetchGraph` even when nothing changed |
| Custom d3-force skeleton | Roll a `SimulationForce` type from scratch | Follow the `forceCluster` / `forceClusterCollide` shape verbatim (`force(alpha); force.initialize(nodes); force.strength(getter/setter)`) | d3-force's force contract is implicit not explicit; `forceCluster.ts` is the in-repo template with correct TypeScript typing |
| Tooltip chrome (glassmorphism, clamp, 200ms dwell) | Recreate the CSS + positioning logic | Import `AgentTooltip` container + clamp math; extract to a shared `RadarTooltip` utility if preferred (UI-SPEC allows both) | 200ms dwell, right-12/down-12 offset, and viewport clamp are all solved; copy-paste reuse is better than re-typing 40 lines of edge-case math |
| `AnimatePresence` mount animation | Roll setTimeout + opacity CSS | Motion (Framer) `AnimatePresence` + the pattern used by `AlertDetail` / `RadarManifest` collapse | Already a dep; interop with existing z-index / accessibility is free |
| `OnceLock` for regex compilation | `once_cell::sync::Lazy` (new dep) OR recompiling each call | `std::sync::OnceLock` (since Rust 1.70 — already available, no new dep) | No new dep; zero-overhead singleton pattern |

**Key insight:** Phase 12 is almost entirely a "connector" phase — it wires tree-sitter (already there), regex (already there), d3-force custom forces (pattern already in repo), Canvas 2D diamonds (primitive), and tauri-specta DTOs (pattern already in repo). The temptation to invent parsers, rewrite quadtree, or introduce a separate rendering pass should be resisted; the cleanest version of this phase is one where every new file is under 200 lines and every new Rust module reads like `pipeline/deps/` with different names.

## Runtime State Inventory

> Phase 12 is structural visualization — a code-edit-only phase. No rename, no migration, no external registrations.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None.** `radarStore` is in-memory only. Bridge list is rebuilt each `fetchGraph`. SQLite schema unchanged (D-28). No persisted bridge positions (D-14 is deterministic; CONTEXT §Deferred explicitly says "bridge persistence — not needed given deterministic layout"). | None. |
| Live service config | **None.** No external services reference the command set beyond what tauri-specta already emits to bindings.ts (which is committed to git). | None. |
| OS-registered state | **None.** No tasks, notifications, or tray state. Bridge visualization is purely in-app. | None. |
| Secrets/env vars | **None.** | None. |
| Build artifacts | `src/bindings.ts` regenerates on every `cargo build` (debug + release). Adding `get_ipc_bridges` + 3 new `.typ::<...>()` calls causes the next `cargo build` (dev-only, gated on `#[cfg(debug_assertions)]` per lib.rs:139) to append the new command to bindings.ts. | After adding the Tauri command, run `cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc` once (Phase 18 canonical bindings-regen recipe per STATE.md) to sync bindings.ts. |

**Canonical question:** *After every file is updated, what runtime systems still have the old shape cached?*
Answer: only the browser's in-memory Zustand store, which re-hydrates on every app launch. No migration needed.

**One risk worth surfacing for the planner:** If a future phase adds serialization of `GraphNode` shape to localStorage (currently none), the `kind` + bridge fields would need a `?? 'file'` fallback read to avoid crashes on old serialized shapes. Not a Phase 12 concern (no such serialization exists today) but worth noting in the plan's "Deferred" section.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | build (same as Phase 7) | ✓ (assumed — project builds) | rustc 1.70+ (for `OnceLock`) | — |
| tree-sitter + grammars | frontend call-site scan | ✓ (Phase 7 D-06) | pinned in Cargo.toml | — |
| regex crate | bindings.ts + Rust handler scan | ✓ (Cargo.toml:47) | ^1 | — |
| rayon crate | parallel file scans | ✓ (Cargo.toml:58) | =1.12.0 | — |
| walkdir crate | recursive file walk for src-tauri/src and src/ | ✓ (Cargo.toml:65) | 2 | — |
| d3-force + d3-quadtree | custom forceBoundary + hit-test extension | ✓ (package.json) | ^3 | — |
| tauri-specta | DTO registration + bindings regen | ✓ (Cargo.toml:27) | =2.0.0-rc.21 | — |
| Motion (framer-motion) | BridgeDetailPanel mount/unmount | ✓ (package.json) | ^12 | — |
| Lucide React | `X` close icon | ✓ (package.json) | ^1.7 | — |
| Space Grotesk + JetBrains Mono | FE/BE labels, bridge label | ✓ (theme.css:42-43) | self-hosted | — |

**Missing dependencies with no fallback:** None — this phase is entirely additive within the established stack.
**Missing dependencies with fallback:** None.

## Common Pitfalls

### Pitfall 1: `fx` / `fy` vs force order
**What goes wrong:** Writing `forceBoundary` to branch `if (n.kind === 'bridge') n.vy += bigPositive;` assuming bridges will stay at y=0 — but d3-force's internal `applyForces → tick → applyFixedPositions` order would end up snapping y=0 anyway, so the branch is dead code but not harmful.
**Why it happens:** Developers coming from physics sims expect forces to *fight* pins; d3-force doesn't work that way. The pin wins absolutely after every tick.
**How to avoid:** In `forceBoundary`, skip bridges (save CPU) but know that accidentally including them does nothing harmful. Pin BOTH `fx` AND `fy` on every bridge in the `fetchGraph` post-merge pass. Test that bridges stay at exactly `y === 0` after 500 ticks.
**Warning signs:** Bridges drift off the y=0 line during settle.
**Reference:** https://d3js.org/d3-force/simulation — "after the application of any forces, a node with a defined fy has y reset to this value and vy set to zero."

### Pitfall 2: `kind` not propagating to the worker
**What goes wrong:** Widening `GraphNode` in `radarStore.ts` with `kind: 'file' | 'bridge'` compiles fine, but the worker-side `SimNode` in `graphSimCore.ts` doesn't mirror the field. `forceBoundary.initialize(nodes)` sees undefined `kind` on every node and silently does nothing or pushes every node up/down.
**Why it happens:** The `InitMessage.nodes` shape in `graphSimProtocol.ts:24-32` is the source of truth for cross-thread node payload. It currently has `id, dirKey, dirDepth, fx, fy`. Adding `kind` + `language` requires editing the protocol AND the worker-side `simNodes.map` in `graphSimCore.ts:241-252`.
**How to avoid:** Treat the protocol widening as a full trace: `radarStore` → `useGraphLayout.payload.nodes.map` → `InitMessage.nodes[]` → `graphSimCore.buildSim.simNodes.map` → `forceBoundary.BoundaryNode`. One edit per stop. Assert the worker-side shape in a test that calls `makeGraphSimCore` with a bridge node and verifies `forceBoundary` sees the kind.
**Warning signs:** File nodes never split into half-planes; all files stay at y≈0; `forceBoundary` slider moves with no visible effect.

### Pitfall 3: Bindings.ts parser mis-pairs async method with TAURI_INVOKE
**What goes wrong:** In a multi-line arg list, the `async camelName(...)` signature_re match spans ~5 lines; the next `TAURI_INVOKE` on a downstream line belongs to the same function. But if parsing with `invoke_re.find_iter` over the whole file and zipping, every command gets matched against `TAURI_INVOKE` from the NEXT command — every snake_name shifts by one.
**Why it happens:** Parsing both patterns with disjoint iterators and zipping assumes they fire in lock-step, which they do UNLESS a parse failure drops one match silently.
**How to avoid:** Locate each `async` header, then run `invoke_re.find_at(bytes_offset = header_end)` to find the first `TAURI_INVOKE` AFTER that header. If none found within 200 bytes of the header → skip (malformed) and log warn.
**Warning signs:** Handler-to-camelCase bindings are systematically off-by-one in tests.

### Pitfall 4: Tree-sitter line numbers 0-indexed vs 1-indexed
**What goes wrong:** `Node.start_position().row` returns 0-indexed; CONTEXT D-06 requires 1-indexed `handler_line`. Mismatch shows up as "jump to caller" in the BridgeDetailPanel landing one line above.
**Why it happens:** Tree-sitter's Point type uses 0-indexed (like LSP); editors universally 1-index.
**How to avoid:** In the scanner: `caller_line = m.captures[0].node.start_position().row + 1`. Add a test fixture where the invoke is on line 5 (file starts with 4 blank lines) and assert `caller_line == 5`.
**Warning signs:** Detail panel's clicked caller opens the external editor at the wrong line (post Phase 12+1 once deep-link ships).

### Pitfall 5: Worker protocol mutation without sequence bump
**What goes wrong:** `fetchGraph` merges bridges, bumps topology through `useGraphLayout`, but `InitMessage.nodes[].kind` is sent only on the FIRST init. A subsequent `updateConfig` message (triggered by slider drag) carries NO nodes — worker keeps its stale simNodes without `kind`. Seems to work at first.
**Why it happens:** The worker protocol is correct as-is (D-37 "no worker protocol changes OTHER than ForceConfig widening"), but the intuition that `kind` is "a node attribute" makes it easy to forget that updateConfig doesn't re-send nodes.
**How to avoid:** The worker stores `simNodes` once from `init` / `topology`; kind is part of the node payload there. `updateConfig` only ships `ForceConfig`. Correct by construction — no action needed except testing that bridge kind survives a slider drag.
**Warning signs:** Force bifurcation breaks after the user drags the BOUNDARY slider.

### Pitfall 6: Bridge ID collision with file paths in quadtree
**What goes wrong:** A file at path `bridge` (e.g., `src/bridge/index.ts`) → `id = 'src/bridge/index.ts'`. A bridge with command `index` → `id = 'bridge:index'`. No collision in practice, but IF someone later decides "let me just use command names as IDs" the id `index` would collide with Phase 7's file nodes that happen to be at path `index`.
**Why it happens:** Cross-domain ID name-spacing is easy to forget.
**How to avoid:** Always prefix bridge IDs with `bridge:`. Enforce in radarStore construction + an invariant test that `bridgeNodes.every(n => n.id.startsWith('bridge:'))`. Document the prefix in the store's comment.
**Warning signs:** `hoveredNodeId` set to a path but nothing in the quadtree matches; or a bridge's selection highlights a file node with a similar name.

### Pitfall 7: `forceBoundary` strength 0 still pays the per-tick cost
**What goes wrong:** User sets `boundaryStrength: 0` in the slider, expecting the force to collapse to zero cost. But the default implementation still iterates all N nodes per tick, just multiplying by zero at the end.
**Why it happens:** The force's `force(alpha)` function is called every tick regardless of strength.
**How to avoid:** Early-return at the top of the force: `if (strength === 0 || alpha === 0) return;`. Already in the pattern 4 code snippet above.
**Warning signs:** Tick time hasn't measurably improved when slider is at 0.

### Pitfall 8: Bindings.ts regex compiles at cold cache for every build_ipc_bridges call
**What goes wrong:** `Regex::new(...)` takes 0.1-1ms. If invoked per-request (every 500ms during active file watch), that's wasted CPU.
**Why it happens:** No `OnceLock` / `Lazy` caching.
**How to avoid:** Use `std::sync::OnceLock` per Pattern 1. Same as Phase 7's thread-local query cache, except bindings regex is global (single-threaded parse, small input).
**Warning signs:** Perf budget tightens on repeated debounce cycles.

### Pitfall 9: Viewport-cull includes bridges on zoomed-out views, making them invisible
**What goes wrong:** Phase 7 implemented `isInViewport` culling in `drawNodes` / `drawEdges` for 5k+ node perf. Bridges passing through that cull at low zoom (e.g., 0.3×) might show as tiny sub-pixel smudges and get culled by the padding check.
**Why it happens:** 52 bridges spread across 3200 world-units means at zoom 0.3×, spacing becomes ~19 screen-px — still visible, but bridges at the edges of the spread may project beyond the viewport.
**How to avoid:** Per UI-SPEC D-19 + Progressive Detail table: at zoom < 0.5× render bridges as 3-world-px solid dots (degraded detail) but STILL DRAW THEM regardless of viewport cull. In `drawBridgeNodes` skip the viewport-cull check OR pad it more generously.
**Warning signs:** At workspace zoom, only some bridges render; scanning across the boundary line finds gaps.

### Pitfall 10: `has_channel_arg` flag missed on multi-arg channel-bearing commands
**What goes wrong:** `startWatch(repoRoot: string, channel: TAURI_CHANNEL<FileEventBatch>)` has channel as the 2nd arg. A regex `^async [a-zA-Z_]+\(channel: TAURI_CHANNEL` anchored to the first arg misses it.
**Why it happens:** Channel args can appear at any arg position.
**How to avoid:** Test the channel regex against the full args capture `channel_arg_re.is_match(&args_text)` — search within the already-captured args, not the whole line.
**Warning signs:** `startWatch` renders as single-stroke (miss the double-stroke channel indicator).

## Code Examples

Verified patterns from official sources and this codebase:

### Example 1: `get_ipc_bridges` Tauri command

```rust
// src-tauri/src/pipeline/commands.rs — sibling of get_dependency_graph
// Pattern mirrors get_dependency_graph:323-376 exactly.

use crate::pipeline::ipc_bridges::{build_ipc_bridges, IpcBridgeDto};

#[tauri::command]
#[specta::specta]
pub async fn get_ipc_bridges(
    state: tauri::State<'_, PipelineState>,
) -> Result<Vec<IpcBridgeDto>, String> {
    let guard = state.inner.lock().await;
    match guard.as_ref() {
        Some(active) => {
            let repo_root = active.repo_root.clone();
            // build_ipc_bridges finds its own bindings.ts + walks src-tauri/src/
            // + src/ — doesn't need tree_index because these file sets are
            // small and well-scoped.
            let result = tauri::async_runtime::spawn_blocking(move || {
                build_ipc_bridges(&repo_root)
            })
            .await
            .map_err(|e| format!("spawn_blocking join: {e}"))?;
            Ok(result)
        }
        None => Ok(Vec::new()),
    }
}
```

### Example 2: Registration in `lib.rs`

```rust
// src-tauri/src/lib.rs:42-92 — add command to collect_commands!
.commands(tauri_specta::collect_commands![
    // ... existing entries ...
    pipeline::commands::get_dependency_graph,
    pipeline::commands::get_ipc_bridges, // NEW
    // ... rest ...
])
// .typ additions (around line 105-110 where DependencyEdgeDto sits):
.typ::<pipeline::deps::DependencyEdgeDto>()
.typ::<pipeline::deps::EdgeKind>()
.typ::<pipeline::ipc_bridges::IpcBridgeDto>()    // NEW
.typ::<pipeline::ipc_bridges::IpcCallSite>()     // NEW
.typ::<pipeline::ipc_bridges::CallShape>()       // NEW
```

### Example 3: DTO shapes

```rust
// src-tauri/src/pipeline/ipc_bridges/mod.rs

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcBridgeDto {
    pub command_name: String,      // camelCase, from bindings.ts
    pub rust_name: String,         // snake_case, Rust fn name
    pub handler_file: String,      // repo-relative forward-slash
    pub handler_line: u32,         // 1-indexed line of `fn`
    pub caller_files: Vec<IpcCallSite>,
    pub signature_summary: String, // "(args) → return", truncated to 120 chars
    pub has_channel_arg: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcCallSite {
    pub file: String,              // repo-relative forward-slash
    pub line: u32,                 // 1-indexed
    pub shape: CallShape,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CallShape { Literal, Typed }
```

### Example 4: `EdgeKind` extension (Phase 7's enum widens)

```rust
// src-tauri/src/pipeline/deps/mod.rs — extend existing enum

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum EdgeKind {
    Import,
    Reexport,
    TypeOnly,
    DynamicImport,
    Use,
    ModDecl,
    FromImport,
    ImportStmt,
    Invokes,    // NEW — caller TS file → bridge node
    Handles,    // NEW — bridge node → handler Rust file
}
```

Downstream: `src/bindings.ts`'s `EdgeKind` union auto-regenerates, picking up `"invokes" | "handles"`. All existing switches over `edge.kind` must be audited for exhaustive handling — `GraphRenderer.drawEdges` is the main consumer.

### Example 5: ForceConfig protocol widening

```typescript
// src/workers/graphSimProtocol.ts — existing contract, one field added

export interface ForceConfig {
  centerStrength: number;
  clusterStrength: number;
  linkStrength: number;
  chargeStrength: number;
  boundaryStrength: number; // NEW — Phase 12 (D-29/D-30)
}

// Node payload widens by two fields to carry the bridge discriminator into the worker:
export interface InitMessage {
  type: 'init';
  sequence: number;
  nodes: {
    id: string;
    dirKey: string;
    dirDepth: number;
    fx?: number | null;
    fy?: number | null;
    kind?: 'file' | 'bridge';    // NEW — Phase 12 (D-10)
    language?: 'ts' | 'rust';    // NEW — Phase 12 (D-16). Undefined = no boundary force.
  }[];
  edges: { source: string; target: string; kind: string }[];
  config: ForceConfig;
  alpha: number;
  fastSettle: boolean;
}
```

### Example 6: radarStore shape extensions

```typescript
// src/stores/radarStore.ts — incremental widening

export interface GraphNode {
  id: string;
  dirKey: string;
  dirDepth: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  // Phase 12 additions (D-10):
  kind?: 'file' | 'bridge';  // undefined legacy = 'file' at read sites
  language?: 'ts' | 'rust';  // Phase 12 (D-16); undefined = no boundary force
  // Bridge-only metadata (undefined for file nodes):
  commandName?: string;
  rustName?: string;
  handlerFile?: string;
  handlerLine?: number;
  signatureSummary?: string;
  hasChannelArg?: boolean;
  callerFiles?: IpcCallSite[];
  callerCount?: number;
}

export interface ForceConfig {
  centerStrength: number;
  clusterStrength: number;
  linkStrength: number;
  chargeStrength: number;
  boundaryStrength: number; // NEW
}

export const DEFAULT_FORCE_CONFIG: ForceConfig = {
  centerStrength: 0.05,
  clusterStrength: 0.08,
  linkStrength: 0.3,
  chargeStrength: -80,
  boundaryStrength: 0.15, // NEW — D-30
};

// New slot + action (D-21):
interface RadarStore {
  // ... existing ...
  selectedBridgeId: string | null;
  bridgesVisible: boolean; // UI-SPEC `B` hotkey state
  selectBridge: (commandName: string | null) => void;
  toggleBridgesVisible: () => void;
  // ... existing ...
}
```

### Example 7: fetchGraph merge with bridges

```typescript
// src/stores/radarStore.ts — fetchGraph gains third Promise.all leg

import type { IpcBridgeDto } from '../bindings';
import { GRAPH_HALF_WIDTH } from '../workers/graphSimConfig';

const BRIDGE_ID_PREFIX = 'bridge:';

function classifyLanguage(path: string): 'ts' | 'rust' | undefined {
  // Path prefix first (D-16).
  if (path.startsWith('src-tauri/')) return 'rust';
  // Extension second.
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'rs') return 'rust';
  if (['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'].includes(ext)) return 'ts';
  return undefined;
}

function hashCommandSet(bridges: IpcBridgeDto[]): number {
  let h = 5381;
  const names = bridges.map(b => b.commandName).sort();
  for (const n of names)
    for (let i = 0; i < n.length; i++) h = ((h << 5) + h) ^ n.charCodeAt(i);
  return h;
}

fetchGraph: async () => {
  try {
    const [treeIndex, edges, bridges] = await Promise.all([
      invoke<TreeIndexEntryRaw[]>('get_tree_index'),
      invoke<DependencyEdgeDto[]>('get_dependency_graph'),
      invoke<IpcBridgeDto[]>('get_ipc_bridges'),  // NEW
    ]);

    const fileEntries = treeIndex.filter((e) => !e.isDir);
    const existingById = new Map(get().graphNodes.map((n) => [n.id, n]));

    // File nodes (Phase 7 logic + kind + language annotations).
    const fileNodes: GraphNode[] = fileEntries.map((e) => {
      const lastSlash = e.path.lastIndexOf('/');
      const dirKey = lastSlash >= 0 ? e.path.slice(0, lastSlash) : '';
      const prev = existingById.get(e.path);
      return {
        id: e.path,
        dirKey,
        dirDepth: dirKey === '' ? 0 : dirKey.split('/').length,
        kind: 'file' as const,
        language: classifyLanguage(e.path),
        x: prev?.x,
        y: prev?.y,
        fx: prev?.fx,
        fy: prev?.fy,
      };
    });

    // Bridge nodes (new). x-spread preserved across refreshes if command set unchanged.
    const newHash = hashCommandSet(bridges);
    const needsSpread = newHash !== get().lastBridgeSetHash;
    const sortedBridges = [...bridges].sort((a, b) =>
      a.commandName.localeCompare(b.commandName),
    );
    const n = sortedBridges.length;
    const step = n <= 1 ? 0 : (2 * GRAPH_HALF_WIDTH) / (n - 1);
    const bridgeNodes: GraphNode[] = sortedBridges.map((b, i) => {
      const id = BRIDGE_ID_PREFIX + b.commandName;
      const prev = existingById.get(id);
      const x = needsSpread ? -GRAPH_HALF_WIDTH + step * i : prev?.x ?? -GRAPH_HALF_WIDTH + step * i;
      return {
        id,
        dirKey: '',
        dirDepth: 0,
        kind: 'bridge' as const,
        x,
        y: 0,
        fx: x,
        fy: 0,
        commandName: b.commandName,
        rustName: b.rustName,
        handlerFile: b.handlerFile,
        handlerLine: b.handlerLine,
        signatureSummary: b.signatureSummary,
        hasChannelArg: b.hasChannelArg,
        callerFiles: b.callerFiles,
        callerCount: b.callerFiles.length,
      };
    });

    // Merge + synthesize invokes/handles edges.
    const allNodes = [...fileNodes, ...bridgeNodes];
    const knownIds = new Set(allNodes.map((n) => n.id));

    const depEdges: GraphEdge[] = edges
      .filter((e) => knownIds.has(e.from) && knownIds.has(e.to))
      .map((e) => ({ source: e.from, target: e.to, kind: e.kind }));

    const bridgeEdges: GraphEdge[] = [];
    for (const b of bridges) {
      const bridgeId = BRIDGE_ID_PREFIX + b.commandName;
      if (b.handlerFile && knownIds.has(b.handlerFile)) {
        bridgeEdges.push({ source: bridgeId, target: b.handlerFile, kind: 'handles' });
      }
      for (const c of b.callerFiles) {
        if (knownIds.has(c.file)) {
          bridgeEdges.push({ source: c.file, target: bridgeId, kind: 'invokes' });
        }
      }
    }

    // Pre-compute parentChildMap + dirsWithOwnFiles — bridges don't participate
    // (their dirKey is '' and they shouldn't affect folder hull computation).
    const pcm = new Map<string, Set<string>>();
    const dwof = new Set<string>();
    for (const node of fileNodes) {
      dwof.add(node.dirKey);
      const parts = node.dirKey === '' ? [] : node.dirKey.split('/');
      for (let i = 0; i < parts.length; i++) {
        const parent = i === 0 ? '' : parts.slice(0, i).join('/');
        const child = parts.slice(0, i + 1).join('/');
        const s = pcm.get(parent) ?? new Set<string>();
        s.add(child);
        pcm.set(parent, s);
      }
    }

    set({
      graphNodes: allNodes,
      graphEdges: [...depEdges, ...bridgeEdges],
      settledAt: null,
      parentChildMap: pcm,
      dirsWithOwnFiles: dwof,
      lastBridgeSetHash: newHash,
    });
  } catch {
    // Best-effort: leave existing slots as-is on failure.
  }
},
```

### Example 8: `forceBoundary` registered in the worker

```typescript
// src/workers/graphSimCore.ts — inside buildSim, adjacent to forceCluster

import { forceBoundary } from './forces/forceBoundary';

// ... inside buildSim ...
sim = forceSimulation<SimNode>(simNodes)
  .force('link', forceLink<SimNode, SimEdge>(simEdges).id((n) => (n as SimNode).id).distance(LINK_DISTANCE).strength(cfg.linkStrength))
  .force('charge', forceManyBody<SimNode>().strength(cfg.chargeStrength).theta(CHARGE_THETA).distanceMax(CHARGE_DISTANCE_MAX))
  .force('center', forceCenter(0, 0).strength(cfg.centerStrength))
  .force('collide', forceCollide(COLLIDE_RADIUS))
  .force('cluster', forceCluster().strength(cfg.clusterStrength))
  .force('clusterCollide', forceClusterCollide())
  .force('boundary', forceBoundary().strength(cfg.boundaryStrength))  // NEW
  .alphaDecay(ALPHA_DECAY)
  .velocityDecay(VELOCITY_DECAY)
  .stop();

// updateConfig extension:
(sim.force('boundary') as ReturnType<typeof forceBoundary>).strength(cfg.boundaryStrength);

// SimNode map must carry the new fields:
simNodes = nodes.map((n, i) => ({
  id: n.id,
  dirKey: n.dirKey,
  dirDepth: n.dirDepth,
  kind: n.kind ?? 'file',           // NEW
  language: n.language,              // NEW
  x: (rng() - 0.5) * 200,
  y: n.fy !== null && n.fy !== undefined ? n.fy : (rng() - 0.5) * 200,  // bridges anchor
  fx: n.fx ?? undefined,
  fy: n.fy ?? undefined,
  index: i,
} as SimNode));
```

### Example 9: Test fixture for bindings parser

```typescript
// src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_bindings.ts
// Miniature tauri-specta emit — 4 commands exercising all shapes.

export const commands = {
async listAgents() : Promise<Result<AgentInfo[], string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("list_agents") };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
/**
 * Two-line doc comment with a star * in the middle.
 */
async launchAgent(agentType: string, cwd: string) : Promise<Result<AgentInfo, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("launch_agent", { agentType, cwd }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
async startWatch(repoRoot: string, channel: TAURI_CHANNEL<FileEventBatch>) : Promise<Result<Worktree[], string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("start_watch", { repoRoot, channel }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
async manyArgs(a: string, b: number | null, c: { nested: string }) : Promise<Result<null, string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("many_args", { a, b, c }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
};
```

**Assertions to land against this fixture:**
- Parser emits 4 BindingCommand records.
- `list_agents` (no-arg), `launch_agent` (2-arg), `start_watch` (2-arg incl. channel), `many_args` (3-arg multi-line).
- `start_watch` has `has_channel_arg: true`; others false.
- `listAgents.rust_name == "list_agents"` (lossless camel↔snake recovery).
- `launchAgent.signature_summary` starts with `"(agentType: string, cwd: string)"`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Runtime introspection of invoke calls via `window.__TAURI_INTERNALS__` | Static source analysis via tauri-specta bindings | Locked in this phase (D-02) | Drift-proof by construction — regenerates from source every 500ms |
| Hand-maintained command → handler tables | Parse bindings.ts (camelCase ↔ snake_case) + grep handler locations | 2024-2025 (tauri-specta adoption in the ecosystem) | Zero bit-rot when commands are added/renamed/removed |
| Regex-only cross-language parsing | tree-sitter for AST-aware call-site detection | Phase 7 (2026-04) established the grammar-loading pattern; Phase 12 extends it | Zero false positives from comments / strings / template literals |
| SharedArrayBuffer for cross-thread positions | Transferable Float32Array ping-pong | Phase 11 (2026-04-17) | No COOP/COEP headers needed |
| Main-thread d3-force simulation | Web Worker with `makeGraphSimCore` factory | Phase 11 (2026-04-17) | Bridges' `forceBoundary` registers in the worker for free |

**Deprecated/outdated:**
- Any approach that requires rebuilding Rust to derive the command list on-demand (defeats the "regenerates every 500ms" property; tauri-specta's emission at `cargo build` time is the hook, but bindings.ts is the static cache).
- Hand-rolled command registries that duplicate `collect_commands!` — tauri-specta ensures one source of truth.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `forceBoundary` cost at 5k file nodes is ~0.1ms/tick (extrapolated from `forceCluster` ~0.15ms/tick which does centroid aggregation) | Pattern 4 | If the cost is higher (unlikely; it's a simple scan-and-add), tick rate on large graphs drops. Mitigation: O(N) structure with one branch per node — very hard to slow down. |
| A2 | The repo currently has 0 aliased `commands` imports | D-05 deferral | If a future commit introduces `import { commands as C } from '../bindings'` before Phase 12 ships, those sites silently don't show up as callers. Mitigation: Wave 0 adds a one-shot grep-verification in a test. |
| A3 | 51 commands today in bindings.ts (not the CONTEXT-quoted 52) | Summary | Planner should update plan copy from "52" to "~51" or "N"; nothing downstream cares about exact count. |
| A4 | `GRAPH_HALF_WIDTH = 1600` world-units gives comfortable 64px bridge spacing at zoom 1 with 51 bridges | Pattern 5 | If the real codebase grows to 120+ commands, spacing collapses to 27px which makes hover-precision tight. Mitigation: scale `GRAPH_HALF_WIDTH` with command count — `max(1600, 32 * commands.length)`. Not in v1 because 51 doesn't trigger it. |
| A5 | `BRIDGE_HIT_RADIUS = 10` world-px is enough slop for 8-half-diagonal diamonds (UI-SPEC Appendix A auto-selected) | Pattern 7 | If hover feels unreliable at corners, bump to 12. Visual-only, no cascade. |
| A6 | `std::sync::OnceLock` requires Rust 1.70+; this project uses rustc sufficiently recent | Pattern 1 | If the Rust MSRV for this project is <1.70, swap to a one-shot static initializer via `once_cell::sync::Lazy` (would require adding once_cell as a direct dep — Phase 7 may already include it transitively). Verify in Wave 0 via `cargo tree \| grep once_cell`. |
| A7 | The FRONTEND/BACKEND screen-space label drift on pan follows `viewport.panY * dpr` directly (no extra transform) | Pattern 8 | RadarCanvas:593 confirms the canonical pattern; labels should appear at `y = panY * dpr` in screen space when world `y = 0`. If the draw code scales wrong, labels drift. Covered by a snapshot test that pans and asserts label y. |
| A8 | Bridge refresh cadence (500ms debounce) is fine for the <100ms parse target — doesn't stack up | D-24 + D-35 | If parsing overruns 500ms on a large external codebase, the debounce window fills, causing visible pipeline lag. Mitigation: Wave 2 benchmark on this repo; fallback is to path-filter the debounce (only refresh bridges when `src/bindings.ts` or `src-tauri/**/*.rs` or `src/**/*.ts(x)` changed). |

**If this table is empty:** Not applicable — the assumptions above warrant user confirmation during discuss-phase if any feel risky.

## Open Questions

1. **Should `handles` edge target the Rust file even when cross-module resolution is imperfect?**
   - What we know: The handler scanner emits `handler_file = src-tauri/src/agents/commands.rs` with 1-indexed line. That path is in the `graphNodes` set (Phase 7 dep extractor includes `.rs` files).
   - What's unclear: If Phase 7's `build_tree_index` doesn't include a given Rust file (e.g., gitignored directory), the `handles` edge won't find its target and must drop. Planner should confirm this is handled silently (edge dropped, no warn — matches D-09's "bridge rendered as dangling").
   - Recommendation: In the fetchGraph merge, drop `handles` edges where `knownIds.has(b.handlerFile) === false` and mark the bridge as dangling-no-handler. Log `tracing::warn!` once per snapshot per CONTEXT D-09.

2. **How does a re-warm caused by file addition handle the bridge set?**
   - What we know: Phase 7's `shouldRewarm` threshold (≥5 node mutations OR ≥1%) fires a topology message. Phase 12's bridges need their `fx/fy` reset pre-topology-post if the command set changed.
   - What's unclear: A brand-new file adds to `graphNodes`; if it's irrelevant (no invoke, not a command), bridges are untouched — existing hash matches, no re-spread. Correct.
   - Recommendation: The hash-based `needsSpread` in Example 7 handles this correctly by construction. Add a test fixture: 51 bridges settle → add 1 unrelated file → re-fetchGraph → assert bridge `fx` coords identical.

3. **UI-SPEC F-03 says caller line numbers appear in the detail panel but not in the tooltip. Does the DTO carry the line numbers to both surfaces or only the panel?**
   - What we know: `IpcCallSite` carries `file` + `line`; the bridge DTO has `caller_files: Vec<IpcCallSite>` so the frontend has everything it needs.
   - What's unclear: Tooltip is rendered off `hoveredNodeId` → `graphNodes.find(...).commandName` → access the full `callerFiles` list. No extra payload needed.
   - Recommendation: No DTO change. Tooltip just chooses to display `callerCount` and hide per-caller lines; detail panel shows all.

4. **Does the `B` hotkey visibility toggle propagate through the worker?**
   - What we know: UI-SPEC §Copywriting §States `BRIDGES_HIDDEN`: "Boundary line hides, bridges hide, FE/BE labels hide, invokes/handles edges hide. `forceBoundary` still runs so file nodes stay in their half-planes — hiding is a visual-only toggle."
   - What's unclear: With `forceBoundary` running, TS/Rust file nodes stay in their half-planes while bridges are hidden — that's the intended behavior. Hiding is a draw-time gate, not a layout gate.
   - Recommendation: `bridgesVisible: boolean` lives in radarStore. `RadarCanvas` branches on it to skip `drawBoundaryLine` + `drawBridgeNodes` + `drawBridgeLabels` + `drawBoundaryAnchorLabels` + filter out `invokes`/`handles` edges from `drawEdges`. Worker protocol unchanged.

5. **What if two Rust handlers share a common `fn name`? (impossible under `collect_commands!` uniqueness but defensive)**
   - What we know: CONTEXT D-03 says "log warn, pick first."
   - What's unclear: Which "first" — by file walk order (non-deterministic with rayon), alphabetical file order, or some stable index?
   - Recommendation: Rayon parallel scan returns `Vec<Vec<HandlerHit>>`; flatten with source-file sort by `file_path.to_string_lossy()` before deduping. Produces deterministic first-match.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (TS) | vitest ^3.0.0 + @testing-library/react ^16 + jsdom ^26 (existing) |
| Framework (Rust) | `cargo test` + `#[cfg(test)] mod tests` colocated; `tempfile` dev-dep (existing) |
| Config file (TS) | `vitest.config.ts` (existing, unchanged) |
| Config file (Rust) | `src-tauri/Cargo.toml [dev-dependencies]` (existing) |
| Quick run command (TS, per-task) | `npm test -- --run <file>` (<5s for one file) |
| Quick run command (Rust, per-task) | `cargo test -p aitc_lib pipeline::ipc_bridges::<testname>` (<10s) |
| Full suite command (TS) | `npm test` |
| Full suite command (Rust) | `cargo test --lib` |
| Phase gate | Both green + visual smoke on this repo before `/gsd-verify-work` |

### Phase Requirements → Test Map

Per CONTEXT "no new requirement IDs" → witness IDs `V-12-01..V-12-13` are phase-local:

| Witness ID | Behavior | Test Type | Automated Command | File Exists? |
|------------|----------|-----------|-------------------|-------------|
| V-12-01 | Bindings parser enumerates every `async camelName(…) : Promise<Result<…>>` entry | unit (fixture) | `cargo test -p aitc_lib pipeline::ipc_bridges::bindings_parser::enumerates_all_commands` | ❌ Wave 0 |
| V-12-02 | Bindings parser recovers `camelCase ↔ snake_case` pair for each command (lossless) | unit | `cargo test -p aitc_lib pipeline::ipc_bridges::bindings_parser::camel_snake_mapping` | ❌ Wave 0 |
| V-12-03 | Bindings parser captures `signature_summary` incl. multi-line args | unit | `cargo test -p aitc_lib pipeline::ipc_bridges::bindings_parser::signature_summary` | ❌ Wave 0 |
| V-12-04 | Bindings parser sets `has_channel_arg` iff args contain `TAURI_CHANNEL<…>` | unit | `cargo test -p aitc_lib pipeline::ipc_bridges::bindings_parser::channel_arg_detection` | ❌ Wave 0 |
| V-12-05 | Rust handler scanner finds `#[tauri::command]` + following `fn <name>(` with 1-indexed line | unit (fixture) | `cargo test -p aitc_lib pipeline::ipc_bridges::rust_handler_scanner::handler_detection` | ❌ Wave 0 |
| V-12-06 | Rust handler scanner tolerates `pub async fn`, `async fn`, `pub fn`, `#[tauri::command(async)]` | unit | `cargo test -p aitc_lib pipeline::ipc_bridges::rust_handler_scanner::fn_modifiers` | ❌ Wave 0 |
| V-12-07 | Frontend call-site scanner extracts `invoke('literal', ...)` with line numbers, skips template invokes | unit (fixture) | `cargo test -p aitc_lib pipeline::ipc_bridges::frontend_callsite_scanner::literal_invokes` | ❌ Wave 0 |
| V-12-08 | Frontend call-site scanner extracts `commands.camelName(...)` | unit (fixture) | `cargo test -p aitc_lib pipeline::ipc_bridges::frontend_callsite_scanner::typed_commands` | ❌ Wave 0 |
| V-12-09 | `build_ipc_bridges` assembles complete `IpcBridgeDto[]` with dangling detection | integration | `cargo test -p aitc_lib pipeline::ipc_bridges::build_full` | ❌ Wave 0 |
| V-12-10 | `build_ipc_bridges` finishes in <100ms on this repo (D-35) | bench (`#[ignore]`) | `cargo test -p aitc_lib -- --ignored bench_ipc_bridges_build` | ❌ Wave 0 |
| V-12-11 | `forceBoundary` pushes `language: 'ts'` nodes to negative y after N ticks | unit | `npm test -- src/views/Radar/__tests__/forceBoundary.test.ts -t "ts nodes converge to negative y"` | ❌ Wave 0 |
| V-12-12 | `forceBoundary` pushes `language: 'rust'` nodes to positive y, leaves kind=bridge untouched | unit | `npm test -- src/views/Radar/__tests__/forceBoundary.test.ts -t "rust converges positive; bridges pinned"` | ❌ Wave 0 |
| V-12-13 | `forceBoundary` at `strength === 0` is a no-op | unit | `npm test -- src/views/Radar/__tests__/forceBoundary.test.ts -t "zero strength no-op"` | ❌ Wave 0 |
| V-12-14 | Bridge x-spread is deterministic + stable across refresh when command set unchanged | unit | `npm test -- src/stores/__tests__/radarStore.test.ts -t "bridge x stable across refresh"` | ❌ Wave 0 |
| V-12-15 | Bridge x-spread recomputes on command-set hash change | unit | `npm test -- -t "bridge x-spread recomputes on set change"` | ❌ Wave 0 |
| V-12-16 | `drawBridgeNodes` renders diamond geometry (4 lineTo from cardinal points) | unit | `npm test -- src/views/Radar/__tests__/BridgeRenderer.test.ts -t "diamond geometry"` | ❌ Wave 0 |
| V-12-17 | Channel-bearing bridges render with double-stroke outer ring | unit | `npm test -- -t "channel-bearing double stroke"` | ❌ Wave 0 |
| V-12-18 | Dangling bridges (callerCount === 0) render with dashed stroke | unit | `npm test -- -t "dangling dashed stroke"` | ❌ Wave 0 |
| V-12-19 | Click bridge sets `selectedBridgeId`; Escape clears both agent and bridge selection | unit | `npm test -- src/views/Radar/__tests__/RadarCanvas.test.tsx -t "select bridge; escape clears"` | ❌ Wave 0 |
| V-12-20 | `B` hotkey toggles `bridgesVisible`; bridges/line/labels hide but forceBoundary still runs | unit | `npm test -- -t "B hotkey hides visuals; force persists"` | ❌ Wave 0 |
| V-12-21 | `BridgeDetailPanel` renders caller list with `file:line` + close button | unit | `npm test -- src/views/Radar/__tests__/BridgeDetailPanel.test.tsx` | ❌ Wave 0 |
| V-12-22 | `BOUNDARY` slider updates `ForceConfig.boundaryStrength` + round-trips via worker protocol | unit | `npm test -- src/hooks/__tests__/useGraphLayout.test.ts -t "boundaryStrength round-trip"` | ❌ Wave 0 |
| V-12-23 | `EdgeKind` union includes `invokes` + `handles`; `drawEdges` styles them distinctly | unit | `npm test -- src/views/Radar/__tests__/GraphRenderer.test.ts -t "invokes/handles alpha saturation"` | ❌ Wave 0 |
| V-12-24 | Repo-relative forward-slash path invariant: DTO paths never contain `\\` or start with `/` | unit | `cargo test -p aitc_lib pipeline::ipc_bridges::path_convention` | ❌ Wave 0 |

### Sampling Rate (Nyquist cadence)

- **Per task commit:** quick run — the single test file for the unit under change. Target <10s. Enforces "commit after every change" rule.
- **Per wave merge:** full `npm test && cargo test --lib` suite. Target <2min.
- **Per phase gate (before `/gsd-verify-work`):**
  1. Full `npm test` green.
  2. Full `cargo test --lib` green.
  3. `cargo test -p aitc_lib -- --ignored bench_ipc_bridges_build` green (asserts D-35 <100ms).
  4. Optional visual verification on this repo per D-34 — run Tauri dev build, eyeball boundary line + diamonds + labels + tooltip + selection + BOUNDARY slider.

### Wave 0 Gaps

All Wave 0 test scaffolding to create before implementation:

- [ ] `src-tauri/src/pipeline/ipc_bridges/mod.rs` + `mod tests { … }` — V-12-09, V-12-10, V-12-24
- [ ] `src-tauri/src/pipeline/ipc_bridges/bindings_parser.rs` + `mod tests { … }` — V-12-01..V-12-04
- [ ] `src-tauri/src/pipeline/ipc_bridges/rust_handler_scanner.rs` + `mod tests { … }` — V-12-05, V-12-06
- [ ] `src-tauri/src/pipeline/ipc_bridges/frontend_callsite_scanner.rs` + `mod tests { … }` — V-12-07, V-12-08
- [ ] `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_bindings.ts`
- [ ] `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_handler.rs`
- [ ] `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_caller_literal.ts`
- [ ] `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_caller_typed.tsx`
- [ ] `src/views/Radar/__tests__/forceBoundary.test.ts` — V-12-11..V-12-13
- [ ] `src/views/Radar/__tests__/BridgeRenderer.test.ts` — V-12-16..V-12-18
- [ ] `src/views/Radar/__tests__/BridgeDetailPanel.test.tsx` — V-12-21
- [ ] Extensions to `src/views/Radar/__tests__/RadarCanvas.test.tsx` — V-12-19, V-12-20
- [ ] Extensions to `src/hooks/__tests__/useGraphLayout.test.ts` — V-12-22
- [ ] Extensions to `src/views/Radar/__tests__/GraphRenderer.test.ts` — V-12-23
- [ ] Extensions to `src/stores/__tests__/radarStore.test.ts` — V-12-14, V-12-15
- [ ] Benchmark: `#[ignore]` test in `ipc_bridges/mod.rs` asserting full build <100ms on this repo

## Security Domain

Phase 12 is a read-only source-parsing + visualization phase. Operationally it reads files under `repo_root` (`src-tauri/src/**/*.rs`, `src/**/*.ts(x)`, `src/bindings.ts`) and writes nothing. Adjacent to Phase 7 threat-model which is already hardened.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface introduced |
| V3 Session Management | no | No session surface |
| V4 Access Control | yes (inherit Phase 7) | File reads confined to `repo_root` — path traversal via `strip_prefix(&repo_root)` check |
| V5 Input Validation | yes | Bindings regex validation — reject malformed specta output. Tree-sitter resilience to arbitrary TS/TSX. Handler regex resilient to adversarial `#[tauri::command(…)]` arg shapes. |
| V6 Cryptography | no | No crypto |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Adversarial source input (malformed bindings.ts after specta bug) | DoS | Bound regex with `(?m)^async` line-anchored patterns + fail-open — if a command can't be parsed, drop it and warn. Total parse ≤ 1000 lines, no catastrophic backtracking vectors in the chosen regexes. |
| Adversarial TS/TSX file triggering tree-sitter parse blowup | DoS (Phase 7 T-07-A inherited) | `MAX_FILE_SIZE_BYTES = 1 MiB` + `MAX_PARSE_DURATION = 500ms` already enforced via thread-local cache in `src-tauri/src/pipeline/deps/extract.rs:107-178`. Bridge scanner re-uses those via the same thread-local-Query pattern. |
| Rust handler scan on files outside `src-tauri/src/` | path traversal | `walkdir(root)` rooted to `repo_root.join("src-tauri/src/")`. Phase 7 T-07-B lexical canonicalization pattern carries over. |
| Frontend scan picking up bindings.ts (would match every `invoke` emit as a caller) | logic bomb | Excluded by filename `bindings.ts` predicate — test-verified. |
| Duplicate `#[tauri::command]` for same fn name across files | Info disclosure (wrong handler location in tooltip) | Log warn, pick first-by-sorted-path-order (deterministic). CONTEXT D-03 explicit. |
| Command whose callers include a path with a `\\` literal (Windows path backslash leak) | Path serialization | `replace('\\', '/')` at DTO emit — Phase 7 path convention (`pipeline::commands:362`). |

Phase 12 introduces no new auth, no persistence, no network, no privilege boundary — it only reads sources that the user already has access to and renders them. Attack surface is limited to parse-level DoS from malformed inputs, all mitigated by Phase 7's existing hardening pattern.

## Sources

### Primary (HIGH confidence)
- Phase 7 RESEARCH.md (tree-sitter patterns, rayon parallel extraction, specta DTO idiom) — `/home/prannayag/pragnition/htx/aitc/.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-RESEARCH.md`
- Phase 7 implementation (`src-tauri/src/pipeline/deps/{mod,extract,resolve}.rs`, `src/views/Radar/forceCluster.ts`) — canonical templates
- Phase 11 implementation (`src/workers/{graphSimCore,graphSimProtocol,graphSimConfig}.ts`, `src/workers/graphSim.worker.ts`) — worker protocol shape
- Phase 11.1 constants (`graphSimConfig.ts` confirmed no `GRAPH_HALF_WIDTH` constant exists — new in Phase 12)
- Live `src/bindings.ts` (980 lines, 51 async commands, 2 `TAURI_CHANNEL<…>`-bearing) — empirical shape verification
- Live `src-tauri/src/lib.rs:42-138` — `collect_commands!` + `.typ::<…>()` registration site confirmed
- [Live invoke grep across `src/`](file:///home/prannayag/pragnition/htx/aitc/src) — 21 literal invokes in 10 files + 1 typed `commands.listAvailableAgentTypes()` site (plus `import { commands }` in `src/views/TowerControl/DeployDialog.tsx:7`)
- [d3-force documentation — simulation + custom forces](https://d3js.org/d3-force/simulation) — fixed-position semantics ("after the application of any forces, a node with a defined fy has y reset to this value and vy set to zero"); custom-force idiom
- [tree-sitter-rust grammar node definitions](https://github.com/tree-sitter/tree-sitter-rust) — attribute_item + function_item siblings (supports the regex-over-tree-sitter choice for Rust handler scan)

### Secondary (MEDIUM confidence)
- Phase 12 UI-SPEC (auto-generated under `--auto`; auto-selected decisions marked clearly) — consumed wholesale as locked visual contract
- Phase 12 CONTEXT — D-01..D-37 locked
- [Rust `std::sync::OnceLock` MSRV 1.70](https://doc.rust-lang.org/std/sync/struct.OnceLock.html) — version constraint

### Tertiary (LOW confidence)
- None. All recommendations have HIGH-confidence backing from in-repo evidence or official documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep already in package.json / Cargo.toml, verified via file reads.
- Architecture: HIGH — mirrors Phase 7 `pipeline/deps/` exactly; Phase 11 worker contract understood.
- Pitfalls: HIGH — list drawn from in-repo pattern experience + d3-force semantics verification.
- Bindings.ts regex: MEDIUM — empirically verified against live file, but future tauri-specta releases could tweak emit format. Mitigated by fixture-based tests.
- `GRAPH_HALF_WIDTH` value choice: MEDIUM — derived from 51-command spacing math; may need retuning at 120+ commands.
- `forceBoundary` perf: MEDIUM — extrapolated from `forceCluster` baseline; validate in Wave 2.
- Tree-sitter aliased-import gap: HIGH — grep-verified zero occurrences today.

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days — stack is stable; tauri-specta release cadence is slow)
