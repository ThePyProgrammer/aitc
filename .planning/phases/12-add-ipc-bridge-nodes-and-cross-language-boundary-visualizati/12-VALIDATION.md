---
phase: 12
slug: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seed witnesses V-12-01..V-12-24 come from 12-RESEARCH.md §Validation Architecture. Planner fills per-task rows during Wave 0 / Wave 1 / Wave 2 / Wave 3 decomposition; witnesses are the authoritative observable invariants.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (frontend)** | vitest + jsdom (already configured — see `vitest.config.ts`) |
| **Framework (backend)** | `cargo test` (`#[cfg(test)] mod tests` colocated with modules) |
| **Config files** | `vitest.config.ts`, `src-tauri/Cargo.toml` |
| **Quick run (frontend)** | `npm run test -- --run` (non-watch; vitest single pass) |
| **Quick run (backend)** | `cargo test --manifest-path src-tauri/Cargo.toml --lib pipeline::ipc_bridges` |
| **Full suite (frontend)** | `npm run test -- --run` |
| **Full suite (backend)** | `cargo test --manifest-path src-tauri/Cargo.toml` |
| **Bindings regen sanity** | `cd src-tauri && cargo build --bin aitc && timeout --preserve-status 8 ../target/debug/aitc` (regen gate; existing pattern from Phase 18 D-03) |
| **Estimated runtime (quick)** | ~20s frontend, ~15s backend (scoped to `ipc_bridges` module) |
| **Estimated runtime (full)** | ~90s frontend, ~120s backend |

---

## Sampling Rate

- **After every task commit:** Run the relevant quick-run command (frontend OR backend depending on which layer the task touched).
- **After every plan wave:** Run the full suite for the layer the wave modified; run bindings regen if the wave touched `src-tauri/src/lib.rs` or added `.typ::<…>()` registrations.
- **Before `/gsd-verify-work`:** Full suite must be green on both sides; bindings regen must produce clean `src/bindings.ts` with `getIpcBridges`, `IpcBridgeDto`, `IpcCallSite`, `CallShape`, and new `EdgeKind` variants (`invokes`, `handles`) visible.
- **Max feedback latency:** ~20s for scoped tests; ~120s for full backend suite.

---

## Witness Catalog (V-12-01..V-12-24)

**From 12-RESEARCH.md §Validation Architecture.** Each witness is an observable invariant of Phase 12's contract. Planner-created tasks reference these IDs in their `<acceptance_criteria>` blocks.

