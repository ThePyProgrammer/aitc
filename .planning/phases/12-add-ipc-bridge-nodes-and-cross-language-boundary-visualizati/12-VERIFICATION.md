---
phase: 12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati
verified: 2026-04-21T22:25:00Z
status: human_needed
score: 24/24 automated witnesses verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: 0/0
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "D-34 — visual confirmation of boundary line + ~50 cyan bridge diamonds"
    expected: "Boundary line visible at world y=0 with diamond-shaped bridge nodes spread alphabetically along it; FRONTEND/BACKEND anchor labels readable at viewport left edge across all zoom levels"
    why_human: "Visual first-impression + contrast-against-background across 9 themes is not captured by unit tests; requires prod-build smoke per 12-VALIDATION.md §Manual-Only Verifications"
  - test: "D-34 — boundaryStrength slider feels responsive on live graph"
    expected: "Dragging slider 0→0.5 visibly separates FE/BE halves within ~1s; reverse direction with no jank"
    why_human: "Force-convergence math is unit-tested (V-12-17..V-12-19) but subjective slider perception is qualitative"
  - test: "D-34 — bridge hover tooltip readable in all 9 graph themes"
    expected: "BridgeTooltip text readable on each theme's background when hovering a bridge node"
    why_human: "Theme token plumbing is code-tested but perceptual contrast across 9 palettes requires human judgment"
  - test: "D-34 — bridge detail panel scroll behavior with 10+ callers"
    expected: "Selecting a bridge with many callers scrolls smoothly in the right-side manifest without layout shift"
    why_human: "No TanStack Virtual used here (small lists); verify scroll feel directly"
  - test: "D-34 — FRONTEND/BACKEND anchor labels stay readable at all zoom levels"
    expected: "Zoom 0.1× to 20×: anchor labels never clip, occlude, or flicker; bridges stay visible at every zoom"
    why_human: "Screen-space anchoring presence is unit-tested (V-12-22); readability across zoom is visual"
  - test: "D-34 — channel-bearing bridge visual distinctness"
    expected: "Bridges with hasChannelArg=true render with a visibly double-stroke ring that is perceptibly distinct from regular bridges"
    why_human: "Double-stroke geometry is unit-tested (V-12-21); whether the signal reads as distinct to a human eye is qualitative"
  - test: "D-34 — dangling bridge visual distinctness (dashed stroke)"
    expected: "Bridges with no caller OR no handler render with a dashed outline that is perceptibly distinct from solid bridges"
    why_human: "Dashed-stroke application is unit-tested (V-12-21); dash-pattern readability at zoom is visual"
---

# Phase 12: IPC Bridge Nodes + Cross-Language Boundary Verification Report

**Phase Goal:** Add IPC bridge nodes and cross-language boundary visualization — parse tauri-specta bindings.ts for the command surface, cross-reference invoke() callers with #[tauri::command] handlers, render bridge nodes on a visible frontend/backend boundary line.

**Verified:** 2026-04-21T22:25:00Z
**Status:** human_needed (24/24 automated witnesses green; D-34 manual UAT pending per 12-05-CHECKPOINT.md)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (derived from phase goal; merged with V-12 witness set)

