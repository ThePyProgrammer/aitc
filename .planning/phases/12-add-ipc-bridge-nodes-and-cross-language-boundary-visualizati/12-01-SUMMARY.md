---
phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
plan: 01
subsystem: infra
tags: [tauri, tauri-specta, ipc, tree-sitter, d3-force, vitest, cargo-test, scaffold]

# Dependency graph
requires:
  - phase: 07-replace-current-blocked-codebase-map-with-a-graph-based-code
    provides: Dependency extraction module shape (deps/mod.rs DTO + fixture pattern) mirrored by ipc_bridges
  - phase: 11-move-d3-force-simulation-to-a-webworker-with-transferable-fl
    provides: Worker protocol + graphSimConfig constants file + forceCluster custom-force analog
  - phase: 19-polish-phase-10-chat-transcript-rendering-four-related-gaps-
    provides: `.todo` test-scaffold idiom with V-XX-XX anchor comments + noUnusedLocals guard pattern
provides:
  - Rust `pipeline::ipc_bridges` module (mod.rs + 3 scanner submodules) registered and compiling
  - 3 DTO types (IpcBridgeDto, IpcCallSite, CallShape) with serde + specta derives
  - 4 test fixture files (sample_bindings.ts, sample_handler.rs, sample_caller_literal.ts, sample_caller_typed.tsx)
  - 13 `#[test]` panic stubs anchored to V-12-01..V-12-13 for Wave 1 to flip
  - `src/workers/forces/forceBoundary.ts` BoundaryForce contract skeleton + 3 constants
  - 3 new Phase 12 constants on `src/workers/graphSimConfig.ts` (BOUNDARY_STRENGTH_DEFAULT, BOUNDARY_DEADBAND, GRAPH_HALF_WIDTH)
  - 5 new frontend `.todo` test files + 2 appended describe blocks on existing tests, totaling 44 anchored `.todo` entries
affects:
  - Plan 12-02 (Wave 1 — Rust parsers + get_ipc_bridges command)
  - Plan 12-03 (Wave 2 — frontend store + worker wiring)
  - Plan 12-04 (Wave 3 — canvas renderer + interaction)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave 0 scaffold: `.todo` placeholders + `V-XX-XX` comment anchors + `void marker;` noUnusedLocals guards (Phase 19 Plan 01 precedent, now extended to cross-language Rust + TS skeletons)"
    - "Rust RED-stage stubs: `#[test] fn name_v_xx_yy() { panic!(\"pending: V-XX-YY\"); }` visible in `cargo test` output until Wave 1 flips assertions"
    - "Co-located fixtures under `src-tauri/src/pipeline/<module>/test_fixtures/` (mirror of deps/test_fixtures/ pattern)"

key-files:
  created:
    - src-tauri/src/pipeline/ipc_bridges/mod.rs
    - src-tauri/src/pipeline/ipc_bridges/bindings_parser.rs
    - src-tauri/src/pipeline/ipc_bridges/rust_handler_scanner.rs
    - src-tauri/src/pipeline/ipc_bridges/frontend_callsite_scanner.rs
    - src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_bindings.ts
    - src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_handler.rs
    - src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_caller_literal.ts
    - src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_caller_typed.tsx
    - src/workers/forces/forceBoundary.ts
    - src/views/Radar/__tests__/forceBoundary.test.ts
    - src/views/Radar/__tests__/BridgeRender.test.ts
    - src/views/Radar/__tests__/BoundaryLine.test.ts
    - src/views/Radar/__tests__/BridgeSelection.test.tsx
    - src/views/Radar/__tests__/BridgeTooltip.test.tsx
    - .planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/deferred-items.md
  modified:
    - src-tauri/src/pipeline/mod.rs
    - src/workers/graphSimConfig.ts
    - src/stores/__tests__/radarStore.test.ts
    - src/hooks/__tests__/useGraphLayout.test.ts

key-decisions:
  - "Chose `src/workers/forces/forceBoundary.ts` over `src/views/Radar/forceBoundary.ts` (D-37 open question) — aligns with Phase 11 D-30 deferred relocation target; keeps custom forces colocated for Wave 2 to register alongside forceCluster in graphSimCore."
  - "Type-only imports (`type BoundaryForce, type BoundaryNode`) initially held with `type _Alias = T;` guards for noUnusedLocals tripped on TS6196 'declared but never used' for type aliases; dropped the type imports entirely from the Wave 0 forceBoundary.test.ts — Wave 2 will re-add them when mkBoundaryNode() signatures consume the types naturally."
  - "Preserved fixture contents VERBATIM from plan — including intentional TypeScript syntax that would not compile as runtime TS (the fixtures live under src-tauri/ and are loaded via include_str!, not type-checked)."
  - "HandlerHit / BindingCommand / CalleeHit structs annotated `#[allow(dead_code)]` — Wave 1 consumes them; Wave 0 needs the struct exported for the test module namespace to exist, but the crate lib build warns on unused pub fields without the allow."