| Witness | Layer | Plan/Wave | What it asserts | Automated Command | Nyquist Dimension |
|---------|-------|-----------|-----------------|-------------------|--------|
| V-12-01 | Rust | 1 | `parse_bindings` returns the full command set discovered in `src/bindings.ts` (count-agnostic; cardinality ≥ 40) | `cargo test pipeline::ipc_bridges::bindings_parser` | Coverage |
| V-12-02 | Rust | 1 | Every parsed command has a camelCase↔snake_name pair consistent with `collect_commands!` registrations | `cargo test pipeline::ipc_bridges::bindings_parser::preserves_camel_snake_pair` | Correctness |
| V-12-03 | Rust | 1 | `has_channel_arg: true` on bindings whose signature contains `TAURI_CHANNEL<…>` (`startWatch` test case) | `cargo test pipeline::ipc_bridges::bindings_parser::detects_channel_arg` | Correctness |
| V-12-04 | Rust | 1 | `signature_summary` is truncated to ≤ 200 chars and preserves args + return type | `cargo test pipeline::ipc_bridges::bindings_parser::signature_summary_bounded` | Safety |
| V-12-05 | Rust | 1 | Rust handler scanner pairs `#[tauri::command]` attribute to the next `fn snake_name(` declaration correctly | `cargo test pipeline::ipc_bridges::rust_handler_scanner::matches_attribute_to_fn` | Correctness |
| V-12-06 | Rust | 1 | Handler scanner handles `async fn`, `pub async fn`, `pub fn` variants | `cargo test pipeline::ipc_bridges::rust_handler_scanner::supports_fn_variants` | Coverage |
| V-12-07 | Rust | 1 | Duplicate `fn` names across files → picks path-sorted first + `tracing::warn!` once | `cargo test pipeline::ipc_bridges::rust_handler_scanner::duplicate_warn_once` | Robustness |
| V-12-08 | Rust | 1 | Tree-sitter TS query extracts `invoke('literal', …)` call-sites with correct file + 1-based line | `cargo test pipeline::ipc_bridges::frontend_callsite_scanner::literal_invoke` | Correctness |
| V-12-09 | Rust | 1 | Tree-sitter TS query extracts `commands.camelName(…)` access calls | `cargo test pipeline::ipc_bridges::frontend_callsite_scanner::typed_invoke` | Correctness |
| V-12-10 | Rust | 1 | Variable-name `invoke(someVar, …)` is skipped (and does NOT produce a false-positive bridge) | `cargo test pipeline::ipc_bridges::frontend_callsite_scanner::skips_variable_callee` | Safety |
| V-12-11 | Rust | 1 | `build_ipc_bridges` merges all three scanners into a stable `Vec<IpcBridgeDto>` with `caller_files` aggregated per command | `cargo test pipeline::ipc_bridges::mod_tests::merge_preserves_order_and_dedup` | Correctness |
| V-12-12 | Rust | 1 | Dangling detection: command with no resolvable handler → `handler_file = ""` + `tracing::warn!`; command with no callers → empty `caller_files` + `tracing::info!` once per snapshot | `cargo test pipeline::ipc_bridges::mod_tests::dangling_states` | Robustness |
| V-12-13 | Rust | 1 | `get_ipc_bridges` Tauri command wires through `pipeline::commands::get_ipc_bridges` and returns `Vec<IpcBridgeDto>` without panicking on empty repo | `cargo test pipeline::commands::tests::get_ipc_bridges_smoke` | Correctness |
| V-12-14 | Bindings regen | 1 | `src/bindings.ts` regen after Wave 1 contains `getIpcBridges`, `IpcBridgeDto`, `IpcCallSite`, `CallShape`, and new `invokes` / `handles` `EdgeKind` variants | `cd src-tauri && cargo build --bin aitc && timeout --preserve-status 8 ../target/debug/aitc && grep -c "getIpcBridges\|IpcBridgeDto" ../src/bindings.ts` | Correctness |
| V-12-15 | Frontend | 2 | `radarStore.GraphNode.kind` discriminator round-trips through `fetchGraph` — bridges have `kind: 'bridge'`, files have `kind: 'file'` (default/undefined) | `npm run test -- --run src/stores/__tests__/radarStore.test.ts` | Correctness |
| V-12-16 | Frontend | 2 | `radarStore.fetchGraph` runs three `invoke` calls in parallel via `Promise.all`; failure of any single leg leaves existing slots untouched | `npm run test -- --run src/stores/__tests__/radarStore.test.ts -t fetchGraph` | Robustness |
| V-12-17 | Frontend worker | 2 | `forceBoundary` converges TS-path nodes to negative y (`y < -50` after 30 ticks at `boundaryStrength = 0.15`) | `npm run test -- --run src/views/Radar/__tests__/forceBoundary.test.ts` | Correctness |
| V-12-18 | Frontend worker | 2 | `forceBoundary` converges Rust-path nodes to positive y (`y > 50` after 30 ticks) | `npm run test -- --run src/views/Radar/__tests__/forceBoundary.test.ts` | Correctness |
| V-12-19 | Frontend worker | 2 | Bridge-pinned `fy = 0` stays at 0 regardless of `forceBoundary` strength (d3-force `fy` clobbers `vy`) | `npm run test -- --run src/views/Radar/__tests__/forceBoundary.test.ts -t bridges_stay_pinned` | Robustness |
| V-12-20 | Frontend worker | 2 | `ForceConfig.boundaryStrength` round-trips through `updateConfig` worker message and triggers `alpha`-restart | `npm run test -- --run src/hooks/__tests__/useGraphLayout.test.ts -t boundaryStrength_updateConfig` | Correctness |
| V-12-21 | Frontend canvas | 3 | `drawBridgeNodes` renders diamond geometry with theme-keyed fill, channel-bearing double-stroke, and dangling dashed outline | `npm run test -- --run src/views/Radar/__tests__/BridgeRender.test.ts` | Correctness |
| V-12-22 | Frontend canvas | 3 | `drawBoundaryLine` renders a world-space horizontal line at y=0 + screen-space FRONTEND/BACKEND anchor labels at viewport left edge | `npm run test -- --run src/views/Radar/__tests__/BoundaryLine.test.ts` | Correctness |
| V-12-23 | Frontend interaction | 3 | Click on bridge node hit-region sets `radarStore.selectedBridgeId`; `BridgeDetailPanel` renders command, handler, caller list | `npm run test -- --run src/views/Radar/__tests__/BridgeSelection.test.tsx` | Correctness |
| V-12-24 | Frontend interaction | 3 | Hover on bridge renders `BridgeTooltip` (or reused AgentTooltip chrome) with command name + signature + handler path + caller count | `npm run test -- --run src/views/Radar/__tests__/BridgeTooltip.test.tsx` | Correctness |

---

## Per-Task Verification Map

> Filled by planner during Wave 0–3 task decomposition. Every task row maps to one or more witnesses and a Nyquist dimension.

