---
phase: 07
plan: 01
subsystem: radar-graph
tags: [foundation, dependencies, scaffold, wave-0]
dependency_graph:
  requires: []
  provides:
    - tree-sitter + 4 grammars + rayon installed
    - d3-force + d3-quadtree + d3-polygon + @types installed
    - pipeline::deps module skeleton with stubs
    - get_dependency_graph Tauri command (stub)
    - radarStore graph state slots
    - 7 Wave 0 test scaffold files
  affects:
    - src-tauri/Cargo.toml
    - package.json
    - src-tauri/src/pipeline/mod.rs
    - src-tauri/src/lib.rs
    - src/bindings.ts
    - src/stores/radarStore.ts
tech_stack:
  added:
    - tree-sitter=0.26.8
    - tree-sitter-typescript=0.23.2
    - tree-sitter-javascript=0.25.0
    - tree-sitter-rust=0.24.2
    - tree-sitter-python=0.25.0
    - rayon=1.12.0
    - d3-force ^3.0.0
    - d3-quadtree ^3.0.1
    - d3-polygon ^3.0.1
    - "@types/d3-force ^3.0.10"
    - "@types/d3-quadtree ^3.0.6"
    - "@types/d3-polygon ^3.0.2"
  patterns:
    - EXACT version pinning (=) for tree-sitter + grammars (T-07-D mitigation)
    - spawn_blocking for CPU-heavy parse on Tauri command boundary (D-24)
    - Repo-relative forward-slash path DTOs (matches tree_index commit a1b15b6)
    - describe.skip scaffold pattern for Wave 0 test landing zones
key_files:
  created:
    - src-tauri/src/pipeline/deps/mod.rs
    - src-tauri/src/pipeline/deps/extract.rs
    - src-tauri/src/pipeline/deps/resolve.rs
    - src-tauri/src/pipeline/deps/queries/mod.rs
    - src-tauri/src/pipeline/deps/queries/typescript.rs
    - src-tauri/src/pipeline/deps/queries/javascript.rs
    - src-tauri/src/pipeline/deps/queries/rust.rs
    - src-tauri/src/pipeline/deps/queries/python.rs
    - src-tauri/src/pipeline/deps/test_fixtures/sample.ts
    - src-tauri/src/pipeline/deps/test_fixtures/sample.tsx
    - src-tauri/src/pipeline/deps/test_fixtures/sample.js
    - src-tauri/src/pipeline/deps/test_fixtures/sample.jsx
    - src-tauri/src/pipeline/deps/test_fixtures/sample.rs
    - src-tauri/src/pipeline/deps/test_fixtures/sample.py
    - src/views/Radar/__tests__/RadarCanvas.test.tsx
    - src/views/Radar/__tests__/CometTrail.test.ts
    - src/views/Radar/__tests__/HeatMapOverlay.test.ts
    - src/views/Radar/__tests__/RadarMinimap.test.tsx
    - src/views/Radar/__tests__/forceCluster.test.ts
    - src/views/Radar/__tests__/GraphRenderer.test.ts
    - src/hooks/__tests__/useGraphLayout.test.ts
  modified:
    - src-tauri/Cargo.toml
    - src-tauri/Cargo.lock
    - src-tauri/src/pipeline/mod.rs
    - src-tauri/src/lib.rs
    - src-tauri/src/pipeline/commands.rs
    - package.json
    - package-lock.json
    - src/stores/radarStore.ts
    - src/bindings.ts
decisions:
  - "Exact version pinning for tree-sitter + grammars (D-06, T-07-D mitigation) — prevents ABI drift surfacing as runtime IncompatibleLanguageVersion"
  - "spawn_blocking around build_dependency_graph at command boundary — keeps async runtime responsive during <2s D-24 target even before Plan 02 lands the real parser"
  - "Added graphNodes/graphEdges/settledAt/pinnedNodeIds/activeTrails to radarStore without removing treeData — Plan 03 removes treeData after useGraphLayout replacement lands"
  - "describe.skip in all 7 Wave 0 test files so downstream plan authors have explicit named landing zones without red tests blocking the suite"
metrics:
  duration: 9min
  tasks: 3
  files: 28
  completed: "2026-04-15T04:22:00Z"
---