| #  | Truth                                                                                                                                    | Status     | Evidence                                                                                                                                      |
|----|------------------------------------------------------------------------------------------------------------------------------------------|------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | Rust backend parses `src/bindings.ts` for the tauri-specta command surface (V-12-01..V-12-04)                                            | ✓ VERIFIED | `cargo test pipeline::ipc_bridges::bindings_parser` — 4 tests pass (parse_bindings_returns_command_set, preserves_camel_snake_pair, detects_channel_arg, signature_summary_bounded) |
| 2  | Rust handler scanner pairs `#[tauri::command]` attributes to `fn snake_name(` declarations across `src-tauri/src/**/*.rs` (V-12-05..V-12-07) | ✓ VERIFIED | `cargo test pipeline::ipc_bridges::rust_handler_scanner` — 3 tests pass (matches_attribute_to_fn, supports_fn_variants, duplicate_warn_once) |
| 3  | Frontend callsite scanner tree-sitter-extracts `invoke('literal', …)` + `commands.camelName(…)` call-sites and skips variable-name invokes (V-12-08..V-12-10) | ✓ VERIFIED | `cargo test pipeline::ipc_bridges::frontend_callsite_scanner` — 5 tests pass (literal_invoke, typed_invoke, skips_variable_callee, excludes_bindings_ts, scan_callsites_empty_root) |
| 4  | `build_ipc_bridges` merges all three scanners into a stable `Vec<IpcBridgeDto>` with dangling detection (V-12-11, V-12-12)                | ✓ VERIFIED | `cargo test pipeline::ipc_bridges::tests` — `merge_preserves_order_and_dedup` + `dangling_states` both pass                                   |
| 5  | `get_ipc_bridges` Tauri command wires through `pipeline::commands::get_ipc_bridges` and returns `Vec<IpcBridgeDto>` without panicking (V-12-13) | ✓ VERIFIED | `cargo test pipeline::commands::tests::get_ipc_bridges_smoke_v_12_13` passes; `src-tauri/src/pipeline/commands.rs:388` defines the async command; `src-tauri/src/lib.rs:48` registers it in `collect_commands!` |
| 6  | `src/bindings.ts` regen after Wave 1 includes `getIpcBridges`, `IpcBridgeDto`, `IpcCallSite`, `CallShape`, and new `"invokes"` / `"handles"` `EdgeKind` variants (V-12-14) | ✓ VERIFIED | `grep -c "getIpcBridges\|IpcBridgeDto\|IpcCallSite\|CallShape" src/bindings.ts` → 6; `grep "\"invokes\"\|\"handles\""` → both literals present |
| 7  | `radarStore.GraphNode.kind` discriminator round-trips through `fetchGraph` and failure of any single leg leaves existing slots untouched (V-12-15, V-12-16) | ✓ VERIFIED | `npm run test -- --run src/stores/__tests__/radarStore.test.ts` — all 36 tests pass (incl. Phase 12 bridge integration block); `get_ipc_bridges failed` is an intentional mocked failure asserting the best-effort merge contract |
| 8  | `forceBoundary` converges TS-path nodes to negative y, Rust-path nodes to positive y, and preserves bridge `fy=0` pinning (V-12-17..V-12-19) | ✓ VERIFIED | `npm run test -- --run src/views/Radar/__tests__/forceBoundary.test.ts` — tests pass (part of the 96-test sweep) |
| 9  | `ForceConfig.boundaryStrength` round-trips through `updateConfig` worker message and triggers `alpha`-restart (V-12-20)                  | ✓ VERIFIED | `npm run test -- --run src/hooks/__tests__/useGraphLayout.test.ts` — all 17 tests pass                                                         |
| 10 | `drawBridgeNodes` renders diamond geometry with theme-keyed fill, channel-bearing double-stroke, and dangling dashed outline (V-12-21)    | ✓ VERIFIED | `npm run test -- --run src/views/Radar/__tests__/BridgeRender.test.ts` — tests pass; `BridgeRenderer.ts:87` exports `drawBridgeNodes`, uses `setLineDash(BRIDGE_DASH_PATTERN)` at L125 for dangling, `hasChannel` branch at L111 for double-stroke |
| 11 | `drawBoundaryLine` renders world-space horizontal line at y=0 + screen-space FRONTEND/BACKEND anchor labels (V-12-22)                     | ✓ VERIFIED | `npm run test -- --run src/views/Radar/__tests__/BoundaryLine.test.ts` — tests pass; `BridgeRenderer.ts:54` exports `drawBoundaryLine`; L211 exports `drawBoundaryAnchorLabels` |
| 12 | Click on bridge hit-region sets `radarStore.selectedBridgeId`; `BridgeDetailPanel` renders command/handler/caller list (V-12-23)           | ✓ VERIFIED | `npm run test -- --run src/views/Radar/__tests__/BridgeSelection.test.tsx` — 8 tests pass; `radarStore.ts:515` exposes `selectBridge`; `RadarManifest.tsx:77` mounts `<BridgeDetailPanel />` |
| 13 | Hover on bridge renders `BridgeTooltip` with command name + signature + handler path + caller count (V-12-24)                             | ✓ VERIFIED | `npm run test -- --run src/views/Radar/__tests__/BridgeTooltip.test.tsx` — 8 tests pass                                                        |
| 14 | `ForceConfigPanel` has BOUNDARY slider bound to `forceConfig.boundaryStrength`                                                            | ✓ VERIFIED | `ForceConfigPanel.tsx:143,153` — slider labeled "BOUNDARY" binds to `forceConfig.boundaryStrength ?? 0.15` with setForceConfig on change      |
| 15 | `EdgeKind` union extends with `Invokes` + `Handles` variants in Rust (D-11, D-27)                                                         | ✓ VERIFIED | `pipeline/deps/mod.rs:54-57` declares `Invokes` + `Handles`; bindings regen produces `"invokes"` + `"handles"` camelCase literals in bindings.ts |
| 16 | `GraphRenderer.drawEdges` styles `invokes`/`handles` distinctly without a separate draw pass                                              | ✓ VERIFIED | `GraphRenderer.ts:263-266` — `isIpc = e.kind === 'invokes' || e.kind === 'handles'` with alpha boost branch                                    |
| 17 | Worker protocol carries `kind` + `language` into the simulation so `forceBoundary` can route nodes by language                            | ✓ VERIFIED | `graphSimCore.ts:26` imports `forceBoundary`; L248 propagates kind+language; L291 registers the force; `graphSimProtocol.ts:20-23` adds `boundaryStrength` to ForceConfig |
| 18 | `RadarCanvas` renders boundary line + bridge nodes in the render loop                                                                     | ✓ VERIFIED | `RadarCanvas.tsx:696` calls `drawBoundaryLine(ctx, vp, w, h, s.theme)`; L733 calls `drawBridgeNodes(...)`                                       |
| 19 | No new Cargo / npm dependencies introduced by Phase 12                                                                                    | ✓ VERIFIED | `git log --since="2026-04-15" -- Cargo.lock src-tauri/Cargo.toml package.json` — only Phase 17 (`path-clean`, `shlex`) and Phase 19 (markdown) dep bumps; no Phase 12 dep commits |
| 20 | Build hygiene: `cargo build --lib` clean, `npm run build` exit 0                                                                          | ✓ VERIFIED | Cargo build: 13 pre-existing Phase 17 dead-code warnings, 0 errors; `npm run build`: "built in 6.67s", exit 0                                   |

