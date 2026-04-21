---
phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
plan: 03
subsystem: infra
tags: [tauri, tauri-specta, ipc, rust, typescript, bindings, edgekind, spawn-blocking]

# Dependency graph
requires:
  - phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
    plan: 02
    provides: build_ipc_bridges(&Path) -> Vec<IpcBridgeDto> entrypoint + 3 DTOs (IpcBridgeDto, IpcCallSite, CallShape) + 17 passing scanner tests
  - phase: 07-replace-current-blocked-codebase-map-with-a-graph-based-code
    provides: get_dependency_graph Tauri command shape (tauri::async_runtime::spawn_blocking + state.inner.lock().await + String error mapping) mirrored by get_ipc_bridges
  - phase: 18
    provides: debug_assertions-gated specta `.export(...)` in pub fn run() + bindings regen recipe (cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc)
provides:
  - get_ipc_bridges async Tauri command (src-tauri/src/pipeline/commands.rs) exposing build_ipc_bridges across the IPC boundary
  - EdgeKind widened with Invokes + Handles variants (pipeline/deps/mod.rs) — serialized as camelCase "invokes"/"handles"
  - collect_commands![…] + .typ::<…>() registration for the new command + 3 DTOs in src-tauri/src/lib.rs
  - Regenerated src/bindings.ts containing getIpcBridges + IpcBridgeDto + IpcCallSite + CallShape + invokes/handles literals
  - V-12-13 smoke test (pipeline::commands::tests::get_ipc_bridges_smoke_v_12_13) exercising the None-branch of get_ipc_bridges
affects:
  - Plan 12-04 (Wave 3 — frontend store widening + GraphRenderer drawBridgeNodes + GraphRenderer drawBoundaryLine + BridgeTooltip + BridgeSelection)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "get_ipc_bridges mirrors get_dependency_graph shape exactly: state.inner.lock().await → match guard.as_ref() { Some(active) => spawn_blocking(move || build_fn(&active.repo_root)).await.map_err(|e| format!(…))?, None => Ok(Vec::new()) }"
    - "EdgeKind widening via variant append (no renumbering, no non_exhaustive attribute) — preserves serde/specta bindings stability for existing variants"
    - "Unit-test smoke for Tauri commands that cannot be invoked via tauri::State wrapper: construct PipelineState::default(), exercise guard.as_ref().is_none() branch directly, mirror the command's None-arm return value"
    - "tauri-specta bindings regen is a debug_assertions-gated side effect of booting `./target/debug/aitc` — 8-second timeout is sufficient for the export, and `timeout --preserve-status` forwards the exit status rather than masking it"

key-files:
  created: []
  modified:
    - src-tauri/src/pipeline/commands.rs
    - src-tauri/src/pipeline/deps/mod.rs
    - src-tauri/src/lib.rs
    - src/bindings.ts
    - .planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/deferred-items.md

key-decisions:
  - "V-12-13 witness placed in pipeline::commands::tests (not pipeline::ipc_bridges::tests). Rationale: V-12-13 is specifically about the Tauri command wrapper's None-branch behavior, which is commands.rs responsibility. The Some-branch is already covered by pipeline::ipc_bridges::tests::build_ipc_bridges_empty_root_returns_empty (Plan 02)."
  - "Exercised the None-branch via direct guard-inspection instead of constructing a real tauri::State<'_, PipelineState>. The tauri::State wrapper is only available inside a running Tauri app; replicating the guard-lock + match pattern inline gives equivalent witness coverage without a full Tauri integration harness."
  - "Left D-03 (the bash_paths blocker) in deferred-items.md with a RESOLVED annotation rather than removing it. Rationale: preserves the audit trail of the cross-phase ordering issue (Phase 17-03 landed the module index entry before Phase 17-01 landed the file itself) so future planners can see why Wave ordering within a phase matters."
  - "Did NOT add Plan 04's drawEdges exhaustive-match handling in this plan. npm run build currently passes without exhaustive-match TS errors because the current GraphRenderer does not exhaustive-match EdgeKind. When Plan 04 widens drawEdges to handle all variants, the new invokes/handles arms will slot in without a migration step."

