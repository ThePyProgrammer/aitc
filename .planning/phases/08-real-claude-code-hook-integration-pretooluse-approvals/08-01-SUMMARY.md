---
phase: 08-real-claude-code-hook-integration-pretooluse-approvals
plan: 01
subsystem: hook-integration-foundation
tags: [scaffolding, sidecar, workspace, contract-lock, tdd-red]
dependency_graph:
  requires: []
  provides:
    - aitc-hook sidecar crate + binary + envelope helpers (stubs)
    - WaiterRegistry / HookDecision types (stubs with locked signatures)
    - install_aitc_hook / upsert_pretool_entry API (stubs)
    - PortFileGuard / write_port / port_file_path API (stubs)
    - DB migration 005 (approval_requests += tool_name/tool_input_json/session_id)
    - Tauri externalBin + shell:allow-execute capability
    - ToolPreview dispatcher + registry (resolveRenderer) with UnknownToolPreview fallback
    - commsStore ApprovalRequest extension + sessionAlwaysAllow + clearAlwaysAllowForAgent
  affects:
    - All Phase 8 downstream plans (02, 03, 04, 05, 06) — they implement against these locked contracts
tech_stack:
  added:
    - "aitc-hook (new Rust crate) with ureq, serde_json, dirs, anyhow"
    - "tauri-plugin-shell v2 on main crate"
  patterns:
    - "Cargo workspace (src-tauri as root + aitc-hook as member)"
    - "Contract-lock via #[should_panic(expected = \"plan XX\")] tests"
    - "Renderer registry with MCP prefix fallback heuristic"
key_files:
  created:
    - src-tauri/aitc-hook/Cargo.toml
    - src-tauri/aitc-hook/src/main.rs
    - src-tauri/aitc-hook/src/lib.rs
    - src-tauri/aitc-hook/tests/envelope_shapes.rs
    - src-tauri/src/agents/hook_waiters.rs
    - src-tauri/src/agents/hook_install.rs
    - src-tauri/src/pipeline/port_file.rs
    - src-tauri/src/db/migrations/005_pretool_use_hooks.sql
    - src-tauri/tests/fixtures/pretool_use_stdin.json
    - src-tauri/tests/fixtures/expected_permission_decision.json
    - src/views/CommsHub/ToolPreview/index.tsx
    - src/views/CommsHub/ToolPreview/registry.ts
    - src/views/CommsHub/ToolPreview/UnknownToolPreview.tsx
    - src/views/CommsHub/__tests__/ToolPreview.test.tsx
    - .planning/phases/08-real-claude-code-hook-integration-pretooluse-approvals/deferred-items.md
  modified:
    - src-tauri/Cargo.toml (workspace + dirs bump + tauri-plugin-shell)
    - src-tauri/.gitignore (+ /binaries/)
    - src-tauri/src/agents/mod.rs (+ hook_waiters, hook_install)
    - src-tauri/src/pipeline/mod.rs (+ port_file)
    - src-tauri/tauri.conf.json (+ bundle.externalBin, bundle.resources)
    - src-tauri/capabilities/default.json (+ shell:default + shell:allow-execute scoped)
    - src/stores/commsStore.ts (+ PreToolUse fields, sessionAlwaysAllow, clearAlwaysAllowForAgent)
    - src/stores/__tests__/commsStore.test.ts (+ 4 tests locking extension shape)
decisions:
  - "HookDecision enum kept as 3 variants: Allow, AllowWithEdits(Value), Deny(String). Matches Plan 03 wire shape (serde tag=\"kind\", snake_case)."
  - "Sidecar crate name is `aitc-hook` (binary) / `aitc_hook` (lib). Published as workspace member under src-tauri/aitc-hook/."
  - "DB schema change lives in migration 005 (ADD COLUMN tool_name/tool_input_json/session_id + 2 indexes). No CHECK constraint on status exists in 001-004, so 'abandoned' value is free to insert."
  - "Tauri bundle externalBin path is `binaries/aitc-hook` (Tauri appends target-triple automatically at bundle time)."
  - "Shell capability is scoped to the sidecar via `{name: binaries/aitc-hook, sidecar: true}` — not a general shell:allow-execute wildcard."
  - "Frontend renderer registry keyed on exact tool_name string; MCP prefix match (`mcp__`) falls back to UnknownToolPreview per UI-SPEC."
  - "commsStore.sessionAlwaysAllow is client-side cache keyed by (agent_id, tool_name); Plan 02 is authoritative (backend is source of truth) — Plan 05 will wire invoke payloads."