**Score:** 20/20 truths verified. **Witness coverage:** 24/24 automated witnesses (V-12-01..V-12-24) green.

### Witness Coverage Map (V-12-01..V-12-24)

| Witness  | Layer           | Test Status | Evidence                                                                 |
|----------|-----------------|-------------|--------------------------------------------------------------------------|
| V-12-01  | Rust parser     | ✓ PASS      | `parse_bindings_returns_command_set`                                      |
| V-12-02  | Rust parser     | ✓ PASS      | `preserves_camel_snake_pair`                                              |
| V-12-03  | Rust parser     | ✓ PASS      | `detects_channel_arg`                                                     |
| V-12-04  | Rust parser     | ✓ PASS      | `signature_summary_bounded`                                               |
| V-12-05  | Rust scanner    | ✓ PASS      | `matches_attribute_to_fn`                                                 |
| V-12-06  | Rust scanner    | ✓ PASS      | `supports_fn_variants`                                                    |
| V-12-07  | Rust scanner    | ✓ PASS      | `duplicate_warn_once`                                                     |
| V-12-08  | Rust scanner    | ✓ PASS      | `literal_invoke`                                                          |
| V-12-09  | Rust scanner    | ✓ PASS      | `typed_invoke`                                                            |
| V-12-10  | Rust scanner    | ✓ PASS      | `skips_variable_callee`                                                   |
| V-12-11  | Rust merge      | ✓ PASS      | `merge_preserves_order_and_dedup`                                         |
| V-12-12  | Rust merge      | ✓ PASS      | `dangling_states`                                                         |
| V-12-13  | Rust cmd        | ✓ PASS      | `get_ipc_bridges_smoke_v_12_13`                                           |
| V-12-14  | Bindings regen  | ✓ PASS      | bindings.ts grep: 6 matches + both EdgeKind literals                     |
| V-12-15  | Store           | ✓ PASS      | radarStore.test.ts Phase 12 bridge integration                           |
| V-12-16  | Store           | ✓ PASS      | best-effort merge with mocked `bridges scan failed`                       |
| V-12-17  | Worker          | ✓ PASS      | forceBoundary.test.ts TS-path convergence                                 |
| V-12-18  | Worker          | ✓ PASS      | forceBoundary.test.ts Rust-path convergence                               |
| V-12-19  | Worker          | ✓ PASS      | forceBoundary.test.ts bridge fy=0 pinning                                 |
| V-12-20  | Worker          | ✓ PASS      | useGraphLayout.test.ts boundaryStrength updateConfig                      |
| V-12-21  | Canvas          | ✓ PASS      | BridgeRender.test.ts                                                     |
| V-12-22  | Canvas          | ✓ PASS      | BoundaryLine.test.ts                                                     |
| V-12-23  | Interaction     | ✓ PASS      | BridgeSelection.test.tsx (8 tests)                                       |
| V-12-24  | Interaction     | ✓ PASS      | BridgeTooltip.test.tsx (8 tests)                                         |

