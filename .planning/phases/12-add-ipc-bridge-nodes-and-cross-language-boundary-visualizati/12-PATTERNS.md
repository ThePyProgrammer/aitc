# Phase 12: IPC Bridge Nodes + Cross-Language Boundary — Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 29 (new + modified)
**Analogs found:** 29 / 29 (every file has an in-repo template)

> Bias: concrete excerpts over prose. Every `<action>` / `<read_first>` the planner writes should cite a specific `file:line-line` span from this doc.

---

## File Classification

### New files (Rust backend)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src-tauri/src/pipeline/ipc_bridges/mod.rs` | model + service | batch / transform | `src-tauri/src/pipeline/deps/mod.rs` | exact (sibling module shape) |
| `src-tauri/src/pipeline/ipc_bridges/bindings_parser.rs` | utility (text parser) | transform | `src-tauri/src/pipeline/deps/resolve.rs` (pure-fn + `#[cfg(test)] mod tests` convention); no direct analog for regex-over-file — RESEARCH §Pattern 1 is canonical | role-match only |
| `src-tauri/src/pipeline/ipc_bridges/rust_handler_scanner.rs` | utility (rayon-parallel scanner) | batch / transform | `src-tauri/src/pipeline/deps/resolve.rs` (regex + pure-fn idiom); rayon pattern from `pipeline/deps/mod.rs:95-127` | role-match |
| `src-tauri/src/pipeline/ipc_bridges/frontend_callsite_scanner.rs` | utility (tree-sitter scanner) | batch / transform | `src-tauri/src/pipeline/deps/extract.rs` (thread-local Parser + Query cache + rayon) | exact |
| `src-tauri/src/pipeline/ipc_bridges/queries/typescript.rs` (may be inline inside the scanner — planner's choice) | config (tree-sitter query const) | — | `src-tauri/src/pipeline/deps/queries/typescript.rs` | exact |
| `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_bindings.ts` | test-fixture | — | `src-tauri/src/pipeline/deps/test_fixtures/sample.ts` | structural (different content) |
| `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_handler.rs` | test-fixture | — | `src-tauri/src/pipeline/deps/test_fixtures/sample.rs` | structural |
| `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_caller_literal.ts` | test-fixture | — | `src-tauri/src/pipeline/deps/test_fixtures/sample.ts` | structural |
| `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_caller_typed.tsx` | test-fixture | — | `src-tauri/src/pipeline/deps/test_fixtures/sample.tsx` | structural |

### New files (Frontend)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/workers/forces/forceBoundary.ts` (CONTEXT §Claude's Discretion → RESEARCH resolves to `src/workers/forces/`) | utility (custom d3-force) | event-driven (per-tick) | `src/views/Radar/forceCluster.ts` | exact (force contract identical) |
| `src/views/Radar/BridgeRenderer.ts` (UI-SPEC §Component Inventory) | utility (pure Canvas draw fns) | transform (world → pixels) | `src/views/Radar/GraphRenderer.ts` (`drawNodes`, `drawEdges`, `drawSelectedNode`) | exact |
| `src/views/Radar/BridgeTooltip.tsx` | component | request-response (hover) | `src/views/Radar/AgentTooltip.tsx` | exact (reuse glassmorphism chrome) |
| `src/views/Radar/BridgeDetailPanel.tsx` | component | request-response (selection) | `src/views/Radar/AgentManifestRow.tsx` + `src/views/Radar/AlertDetail.tsx` | role-match (panel layout + click→pan idiom) |
| `src/views/Radar/__tests__/forceBoundary.test.ts` | test | — | `src/views/Radar/__tests__/forceCluster.test.ts` | exact |
| `src/views/Radar/__tests__/BridgeRender.test.ts` | test | — | `src/views/Radar/__tests__/GraphRenderer.test.ts` + `RadarCanvas.test.tsx` shim | exact (same Canvas shim idiom) |
| `src/views/Radar/__tests__/BoundaryLine.test.ts` | test | — | `src/views/Radar/__tests__/GraphRenderer.test.ts` | exact |
| `src/views/Radar/__tests__/BridgeSelection.test.tsx` | test | — | `src/views/Radar/__tests__/RadarMinimap.test.tsx` (store-mocked selection test) | exact |
| `src/views/Radar/__tests__/BridgeTooltip.test.tsx` | test | — | `src/views/Radar/__tests__/RadarCanvas.test.tsx` hover dispatch section | role-match |

### Modified files

| Modified File | Role | Data Flow | Nature of Change |
|---------------|------|-----------|-------------------|
| `src-tauri/src/pipeline/mod.rs` | registration | — | `pub mod ipc_bridges;` one-liner |
| `src-tauri/src/pipeline/commands.rs` | controller | request-response | add `get_ipc_bridges` mirroring `get_dependency_graph` |
| `src-tauri/src/pipeline/deps/mod.rs` | model | — | extend `EdgeKind` enum with `Invokes` + `Handles` variants |
| `src-tauri/src/lib.rs` | config | — | register command in `collect_commands!` + `.typ::<…>()` for 3 new DTOs |
| `src/stores/radarStore.ts` | store | CRUD | widen `GraphNode`, add `selectedBridgeId`, extend `ForceConfig`, add third `Promise.all` leg |
| `src/workers/graphSimConfig.ts` | config | — | add `BOUNDARY_STRENGTH_DEFAULT = 0.15`, `BOUNDARY_DEADBAND = 5`, `GRAPH_HALF_WIDTH = 1600` |
| `src/workers/graphSimProtocol.ts` | config | — | widen `ForceConfig` + `InitMessage.nodes[]` with `kind` + `language` |
| `src/workers/graphSimCore.ts` | service | event-driven | register `forceBoundary` alongside `forceCluster` |
| `src/views/Radar/GraphRenderer.ts` | utility | transform | `drawEdges` switches on `kind === 'invokes' \| 'handles'` for alpha boost |
| `src/views/Radar/RadarCanvas.tsx` | component | event-driven | z-order extension (boundary line, bridges, screen-space anchors) + hit-test branching |
| `src/views/Radar/RadarManifest.tsx` | component | request-response | render `<BridgeDetailPanel/>` when `selectedBridgeId !== null` |
| `src/views/Radar/ForceConfigPanel.tsx` | component | request-response | append BOUNDARY slider after CENTER |

---

## Pattern Assignments

### `src-tauri/src/pipeline/ipc_bridges/mod.rs` (model + service, batch/transform)

**Analog:** `src-tauri/src/pipeline/deps/mod.rs` (262 lines — template for module entry, DTO shape, `#[cfg(test)] mod tests`).

**Module header pattern** (`deps/mod.rs:1-22`):
```rust
//! Phase 12: IPC bridge extraction (D-01..D-13, VIZN-01/05 extension).
//!
//! Parses src/bindings.ts (tauri-specta canonical) for the command surface,
//! grep-scans src-tauri/src/**/*.rs for #[tauri::command] attributes,
//! tree-sitter-scans src/**/*.ts(x) for invoke('literal', …) and
//! commands.camelName(…) call-sites. Returns a Vec<IpcBridgeDto> via the
//! new get_ipc_bridges command.
//!
//! See: .planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-RESEARCH.md

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};

pub mod bindings_parser;
pub mod rust_handler_scanner;
pub mod frontend_callsite_scanner;
```

**DTO shape** (copy the `#[derive(Debug, Clone, Serialize, Deserialize, Type)] #[serde(rename_all = "camelCase")]` stack from `deps/mod.rs:33-54` — identical for all 3 new types):
```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcBridgeDto {
    pub command_name: String,       // camelCase — from bindings.ts
    pub rust_name: String,          // snake_case — Rust fn name
    pub handler_file: String,       // repo-relative forward-slash
    pub handler_line: u32,          // 1-indexed line of `fn`
    pub caller_files: Vec<IpcCallSite>,
    pub signature_summary: String,  // "(args) → return", ≤120 chars
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

**Top-level `build_ipc_bridges` entrypoint** — mirror `build_dependency_graph` signature shape (`deps/mod.rs:84-150`):
```rust
pub fn build_ipc_bridges(repo_root: &Path) -> Vec<IpcBridgeDto> {
    // 1. Parse src/bindings.ts for the command catalog
    // 2. Parallel-scan src-tauri/src/**/*.rs for handlers
    // 3. Parallel-scan src/**/*.ts(x) for call-sites (excluding bindings.ts)
    // 4. Join: command → handler → callers; emit DTOs with repo-relative paths
}
```

**Test module scaffold** (`deps/mod.rs:152-261`) — same `use super::*; use std::fs; use tempfile::TempDir;` plus `include_str!("test_fixtures/sample_bindings.ts")` for fixture loading.

**Risk note:** This file is the smallest of the new Rust files (should land ~150 lines). If it grows past 200, collapse `bindings_parser` helpers into it; if it grows past 300 something is wrong (per RESEARCH §Don't Hand-Roll).

---

### `src-tauri/src/pipeline/ipc_bridges/bindings_parser.rs` (utility, transform)

**Analog:** no direct in-repo analog for "regex over generated TS file" — RESEARCH §Pattern 1 (lines 363-405) is canonical. **Convention analog:** `src-tauri/src/pipeline/deps/resolve.rs` for module shape (pure functions, `#[cfg(test)] mod tests`, `use regex::Regex;`).

**OnceLock regex cache pattern** (verbatim from RESEARCH §Pattern 1):
```rust
use regex::Regex;
use std::sync::OnceLock;

fn signature_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?m)^async\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*:\s*Promise<([\s\S]*?)>\s*\{"
        ).expect("bindings regex compiles")
    })
}

fn invoke_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"TAURI_INVOKE\("([a-z_][a-z0-9_]*)""#).expect("invoke regex compiles")
    })
}
```

**Live bindings.ts shape** (verified 2026-04-21, `src/bindings.ts:11-19`):
```typescript
async startWatch(repoRoot: string, channel: TAURI_CHANNEL<FileEventBatch>) : Promise<Result<Worktree[], string>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("start_watch", { repoRoot, channel }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
```

**Output shape** (internal struct; do not serialize):
```rust
pub struct BindingCommand {
    pub camel_name: String,
    pub snake_name: String,
    pub signature_summary: String,  // (args) → return, ≤120 chars
    pub has_channel_arg: bool,
}
pub fn parse_bindings(bindings_ts_source: &str) -> Vec<BindingCommand>;
```

**Risk note:** Pitfall 3 from RESEARCH — pair `signature_re` with the **next** `TAURI_INVOKE` by searching `invoke_re.find_at(bytes_offset_after_header)`; do NOT zip disjoint iterators.

---

### `src-tauri/src/pipeline/ipc_bridges/rust_handler_scanner.rs` (utility, batch)

**Analog:** `src-tauri/src/pipeline/deps/mod.rs` rayon idiom at **`deps/mod.rs:95-127`**; regex idiom from RESEARCH §Pattern 2.

**Rayon + walkdir pattern** (paraphrase of `deps/mod.rs:95-127` adapted to scan by filesystem):
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
    // dedupe → HashMap, log tracing::warn! on first collision per name
}
```

**Regex** (verbatim from RESEARCH §Pattern 2):
```rust
fn handler_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?m)^\s*#\[tauri::command(?:\([^\)]*\))?\]\s*(?:\n\s*#\[[^\]]+\]\s*)*\n\s*(?:pub(?:\([^\)]*\))?\s+)?(?:async\s+)?fn\s+([a-z_][a-z0-9_]*)\s*\("
        ).expect("handler regex compiles")
    })
}
```

**Line-number extraction:** `count '\n' chars before match offset + 1` → 1-indexed (CONTEXT D-06).

---

### `src-tauri/src/pipeline/ipc_bridges/frontend_callsite_scanner.rs` (utility, batch)

**Analog:** `src-tauri/src/pipeline/deps/extract.rs` (450 lines) — **the canonical tree-sitter pattern for this repo**.

**Thread-local Parser + Query cache** (`extract.rs:32-35`, this repo's established idiom):
```rust
thread_local! {
    static BRIDGE_PARSERS: RefCell<[Option<Parser>; 2]> = const { RefCell::new([None, None]) };
    static BRIDGE_QUERIES: RefCell<[Option<Query>; 2]> = const { RefCell::new([None, None]) };
}
// slot 0 = TypeScript, slot 1 = TSX — separate from deps/extract.rs's 6-slot cache
// because the queries are different (invoke call-sites vs import-source edges).
```

**Parser / query setup pattern** (`extract.rs:125-177` — mirror exactly for the bridge scanner; wall-clock parse budget + size cap carry over so Phase 12 inherits T-07-A mitigation):
```rust
PARSERS.with(|cell| {
    let mut slot = cell.borrow_mut();
    let idx = lang_index(language);
    if slot[idx].is_none() {
        let mut parser = Parser::new();
        if parser.set_language(&ts_language_for(language)).is_err() {
            return Vec::new();
        }
        slot[idx] = Some(parser);
    }
    let parser = slot[idx].as_mut().expect("parser initialized above");
    // ... parse_with_options with ParseOptions::new().progress_callback(&mut progress) ...
})
```

**Tree-sitter query** — colocate as `ipc_bridges/queries/typescript.rs` mirroring `deps/queries/typescript.rs:13-23`:
```rust
pub const IPC_CALLSITE_QUERY: &str = r#"
    (call_expression
      function: (identifier) @_fn
      arguments: (arguments
        .
        (string (string_fragment) @command)
      )
      (#eq? @_fn "invoke")) @invoke_literal

    (call_expression
      function: (member_expression
        object: (identifier) @_obj
        property: (property_identifier) @command)
      (#eq? @_obj "commands")) @commands_typed
"#;
```

**Non-obvious tree-sitter setup call-outs:**
1. **Pattern index discriminates call shape:** `match m.pattern_index { 0 => CallShape::Literal, 1 => CallShape::Typed, _ => continue }`.
2. **1-indexed line:** `m.captures[0].node.start_position().row + 1` (RESEARCH Pitfall 4).
3. **Capture names** (`@command`, `@_fn`, `@_obj`): predicate names starting with `_` are standard convention for "predicate-only" captures. The `@command` capture is the one you read via `node.utf8_text(src_bytes)`.
4. **Exclude `src/bindings.ts` itself** from the file walk (RESEARCH lines 517-530) — it contains `invoke` transitively and would self-attribute to every command.

**File walk** (RESEARCH lines 519-530):
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

---

### `src-tauri/src/pipeline/ipc_bridges/test_fixtures/` (test fixtures)

**Analog:** `src-tauri/src/pipeline/deps/test_fixtures/` (contains 6 files: `sample.js`, `sample.jsx`, `sample.py`, `sample.rs`, `sample.ts`, `sample.tsx`).

**Sample-file shape** (mirror these — tiny and focused):

`sample.ts` (`deps/test_fixtures/sample.ts:1-8`):
```typescript
import foo from './foo';
import { bar } from '../bar/baz';
import * as ns from '@/lib/x';
import type { T } from './types';
export { x } from './x';
export * from './y';
const dyn = import('./dyn');
const cjs = require('./cjs');
```

`sample.rs` (`deps/test_fixtures/sample.rs:1-4`):
```rust
use crate::foo::Bar;
use super::baz;
use std::path::Path;
mod sibling;
```

**Fixture-loading convention** — `include_str!("test_fixtures/sample_bindings.ts")` inside `#[cfg(test)] mod tests` so the fixture travels with the compiled test binary (no runtime FS dependency in CI).

**Fixture requirements for V-12-01..V-12-12** (from VALIDATION §Wave 0):
- `sample_bindings.ts` — 3 commands: 1 fire-and-forget, 1 channel-bearing (`TAURI_CHANNEL<…>` arg), 1 dangling (no handler, no callers).
- `sample_handler.rs` — at least 3 `#[tauri::command]` attrs covering: `pub async fn`, `async fn`, `pub fn`; one should carry `tauri::ipc::Channel<…>` arg.
- `sample_caller_literal.ts` — 5 `invoke(...)` shapes: 3 valid string-literal, 1 variable-callee (must SKIP), 1 in-comment (must SKIP).
- `sample_caller_typed.tsx` — 3 `commands.X()` shapes: 2 direct, 1 aliased import (must SKIP per CONTEXT D-05).

---

### `src-tauri/src/pipeline/commands.rs` (controller — extend, request-response)

**Analog:** `get_dependency_graph` at **`src-tauri/src/pipeline/commands.rs:314-376`** (exact pattern to mirror).

**Copy-paste template** (lines 314-344 — adapt name + DTO type, drop the `tree_index` collection since bridges walk FS directly):
```rust
/// Get the IPC bridge surface (commands + handlers + callers) for the active
/// watch. Returns an empty vec if no watch is active.
///
/// Bridges use repo-relative forward-slash paths (matching `get_tree_index`
/// convention, commit `a1b15b6`).
///
/// CPU-heavy parsing runs on `tauri::async_runtime::spawn_blocking` so the main
/// async runtime stays responsive during the <100ms build target (D-35).
#[tauri::command]
#[specta::specta]
pub async fn get_ipc_bridges(
    state: tauri::State<'_, PipelineState>,
) -> Result<Vec<crate::pipeline::ipc_bridges::IpcBridgeDto>, String> {
    use crate::pipeline::ipc_bridges::build_ipc_bridges;
    let guard = state.inner.lock().await;
    match guard.as_ref() {
        Some(active) => {
            let repo_root = active.repo_root.clone();
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

**Repo-relative path normalization** (copy verbatim from `commands.rs:356-368`) — apply inside `build_ipc_bridges` when writing DTO paths:
```rust
let repo_rel = absolute_path
    .strip_prefix(&repo_root)
    .ok()?
    .to_string_lossy()
    .replace('\\', "/");
```

---

### `src-tauri/src/pipeline/deps/mod.rs` (model — extend)

**Analog:** **self**. Extend the existing `EdgeKind` enum at **`deps/mod.rs:43-54`**:
```rust
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
    Invokes,    // NEW — caller file → bridge
    Handles,    // NEW — bridge → handler file
}
```

**Downstream bindings regen cascade:** adding variants widens the `EdgeKind` union type in `src/bindings.ts` to `"import" | … | "invokes" | "handles"` — after `cargo build` the frontend `switch (edge.kind)` in `GraphRenderer.drawEdges` will fail exhaustive-matching until the new arms land.

---

### `src-tauri/src/lib.rs` (config — extend)

**Analog:** **self**. Two edits at **`src/lib.rs:42-97`** (`collect_commands!` block) and **`src/lib.rs:99-130`** (`.typ::<…>()` chain).

**Command registration** (insert after line 47):
```rust
.commands(tauri_specta::collect_commands![
    pipeline::commands::start_watch,
    // ... existing entries ...
    pipeline::commands::get_dependency_graph,
    pipeline::commands::get_ipc_bridges,       // NEW Phase 12
    // ... rest ...
])
```

**Type registration** (insert after `.typ::<pipeline::deps::EdgeKind>()` at line 106):
```rust
.typ::<pipeline::deps::DependencyEdgeDto>()
.typ::<pipeline::deps::EdgeKind>()              // already present — now widened
.typ::<pipeline::ipc_bridges::IpcBridgeDto>()    // NEW
.typ::<pipeline::ipc_bridges::IpcCallSite>()     // NEW
.typ::<pipeline::ipc_bridges::CallShape>()       // NEW
```

**Non-obvious tauri-specta setup call-out:** bindings regen is gated on `#[cfg(debug_assertions)]` per `lib.rs:139` (not shown in excerpt) — so the canonical regen recipe is `cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc` (VALIDATION §Test Infrastructure). After a release build `src/bindings.ts` does NOT regenerate.

---

### `src/workers/forces/forceBoundary.ts` (utility — custom d3-force)

**Analog:** `src/views/Radar/forceCluster.ts` (197 lines). **Exact match** — same `{ force(alpha); force.initialize(nodes); force.strength(getter/setter) }` contract.

**Force interface pattern** (`forceCluster.ts:16-27`):
```typescript
import type { SimulationNodeDatum } from 'd3-force';

export interface BoundaryNode extends SimulationNodeDatum {
  kind: 'file' | 'bridge';
  language?: 'ts' | 'rust';  // undefined → no boundary force applied
}

export interface BoundaryForce {
  (alpha: number): void;
  initialize: (nodes: BoundaryNode[]) => void;
  strength: ((v: number) => BoundaryForce) & (() => number);
}
```

**Force body** — mirror `forceCluster.ts:155-196`, replacing centroid math with target-y math (RESEARCH §Pattern 4 provides the full body):
```typescript
export function forceBoundary(): BoundaryForce {
  let nodes: BoundaryNode[] = [];
  let strength = 0.15;
  const force = ((alpha: number) => {
    const k = strength * alpha;
    if (k === 0) return;                      // RESEARCH Pitfall 7
    for (const n of nodes) {
      if (n.kind !== 'file') continue;
      if (n.language === undefined) continue;
      const targetY = n.language === 'ts' ? -300 : 300;
      const y = n.y ?? 0;
      const dy = targetY - y;
      if (Math.abs(y) < 5 /* DEADBAND */ && Math.abs(dy) > 295) continue;
      n.vy = (n.vy ?? 0) + Math.sign(dy) * k * Math.min(Math.abs(dy), 300);
    }
  }) as BoundaryForce;
  force.initialize = (n: BoundaryNode[]) => { nodes = n; };
  force.strength = ((v?: number) => {
    if (v === undefined) return strength;
    strength = v;
    return force;
  }) as BoundaryForce['strength'];
  return force;
}
```

**Exported constants** (mirror `forceCluster.ts:30-32` idiom):
```typescript
export const BOUNDARY_TARGET_Y_MAGNITUDE = 300;
export const BOUNDARY_DEADBAND = 5;
export const FORCE_BOUNDARY_BASE_STRENGTH = 0.15;
```

---

### `src/views/Radar/__tests__/forceBoundary.test.ts` (test)

**Analog:** `src/views/Radar/__tests__/forceCluster.test.ts` (135 lines). **Exact match** — mulberry32 seeded RNG + manual damping emulation + strength getter/setter round-trip.

**Seeded-RNG helper** (`forceCluster.test.ts:20-28` — copy verbatim):
```typescript
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
```

**Convergence-in-N-ticks test shape** (`forceCluster.test.ts:43-81` — adapt to bifurcation assertion for V-12-17/V-12-18):
```typescript
it('converges TS-path nodes to negative y over 30 ticks at strength 0.15 (V-12-17)', () => {
  const rng = mulberry32(42);
  const nodes: BoundaryNode[] = Array.from({ length: 10 }, () => ({
    kind: 'file',
    language: 'ts',
    x: (rng() - 0.5) * 200,
    y: (rng() - 0.5) * 200,
    vx: 0, vy: 0,
  }));
  const f = forceBoundary();
  f.initialize(nodes);
  f.strength(0.15);
  for (let t = 0; t < 30; t++) {
    f(1);
    for (const n of nodes) {
      n.vx = (n.vx ?? 0) * 0.5;          // emulate velocityDecay
      n.vy = (n.vy ?? 0) * 0.5;
      n.x = (n.x ?? 0) + (n.vx ?? 0);
      n.y = (n.y ?? 0) + (n.vy ?? 0);
    }
  }
  for (const n of nodes) expect(n.y).toBeLessThan(-50);
});
```

**Bridges-stay-pinned test** (V-12-19 — d3-force clobbers vy for fy-pinned nodes):
```typescript
it('bridges with fy=0 stay at y=0 regardless of strength (V-12-19)', () => {
  const nodes: BoundaryNode[] = [{ kind: 'bridge', fx: 0, fy: 0, x: 0, y: 0, vx: 0, vy: 0 }];
  const f = forceBoundary();
  f.initialize(nodes);
  f.strength(10);  // absurdly high
  for (let t = 0; t < 100; t++) f(1);
  // forceBoundary SKIPS kind !== 'file' (see force body), so bridges' vy is untouched.
  expect(nodes[0].vy).toBe(0);
});
```

---

### `src/views/Radar/BridgeRenderer.ts` (utility — Canvas 2D draw functions)

**Analog:** `src/views/Radar/GraphRenderer.ts`. Specifically:
- `drawBoundaryLine` ← `drawEdges` body pattern (`GraphRenderer.ts:229-272`)
- `drawBridgeNodes` ← `drawNodes` body pattern (`GraphRenderer.ts:332-418`)
- `drawSelectedBridge` ← `drawSelectedNode` pattern (`GraphRenderer.ts:459-482`)
- `drawBridgeLabels` ← `drawFileLabels` pattern (`GraphRenderer.ts:424-450`)
- `drawBoundaryAnchorLabels` ← screen-space pass idiom from `RadarCanvas.tsx:592-596`

**Draw-function signature convention** (every pure draw-fn takes `ctx, …data…, zoom, viewport, canvasW, canvasH, theme = FALLBACK_THEME`):
```typescript
export function drawBridgeNodes(
  ctx: CanvasRenderingContext2D,
  bridges: GraphNode[],                     // filtered to kind === 'bridge'
  selectedBridgeId: string | null,
  hoveredBridgeId: string | null,
  zoom: number,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void { /* … */ }
```

**Diamond geometry** (RESEARCH §Pattern 6):
```typescript
const d = BRIDGE_HALF_DIAG / zoom;          // 8 / zoom
ctx.beginPath();
ctx.moveTo(b.x, b.y - d);
ctx.lineTo(b.x + d, b.y);
ctx.lineTo(b.x, b.y + d);
ctx.lineTo(b.x - d, b.y);
ctx.closePath();
ctx.fillStyle = theme.edgeGlow ?? theme.arrowFill ?? '#00cffc';
ctx.fill();
ctx.strokeStyle = theme.nodeStroke;
ctx.lineWidth = 1 / zoom;
if (b.callerCount === 0 || !b.handlerFile) ctx.setLineDash([4, 3]);  // dangling (D-09)
ctx.stroke();
ctx.setLineDash([]);
```

**Sizing-token exports** (UI-SPEC §Sizing Tokens — ALL new constants live here):
```typescript
export const BRIDGE_HALF_DIAG = 8;
export const BRIDGE_CHANNEL_STROKE_OFFSET = 2;
export const BRIDGE_SELECTED_RING_OFFSET = 3;
export const BRIDGE_LABEL_OFFSET = 6;
export const BRIDGE_LABEL_ZOOM_THRESHOLD = 4;   // matches FILE_LABEL_ZOOM_THRESHOLD
export const BRIDGE_DASH_PATTERN: [number, number] = [4, 3];
export const BOUNDARY_LINE_OPACITY = 0.6;
export const BRIDGE_HIT_RADIUS = 10;
```

**Boundary line** — drawn across full world at y=0 (UI-SPEC §Layout):
```typescript
export function drawBoundaryLine(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  // Compute world-x extents from the screen viewport rect.
  const leftWorld = -viewport.panX / viewport.zoom;
  const rightWorld = (canvasWidth - viewport.panX) / viewport.zoom;
  ctx.strokeStyle = theme.hullStroke;
  ctx.globalAlpha = BOUNDARY_LINE_OPACITY;
  ctx.lineWidth = 1 / viewport.zoom;
  ctx.beginPath();
  ctx.moveTo(leftWorld, 0);
  ctx.lineTo(rightWorld, 0);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
```

**Screen-space FRONTEND/BACKEND labels** — RESEARCH §Pattern 8 gives the full body; the `ctx.save() + setTransform(1,0,0,1,0,0) + restore()` idiom comes from `RadarCanvas.tsx:591-596`.

---

### `src/views/Radar/GraphRenderer.ts` (extend `drawEdges`)

**Analog:** **self**. The body already supports per-edge state changes — add one `switch (e.kind)` branch at **`GraphRenderer.ts:249`** (inside the main for-loop) to boost alpha for `invokes` / `handles` variants:

```typescript
for (const e of edges) {
  // ... existing endpoint-resolution + culling (lines 249-262) ...
  // NEW: boost alpha for cross-language boundary edges.
  if (e.kind === 'invokes' || e.kind === 'handles') {
    ctx.globalAlpha = Math.min(1, 0.55 * 1.27);  // ≈0.70 vs 0.55 default
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  if (e.kind === 'invokes' || e.kind === 'handles') {
    ctx.globalAlpha = 1;
  }
}
```

**Critical reminder:** existing `EdgeKind` union (`bindings.ts`) is regenerated from Rust after the `deps/mod.rs` edit. If any `switch (edge.kind)` elsewhere relies on `never` exhaustive checks, they'll break until the new arms are added. `grep -rn "switch.*kind" src/` returns only `drawEdges`; safe to touch here only.

---

### `src/views/Radar/BridgeTooltip.tsx` (component — hover overlay)

**Analog:** `src/views/Radar/AgentTooltip.tsx` (90 lines). **Exact reuse** — clone the glassmorphism wrapper and replace the content rows.

**Glassmorphism chrome** (`AgentTooltip.tsx:54-67` — copy verbatim):
```tsx
<div className="absolute z-50 pointer-events-none" style={{ left, top }}>
  <div
    className="p-3 border border-outline/20"
    style={{
      backgroundColor: 'rgba(36, 36, 36, 0.6)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      width: 260,                              // slightly wider than agent 240 for signature
    }}
  >
    {/* command_name headline, signature_summary mono, "Handler: …", "Callers: N" */}
  </div>
</div>
```

**Clamp math** (`AgentTooltip.tsx:41-52` — copy verbatim, adjust `tooltipW/H`):
```typescript
const tooltipW = 260;
const tooltipH = 140;
let left = mouseX + 12;
let top = mouseY + 12;
if (left + tooltipW > containerW) left = mouseX - tooltipW - 12;
if (top + tooltipH > containerH) top = mouseY - tooltipH - 12;
if (left < 0) left = 4;
if (top < 0) top = 4;
```

**Typography per UI-SPEC §Typography** (new tooltip rows use only existing tokens):
- Command name: `font-mono text-xs font-bold text-on-surface truncate` (matches `AgentTooltip:70-72`)
- Signature: `font-mono text-[10px] text-on-surface-variant mb-1` (matches `AgentTooltip:77-79`)
- Handler/Callers rows: same 10px mono style
- Channel pill (only if `hasChannelArg`): 10px uppercase in `text-secondary` (#00cffc theme-constant per UI-SPEC Color).

---

### `src/views/Radar/BridgeDetailPanel.tsx` (component — selected-bridge side panel)

**Analog:** `src/views/Radar/AgentManifestRow.tsx` (117 lines) for the row-click / pan-to idiom; `src/views/Radar/AlertDetail.tsx` (referenced but brief) for the "only render when relevant" pattern inside `RadarManifest`.

**Click-row → pan-to-file** (`AgentManifestRow.tsx:45-80` — copy exactly for "click caller-row → pan to that file"):
```typescript
const handleClick = () => {
  // ... find matching graphNode by path (lines 52-69) ...
  const viewportCenterX = 400;
  const viewportCenterY = 300;
  setViewport({
    panX: viewportCenterX - node.x * 3,
    panY: viewportCenterY - node.y * 3,
    zoom: 3,
  });
};
```

**Panel layout** — inherit `RadarManifest.tsx:49-75` wrapper div structure; add a `BRIDGE_DETAIL` subsection heading in the same `font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant` style used at `RadarManifest.tsx:52-54`.

**Conditional render** — render only when `selectedBridgeId !== null` (UI-SPEC §Layout — "consistent with AlertDetail behavior"). Inside `RadarManifest.tsx`, append after `<AlertDetail />` at line 73:
```tsx
<AlertDetail />
<BridgeDetailPanel />        {/* renders null when selectedBridgeId is null */}
```

---

### `src/views/Radar/ForceConfigPanel.tsx` (component — add BOUNDARY slider)

**Analog:** **self**. Mirror the existing CENTER slider block at **`ForceConfigPanel.tsx:120-138`** — one-to-one copy with `boundaryStrength` in place of `centerStrength`:

```tsx
<label className="block">
  <span className="flex justify-between text-on-surface-variant">
    BOUNDARY
    <span className="font-mono text-on-surface">
      {forceConfig.boundaryStrength.toFixed(2)}
    </span>
  </span>
  <input
    type="range"
    min={0}
    max={0.5}
    step={0.01}
    value={forceConfig.boundaryStrength}
    onChange={(e) =>
      setForceConfig({ boundaryStrength: parseFloat(e.target.value) })
    }
    className="w-full mt-1 accent-primary"
  />
</label>
```

Insert immediately after the CENTER block (line 138) and before `RESET DEFAULTS` (line 140).

---

### `src/stores/radarStore.ts` (store — extend)

**Analog:** **self**. Five coordinated edits.

**1. Widen `GraphNode`** (`radarStore.ts:36-44`):
```typescript
export interface GraphNode {
  id: string;
  dirKey: string;
  dirDepth: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  // NEW Phase 12 (D-10):
  kind?: 'file' | 'bridge';          // undefined → treat as 'file' for BC
  language?: 'ts' | 'rust';          // for forceBoundary (D-16)
  // Bridge-only fields (undefined on file nodes):
  commandName?: string;
  handlerFile?: string;
  handlerLine?: number;
  signatureSummary?: string;
  hasChannelArg?: boolean;
  callerFiles?: Array<{ file: string; line: number; shape: 'literal' | 'typed' }>;
  callerCount?: number;
}
```

**2. Widen `ForceConfig` + `DEFAULT_FORCE_CONFIG`** (`radarStore.ts:66-78`):
```typescript
export interface ForceConfig {
  centerStrength: number;
  clusterStrength: number;
  linkStrength: number;
  chargeStrength: number;
  boundaryStrength: number;            // NEW (D-29/D-30)
}
export const DEFAULT_FORCE_CONFIG: ForceConfig = {
  centerStrength: 0.05,
  clusterStrength: 0.08,
  linkStrength: 0.3,
  chargeStrength: -80,
  boundaryStrength: 0.15,              // NEW
};
```

**3. Add `selectedBridgeId` + action to the store interface** (mirror `selectedAgentId` at `radarStore.ts:105-143`):
```typescript
interface RadarStore {
  // ... existing fields ...
  selectedBridgeId: string | null;             // NEW (D-21); keyed by commandName
  selectBridge: (id: string | null) => void;   // NEW
  lastBridgeSetHash: number | null;            // NEW (D-14 cache; from RESEARCH §Pattern 5)
  // ...
}
```

**4. Widen `fetchGraph` to three parallel invokes** (`radarStore.ts:188-249`) — mirror the existing two-leg `Promise.all`:
```typescript
const [treeIndex, edges, bridges] = await Promise.all([
  invoke<TreeIndexEntryRaw[]>('get_tree_index'),
  invoke<DependencyEdgeDto[]>('get_dependency_graph'),
  invoke<IpcBridgeDto[]>('get_ipc_bridges'),          // NEW leg
]);
// Merge bridges into graphNodes as kind='bridge'; fan invoke/handles edges
// into graphEdges; run alphabetic x-spread hash check (RESEARCH §Pattern 5).
```

**5. `selectBridge` action** (mirror `selectAgent` at `radarStore.ts:357`):
```typescript
selectBridge: (id) => set({ selectedBridgeId: id }),
```

**Backward-compat read** (D-30) — everywhere the old shape is read (e.g. test snapshots), use `forceConfig.boundaryStrength ?? DEFAULT_FORCE_CONFIG.boundaryStrength`.

---

### `src/workers/graphSimConfig.ts` (config — add constants)

**Analog:** **self**. Append after the `FORCE_CONFIG_ALPHA` line (`graphSimConfig.ts:25`):
```typescript
// Phase 12 (D-29, D-14) — boundary force tuning.
export const BOUNDARY_STRENGTH_DEFAULT = 0.15;
export const BOUNDARY_DEADBAND = 5;         // world-space; ±5 around y=0 is a no-op
export const GRAPH_HALF_WIDTH = 1600;       // world-space; bridge x-spread extent
```

---

### `src/workers/graphSimProtocol.ts` (config — widen shape)

**Analog:** **self** — edit `ForceConfig` at `graphSimProtocol.ts:15-20` and `InitMessage.nodes[]` at `graphSimProtocol.ts:25-31`:

```typescript
// Widen — exactly one new field, matches radarStore.ts.
export interface ForceConfig {
  centerStrength: number;
  clusterStrength: number;
  linkStrength: number;
  chargeStrength: number;
  boundaryStrength: number;        // NEW Phase 12
}

export interface InitMessage {
  type: 'init';
  sequence: number;
  nodes: {
    id: string;
    dirKey: string;
    dirDepth: number;
    fx?: number | null;
    fy?: number | null;
    kind?: 'file' | 'bridge';       // NEW (RESEARCH Pitfall 2)
    language?: 'ts' | 'rust';       // NEW (D-16)
  }[];
  edges: { source: string; target: string; kind: string }[];
  config: ForceConfig;
  alpha: number;
  fastSettle: boolean;
}
```

**Non-obvious protocol call-out (Pitfall 2/5 from RESEARCH):** `updateConfig` does NOT re-send nodes. `kind` + `language` travel ONLY through `init` / `topology`. The worker-side `buildSim` in `graphSimCore.ts:241-252` must be updated to propagate them onto the `simNodes` objects.

---

### `src/workers/graphSimCore.ts` (service — register `forceBoundary`)

**Analog:** **self** — mirror the `.force('cluster', forceCluster()…)` registration at `graphSimCore.ts:278` and the corresponding `updateConfig` strength-setter at `graphSimCore.ts:339-341`.

**Registration** (insert after line 279's `forceClusterCollide`):
```typescript
import { forceBoundary, type BoundaryNode } from './forces/forceBoundary';

// ...

// Inside buildSim(), alongside existing force.* calls:
.force('cluster', forceCluster().strength(cfg.clusterStrength))
.force('clusterCollide', forceClusterCollide())
.force('boundary', forceBoundary().strength(cfg.boundaryStrength))   // NEW
```

**Propagate `kind` + `language` onto simNodes** (`graphSimCore.ts:241-252`) — extend the map:
```typescript
simNodes = nodes.map((n, i) => ({
  id: n.id,
  dirKey: n.dirKey,
  dirDepth: n.dirDepth,
  kind: n.kind ?? 'file',               // NEW
  language: n.language,                 // NEW (undefined for non-ts/rust files)
  x: (rng() - 0.5) * 200,
  y: (rng() - 0.5) * 200,
  fx: n.fx ?? undefined,
  fy: n.fy ?? undefined,
  index: i,
} as SimNode));
```

**`SimNode` interface widens accordingly** (`graphSimCore.ts:59-61`):
```typescript
export interface SimNode extends ClusterNode, BoundaryNode { id: string; }
```
(both `ClusterNode` and `BoundaryNode` extend `SimulationNodeDatum` — structural intersection.)

**`updateConfig` strength update** (insert after `cluster` strength update at line 341):
```typescript
(sim.force('boundary') as ReturnType<typeof forceBoundary>).strength(cfg.boundaryStrength);
```

---

### `src/views/Radar/RadarCanvas.tsx` (component — z-order + hit-test)

**Analog:** **self**. Render-loop insertions at **`RadarCanvas.tsx:670-710`** (after the Phase 7 draw pass, before the Plan 05 z-order section).

**New draw calls — matching UI-SPEC §Render z-order** (insertions italicized in UI-SPEC lines 369-389):
```typescript
// ── Step 3 insert: boundary line BEFORE hulls ──
drawBoundaryLine(ctx, vp, w, h, s.theme);

// Existing step 4 (hulls), step 5 (edges — now styles invokes/handles),
// step 6 (nodes), step 6b (file labels) unchanged.

// ── Step 12/13 insert: bridges + bridge labels AFTER file labels ──
drawBridgeNodes(ctx, bridges, s.selectedBridgeId, s.hoveredBridgeId, vp.zoom, vp, w, h, s.theme);
drawBridgeLabels(ctx, bridges, vp.zoom, vp, w, h, s.theme);

// Existing steps 14-21 (selection halo, trails, agent dots, conflict pulses).

// ── Step 22-24 insert: screen-space pass for FRONTEND/BACKEND anchor labels ──
ctx.save();
ctx.setTransform(1, 0, 0, 1, 0, 0);
drawBoundaryAnchorLabels(ctx, vp, canvas!.width, canvas!.height, s.theme);
ctx.restore();
```

**Hit-test branching** (RESEARCH §Pattern 7 — bridge IDs prefixed `bridge:`):
```typescript
// Inside handleMouseMove, after the existing quadtree.find:
const hit = qt.find(world.x, world.y, BRIDGE_HIT_RADIUS / zoom);
if (hit) {
  if (hit.id.startsWith('bridge:')) {
    setHoveredBridgeId(hit.id.slice('bridge:'.length));
  } else {
    setHoveredNodeId(hit.id);
  }
}
```

**Risk / non-obvious call-out:** the canvas transform at line 600-607 bakes `dpr` into world-space. The screen-space pass must compensate — see RESEARCH §Pattern 8 for DPR-correct label offsets (`boundaryScreenY = viewport.panY * dpr`).

---

## Shared Patterns

### A. tauri-specta DTO registration (cross-cutting)

**Source:** `src-tauri/src/lib.rs:42-130`
**Apply to:** every new Rust type that crosses the IPC boundary (`IpcBridgeDto`, `IpcCallSite`, `CallShape`) AND the new command (`get_ipc_bridges`).

**Non-obvious setup call-out:** a command registered in `collect_commands![…]` but whose return-type DTOs are NOT all `.typ::<…>()`-registered will emit `any` in `src/bindings.ts` — the build succeeds, but the frontend loses type safety. Register all three types.

### B. Repo-relative forward-slash path normalization (cross-cutting)

**Source:** `src-tauri/src/pipeline/commands.rs:356-368`
**Apply to:** every DTO field that exposes a path to the frontend (`IpcBridgeDto.handler_file`, `IpcCallSite.file`).

```rust
let repo_rel = absolute_path
    .strip_prefix(&repo_root)
    .ok()?
    .to_string_lossy()
    .replace('\\', "/");
```

Commit `a1b15b6` locks this idiom. Paths not normalized this way will mismatch `graphNodes[n].id` keys on Windows.

### C. Canvas 2D test shim (cross-cutting, frontend tests)

**Source:** `src/views/Radar/__tests__/RadarCanvas.test.tsx:52-114` + `src/views/Radar/__tests__/GraphRenderer.test.ts:35-87`
**Apply to:** all 4 new frontend tests (`BridgeRender.test.ts`, `BoundaryLine.test.ts`, `BridgeSelection.test.tsx`, `BridgeTooltip.test.tsx`).

**Pattern:** replace `HTMLCanvasElement.prototype.getContext` with a factory that returns a context object where every draw method is a `vi.fn()` and every style property (`fillStyle`, `strokeStyle`, `lineWidth`, `font`, `textAlign`, `textBaseline`) is an `Object.defineProperty` getter/setter that appends to an `_assignments[prop]` array. Tests assert on `ctx._calls.filter(c => c.fn === 'arc')` and `ctx._assignments.strokeStyle.includes('#00cffc')`.

**Non-obvious jsdom setup:** `Path2D` polyfill is required at the top of test files (`RadarCanvas.test.tsx:7-10`):
```typescript
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as any).Path2D = class Path2D { constructor(_d?: string) {} };
}
```

### D. Worker protocol test pattern (mocked Worker constructor)

**Source:** `src/hooks/__tests__/useGraphLayout.test.ts:50-131`
**Apply to:** V-12-20 worker `updateConfig` round-trip test (extend this existing file rather than adding a new one).

**Pattern:** `vi.stubGlobal('Worker', MockWorker)` where `MockWorker` wraps `makeGraphSimCore` with a queue-based scheduler (no async awaits needed). `postMessage` drains the queue synchronously. Use `workers[0].postedMessages.filter(m => m.type === 'updateConfig')` to assert that the boundary-strength change actually round-tripped.

### E. Zustand selector-mocking for component tests

**Source:** `src/views/Radar/__tests__/RadarCanvas.test.tsx:183-240` + `src/views/Radar/__tests__/RadarMinimap.test.tsx:72-100`
**Apply to:** `BridgeSelection.test.tsx`, `BridgeTooltip.test.tsx`.

**Pattern:** declare a `mockRadarState` object with every field the component reads; `vi.mock('../../../stores/radarStore', () => { ... })` returns a function that acts as both a selector (`(sel) => sel(mockRadarState)`) and has `getState`/`setState` attached. Tests mutate `mockRadarState.selectedBridgeId = 'launchAgent'` then render + assert.

### F. tracing logging conventions

**Source:** `src-tauri/src/pipeline/deps/mod.rs:107-111, 136-139` + `src-tauri/src/pipeline/commands.rs:345-350`
**Apply to:** `ipc_bridges/*` scanners (duplicate handler warn, dangling-bridge warn, variable-callee debug).

```rust
tracing::warn!(
    name = %hit.snake_name,
    first_file = %existing.file.display(),
    "ipc_bridges: duplicate #[tauri::command] handler; keeping first"
);
tracing::info!(command = %cmd_name, "ipc_bridges: command has no frontend callers (dangling)");
tracing::debug!(path = %file.display(), line, "ipc_bridges: skipping variable-callee invoke()");
```

Field-value logging (`name = %…`) is the tracing idiom this codebase uses everywhere — preserve it.

---

## No Analog Found

All 29 files have a mapped analog — **the phase is entirely additive within the established stack**, matching the RESEARCH §Don't Hand-Roll insight: "Phase 12 is almost entirely a 'connector' phase."

The one intentional departure is `src/workers/forces/forceBoundary.ts` living in a new subdirectory (`workers/forces/`) rather than next to `forceCluster.ts` in `views/Radar/`. This is the RESEARCH-resolved answer to CONTEXT §Claude's Discretion and materializes Phase 11 D-30's deferred cleanup — it is not a pattern-void, the **analog is `forceCluster.ts` verbatim**.

---

## Risk / Non-Obvious Setup Summary

| Risk | Mitigation Pointer |
|------|---------------------|
| `EdgeKind` union exhaustive-switch break on regen | Only one consumer (`drawEdges`) — audit with `grep "edge\.kind" src/views/Radar` before regen |
| `kind` / `language` not propagating to worker | Pitfall 2 trace path: `radarStore → useGraphLayout.payload → InitMessage.nodes → graphSimCore.buildSim.simNodes`. One edit per stop. See `useGraphLayout.ts:304-325` for the payload map. |
| Bindings.ts parser mis-pairs async method with TAURI_INVOKE | `invoke_re.find_at(bytes_offset_after_header)`, not `zip(find_iter, find_iter)` — Pitfall 3 |
| Tree-sitter `row` 0-indexed vs CONTEXT D-06 1-indexed | `node.start_position().row + 1` at the point of DTO emission — Pitfall 4 |
| Bridge ID collision with file paths in quadtree | Always prefix `bridge:${commandName}` — Pitfall 6 |
| `forceBoundary` strength 0 still pays per-tick cost | Early-return `if (k === 0) return;` at top of force body — Pitfall 7 |
| Channel-arg detection missed at non-first arg | Search `channel_arg_re` inside the already-captured args_text, not per line — Pitfall 10 |
| Viewport-cull hides bridges at low zoom | Do NOT apply `isInViewport` cull inside `drawBridgeNodes` (bridges are the "skeleton" at all zoom) — Pitfall 9 |
| Screen-space anchor labels off by DPR factor | `boundaryScreenY = viewport.panY * dpr`; `leftX = 12 * dpr` — RESEARCH §Pattern 8 |
| Tauri-specta types registered but command unregistered (or vice versa) | Both edits MUST land in the same `lib.rs` commit; bindings regen is the verification gate (V-12-14) |
| `bindings.ts` regex cold-cache per call | `std::sync::OnceLock` (no new deps) — Pitfall 8 |
| `updateConfig` worker message does not re-send nodes | Correct by construction (D-37). Don't try to ship `kind`/`language` through `updateConfig` — Pitfall 5 |

---

## Metadata

**Analog search scope:** `src-tauri/src/pipeline/{deps,commands.rs}`, `src-tauri/src/lib.rs`, `src/views/Radar/**`, `src/workers/**`, `src/stores/{radarStore.ts,__tests__/radarStore.test.ts}`, `src/hooks/{useGraphLayout.ts,__tests__/useGraphLayout.test.ts}`, `src/bindings.ts`.
**Files scanned:** 29 new/modified mapped to 17 distinct analog files.
**Pattern extraction date:** 2026-04-21.
**Canonical line spans worth citing in plans:**
- `src-tauri/src/pipeline/deps/mod.rs:33-54` — DTO shape + `#[serde(rename_all = "camelCase")]` stack
- `src-tauri/src/pipeline/deps/mod.rs:95-127` — rayon per-file scan + dedupe pattern
- `src-tauri/src/pipeline/deps/extract.rs:32-35, 125-177` — thread-local Parser/Query cache + wall-clock parse budget
- `src-tauri/src/pipeline/deps/queries/typescript.rs:13-23` — S-expression query file convention
- `src-tauri/src/pipeline/commands.rs:314-376` — Tauri command + `spawn_blocking` + repo-relative normalization
- `src-tauri/src/lib.rs:42-130` — `collect_commands!` + `.typ::<…>()` registration block
- `src/views/Radar/forceCluster.ts:16-27, 155-196` — d3-force custom-force contract
- `src/views/Radar/GraphRenderer.ts:229-272, 332-418, 459-482` — pure Canvas draw-fn idiom
- `src/views/Radar/AgentTooltip.tsx:41-88` — glassmorphism overlay chrome + clamp math
- `src/views/Radar/RadarManifest.tsx:35-77` — panel layout with conditional subsections
- `src/views/Radar/AgentManifestRow.tsx:45-80` — click-row → pan-to-file idiom
- `src/views/Radar/ForceConfigPanel.tsx:120-138` — single slider template
- `src/stores/radarStore.ts:36-78, 188-249, 357` — `GraphNode`, `ForceConfig`, `fetchGraph`, `selectAgent`
- `src/workers/graphSimCore.ts:241-282, 328-349` — simNodes build + updateConfig force re-strength
- `src/workers/graphSimProtocol.ts:15-53` — protocol `ForceConfig` + `InitMessage.nodes` widening points
- `src/hooks/useGraphLayout.ts:283-339` — topology payload assembly (where `kind` + `language` must be passed through)
- `src/hooks/__tests__/useGraphLayout.test.ts:50-131` — MockWorker test pattern
- `src/views/Radar/__tests__/forceCluster.test.ts:20-28, 43-81` — seeded-RNG + convergence test shape
- `src/views/Radar/__tests__/RadarCanvas.test.tsx:52-114, 183-240` — Canvas shim + Zustand selector mock