metrics:
  duration: "~45m"
  completed_date: "2026-04-15"
  tasks: 3
  files_created: 15
  files_modified: 8
---

# Phase 8 Plan 01: Foundation & Contract Locks Summary

Scaffold the Wave 0 plumbing for Phase 8 PreToolUse hook integration — new sidecar crate, backend module stubs with `todo!()` bodies, DB migration 005, Tauri bundle/capability config, and the ToolPreview renderer registry — so Waves 1/2 can implement logic against locked signatures without re-inventing paths.

## Objective Met

Every new module ships with either a `#[should_panic(expected = "plan NN")]` contract-lock test (Rust) or a GREEN vitest assertion (frontend). Plans 02/03/04/05 cannot change `WaiterRegistry`/`HookDecision`/`install_aitc_hook`/`PortFileGuard`/`resolveRenderer` signatures without breaking the lock.

## Task Summary

| Task | Commit   | What                                                         |
| ---- | -------- | ------------------------------------------------------------ |
| 1    | 17aed85  | Workspace + aitc-hook crate (lib.rs types, main.rs stub, envelope RED tests) |
| 2    | def65b2  | Backend stubs (hook_waiters, hook_install, port_file) + migration 005 + Tauri bundle/capability config + JSON fixtures |
| 3    | 7e1d974  | ToolPreview/ dispatcher + registry + UnknownToolPreview; commsStore PreToolUse extension + 4 new vitest specs |

## RED Tests Locked (Contract Guards)

All of these are intentional RED (or `#[should_panic]`) until the owning plan fills in the real body. Do NOT weaken these assertions — they are the contract.

| Test                                                                     | Location                                                       | Owner   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- | ------- |
| `allow_envelope_matches_modern_contract`                                 | src-tauri/aitc-hook/tests/envelope_shapes.rs                   | Plan 03 |
| `allow_with_edits_envelope_includes_updated_input`                       | src-tauri/aitc-hook/tests/envelope_shapes.rs                   | Plan 03 |
| `hook_waiters::register_then_signal_delivers_decision`                   | src-tauri/src/agents/hook_waiters.rs                           | Plan 02 |
| `hook_waiters::signal_for_agent_fires_all_waiters_for_that_agent`        | src-tauri/src/agents/hook_waiters.rs                           | Plan 02 |
| `hook_waiters::always_allow_roundtrip`                                   | src-tauri/src/agents/hook_waiters.rs                           | Plan 02 |
| `hook_install::upsert_preserves_existing_user_entries`                   | src-tauri/src/agents/hook_install.rs                           | Plan 04 |
| `hook_install::upsert_is_idempotent`                                     | src-tauri/src/agents/hook_install.rs                           | Plan 04 |
| `port_file::write_port_creates_file_with_port_only`                      | src-tauri/src/pipeline/port_file.rs                            | Plan 02 |
| `port_file::drop_guard_removes_file`                                     | src-tauri/src/pipeline/port_file.rs                            | Plan 02 |

## Locked Interfaces

Plans 02/03/04/05 MUST import these exact names — verbatim from 08-01-PLAN.md `<interfaces>`:

- `crate::agents::hook_waiters::{HookDecision, WaiterEntry, WaiterRegistry}` — with methods: `register`, `signal`, `signal_for_agent`, `remove_silently`, `add_always_allow`, `is_always_allowed`, `clear_always_allow_for_agent`, `bind_session`, `agent_for_session`, `clear_session_bindings_for_agent`
- `crate::agents::hook_install::{install_aitc_hook, upsert_pretool_entry}`
- `crate::pipeline::port_file::{PortFileGuard, port_file_path, write_port}`
- `aitc_hook::{AitcDecision, HookRequest, resolve_port, build_allow_envelope, build_allow_with_edits_envelope}`
- Frontend: `src/views/CommsHub/ToolPreview` (default + named `ToolPreview`), `./registry` (`resolveRenderer`, `ToolPreviewProps`, `ToolRenderer`), `./UnknownToolPreview` (`UnknownToolPreview`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed sidecar binary into `src-tauri/binaries/`**

- **Found during:** Task 2 — `cargo check --workspace` with the new `bundle.externalBin` key refused to compile because the tauri-build step verifies the sidecar binary exists at `binaries/aitc-hook-<target-triple>`.
- **Fix:** Copied the freshly-built `target/debug/aitc-hook` into `src-tauri/binaries/aitc-hook-x86_64-unknown-linux-gnu` and added `/binaries/` to `src-tauri/.gitignore` (build artifact, not source of truth).
- **Files modified:** src-tauri/.gitignore
- **Commit:** def65b2

**2. [Rule 2 - Critical] Declared `dirs = "6"` unified across main crate and sidecar**

- **Found during:** Task 1 — `dirs = "5"` was already present in main `Cargo.toml` (Phase 9 ARSENAL) but the plan specified `dirs = "6"` for the aitc-hook sidecar. Two different major versions of `dirs` in the workspace would pull in duplicate transitive crates and break uniform home-directory resolution (both aitc and aitc-hook read `~/.aitc/port`).
- **Fix:** Bumped main crate to `dirs = "6"` with an inline comment.
- **Files modified:** src-tauri/Cargo.toml
- **Commit:** 17aed85

### Out-of-Scope Deferrals

See `deferred-items.md`:

1. **`cargo test --lib` broken by Phase 9 Plan 1 `fixtures` module** — Pre-existing on worktree base (commit 291acb4). Verified Plan 08-01 stubs compile via `cargo check --workspace --tests`; only the unrelated Phase 9 E0583 error surfaces. Individual stub tests will run once Phase 9 Plan 2 (or a follow-up) lands `src/claude_resources/fixtures.rs`.
2. **Pre-existing tsc errors (63 on base → 59 on HEAD)** — All in `src/views/Radar/forceCluster.ts` + tests, rooted in Phase 7 d3-force typings. Plan 08-01 adds ZERO new tsc errors.
3. **`[profile.release]` in `aitc-hook/Cargo.toml` ignored** — Non-blocking Cargo warning; profile block is effectively a no-op. Leaving as-specified by plan. Migrate to workspace root when multiple release profiles are needed.

## Authentication Gates

None — Wave 0 is pure scaffolding and does not interact with external auth surfaces.

## Known Stubs

This plan is intentionally all stubs. Every stub is tracked by a contract-lock test and an owning plan (see "RED Tests Locked" table). Explicit design intent — NOT to be interpreted as implementation defects:

| File | Symbol | Stub shape | Fills GREEN |
|------|--------|------------|-------------|
| aitc-hook/src/lib.rs | `build_allow_envelope` | returns `json!({})` | Plan 03 |
| aitc-hook/src/lib.rs | `build_allow_with_edits_envelope` | returns `json!({})` | Plan 03 |
| aitc-hook/src/lib.rs | `resolve_port` | returns `None` | Plan 03 |
| aitc-hook/src/main.rs | `main()` | exits 2 + stderr "stub not implemented" | Plan 03 |
| agents/hook_waiters.rs | All 10 `WaiterRegistry` methods | `todo!("plan 02")` | Plan 02 |
| agents/hook_install.rs | `install_aitc_hook`, `upsert_pretool_entry` | `todo!("plan 04")` | Plan 04 |
| pipeline/port_file.rs | `port_file_path`, `write_port`, `Drop` | `todo!("plan 02")` + no-op Drop | Plan 02 |
| ToolPreview/registry.ts | 12 stub renderers (Edit, Bash, Write, ...) | `() => null` with `displayName` set | Plan 05 |
| commsStore.ts | `approveRequest`/`approveWithEdits` opts param | signature only; body ignores opts | Plan 05 |

## Verification Evidence

- `cd src-tauri && cargo check --workspace` — exits 0 (8 pre-existing lib warnings)
- `cd src-tauri && cargo build -p aitc-hook` — produces `target/debug/aitc-hook` (exits 2, stderr "stub not implemented")
- `cd src-tauri && cargo test -p aitc-hook --test envelope_shapes` — 1 passed, 2 FAILED (RED by design)
- `cd src-tauri && grep -c "pub mod hook_waiters" src/agents/mod.rs` → `1`
- `cd src-tauri && grep -c "pub mod hook_install" src/agents/mod.rs` → `1`
- `cd src-tauri && grep -c "pub mod port_file" src/pipeline/mod.rs` → `1`
- `jq -r '.bundle.externalBin[0]' src-tauri/tauri.conf.json` → `binaries/aitc-hook`
- `jq -r '.permissions[] | objects | select(.identifier == "shell:allow-execute") | .allow[0].name' src-tauri/capabilities/default.json` → `binaries/aitc-hook`
- `jq -r .tool_name src-tauri/tests/fixtures/pretool_use_stdin.json` → `Edit`
- `jq -r .hookSpecificOutput.permissionDecision src-tauri/tests/fixtures/expected_permission_decision.json` → `allow`
- `npx vitest run src/views/CommsHub/__tests__/ToolPreview.test.tsx src/stores/__tests__/commsStore.test.ts` → `Test Files 2 passed (2) / Tests 24 passed (24)`
- `npx tsc --noEmit` error count: 63 (base) → 59 (HEAD), ZERO new errors in Phase 8 files

## Next Steps

- **Plan 08-02 (Wave 1, backend):** implements `WaiterRegistry` methods + `port_file` body. Turns `hook_waiters::*` and `port_file::*` `#[should_panic]` tests GREEN.
- **Plan 08-03 (Wave 1, sidecar):** implements `aitc-hook` envelope helpers + HTTP client wire + main() flow. Turns `envelope_shapes` tests GREEN.
- **Plan 08-04 (Wave 2, install):** implements `install_aitc_hook` + `upsert_pretool_entry`. Turns `hook_install::*` tests GREEN.
- **Plan 08-05 (Wave 2, UI):** fills renderer registry stubs with real EditPreview/BashPreview/etc. and wires `opts.alwaysAllowForSession` into commsStore invokes.
- **Plan 08-06 (integration):** e2e hook pipeline test using the two JSON fixtures in `src-tauri/tests/fixtures/`.

## Self-Check: PASSED

- [x] `src-tauri/aitc-hook/Cargo.toml` — FOUND
- [x] `src-tauri/aitc-hook/src/main.rs` — FOUND
- [x] `src-tauri/aitc-hook/src/lib.rs` — FOUND
- [x] `src-tauri/aitc-hook/tests/envelope_shapes.rs` — FOUND
- [x] `src-tauri/src/agents/hook_waiters.rs` — FOUND
- [x] `src-tauri/src/agents/hook_install.rs` — FOUND
- [x] `src-tauri/src/pipeline/port_file.rs` — FOUND
- [x] `src-tauri/src/db/migrations/005_pretool_use_hooks.sql` — FOUND
- [x] `src-tauri/tests/fixtures/pretool_use_stdin.json` — FOUND
- [x] `src-tauri/tests/fixtures/expected_permission_decision.json` — FOUND
- [x] `src/views/CommsHub/ToolPreview/index.tsx` — FOUND
- [x] `src/views/CommsHub/ToolPreview/registry.ts` — FOUND
- [x] `src/views/CommsHub/ToolPreview/UnknownToolPreview.tsx` — FOUND
- [x] `src/views/CommsHub/__tests__/ToolPreview.test.tsx` — FOUND
- [x] Commit `17aed85` — FOUND in `git log`
- [x] Commit `def65b2` — FOUND in `git log`
- [x] Commit `7e1d974` — FOUND in `git log`