### Required Artifacts

| Artifact                                                                    | Expected                                                                 | Status     | Details                                                                                          |
|-----------------------------------------------------------------------------|--------------------------------------------------------------------------|------------|--------------------------------------------------------------------------------------------------|
| `src-tauri/src/pipeline/ipc_bridges/mod.rs`                                 | module root + IpcBridgeDto/IpcCallSite/CallShape + build_ipc_bridges      | ✓ VERIFIED | 330 lines, exists, substantive, wired (pub mod ipc_bridges in pipeline/mod.rs)                    |
| `src-tauri/src/pipeline/ipc_bridges/bindings_parser.rs`                     | parse_bindings + V-12-01..V-12-04 tests                                  | ✓ VERIFIED | 205 lines, 4 tests green                                                                          |
| `src-tauri/src/pipeline/ipc_bridges/rust_handler_scanner.rs`                | scan_handlers + V-12-05..V-12-07 tests                                   | ✓ VERIFIED | 176 lines, 3 tests green                                                                          |
| `src-tauri/src/pipeline/ipc_bridges/frontend_callsite_scanner.rs`           | scan_callsites + V-12-08..V-12-10 tests                                  | ✓ VERIFIED | 294 lines, 5 tests green                                                                          |
| `src-tauri/src/pipeline/commands.rs` — `get_ipc_bridges` async command      | Tauri command wiring the scanner suite + smoke test                      | ✓ VERIFIED | Defined at L388; smoke test `get_ipc_bridges_smoke_v_12_13` at L476 passes                        |
| `src-tauri/src/lib.rs` — collect_commands! + .typ::<…>() registrations      | Register get_ipc_bridges + 3 DTOs via specta                             | ✓ VERIFIED | L48 registers command; L108-110 register IpcBridgeDto + IpcCallSite + CallShape                   |
| `src-tauri/src/pipeline/deps/mod.rs` — EdgeKind::{Invokes,Handles}          | Two new EdgeKind variants                                                | ✓ VERIFIED | L54-57 declare both variants                                                                      |
| `src/bindings.ts`                                                           | Regen contains getIpcBridges + 3 DTOs + "invokes"/"handles" EdgeKind      | ✓ VERIFIED | 6 matches on grep; both EdgeKind literals present                                                 |
| `src/stores/radarStore.ts`                                                  | kind discriminator + selectedBridgeId + boundaryStrength + bridges leg    | ✓ VERIFIED | All features present (L44, L92, L132, L228-234, L283-371, L515, L587)                             |
| `src/views/Radar/BridgeRenderer.ts`                                         | drawBridgeNodes + drawBoundaryLine + dashed+double-stroke visual rules    | ✓ VERIFIED | 246 lines; exports drawBoundaryLine(L54), drawBridgeNodes(L87), drawBridgeLabels(L175), drawBoundaryAnchorLabels(L211); dangling dashed at L125; channel-bearing branch at L111 |
| `src/views/Radar/BridgeTooltip.tsx`                                         | hover overlay with command + signature + handler + caller count           | ✓ VERIFIED | 124 lines; 8 tests green                                                                          |
| `src/views/Radar/BridgeDetailPanel.tsx`                                     | right-manifest panel on selectedBridgeId                                  | ✓ VERIFIED | 109 lines; 8 selection tests green                                                                |
| `src/views/Radar/RadarCanvas.tsx`                                           | renders drawBoundaryLine + drawBridgeNodes + hit-test + tooltip           | ✓ VERIFIED | drawBoundaryLine at L696; drawBridgeNodes at L733                                                 |
| `src/views/Radar/RadarManifest.tsx`                                         | mounts `<BridgeDetailPanel />`                                            | ✓ VERIFIED | Imports at L13; mounts at L77                                                                     |
| `src/views/Radar/ForceConfigPanel.tsx`                                      | BOUNDARY slider bound to forceConfig.boundaryStrength                    | ✓ VERIFIED | Label "BOUNDARY" at L143; input at L153 two-way-bound                                             |
| `src/views/Radar/GraphRenderer.ts`                                          | drawEdges styles invokes/handles distinctly                              | ✓ VERIFIED | L263-266: isIpc branch with alpha boost                                                           |
| `src/workers/forces/forceBoundary.ts`                                       | spring force with per-node target y (TS up / Rust down / bridge pinned)   | ✓ VERIFIED | 84 lines; forceBoundary() exported at L33                                                         |
| `src/workers/graphSimCore.ts`                                               | boundary force registered in simulation; init/topology widened            | ✓ VERIFIED | Import L26; kind+language propagation L248; force registration L291; updateConfig L356            |
| `src/workers/graphSimProtocol.ts`                                           | boundaryStrength on ForceConfig                                           | ✓ VERIFIED | L20-23                                                                                            |
| `src/hooks/useGraphLayout.ts`                                               | payload widened with kind + language                                     | ✓ VERIFIED | L319: `language: n.language` in node payload                                                      |