| Task ID | Plan | Wave | Witness(es) | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-XX | 01 | 0 | V-12-01..V-12-24 (stubs) | unit | `(scaffold — test files created with `.todo` placeholders)` | ❌ W0 | ⬜ pending |
| 12-02-XX | 02 | 1 | V-12-01..V-12-14 | unit | per-witness commands above | ❌ W0 | ⬜ pending |
| 12-03-XX | 03 | 2 | V-12-15..V-12-20 | unit | per-witness commands above | ❌ W0 | ⬜ pending |
| 12-04-XX | 04 | 3 | V-12-21..V-12-24 | unit + render | per-witness commands above | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/pipeline/ipc_bridges/mod.rs` — module scaffold + `IpcBridgeDto` / `IpcCallSite` / `CallShape` types + `#[cfg(test)] mod tests` skeleton with V-12-01..V-12-13 + V-12-14 (bindings regen) as `#[test] fn` stubs that `panic!("pending: V-12-XX")` until Wave 1 fills them.
- [ ] `src-tauri/src/pipeline/ipc_bridges/bindings_parser.rs` — parser module skeleton with empty `parse_bindings()` and stub tests.
- [ ] `src-tauri/src/pipeline/ipc_bridges/rust_handler_scanner.rs` — scanner module skeleton with empty `scan_handlers()` and stub tests.
- [ ] `src-tauri/src/pipeline/ipc_bridges/frontend_callsite_scanner.rs` — scanner skeleton with empty `scan_callsites()` and stub tests.
- [ ] `src-tauri/src/pipeline/ipc_bridges/test_fixtures/` directory with 4 minimal files:
  - `sample_bindings.ts` (3 commands: 1 fire-and-forget, 1 channel-bearing, 1 dangling)
  - `sample_handler.rs` (matches commands 1 + 2; command 3 intentionally absent)
  - `sample_caller_literal.ts` (calls command 1 via `invoke('...')`)
  - `sample_caller_typed.tsx` (calls command 2 via `commands.x(...)`)
- [ ] `src/views/Radar/forceBoundary.ts` — force module skeleton + `src/views/Radar/__tests__/forceBoundary.test.ts` with `.todo` stubs for V-12-17..V-12-19.
- [ ] `src/views/Radar/__tests__/BridgeRender.test.ts` — V-12-21 `.todo` stub.
- [ ] `src/views/Radar/__tests__/BoundaryLine.test.ts` — V-12-22 `.todo` stub.
- [ ] `src/views/Radar/__tests__/BridgeSelection.test.tsx` — V-12-23 `.todo` stub.
- [ ] `src/views/Radar/__tests__/BridgeTooltip.test.tsx` — V-12-24 `.todo` stub.
- [ ] `src/stores/__tests__/radarStore.test.ts` — extend with V-12-15 / V-12-16 `.todo` stubs (file exists from Phase 7; add describe blocks).
- [ ] `src/hooks/__tests__/useGraphLayout.test.ts` — extend with V-12-20 `.todo` stub (file exists from Phase 11).
- [ ] Shared `mkBridgeNode()` / `mkBridgeDto()` factories (colocated next to Phase 11's `mkLivePositions` style helpers, or in the first test file that needs them — Wave 0 commits the factory with `void marker;` noUnusedLocals guards).

*No new test framework installs needed — vitest and `cargo test` are already configured.*

---

## Manual-Only Verifications

| Behavior | Reason | Test Instructions |
|----------|--------|-------------------|
| "52 cyan bridge diamonds strung along the boundary line" visual first-impression (UI-SPEC §Visuals focal point) | Visual perception is not captured by unit tests; requires prod-build smoke | Run `npm run build && npm run tauri build` on a 5k+ file repo; open app; confirm boundary line visible at zoom 1 with bridge diamonds clearly readable against dark background |
| `boundaryStrength` slider feels responsive on live graph | Force-convergence math is unit-tested but slider perception is qualitative | Drag `boundaryStrength` slider from 0 to 0.5; confirm FE/BE halves visibly separate within ~1 second; reverse direction; confirm no jank |
| Bridge hover tooltip readable in all 9 graph themes | Theme token plumbing is code-tested but contrast across 9 palettes is perceptual | Cycle through `ThemePicker` (9 themes); hover a bridge; confirm tooltip text is readable on each theme's background |
| Bridge detail panel scroll behavior with 10+ callers | `TanStack Virtual` not used here (caller lists are small); verify scrolling feels right | Select a bridge known to have many callers (e.g. simulated 20 in a test fixture); confirm panel scrolls smoothly without layout shift |
| FRONTEND/BACKEND anchor labels stay readable at all zoom levels | Screen-space anchoring is unit-tested for presence; readability across zoom is visual | Zoom from 0.1× to 20× while bridges visible; confirm anchor labels never clip, occlude, or flicker |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies listed
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (enforced by Wave 0 `.todo` stub scaffolding)
- [ ] Wave 0 covers all MISSING references (enumerated above)
- [ ] No watch-mode flags in automated commands (all use `--run` / `cargo test`)
- [ ] Feedback latency < 120s full suite; < 20s quick run
- [ ] Bindings regen gate present in Wave 1 commit chain
- [ ] `nyquist_compliant: true` set in frontmatter after planner fills the per-task map

**Approval:** pending