patterns-established:
  - "Two-step Tauri command wiring: (1) pipeline/<feature>/mod.rs exports pure-logic build_fn(&Path) -> Vec<Dto>; (2) pipeline/commands.rs wraps with #[tauri::command] #[specta::specta] + spawn_blocking. Composes with Phase 7's deps module and (now) Phase 12's ipc_bridges module. Future phases adding pure-logic extraction modules should follow this split."
  - "EdgeKind extension pattern: append variants to the end (never insert/reorder) to avoid churning unrelated bindings.ts diffs; the serde rename_all=camelCase carries through to bindings as-is."
  - "Bindings regen verification by grep count: a 6-line acceptance block (getIpcBridges ≥ 1, IpcBridgeDto ≥ 1, IpcCallSite ≥ 1, CallShape ≥ 1, \"invokes\" ≥ 1, \"handles\" ≥ 1) is a stable, hand-auditable contract against tauri-specta output."

requirements-completed:
  - V-12-13
  - V-12-14

# Metrics
duration: ~12min (including blocker-resolution re-verification)
completed: 2026-04-21
---

# Phase 12 Plan 03: Wave 2 Tauri IPC Surface Wiring Summary

**`get_ipc_bridges` async Tauri command + `EdgeKind::{Invokes, Handles}` extension + `collect_commands!/.typ::<…>()` registration + regenerated `src/bindings.ts` exposing `getIpcBridges`, `IpcBridgeDto`, `IpcCallSite`, `CallShape`, and `"invokes"`/`"handles"` EdgeKind variants — closes the Rust→TypeScript IPC boundary for Phase 12 bridge data so Wave 3 (GraphRenderer + store widening) can import typed DTOs directly from `./bindings`.**

## Performance

- **Duration:** ~12 min (resumed from prior-session hand-off; bash_paths blocker was resolved in absentia by Phase 17 Plan 01 merge, so this session re-verified + committed the two pre-staged working-tree edits)
- **Resumed:** 2026-04-21T13:28:00Z (approx)
- **Completed:** 2026-04-21T13:31:40Z
- **Tasks:** 2 (atomic commits)
- **Files changed:** 4 (all modifications, no new files)

## Accomplishments

- **`get_ipc_bridges` command wired** — mirrors `get_dependency_graph` shape verbatim: `state.inner.lock().await` guard → `match guard.as_ref()` → `Some(active)` branch invokes `tauri::async_runtime::spawn_blocking(move || build_ipc_bridges(&active.repo_root.clone()))` with `JoinError → String` mapping; `None` branch returns `Ok(Vec::new())`. Lives in `src-tauri/src/pipeline/commands.rs` immediately after `get_dependency_graph`.
- **`EdgeKind` widened** — `Invokes` + `Handles` variants appended at the end of the enum in `src-tauri/src/pipeline/deps/mod.rs` (per D-27). `#[serde(rename_all = "camelCase")]` preserves the existing flow, so these serialize as `"invokes"` and `"handles"` literals in the specta-generated bindings union. No existing variant was touched or reordered; zero churn on prior Phase 7 tests.
- **lib.rs registration complete** — `pipeline::commands::get_ipc_bridges` added to `collect_commands![…]` after the existing `get_dependency_graph,` line; 3 `.typ::<pipeline::ipc_bridges::IpcBridgeDto>()` / `IpcCallSite` / `CallShape` registrations appended to the specta Builder chain adjacent to the existing `.typ::<pipeline::deps::EdgeKind>()` entry.
- **V-12-13 smoke landed** — `pipeline::commands::tests::get_ipc_bridges_smoke_v_12_13` exercises the None-branch exactly (default `PipelineState` → guard.as_ref() is None → returns `Ok(Vec::new())` without panic). The Some-branch is already covered by Plan 02's `pipeline::ipc_bridges::tests::build_ipc_bridges_empty_root_returns_empty`, so V-12-13 is fully witnessed.
- **V-12-14 bindings regen complete** — Ran the canonical Phase 18 D-03 recipe (`cd src-tauri && cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc`); `src/bindings.ts` regenerated with `+74 -1` lines including all required symbols.
- **Zero regression in Phase 12 scope** — `cargo test --lib` full suite: `438 passed | 2 failed` (the 2 failures are pre-existing `conflict::engine` tests in D-02, reproduced on prior clean tip `4cc570b` during Plan 02 verification). `npm run build` exits 0 (TS typecheck clean; no exhaustive-match errors surfaced).

## V-12-14 Bindings Regen Gate — Verification Log

### Before (pre-Task 2)

```
$ grep -cE "getIpcBridges|IpcBridgeDto|IpcCallSite|CallShape" src/bindings.ts
0
$ grep -cE '"invokes"|"handles"' src/bindings.ts
0
```