patterns-established:
  - "Rust Wave-0 RED stubs: 13 named `#[test] fn <behavior>_v_12_XX()` entries with `panic!(\"pending: V-12-XX\")` bodies — `cargo test --lib pipeline::ipc_bridges | grep 'pending: V-12-'` yields exactly 13, an observable count-invariant for Wave 1 to flip."
  - "Module scaffolding smoke: every new Rust submodule ships with a single `empty_input_returns_empty_output` test that exercises the compile-path so Wave 1 cannot silently break the module registration."
  - "Cross-wave handoff via explicit TODO comments in test scaffolds: every `.todo` entry names its witness ID (e.g. `V-12-17`) so Wave 2/3 executors can grep for the anchor and replace without structural edits."

requirements-completed:
  - V-12-01  # (as Wave-0 panic-stub scaffold; real assertion lands in Plan 12-02)
  - V-12-02
  - V-12-03
  - V-12-04
  - V-12-05
  - V-12-06
  - V-12-07
  - V-12-08
  - V-12-09
  - V-12-10
  - V-12-11
  - V-12-12
  - V-12-13
  - V-12-14
  - V-12-15
  - V-12-16
  - V-12-17
  - V-12-18
  - V-12-19
  - V-12-20
  - V-12-21
  - V-12-22
  - V-12-23
  - V-12-24

# Metrics
duration: 14min
completed: 2026-04-21
---

# Phase 12 Plan 01: Wave 0 Scaffold Summary

**Compiling Rust `pipeline::ipc_bridges` skeleton (3 DTOs + 3 scanner submodules + 4 fixtures + 13 V-12-XX panic stubs) plus TypeScript `forceBoundary` BoundaryForce contract and 5 anchored `.todo` test files, ready for Waves 1–3 to flip panics into real parser/force/render assertions without any structural file creation.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-21T11:17:00Z (approx)
- **Completed:** 2026-04-21T11:31:24Z
- **Tasks:** 2 (atomic commits)
- **Files changed:** 16 (14 created, 2 modified; plus pipeline/mod.rs registration + deferred-items.md)

## Accomplishments

- **Rust module registered and compiles** — `pub mod ipc_bridges;` in `pipeline/mod.rs`; `cargo build --lib` exits 0 with no new warnings; `cargo test --lib pipeline::ipc_bridges` shows 4 compile-path smokes passing + 13 deliberate `pending: V-12-XX` panics.
- **DTO surface locked in** — `IpcBridgeDto` (7 fields), `IpcCallSite` (3 fields), `CallShape` enum (Literal | Typed). Wave 1 does not need to re-decide the wire contract.
- **Fixture corpus landed** — 4 files under `test_fixtures/` mirror the 12-CONTEXT.md D-06..D-09 invariants (one fire-and-forget, one channel-bearing, one dangling; one literal caller, one typed caller with aliased-import SKIP case).
- **forceBoundary contract established** — BoundaryForce interface + 3 tuning constants (`BOUNDARY_TARGET_Y_MAGNITUDE=300`, `BOUNDARY_DEADBAND=5`, `FORCE_BOUNDARY_BASE_STRENGTH=0.15`) + working strength getter/setter, so Wave 2's d3-force `sim.force('boundary', forceBoundary())` registration compiles today.
- **graphSimConfig constants shipped** — `BOUNDARY_STRENGTH_DEFAULT=0.15`, `BOUNDARY_DEADBAND=5`, `GRAPH_HALF_WIDTH=1600` appended after `INITIAL_POSITION_SEED`; Phase-11 tuning constants untouched.
- **Frontend `.todo` anchors exhaustive** — 44 `.todo` entries across 7 files, each with an inline `V-12-XX` comment so Wave 2/3 executors can grep-and-flip without reading the plan.
- **Zero regression on pre-existing tests** — scoped vitest run on the 7 Phase-12 files: `40 passed | 44 todo | 0 failed`. TS `npm run build` exits clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rust module skeleton + DTOs + test fixtures** — `a6e6a46` (feat)
2. **Task 2: forceBoundary skeleton + graphSimConfig constants + frontend test scaffolds** — `8038742` (test)

