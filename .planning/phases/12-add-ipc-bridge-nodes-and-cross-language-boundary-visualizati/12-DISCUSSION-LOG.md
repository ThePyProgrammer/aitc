# Phase 12: IPC Bridge Nodes + Cross-Language Boundary - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
**Mode:** `--auto` (no interactive questions; recommended defaults auto-selected inline)
**Areas discussed:** Parser Location, Source of Truth, Callsite Detection, Bridge Data Model, Commands Scope, Cardinality, Dangling Bridges, Store Integration, Edge Kinds, Boundary Strategy, Boundary Rendering, Language Classification, Visual Treatment, Label Policy, Interaction, Tauri Contract, Force-Config, z-Order, Testing, Performance, Worker Protocol Impact

---

## Parser Location

| Option | Description | Selected |
|--------|-------------|----------|
| Rust backend (`src-tauri/src/pipeline/ipc_bridges/`, peer to `deps/`) | Mirrors Phase 7 graph-data-on-Rust invariant; parallelizes via rayon; wraps in `spawn_blocking` | ✓ |
| Frontend one-shot at app boot | TS-side AST + regex; simpler wiring, but deviates from Phase 7 pattern | |
| Both (redundant) | Duplicates work; breaks single source of truth | |

**Auto-selected:** Rust backend, new `pipeline/ipc_bridges/` module — recommended default.
**Rationale:** Consistency with Phase 7 D-05 ("graph data lives on Rust side") + bindings.ts + Rust sources are already co-located under the Tauri app root.

---

## Source of Truth for Command Names

| Option | Description | Selected |
|--------|-------------|----------|
| `src/bindings.ts` (tauri-specta output) | Canonical single file; stable shape; contains camelCase↔snake mapping + signatures | ✓ |
| Rust `collect_commands![…]` macro parsing | Requires expanding proc-macros; snake_case only; misses specta's camel mint | |
| Rust `#[tauri::command]` attributes | Gives handlers but not the registered surface (pre-collect would include draft handlers) | |

**Auto-selected:** `src/bindings.ts` text parse — recommended default.
**Rationale:** Single file, regex-amenable, authoritative by construction (tauri-specta fails the build if it drifts from Rust).

---

## Rust Handler Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Regex `#[tauri::command]` + fn-declaration pair | Trivial identification from flat `.rs` scan; <100 LOC | ✓ |
| Tree-sitter Rust grammar | Already bundled in Phase 7; more precise but heavier for this signal | |
| rustc macro expansion (proc-macro) | Authoritative but requires a build step | |

**Auto-selected:** Regex-based scan — recommended default.
**Rationale:** The `#[tauri::command]` attribute is unambiguous at the line-grammar level; tree-sitter is overkill.

---

## Frontend Callsite Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Tree-sitter TS + TSX (already bundled Phase 7) | Matches `invoke('literal', …)` + `commands.x(…)` via AST queries; no false positives from strings/comments | ✓ |
| Plain regex on string literals | 80% coverage; fails on multi-line / string-in-comment false positives | |
| Hybrid (AST primary + regex fallback) | Unneeded complexity; tree-sitter covers both shapes | |

**Auto-selected:** Tree-sitter — recommended default.
**Rationale:** Zero new dependencies (Phase 7 ships TS+TSX grammars); precise; future-proof for aliased-import extension.

---

## Bridge Data Model

| Option | Description | Selected |
|--------|-------------|----------|
| Full `IpcBridgeDto` with signature, channel flag, caller sites (file + line + shape) | Supports all downstream consumers (tooltip, panel, dangling detection) | ✓ |
| Minimal `{name, handler, callers[]}` | Trims metadata but forces frontend to re-parse bindings.ts for signatures | |
| Extended (includes Tauri events + Channel streams as first-class) | Scope creep for v1 | |

**Auto-selected:** Full DTO — recommended default.
**Rationale:** Single Rust round-trip carries everything the UI needs; avoids secondary fetches.

---

## Scope: Commands vs Events vs Channels

| Option | Description | Selected |
|--------|-------------|----------|
| `#[tauri::command]` only; `Channel<T>`-arg commands flagged with `has_channel_arg` | Clean scope line matching phase title; Channel streams still visible | ✓ |
| Include tauri-specta events | This project registers zero events; pure scope creep | |
| Exclude channel-arg commands | Drops `start_watch` + chat from visualization — counter to "all cross-language surfaces" | |