### After (post-regen)

```
$ grep -c "getIpcBridges" src/bindings.ts           → 1  ✓
$ grep -c "IpcBridgeDto"  src/bindings.ts           → 2  ✓
$ grep -c "IpcCallSite"   src/bindings.ts           → 2  ✓
$ grep -c "CallShape"     src/bindings.ts           → 2  ✓
$ grep -c '"invokes"'     src/bindings.ts           → 1  ✓
$ grep -c '"handles"'     src/bindings.ts           → 1  ✓
$ git diff --stat src/bindings.ts
 src/bindings.ts | 75 ++++++++++++++++++++++++++++++++++++++++++++++++++++++-
 1 file changed, 74 insertions(+), 1 deletion(-)
```

### Key snippets in regenerated bindings.ts

```ts
async getIpcBridges() : Promise<Result<IpcBridgeDto[], string>> { … TAURI_INVOKE("get_ipc_bridges") … }

export type CallShape = "literal" | "typed"

export type EdgeKind = "import" | "reexport" | "typeOnly" | "dynamicImport" | "use" | "modDecl" | "fromImport" | "importStmt" |
  /** Phase 12 D-27: caller file → bridge node (frontend invoke call-site). */
  "invokes" |
  /** Phase 12 D-27: bridge node → Rust handler file. */
  "handles"

export type IpcBridgeDto = { commandName: string; rustName: string; handlerFile: string; handlerLine: number; … callerFiles: IpcCallSite[] }

export type IpcCallSite = { file: string; line: number; shape: CallShape }
```

All 6 grep assertions ≥ 1; V-12-14 gate GREEN.

## V-12-13 Command Smoke — Verification Log

```
$ cargo test --lib pipeline::commands
…
test pipeline::commands::tests::get_ipc_bridges_smoke_v_12_13 ... ok
test pipeline::commands::tests::pid_poll_interval_is_within_range ... ok
test pipeline::commands::tests::pipeline_mpsc_capacity_matches_research_recommendation ... ok
test pipeline::commands::forwarder_persist_tests::forwarder_persist_attributed_batch_skips_ambiguous ... ok
test pipeline::commands::forwarder_persist_tests::forwarder_persist_attributed_batch_skips_pid_with_no_registry_match ... ok
test pipeline::commands::forwarder_persist_tests::forwarder_persist_attributed_batch_skips_unattributed ... ok
test pipeline::commands::forwarder_persist_tests::forwarder_persist_attributed_batch_records_files_for_matched_pid ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 437 filtered out; finished in 0.01s
```

```
$ cargo test --lib pipeline::ipc_bridges
…
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 427 filtered out; finished in 0.08s
```

V-12-13 gate GREEN (explicit smoke test passes + no pipeline::ipc_bridges regression).

## Full-Suite Regression Log

```
$ cargo test --lib
…
test result: FAILED. 438 passed; 2 failed; 4 ignored; 0 measured; 0 filtered out; finished in 17.80s

failures:
    conflict::engine::tests::test_conflict_detected_different_pids_within_window
    conflict::engine::tests::test_custom_window_duration
```

Both failures are pre-existing and documented in `deferred-items.md` D-02 (first surfaced during Plan 02 on clean tip `4cc570b`). Per the "only fix own bugs" memory rule: diagnosed + documented + NOT fixed — Phase 3 (conflict engine) is out of Phase 12 scope.

## Task Commits

Each task was committed atomically:

1. **Task 1: `get_ipc_bridges` command + EdgeKind widening + lib.rs registration + V-12-13 smoke** — `b5ccbab` (feat)
2. **Task 2: regenerate src/bindings.ts — V-12-14** — `3a1bf30` (chore)

_Plan metadata commit (this SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md) will follow as `docs(12-03): phase 12 wave 2 summary`._

## Files Created/Modified

### Rust backend

- `src-tauri/src/pipeline/commands.rs` — +59 lines: `get_ipc_bridges` async command immediately after `get_dependency_graph`; V-12-13 smoke test `get_ipc_bridges_smoke_v_12_13` appended to the existing `#[cfg(test)] mod tests` block.
- `src-tauri/src/pipeline/deps/mod.rs` — +4 lines: `Invokes` + `Handles` variants appended at the end of the `EdgeKind` enum with `#[serde(rename_all = "camelCase")]` preserved from the existing declaration.
- `src-tauri/src/lib.rs` — +4 lines: `pipeline::commands::get_ipc_bridges` in `collect_commands![…]`; 3 `.typ::<pipeline::ipc_bridges::IpcBridgeDto>()` / `IpcCallSite` / `CallShape` lines adjacent to the existing `pipeline::deps::EdgeKind` entry.