_Plan metadata commit (this SUMMARY.md + STATE.md + ROADMAP.md) will follow as `docs(12-01): phase 12 wave 0 summary`._

## Witness Stub Index (V-12-01..V-12-24)

### Rust `#[test] panic!` stubs — `src-tauri/src/pipeline/ipc_bridges/mod.rs`

| Witness | Test fn | Line (approx) | Wave to flip |
|---------|---------|---------------|--------------|
| V-12-01 | `parse_bindings_returns_command_set_v_12_01` | ~74 | 1 |
| V-12-02 | `preserves_camel_snake_pair_v_12_02` | ~79 | 1 |
| V-12-03 | `detects_channel_arg_v_12_03` | ~84 | 1 |
| V-12-04 | `signature_summary_bounded_v_12_04` | ~89 | 1 |
| V-12-05 | `matches_attribute_to_fn_v_12_05` | ~94 | 1 |
| V-12-06 | `supports_fn_variants_v_12_06` | ~99 | 1 |
| V-12-07 | `duplicate_warn_once_v_12_07` | ~104 | 1 |
| V-12-08 | `literal_invoke_v_12_08` | ~109 | 1 |
| V-12-09 | `typed_invoke_v_12_09` | ~114 | 1 |
| V-12-10 | `skips_variable_callee_v_12_10` | ~119 | 1 |
| V-12-11 | `merge_preserves_order_and_dedup_v_12_11` | ~124 | 1 |
| V-12-12 | `dangling_states_v_12_12` | ~129 | 1 |
| V-12-13 | `get_ipc_bridges_smoke_v_12_13` | ~134 | 1 |

Observable invariant: `cargo test --lib pipeline::ipc_bridges 2>&1 | grep 'pending: V-12-' | wc -l` = **13**.

### Frontend `.todo` stubs — 7 files

| Witness | File | `.todo` count anchored |
|---------|------|-----------------------|
| V-12-15 | `src/stores/__tests__/radarStore.test.ts` (appended describe) | 2 (V-12-15 explicit) + 1 D-10 + 1 D-21 + 2 D-14 + 1 D-30 |
| V-12-16 | `src/stores/__tests__/radarStore.test.ts` (same describe) | 2 |
| V-12-17..V-12-19 | `src/views/Radar/__tests__/forceBoundary.test.ts` | 3 explicit + 4 invariants (deadband, zero-strength early-return, language=undefined, strength round-trip) = 7 |
| V-12-20 | `src/hooks/__tests__/useGraphLayout.test.ts` (appended describe) | 2 explicit + 2 propagation guards = 4 |
| V-12-21 | `src/views/Radar/__tests__/BridgeRender.test.ts` | 6 |
| V-12-22 | `src/views/Radar/__tests__/BoundaryLine.test.ts` | 6 (3 drawBoundaryLine + 3 drawBoundaryAnchorLabels) |
| V-12-23 | `src/views/Radar/__tests__/BridgeSelection.test.tsx` | 5 |
| V-12-24 | `src/views/Radar/__tests__/BridgeTooltip.test.tsx` | 7 |

Observable invariant: scoped vitest on these 7 files reports `44 todo` entries.

## Wave 1 / 2 / 3 Handoff

**Wave 1 (Plan 12-02 — Rust parsers + command wiring):**
- Flip the 13 `panic!("pending: V-12-XX")` bodies in `src-tauri/src/pipeline/ipc_bridges/mod.rs` into real assertions that drive `parse_bindings`, `scan_rust_handlers`, `scan_callsites`, and `build_ipc_bridges` implementations via the 4 fixtures.
- Implement the 3 scanner fns (`src-tauri/src/pipeline/ipc_bridges/*.rs`) — each currently returns an empty collection; fixture tests drive the behavior.
- Add `get_ipc_bridges` Tauri command in `src-tauri/src/pipeline/commands.rs`; register in `collect_commands!` + `.typ::<IpcBridgeDto>()/IpcCallSite/CallShape` in `src-tauri/src/lib.rs`.
- Extend `EdgeKind` in `pipeline/deps/mod.rs` with `Invokes` + `Handles` variants.
- Verify `src/bindings.ts` regen emits `getIpcBridges`, `IpcBridgeDto`, `IpcCallSite`, `CallShape`, and new edge variants (V-12-14 bindings-regen gate).