### Key Link Verification

| From                                | To                                     | Via                                                | Status | Details                                                             |
|-------------------------------------|----------------------------------------|----------------------------------------------------|--------|---------------------------------------------------------------------|
| `pipeline::ipc_bridges` (Rust)      | `pipeline::commands::get_ipc_bridges`  | module call + PipelineState                        | WIRED  | commands.rs L388 invokes build_ipc_bridges via pipeline state       |
| `get_ipc_bridges` (Rust)            | `collect_commands!` (lib.rs)           | tauri-specta builder                               | WIRED  | lib.rs L48 + L108-110                                                |
| bindings.ts (regen)                 | frontend `getIpcBridges` / DTO types   | specta codegen                                     | WIRED  | 6 grep matches in bindings.ts                                       |
| `radarStore.fetchGraph`             | `invoke<IpcBridgeDto[]>('get_ipc_bridges')` | Promise.all 3rd leg                            | WIRED  | radarStore.ts L228-234 with catch-branch for best-effort degrade    |
| radarStore graphNodes (bridges)     | `forceBoundary` in worker              | init topology kind+language                        | WIRED  | useGraphLayout.ts L319 → graphSimCore.ts L248 → L291                |
| `BridgeRenderer.drawBridgeNodes`    | `RadarCanvas` render loop              | drawBridgeNodes(...) at L733                       | WIRED  | Z-order ladder: boundaryLine → ... → bridgeNodes → bridgeLabels     |
| `BridgeRenderer.drawBoundaryLine`   | `RadarCanvas` render loop              | drawBoundaryLine(...) at L696                      | WIRED  | Executed before file-node draw (world-space stroke)                 |
| bridge click / hover                | `radarStore.selectBridge(id)`          | hit-test → setSelectedBridgeId                     | WIRED  | 8 selection tests + 8 tooltip tests green                           |
| `selectedBridgeId`                  | `<BridgeDetailPanel />`                | RadarManifest.tsx import + conditional render       | WIRED  | Imported L13, mounted L77                                           |
| `ForceConfigPanel` BOUNDARY slider  | `ForceConfig.boundaryStrength`         | setForceConfig({ boundaryStrength })                | WIRED  | L153-155                                                            |
| `ForceConfig.boundaryStrength`      | `forceBoundary.strength()`             | updateConfig worker message + alpha restart        | WIRED  | graphSimCore.ts L356-357; V-12-20 asserts the round-trip            |