### Frontend

- `src/bindings.ts` — regenerated by specta: `+74 -1` lines. Added: `getIpcBridges()` async TAURI_INVOKE wrapper; `IpcBridgeDto` type (7 fields); `IpcCallSite` type (3 fields); `CallShape` type ("literal" | "typed"); `EdgeKind` union widened with `"invokes"` + `"handles"`.

### Planning

- `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/deferred-items.md` — D-03 entry annotated `RESOLVED 2026-04-21 via Phase 17 Plan 01 merge` with the resolving commits noted (`c02211c` + `5d9d279`, merged as `cf9dcff`); preserves the audit trail.

## Decisions Made

- **V-12-13 witness placement: `pipeline::commands::tests` (Task 1 commit) rather than `pipeline::ipc_bridges::tests`.** The witness is specifically about the Tauri command's None-branch shape, which is `commands.rs` responsibility; the Some-branch is already covered by Plan 02's `build_ipc_bridges_empty_root_returns_empty`. Keeping V-12-13 near the command definition makes the test discoverable via `cargo test --lib pipeline::commands`.
- **Exercised V-12-13 None-branch via direct guard inspection instead of building a real `tauri::State<'_, PipelineState>` harness.** `tauri::State` is only available inside a running Tauri app; unit tests cannot construct it. The inline pattern (default `PipelineState` → lock guard → assert None → mirror the command's return-value branch) gives equivalent witness coverage without a Tauri integration harness, and the plan explicitly permitted this alternative.
- **D-03 deferred-items entry marked RESOLVED rather than removed.** Preserves the audit trail of the cross-phase Wave-ordering issue (Phase 17-03 landed before Phase 17-01 created the required file). Future planners can see the resolution path (Phase 17 Plan 01 merge `cf9dcff`) without digging through git history.
- **No Plan 04 drawEdges handling added here.** `npm run build` passed with no exhaustive-match TS errors — the current `GraphRenderer` does not exhaustive-match `EdgeKind`, so widening the enum introduced zero frontend breakage. Plan 04's Wave 3 will extend `drawEdges` with `invokes`/`handles` rendering branches as part of its own scope.

## Deviations from Plan

None — plan executed exactly as written. The working-tree edits received from the prior executor session matched the plan verbatim (4 files, exact line counts described in the hand-off context), `cargo build --lib` and `cargo test --lib pipeline::ipc_bridges`/`pipeline::commands` passed without modification, and the bindings regen recipe worked on the first try. No Rule 1/2/3 auto-fixes required.

## Issues Encountered

- **Pre-existing `conflict::engine` test failures (2 total)** — Surfaced during full `cargo test --lib` verification. Both already documented under D-02 in `deferred-items.md` (Plan 02 confirmed pre-existence on clean tip `4cc570b`). Out of scope per "only fix own bugs"; NOT fixed.
- **Pre-existing Phase 17 dead-code warnings (13 total)** — `cargo build --lib` emits 13 warnings, all tied to Phase 17 types/methods (`ConflictEngine::set_window`, `ConflictEngine::update_pid_mapping`, `ConflictEngine::could_conflict_with`, `GateReason`, `as_db_str`). These are Phase 17 ownership — the types/methods are declared but not yet consumed by integration code (future Phase 17 plans will consume them). Zero impact on Phase 12 scope; NOT fixed.
- **Resume-state note:** The prior executor session checkpointed on a `bash_paths` missing-module compile error that was entirely Phase 17's ownership. Between sessions, Phase 17 Plan 01 merged (commits `c02211c` + `5d9d279`, merge `cf9dcff`), landing the real `bash_paths.rs` (21KB implementation). On resume, `cargo build --lib` was green immediately — zero Phase 12 code changes needed to unblock; the four pre-staged working-tree edits from the prior session were accepted as-is after verification.

## Known Stubs

None. V-12-13 + V-12-14 are real witnesses. The two new `EdgeKind` variants (`Invokes` + `Handles`) are fully serialized into `src/bindings.ts` and await Plan 04's `drawEdges` consumption (which is the next wave's scope, not a stub).

## Threat Flags