**Wave 2 (Plan 12-03 — frontend store + worker):**
- Flip `.todo` → `it(...)` in `src/stores/__tests__/radarStore.test.ts` Phase-12 describe block (9 entries). Widen `GraphNode` with `kind: 'file' | 'bridge'` + bridge fields; add `selectedBridgeId` slot + `selectBridge` action; extend `fetchGraph` with third Promise.all leg; extend `ForceConfig.boundaryStrength` (D-30).
- Flip `.todo` → `it(...)` in `src/hooks/__tests__/useGraphLayout.test.ts` Phase-12 describe block (4 entries). Wire `boundaryStrength` through worker `updateConfig`; plumb `kind` + `language` onto InitMessage.nodes[]; D-37 guard on updateConfig NOT carrying kind/language.
- Flip 7 `.todo` → `it(...)` in `src/views/Radar/__tests__/forceBoundary.test.ts`. Fill the tick body in `src/workers/forces/forceBoundary.ts` — spring math with deadband + language-driven targetY + bridge short-circuit + zero-strength early-return.
- Register `forceBoundary()` in `src/workers/graphSimCore.ts` alongside `forceCluster`.

**Wave 3 (Plan 12-04 — canvas renderer + interaction):**
- Flip 6 `.todo` in `BridgeRender.test.ts` + implement `drawBridgeNodes` in `src/views/Radar/GraphRenderer.ts` (diamond geometry, channel double-stroke, dangling dash, selection ring, world-space label).
- Flip 6 `.todo` in `BoundaryLine.test.ts` + implement `drawBoundaryLine` (world-space) + `drawBoundaryAnchorLabels` (screen-space FRONTEND/BACKEND).
- Flip 5 `.todo` in `BridgeSelection.test.tsx` + wire hit-test → `selectBridge` dispatch + `BridgeDetailPanel` render under `RadarManifest`.
- Flip 7 `.todo` in `BridgeTooltip.test.tsx` + add `BridgeTooltip.tsx` (or generalize `AgentTooltip`).
- Z-order extension in `src/views/Radar/RadarCanvas.tsx` per D-31.
- Append `boundaryStrength` slider to `src/views/Radar/ForceConfigPanel.tsx`.

## Files Created/Modified

### Rust backend
- `src-tauri/src/pipeline/mod.rs` — added `pub mod ipc_bridges;` (1-line append).
- `src-tauri/src/pipeline/ipc_bridges/mod.rs` — module entry with IpcBridgeDto / IpcCallSite / CallShape + `build_ipc_bridges()` stub + 13 V-12-XX panic tests + 1 empty-root sanity test.
- `src-tauri/src/pipeline/ipc_bridges/bindings_parser.rs` — `parse_bindings()` stub + `BindingCommand` struct + empty-input test.
- `src-tauri/src/pipeline/ipc_bridges/rust_handler_scanner.rs` — `scan_rust_handlers()` stub + `HandlerHit` struct + empty-root test.
- `src-tauri/src/pipeline/ipc_bridges/frontend_callsite_scanner.rs` — `scan_callsites()` stub + `CalleeHit` struct + empty-root test.
- `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_bindings.ts` — 3-command fixture (ping, startWatch, danglingCommand).
- `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_handler.rs` — handlers for ping + start_watch + internal_helper; dangling_command absent.
- `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_caller_literal.ts` — 3 valid `invoke('literal', …)` + 1 variable-callee skip + 1 in-comment skip.
- `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_caller_typed.tsx` — 2 valid `commands.xxx()` + 1 aliased-import skip.

### Frontend
- `src/workers/forces/forceBoundary.ts` — BoundaryForce contract + constants + no-op tick.
- `src/workers/graphSimConfig.ts` — +3 constants appended after INITIAL_POSITION_SEED.
- `src/views/Radar/__tests__/forceBoundary.test.ts` — 7 `.todo` anchored to V-12-17/18/19 + structural invariants.
- `src/views/Radar/__tests__/BridgeRender.test.ts` — 6 `.todo` anchored to V-12-21.
- `src/views/Radar/__tests__/BoundaryLine.test.ts` — 6 `.todo` anchored to V-12-22.
- `src/views/Radar/__tests__/BridgeSelection.test.tsx` — 5 `.todo` anchored to V-12-23.
- `src/views/Radar/__tests__/BridgeTooltip.test.tsx` — 7 `.todo` anchored to V-12-24.
- `src/stores/__tests__/radarStore.test.ts` — appended "Phase 12 bridge integration" describe block (9 `.todo`).
- `src/hooks/__tests__/useGraphLayout.test.ts` — appended "Phase 12 boundaryStrength + kind/language propagation" describe block (4 `.todo`).