**Auto-selected:** Commands only with channel-arg flag — recommended default.
**Rationale:** Maps 1:1 to the phase title; events are empty in this project; channel commands remain visible.

---

## Cardinality: Bridge-Per-Command vs Bridge-Per-Call-Site

| Option | Description | Selected |
|--------|-------------|----------|
| One bridge per command; callers fan in | Clean mental model, matches bindings.ts row-per-command | ✓ |
| One bridge per (caller, command) pair | Quadruples node count (52 × ~3 callers); visual clutter | |

**Auto-selected:** One per command — recommended default.
**Rationale:** The bridge IS the command; multiple call-sites are edges.

---

## Dangling Bridge Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Render with dashed outline; log warn/info | Surfaces dead-code / pending-integration as actionable signal | ✓ |
| Hide dangling bridges | Loses valuable intel | |
| Render identically to live bridges | Masks the signal | |

**Auto-selected:** Dashed outline + log — recommended default.
**Rationale:** Dangling = useful diagnostic; visual distinction keeps it readable.

---

## Store Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Extend `radarStore.graphNodes` with `kind` discriminator | Single storage, uniform force/hit-test/render paths; matches "one store per domain" | ✓ |
| New `ipcBridgeStore` | Breaks force-sim unity; duplicates subscription wiring | |
| Separate `bridgeNodes` + `bridgeEdges` slots in `radarStore` | Doubles fetch logic; no benefit | |

**Auto-selected:** Single graphNodes array + kind flag — recommended default.
**Rationale:** Bridges participate in the same simulation and render passes as file nodes; parallel storage wastes code.

---

## Edge Kinds

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing `EdgeKind` union with `invokes` + `handles` | Single type flows through `GraphEdge`; `drawEdges` branches on kind | ✓ |
| New `BridgeEdge` type parallel to `GraphEdge` | Requires second render pass; complicates hit-testing | |
| Reuse `import` variant | Loses semantic distinction | |

**Auto-selected:** Extend `EdgeKind` — recommended default.
**Rationale:** `EdgeKind` already discriminates by language / edge semantics; adding two variants is a small, natural extension.

---

## Boundary Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Pin bridges to y=0 + `forceBoundary` pushes files to language-appropriate half-plane | Deterministic line + flexible file clustering; alpha-decay handles transient overlap | ✓ |
| Pure force (no pinning) | Bridges drift; line becomes fuzzy | |
| Pin bridges only (no file-node force) | File nodes cluster around bridges via adjacency alone; line visible but halves not separated | |

**Auto-selected:** Pin + push-file force — recommended default.
**Rationale:** Delivers the phase title's "visible frontend/backend boundary line" deterministically while letting the existing clustering physics govern the rest.

---

## Bridge X-Spread

| Option | Description | Selected |
|--------|-------------|----------|
| Alphabetic (sorted by camelCase name) | Deterministic, stable across refreshes, easy to scan | ✓ |
| Grouped by subsystem (agents.* adjacent, pipeline.* adjacent) | More readable topically; less stable; requires naming convention | |
| Force-resolved x | Lets sim pack bridges; bridges drift horizontally on every rewarm | |

**Auto-selected:** Alphabetic — recommended default.
**Rationale:** Stability > clustering for v1; grouped is a noted polish candidate.

---

## Boundary Line Rendering

| Option | Description | Selected |
|--------|-------------|----------|
| Thin horizontal line at world-space y=0 + screen-space FRONTEND/BACKEND labels at viewport left | Always visible, zoom-invariant via screen-space labels | ✓ |
| Subtle gradient tint above/below | Less legible at a glance | |
| Hidden behind a "cross-language view" toggle | Buries the phase's deliverable | |

**Auto-selected:** Drawn line + screen-space labels — recommended default.
**Rationale:** Phase title says "visible"; line + labels read at every zoom.

---

## Language Classification

| Option | Description | Selected |
|--------|-------------|----------|
| Path prefix first (`src-tauri/` → backend), extension fallback | Unambiguous in this repo; portable fallback for reuse | ✓ |
| Extension only (`.rs` vs `.ts/.tsx/.js/.jsx`) | Works but brittle if Rust files land outside src-tauri (monorepos) | |
| Content sniff | Expensive, unnecessary | |