# Phase 7 Plan 1: Graph Foundation + Wave 0 Scaffold Summary

Foundation plan for the graph-based codebase map: installed all new Rust (tree-sitter, 4 grammars, rayon) and JS (d3-force, d3-quadtree, d3-polygon + @types) dependencies; scaffolded the `pipeline::deps` module with type definitions, S-expression query constants, 6 per-language fixture files, and stub functions; wired the `get_dependency_graph` Tauri command end-to-end with regenerated `src/bindings.ts`; extended `radarStore` with empty graph state slots (existing fields preserved); created 7 Wave 0 test scaffolding files with `describe.skip` blocks naming the tests Plans 03-06 must implement.

## Execution

### Task 1 — Install deps + deps module skeleton (commit 41b1ef9)

- Appended Phase 7 dep section to `src-tauri/Cargo.toml`: `tree-sitter = "=0.26.8"`, `tree-sitter-typescript = "=0.23.2"`, `tree-sitter-javascript = "=0.25.0"`, `tree-sitter-rust = "=0.24.2"`, `tree-sitter-python = "=0.25.0"`, `rayon = "=1.12.0"`.
- Added to `package.json` dependencies: `d3-force ^3.0.0`, `d3-quadtree ^3.0.1`, `d3-polygon ^3.0.1`. DevDeps: `@types/d3-force ^3.0.10`, `@types/d3-quadtree ^3.0.6`, `@types/d3-polygon ^3.0.2`.
- `pub mod deps;` added to `src-tauri/src/pipeline/mod.rs` between `commands` and `events`.
- Created `pipeline::deps` module:
  - `mod.rs` — `DependencyEdgeDto` (camelCase, Type, Serde), `EdgeKind` enum (8 variants), internal `DependencyEdge` (absolute paths), `build_dependency_graph` stub returning `Vec::new()`.
  - `extract.rs` — `SourceLanguage` enum, `detect_language(path)` (handles ts/mts/cts/tsx/js/mjs/cjs/jsx/rs/py).
  - `resolve.rs` — `resolve_import` stub returning `None`.
  - `queries/{typescript,javascript,rust,python}.rs` — S-expression query constants (TYPESCRIPT_IMPORTS, JAVASCRIPT_IMPORTS, RUST_IMPORTS, PYTHON_IMPORTS).
  - `test_fixtures/sample.{ts,tsx,js,jsx,rs,py}` — 6 committed fixture files covering realistic import forms (relative, tsconfig alias, type-only, dynamic, CJS require, use/mod, from-import).
- 3 stub tests pass: `build_dependency_graph_stub_returns_empty`, `detect_language_recognises_extensions`, `resolve_stub_returns_none`.
- `cargo build` succeeds in 2m32s — all 4 grammars compile statically.
- `npm install` added 228 packages; `node_modules/d3-{force,quadtree,polygon}/package.json` all present.

### Task 2 — Wire command + radarStore extension (commit bc5b222)