### Planning
- `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/deferred-items.md` — D-01 entry logging pre-existing HeatMap + MasterDetailShell + useGraphLayout flake failures (cross-references Phase 19 D-02/D-04).

## Decisions Made

- **Store struct + discriminator changes are DEFERRED to Plan 12-03.** Plan 12-01 is test-scaffold only; the `.todo` anchors name `D-10` / `D-21` / `D-30` so Wave 2 knows exactly which slots to widen.
- **`forceBoundary.ts` placement locked to `src/workers/forces/`** (not `src/views/Radar/`). Rationale: D-37 flagged the question; placing under `src/workers/` aligns with Phase 11 D-30 deferred cleanup target and keeps custom forces discoverable from graphSimCore.ts' import path.
- **HandlerHit / BindingCommand / CalleeHit get `#[allow(dead_code)]`** — structs must be `pub` for tests in the same crate to reference them, but Wave 0 does not consume their fields. `#[allow(dead_code)]` is the minimum-surface-area annotation (beats gating the whole module behind `#[cfg(test)]`).
- **Type-only imports dropped from `forceBoundary.test.ts`** — `type BoundaryForce, type BoundaryNode` imports fail `noUnusedLocals` (TS6196). The `void marker;` guard works for runtime values, not type aliases. Wave 2 will re-import them when `mkBoundaryNode()` / signature-bearing helpers land. Documented inline in the test file for the next executor.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced `type _BoundaryForce = BoundaryForce; type _BoundaryNode = BoundaryNode;` guards with dropped type-imports**
- **Found during:** Task 2 verification (`npm run build`)
- **Issue:** The plan's `<action>` STEP 3 imported `type BoundaryForce, type BoundaryNode` alongside the runtime exports, gated by the `void marker;` idiom. In TypeScript under `noUnusedLocals`, `void forceBoundary;` works for values but there is no equivalent `void Type;` syntax for type-only imports — they trip TS6196 ("declared but never used"). I initially tried the aliasing workaround `type _BoundaryForce = BoundaryForce;`, which also trips TS6196 on the alias itself.
- **Fix:** Removed the `type BoundaryForce, type BoundaryNode` from the `import` statement entirely. Added an inline comment in the test file explaining that Wave 2 will re-add them when `mkBoundaryNode()` signature-bearing helpers consume the types.
- **Files modified:** `src/views/Radar/__tests__/forceBoundary.test.ts` only
- **Verification:** `npm run build` exits 0 (was failing with 2 × TS6196); scoped vitest still reports the test file with 7 `.todo` entries.
- **Committed in:** `8038742` (Task 2 commit — the fix was folded in before committing)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Zero scope creep. The fix preserves the Wave 0 invariant (anchored `.todo` entries + V-12-17/18/19 comment anchors present + `forceBoundary` symbol imported for next-wave executors). The cost is a single inline comment telling Wave 2 to re-add the type imports.

## Issues Encountered

- **Pre-existing full-suite vitest failures (4 total across 3 files)** — surfaced during Task 2 verification. All four already documented in `.planning/phases/19-.../deferred-items.md` D-02 (HeatMap + MasterDetailShell × 2) and D-04 (useGraphLayout pin/unpin flake under full-suite load). Per "only fix own bugs" memory rule: logged to `12-.../deferred-items.md` D-01 with cross-reference to Phase 19 notes and NOT fixed. Zero causation link to Phase 12 scope (Phase 12 Plan 01 only creates new files + appends to test describes; does not touch HeatMap, MasterDetailShell, or the Phase-11 worker mock).
- **No other issues.**

## Known Stubs

**All 13 Rust `panic!("pending: V-12-XX")` entries + 44 TypeScript `.todo` entries are intentional stubs, tracked by the Plan 12-02 / 12-03 / 12-04 handoff above.** Every stub:
- Has a `V-12-XX` anchor comment or function name matching the VALIDATION.md witness ID.
- Has a concrete file+line reference so downstream Waves can grep-and-flip.
- Leaves the surrounding file compiling + test framework happy (Rust: panics surface as `FAILED. 4 passed; 13 failed; 0 ignored`; Vitest: `.todo` reports as skipped, suite still exits 0).