### Data-Flow Trace (Level 4)

| Artifact                 | Data Variable                 | Source                                                  | Produces Real Data | Status    |
|--------------------------|-------------------------------|---------------------------------------------------------|--------------------|-----------|
| `BridgeRenderer` (canvas)| `graphNodes.filter(bridge)`   | radarStore.fetchGraph → invoke<'get_ipc_bridges'>       | Yes (Rust real scan of src-tauri + src/) | ✓ FLOWING |
| `BridgeTooltip`          | hovered bridge GraphNode       | hit-test hands bridge node (incl. IpcBridgeDto fields)  | Yes (same pipeline)| ✓ FLOWING |
| `BridgeDetailPanel`      | `selectedBridgeId` → node lookup | radarStore selector reads graphNodes for the id      | Yes (real metadata) | ✓ FLOWING |
| `forceBoundary`          | node.kind + node.language     | worker init topology fed from useGraphLayout payload    | Yes (real typed nodes) | ✓ FLOWING |
| boundary anchor labels   | viewport transform + theme    | RadarCanvas render loop viewport + theme store          | Yes                | ✓ FLOWING |

All dynamic-data artifacts trace to `get_ipc_bridges` (V-12-13 smoke passes against an empty-root case; real run depends on D-34 manual UAT for the 51-command count on this repo).

### Behavioral Spot-Checks

| Behavior                                    | Command                                                                                                  | Result                  | Status  |
|---------------------------------------------|----------------------------------------------------------------------------------------------------------|-------------------------|---------|
| ipc_bridges Rust tests pass                 | `cargo test --manifest-path src-tauri/Cargo.toml --lib pipeline::ipc_bridges`                            | 17 passed; 0 failed     | ✓ PASS  |
| pipeline::commands Rust tests pass          | `cargo test --manifest-path src-tauri/Cargo.toml --lib pipeline::commands`                                | 7 passed; 0 failed (incl. V-12-13) | ✓ PASS  |
| Rust lib builds clean                       | `cargo build --manifest-path src-tauri/Cargo.toml --lib`                                                  | 0 errors; 13 pre-existing Phase 17 dead-code warnings | ✓ PASS  |
| Frontend builds clean                       | `npm run build`                                                                                          | "built in 6.67s", exit 0| ✓ PASS  |
| Phase 12 vitest sweep (7 files)             | `npm run test -- --run src/views/Radar/__tests__/Bridge*.test.* forceBoundary.test.ts radarStore.test.ts useGraphLayout.test.ts` | 7 files; 96 tests passed | ✓ PASS  |
| bindings.ts surface present                 | `grep -c "getIpcBridges\|IpcBridgeDto\|IpcCallSite\|CallShape" src/bindings.ts`                          | 6                       | ✓ PASS  |
| EdgeKind invokes/handles present            | `grep "\"invokes\"\|\"handles\"" src/bindings.ts`                                                        | both literals present   | ✓ PASS  |