**Auto-selected:** Path prefix + extension fallback — recommended default.
**Rationale:** AITC's binary src/ vs src-tauri/ layout makes the prefix check trivial; extension fallback keeps the code portable.

---

## Bridge Node Visual Treatment

| Option | Description | Selected |
|--------|-------------|----------|
| Rotated-square diamond, cyan fill, phosphor-green stroke; channel commands double-stroke; dangling dashed | Distinct in palette; legible; carries 3 signals (base/channel/dangling) | ✓ |
| Circle, cyan color only | Too similar to file nodes; loses channel/dangling signals | |
| Hexagon | Distinct but heavier to draw; no marginal readability gain | |

**Auto-selected:** Diamond with state-based stroke — recommended default.
**Rationale:** Shape carries base identity; stroke carries metadata; palette stays within Command Horizon's discipline.

---

## Label Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Command name above diamond at zoom ≥ `FILE_LABEL_ZOOM_THRESHOLD` (4×) | Matches file-node label policy; uncluttered at overview zoom | ✓ |
| Always visible | Clutters workspace zoom | |
| Only in tooltip | Forces hover even for scanning | |

**Auto-selected:** Zoom-gated label — recommended default.
**Rationale:** Consistency with existing file-label policy (Phase 7 FILE_LABEL_ZOOM_THRESHOLD).

---

## Zoom Visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Bridges render at all zoom levels | Skeleton of cross-language architecture, never occluded | ✓ |
| Hide bridges at workspace zoom | Loses the phase's visual at the highest-overview view | |
| Progressive detail (bridges → aggregated region → hidden) | Semantic-zoom complexity is Phase 13's scope | |

**Auto-selected:** Always visible — recommended default.
**Rationale:** Bridges are the phase's first-impression visual; hiding them at high zoom defeats the point.

---

## Hover Tooltip

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse AgentTooltip chrome; show command, signature, handler, caller count | Consistent with existing radar tooltips; fast to implement | ✓ |
| New custom BridgeTooltip | Duplicates shell chrome | |
| No tooltip (detail panel only) | Forces selection for lightweight scanning | |

**Auto-selected:** Reused tooltip chrome — recommended default.
**Rationale:** Establishes visual consistency; minimal new UI.

---

## Click / Select Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| `selectedBridgeId` slot + detail panel in existing RadarManifest sidebar | Reuses sidebar chrome; parallel to selectedAgentId | ✓ |
| Modal dialog on click | Blocks other radar interaction | |
| Secondary floating panel | Introduces new panel-management UX | |

**Auto-selected:** Sidebar-embedded detail panel — recommended default.
**Rationale:** Mirrors `selectedAgentId` pattern; consumes existing `RadarManifest` surface.

---

## Deep-Link to Source

| Option | Description | Selected |
|--------|-------------|----------|
| v1 deferred — show paths as copyable text | Respects PROJECT.md "no built-in editor" and avoids premature URI-scheme picks | ✓ |
| vscode://file URI now | Editor-specific; adds friction for non-VS Code users | |
| Copy-to-clipboard button | Nice polish; not blocker | |

**Auto-selected:** Paths-as-text (no deep-link) — recommended default.
**Rationale:** PROJECT.md Out-of-Scope + no consensus on editor choice for all users; deferred.

---

## Refresh Cadence

| Option | Description | Selected |
|--------|-------------|----------|
| Third parallel leg in `fetchGraph` + `installRadarPipelineBridge` 500ms debounce | Reuses Phase 7 pipeline infrastructure; "regenerated from source, cannot drift" | ✓ |
| On-demand via refresh button | User-managed staleness; counterintuitive for live radar | |
| N-second polling | Wastes cycles; unnecessary given file-watcher trigger | |

**Auto-selected:** Parallel fetchGraph + debounced bridge — recommended default.
**Rationale:** Phase 7 set the precedent; zero new wiring.

---

## Caching

| Option | Description | Selected |
|--------|-------------|----------|
| No cache (rebuild from source every refresh) | Simple; expected <100ms cost; no invalidation logic | ✓ |
| mtime-keyed cache | Unnecessary complexity at this cost | |
| Persistent cache to disk | Violates "rebuildable from source" invariant | |

**Auto-selected:** No cache — recommended default.
**Rationale:** Matches Phase 7 D-05 precedent; cost is negligible; no invalidation risk.

---

## New Tauri Command & Types