None of these are "accidental stubs" — they are the Wave 0 deliverable.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 12-02 unblocked.** Can start immediately — every interface it needs (`IpcBridgeDto`, `IpcCallSite`, `CallShape`, module registration, fixture files, panic-stub test harness) is in place and compiling.
- **Plan 12-03 unblocked** modulo bindings regen from Plan 12-02 (V-12-14) — the frontend `.todo` anchors are ready for Wave 2 to flip; `forceBoundary` skeleton compiles so `sim.force('boundary', forceBoundary())` can be wired into `graphSimCore.ts` in parallel with Plan 12-02 if desired.
- **Plan 12-04 unblocked** — the BridgeRender / BoundaryLine / BridgeSelection / BridgeTooltip test scaffolds are in place; Wave 3 implementation can start flipping them once Wave 2 widens `GraphNode` with the `kind` discriminator.

**No blockers. Wave 0 complete.**

## Self-Check: PASSED

Verified before finalizing:

1. **Files created — all 16 exist:**
   - `src-tauri/src/pipeline/ipc_bridges/mod.rs` — FOUND
   - `src-tauri/src/pipeline/ipc_bridges/bindings_parser.rs` — FOUND
   - `src-tauri/src/pipeline/ipc_bridges/rust_handler_scanner.rs` — FOUND
   - `src-tauri/src/pipeline/ipc_bridges/frontend_callsite_scanner.rs` — FOUND
   - `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_bindings.ts` — FOUND
   - `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_handler.rs` — FOUND
   - `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_caller_literal.ts` — FOUND
   - `src-tauri/src/pipeline/ipc_bridges/test_fixtures/sample_caller_typed.tsx` — FOUND
   - `src/workers/forces/forceBoundary.ts` — FOUND
   - `src/views/Radar/__tests__/forceBoundary.test.ts` — FOUND
   - `src/views/Radar/__tests__/BridgeRender.test.ts` — FOUND
   - `src/views/Radar/__tests__/BoundaryLine.test.ts` — FOUND
   - `src/views/Radar/__tests__/BridgeSelection.test.tsx` — FOUND
   - `src/views/Radar/__tests__/BridgeTooltip.test.tsx` — FOUND
2. **Commits exist:**
   - `a6e6a46` — FOUND (feat(12-01): ipc_bridges Rust module skeleton + fixtures + stubs)
   - `8038742` — FOUND (test(12-01): frontend Wave 0 test scaffolds + forceBoundary skeleton + graphSimConfig constants)
3. **Verification gates:**
   - `cargo build --lib` — exits 0
   - `cargo test --lib pipeline::ipc_bridges` — 4 passed + 13 expected `pending: V-12-XX` panics (Wave 0 contract)
   - `cargo test --lib pipeline::ipc_bridges 2>&1 | grep 'pending: V-12-' | wc -l` = **13** (expected invariant)
   - Scoped `npm run test -- --run` on the 7 plan-touched files: `40 passed | 44 todo | 0 failed`
   - `npm run build` — exits 0 (TS typecheck clean)
   - `grep -c "pub mod ipc_bridges" src-tauri/src/pipeline/mod.rs` = 1
   - `grep -c "BOUNDARY_STRENGTH_DEFAULT" src/workers/graphSimConfig.ts` = 1
   - `grep -c "GRAPH_HALF_WIDTH" src/workers/graphSimConfig.ts` = 1
   - `grep -c "BOUNDARY_DEADBAND" src/workers/graphSimConfig.ts` = 1
   - `grep -c "V-12-17" src/views/Radar/__tests__/forceBoundary.test.ts` = 2
   - `grep -c "V-12-21" src/views/Radar/__tests__/BridgeRender.test.ts` = 7
   - `grep -c "V-12-22" src/views/Radar/__tests__/BoundaryLine.test.ts` = 7
   - `grep -c "V-12-23" src/views/Radar/__tests__/BridgeSelection.test.tsx` = 6
   - `grep -c "V-12-24" src/views/Radar/__tests__/BridgeTooltip.test.tsx` = 8
   - `grep -c "V-12-15" src/stores/__tests__/radarStore.test.ts` = 3
   - `grep -c "V-12-20" src/hooks/__tests__/useGraphLayout.test.ts` = 3

All Wave 0 requirements from `12-VALIDATION.md` §Wave 0 Requirements satisfied. Nothing missing.

---
*Phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati*
*Plan: 01 (Wave 0)*
*Completed: 2026-04-21*