- `get_dependency_graph` command added to `src-tauri/src/pipeline/commands.rs` immediately above `persist_attributed_batch`. Mirrors `get_tree_index` pattern: reads `PipelineState.inner`, filters non-dir entries from `tree_index`, calls `build_dependency_graph` inside `tauri::async_runtime::spawn_blocking` (per D-24), then strips repo_root prefix + replaces `\` with `/` to emit `DependencyEdgeDto` with repo-relative forward-slash paths (matches commit `a1b15b6`).
- `src-tauri/src/lib.rs` registrations:
  - Added `pipeline::commands::get_dependency_graph` to `collect_commands!` immediately after `get_tree_index`.
  - Added `.typ::<pipeline::deps::DependencyEdgeDto>()` and `.typ::<pipeline::deps::EdgeKind>()` between `worktree::Worktree` and `agents::AgentInfo`.
- Bindings regenerated by running `cargo run` briefly (export happens at `run()` entry, line 107-113). Confirmed: `src/bindings.ts` now exports `getDependencyGraph`, `DependencyEdgeDto`, and `EdgeKind`.
- `src/stores/radarStore.ts` extended:
  - New types `GraphNode`, `GraphEdge`, `ActiveTrail` (camelCase, matches bindings kind field).
  - Added fields to `RadarStore` interface: `graphNodes`, `graphEdges`, `settledAt`, `pinnedNodeIds`, `activeTrails`.
  - Initial state + `reset()` both populate the new slots with empty/null values.
  - `treeData` + `fetchTreeIndex` preserved unchanged (Plan 03 deprecates).
- 17 existing `radarStore.test.ts` tests still pass.

### Task 3 — Wave 0 test scaffolds (commit ce90745)

- 7 scaffold files created with `describe.skip(...)` and named `it(...)` blocks referencing Plan numbers, decision IDs, and UI-SPEC sections:
  - `src/views/Radar/__tests__/RadarCanvas.test.tsx` (Plan 04, 3 tests)
  - `src/views/Radar/__tests__/CometTrail.test.ts` (Plan 05, 4 tests)
  - `src/views/Radar/__tests__/HeatMapOverlay.test.ts` (Plan 06, 3 tests)
  - `src/views/Radar/__tests__/RadarMinimap.test.tsx` (Plan 06, 4 tests)
  - `src/views/Radar/__tests__/forceCluster.test.ts` (Plan 03, 3 tests)
  - `src/views/Radar/__tests__/GraphRenderer.test.ts` (Plan 04, 5 tests)
  - `src/hooks/__tests__/useGraphLayout.test.ts` (Plan 03, 5 tests)
- Created `src/hooks/__tests__/` directory.
- Test suite: 27 scaffold tests skipped, 8 pre-existing radar component tests still pass.

## Commits

- `41b1ef9` — feat(07-01): install tree-sitter + d3-force deps, scaffold deps module
- `bc5b222` — feat(07-01): wire get_dependency_graph command + extend radarStore graph slots
- `ce90745` — test(07-01): scaffold Wave 0 test files for Plans 03-06

## Verification

- `cd src-tauri && cargo build` — succeeds (all tree-sitter grammars compile in ~2m32s cold, 27s warm).
- `cd src-tauri && cargo test pipeline::deps::` — 3 stub tests pass.
- `npm install` — 228 packages added, no vulnerabilities.
- `npm test -- --run src/stores/__tests__/radarStore.test.ts` — 17 tests pass.
- `npm test -- --run src/views/Radar/__tests__/ src/hooks/__tests__/useGraphLayout.test.ts` — 27 scaffold tests skip, 8 existing pass.
- `grep -q "getDependencyGraph" src/bindings.ts` — match found.
- `grep -q "DependencyEdgeDto" src/bindings.ts` — match found.
- `grep -q "EdgeKind" src/bindings.ts` — match found.
- `grep -q "graphNodes" src/stores/radarStore.ts` — match found.
- All 7 Wave 0 test files exist with `describe.skip` blocks (grep -l count = 7).
- All 6 fixture files exist under `src-tauri/src/pipeline/deps/test_fixtures/`.

## Deviations from Plan

### Adjusted Command

**1. [Rule 3 — Blocking] Bindings regeneration step clarified**
- **Found during:** Task 2
- **Issue:** The plan (07-01-PLAN.md:560) states `cargo build --features=""` (debug build) triggers the specta export. In reality the export lives inside `lib.rs::run()` at line 107-113 (inside `#[cfg(debug_assertions)]`), which only executes at app runtime, not at build time.
- **Fix:** Ran the tauri binary briefly (`cd src-tauri && timeout 20 cargo run`) — the export executes synchronously at the top of `run()` before the Tauri event loop starts, so bindings regenerate even if the GUI cannot open in a headless environment.
- **Files modified:** `src/bindings.ts` (regenerated)
- **Commit:** bc5b222

## Deferred Issues

See `deferred-items.md` in the phase directory for pre-existing issues surfaced during execution:
- Pre-existing `src/bindings.ts` TS6133/TS2440 errors block `npm run build` (exists on main commit 216a65b before this plan).
- Pre-existing `agentStore.test.ts > launchAgent` test failure (1 test out of 151; exists on main before this plan).

Both are out-of-scope per the scope boundary rule (not directly caused by this plan's changes). Verified by reproducing on a clean checkout of 216a65b.

## Self-Check: PASSED

All 28 files verified to exist. All 3 commits (41b1ef9, bc5b222, ce90745) verified in git log.