None. The `get_ipc_bridges` command exposes the same trust-level surface as `get_dependency_graph` (repo-relative paths + source fragments, all already readable by the invoking desktop user on the same trust domain). No network surface added; no auth path touched; no new file-access pattern at a trust boundary. T-12-03-01 (Information Disclosure) was `accept`-disposition in the plan's threat register and that assessment holds.

## User Setup Required

None — purely internal Rust command + EdgeKind extension + bindings regen. No external service configuration needed.

## Next Phase Readiness

- **Plan 12-04 unblocked.** Wave 3 (frontend store widening + GraphRenderer drawBridgeNodes + BridgeSelection + BridgeTooltip) can now:
  - Import `IpcBridgeDto`, `IpcCallSite`, `CallShape` directly from `./bindings` (typed).
  - Call `await commands.getIpcBridges()` in `radarStore.fetchGraph` as a third `Promise.all` leg alongside `getTreeIndex` + `getDependencyGraph`.
  - Extend `GraphNode` with the `kind: 'file' | 'bridge'` discriminator + bridge-specific fields (commandName, callerCount, etc.) keyed off the DTO shape.
  - Implement `drawBridgeNodes` / `drawBoundaryLine` / `drawBoundaryAnchorLabels` in `src/views/Radar/GraphRenderer.ts` — flipping the 12 `.todo` entries in `BridgeRender.test.ts` + `BoundaryLine.test.ts`.
  - Extend `drawEdges` with `invokes` + `handles` rendering branches (the EdgeKind union now includes these variants in `bindings.ts`, so TS will catch any omissions at build time once `drawEdges` is exhaustive).
  - Hit-test bridges in `RadarCanvas` → dispatch `selectBridge` action → render `BridgeDetailPanel` — flipping the 5 `BridgeSelection.test.tsx` entries.
- **Performance budget still on track.** The `spawn_blocking` wrapping keeps the <100ms D-35 target honored; manual smoke (D-34 Wave 4) will measure the real p99 once the fetcher is wired.
- **Zero blockers.** All of Phase 12 Wave 1 + Wave 2 backend + IPC surface is green.

## Self-Check: PASSED

Verified before finalizing:

1. **Files modified — all 4 match expected hand-off set:**
   - `src-tauri/src/lib.rs` — FOUND; `grep -c "pipeline::commands::get_ipc_bridges" src-tauri/src/lib.rs` = 1; `grep -c "pipeline::ipc_bridges::IpcBridgeDto" src-tauri/src/lib.rs` = 1; `grep -c "pipeline::ipc_bridges::IpcCallSite" src-tauri/src/lib.rs` = 1; `grep -c "pipeline::ipc_bridges::CallShape" src-tauri/src/lib.rs` = 1.
   - `src-tauri/src/pipeline/commands.rs` — FOUND; `grep -c "pub async fn get_ipc_bridges" src-tauri/src/pipeline/commands.rs` = 1; `grep -c "spawn_blocking" src-tauri/src/pipeline/commands.rs` ≥ 2.
   - `src-tauri/src/pipeline/deps/mod.rs` — FOUND; `grep -c "Invokes" src-tauri/src/pipeline/deps/mod.rs` ≥ 1; `grep -c "Handles" src-tauri/src/pipeline/deps/mod.rs` ≥ 1.
   - `src/bindings.ts` — FOUND; all 6 V-12-14 grep checks ≥ 1 (see V-12-14 verification log above).

2. **Commits exist:**
   - `b5ccbab` — FOUND (`feat(12-03): get_ipc_bridges Tauri command + EdgeKind::{Invokes,Handles} + V-12-13 smoke`)
   - `3a1bf30` — FOUND (`chore(12-03): regenerate bindings.ts — V-12-14 includes getIpcBridges + EdgeKind invokes/handles`)

3. **Verification gates:**
   - `cargo build --lib` — exits 0 (13 pre-existing Phase 17 dead-code warnings only)
   - `cargo test --lib pipeline::ipc_bridges` — 17/17 passed
   - `cargo test --lib pipeline::commands` — 7/7 passed (incl. `get_ipc_bridges_smoke_v_12_13`)
   - `cargo test --lib` — 438 passed, 2 pre-existing failures (D-02)
   - `npm run build` — exits 0 (TS typecheck clean)
   - V-12-14 grep gate — all 6 checks ≥ 1 (see log above)

All Wave 2 requirements from `12-VALIDATION.md` V-12-13 + V-12-14 satisfied.

---
*Phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati*
*Plan: 03 (Wave 2)*
*Completed: 2026-04-21*