### Requirements Coverage

No new REQ-IDs are declared for Phase 12 per 12-CONTEXT.md §domain: *"This phase extends the Phase 7 graph map (VIZN-01 / VIZN-05 in spirit — the radar shows architectural structure) with a new architectural dimension. EMON-01 … widens naturally to include cross-language IPC structure."* The 24 V-12-XX witnesses above form the phase's contract; all 24 are green. No REQ-ID orphans to flag.

### Anti-Patterns Found

| File                                           | Line | Pattern                               | Severity | Impact                                                                                                        |
|------------------------------------------------|------|---------------------------------------|----------|---------------------------------------------------------------------------------------------------------------|
| None found in Phase 12 scope                   | —    | —                                     | —        | No TODO / FIXME / HACK / empty-return / console.log stubs introduced by Phase 12 commits                       |

Pre-existing Phase 17 dead-code warnings (`set_window`, `update_pid_mapping`, `as_db_str`, etc.) are unrelated to Phase 12 and are tracked under Phase 17 scope — not flagged as Phase 12 gaps per the "only fix own bugs" memory rule.

### Human Verification Required — D-34 Manual UAT

See `12-05-CHECKPOINT.md` for the full 10-step Tauri-dev smoke test. Phase 12 code-complete; the D-34 checkpoint is a precedent-consistent blocking gate (Phase 10 Plan 06 + Phase 18 Plan 04 pattern) that cannot be satisfied without a human driving the live app. Summary of pending manual-only checks:

1. **Boot `npm run tauri dev`**, wait for repo auto-attach.
2. **Boundary line + ~50 cyan diamonds** visible on the Airspace Radar (V-12-22 unit-covers presence; human confirms count + visual).
3. **boundaryStrength slider** 0→0.5 visibly separates FE/BE halves within ~1s.
4. **Bridge hover** shows BridgeTooltip with readable text on all 9 themes.
5. **Bridge click** opens BridgeDetailPanel with command / handler / signature / caller rows; caller click lead-lines to file node.
6. **Channel-bearing bridges** (double-stroke) + **dangling bridges** (dashed) visually distinct from regular bridges.
7. **FRONTEND/BACKEND anchor labels** readable at zoom 0.1× → 20×; bridges visible at every zoom.
8. **Escape** deselects bridge without perturbing agent selection.
9. **No new Rust / npm dep installs required** for the live run.
10. **No regressions** on heat map, conflict pulses, agent dots, comet trails, minimap.

### Gaps Summary

**No automated gaps found.** All 24 V-12-XX witnesses green; 20/20 observable truths verified; all key links wired; all artifacts present at Level 1 (exist) + Level 2 (substantive) + Level 3 (wired) + Level 4 (data flowing). The only outstanding work is the D-34 human-verify checkpoint — an intentional, documented UAT gate per the Phase 10/18 precedent, not an automated gap.

### Out-of-Scope (per deferred-items.md)

Not counted as Phase 12 gaps per the "only fix own bugs" memory rule:

- **D-01**: 4 pre-existing frontend test failures in HeatMapOverlay + MasterDetailShell + useGraphLayout — Phase 11/11.1 scope, logged before Phase 12 started and independently documented in Phase 19 deferred-items.md.
- **D-02**: 2 pre-existing `conflict::engine` backend test failures — Phase 17 scope.
- **D-03**: `bash_paths` blocker — RESOLVED 2026-04-21 via Phase 17 Plan 01 merge (commits `c02211c` + `5d9d279`).

---

_Verified: 2026-04-21T22:25:00Z_
_Verifier: Claude (gsd-verifier)_