| Option | Description | Selected |
|--------|-------------|----------|
| `get_ipc_bridges` in `pipeline/commands.rs` + register `IpcBridgeDto`/`IpcCallSite`/`CallShape` | Matches `get_dependency_graph` pattern | ✓ |
| Inline into `get_dependency_graph` (return combined DTO) | Breaks the boundary between graph + bridge data | |
| Event emit instead of command | Unnecessary — data fits one-shot fetch | |

**Auto-selected:** New dedicated command — recommended default.
**Rationale:** Matches existing pipeline/commands.rs pattern; clean separation.

---

## Force-Config Slider

| Option | Description | Selected |
|--------|-------------|----------|
| Add `boundaryStrength` slider to `ForceConfigPanel` + `DEFAULT_FORCE_CONFIG.boundaryStrength = 0.15` | Consistent with existing four-slider pattern; tunable live | ✓ |
| Hardcoded strength | No empirical tuning; harder to debug | |
| New panel | Overkill for one slider | |

**Auto-selected:** Extend existing panel — recommended default.
**Rationale:** Parallelism with four existing sliders; backward-compatible via `??` fallback.

---

## z-Order for Bridge-Specific Draws

| Option | Description | Selected |
|--------|-------------|----------|
| Boundary line before hulls; bridges after file nodes; screen-space labels last | Matches visual hierarchy (structure behind, focal elements front) | ✓ |
| Bridges before file nodes | File nodes can occlude bridges | |
| Boundary line on top of everything | Over-prominent; hides selection rings | |

**Auto-selected:** Layered as spec'd — recommended default.
**Rationale:** Follows the z-order discipline established in GraphRenderer.

---

## Testing Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Rust `#[cfg(test)] mod tests` + `test_fixtures/` (mirror deps/); Frontend Vitest colocated in `__tests__/` | Phase 7 convention; immediate reusability | ✓ |
| Integration tests only | Slower feedback; poorer isolation | |
| Storybook for visual states | Nice-to-have; not a pass/fail gate | |

**Auto-selected:** Colocated unit tests — recommended default.
**Rationale:** Matches codebase convention.

---

## Worker Protocol Impact

| Option | Description | Selected |
|--------|-------------|----------|
| Extend `ForceConfig` with `boundaryStrength`; register `forceBoundary` inside worker alongside `forceCluster` | Zero protocol reshape; new force reads `kind` off already-transferred node data | ✓ |
| New worker message for boundary state | Over-engineered; boundaryStrength fits ForceConfig | |
| Run boundary force on main thread | Defeats Phase 11's "worker owns physics" invariant | |

**Auto-selected:** Extend ForceConfig + in-worker force — recommended default.
**Rationale:** Respects Phase 11 D-01..D-24; minimum protocol delta.

---

## Claude's Discretion

- Exact force math for `forceBoundary` (linear vs spring; deadband near y=0) — spring + small deadband recommended.
- Bridge-x-spread on every rewarm vs on command-set-change only — cheap hash check keeps x stable across unrelated file churn.
- Aliased `commands` import handling — zero occurrences today; tree-sitter query extension is a one-shot add.
- Focus-mode (dim non-caller file nodes when bridge selected) — nice if cheap; v1 may defer.
- Whether to surface bridges in heat map tint — let the existing file-path-keyed scoring carry through transparently (emergent signal).
- Location of `forceBoundary.ts`: `src/views/Radar/` (Phase 11 D-30 convention) vs `src/workers/forces/` (Phase 11 deferred reorg) — pick one.
- Invoke-count heat tint, multi-line signature preview, rightmost boundary labels — all listed in `<deferred>`.

---

## Deferred Ideas

See CONTEXT.md `<deferred>` section for the full list (~15 items). Highlights:

- Agent-driven invoke animation (needs invoke telemetry)
- Deep-link to editor via URI scheme
- Drag-to-pin bridges (would break deterministic layout)
- Event push bridges / MCP / Phase 8 /hook — separate surfaces
- Aliased `commands` imports, variable-name invokes — TS tooling extensions
- Grouped-by-subsystem x-spread
- Bridge heat from runtime invoke counts
- Focus mode (dim non-callers)
- Persisted bridge positions
- Rightmost boundary labels

---

*Phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati*
*Discussion mode: auto (no interactive Q&A; all options selected as recommended defaults per 2026-04-21)*
