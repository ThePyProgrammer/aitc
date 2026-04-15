---
phase: 08-real-claude-code-hook-integration-pretooluse-approvals
plan: 04
subsystem: hook-install-and-passive-consent
tags: [hook-install, passive-consent, sidecar-bundle, auto-heal, wave-2-backend]
dependency_graph:
  requires:
    - 08-01 (hook_install.rs stub + contract-lock RED tests)
    - 08-02 (WaiterRegistry / port_file / ApprovalRequest Phase 8 fields already live)
    - 08-03 (aitc-hook sidecar binary compiled for bundle.externalBin resolution)
  provides:
    - hook_install::install_aitc_hook (merge-safe, atomic, Pitfall-6-healing)
    - hook_install::upsert_pretool_entry (hand-rolled PreToolUse merge, preserves user hooks)
    - hook_install::reinstall_accepted_repos_on_startup (startup Pitfall 6 auto-heal)
    - app_settings::{get,has,record}_passive_hook_consent* (D-04 consent dedup)
    - Tauri commands accept_passive_hook_consent / decline_passive_hook_consent / resolve_sidecar_path
    - passive_bridge emits `passive-claude-detected` Tauri event on first-sighting, deduped via app_settings
    - claude_code::launch installs hook in cwd unless D-23 bypass chip is set
    - AITC_SIDECAR_PATH env var set at startup via ShellExt::sidecar("aitc-hook")
    - tauri_plugin_shell plugin registered
  affects:
    - Plan 08-05 (frontend): consumes accept/decline commands + listens on passive-claude-detected
    - Plan 08-06 (e2e integration): the install pipeline is now wire-complete
tech_stack:
  added: []
  patterns:
    - "Hand-rolled JSON merge (not RFC 7396) to preserve user hook array entries (Pitfall 4)"
    - "Atomic tmp+rename write for user-owned config files (T-08-08 Tampering mitigation)"
    - "Basename-suffix detection of aitc-hook entries (enables Pitfall 6 stale-path healing)"
    - "app_settings as generic key/value table keyed on `passive_hook_consent:{cwd}`"
    - "Tauri event emission from a non-command path (bridge_tick) via injected Option<AppHandle>"
    - "Env-var bridge (AITC_SIDECAR_PATH) for dependency injection into the adapter trait without breaking the trait signature"
key_files:
  created: []
  modified:
    - src-tauri/src/agents/hook_install.rs (stubs + RED tests → full merge writer + 11 GREEN tests)
    - src-tauri/src/agents/claude_code.rs (install gate in launch() with D-23 chip bypass)
    - src-tauri/src/agents/commands.rs (3 new Tauri commands + 2 unit tests)
    - src-tauri/src/comms/app_settings.rs (3 new consent helpers + 4 new tests)
    - src-tauri/src/pipeline/passive_bridge.rs (bridge_tick + spawn_passive_bridge gain pool+app; D-04 event emission; 3 new tests)
    - src-tauri/src/pipeline/commands.rs (spawn_passive_bridge call site passes pool + app_handle)
    - src-tauri/src/pipeline/smoke_tests.rs (bridge_tick arity update)
    - src-tauri/src/lib.rs (pub mod comms; plugin_shell; 3 new commands registered; AITC_SIDECAR_PATH setup + background auto-heal)
    - src-tauri/tests/end_to_end_smoke.rs (bridge_tick arity update + 6 new Phase 8 smokes)
decisions:
  - "is_aitc_entry treats any basename matching `aitc-hook{,.exe}` as ours (Pitfall 6). Rationale: matches RESEARCH.md §'Pitfall 4' merge pattern and allows stale-path healing across AITC upgrades without a path-equality regression."
  - "Dedup sentinel uses value `\"declined\"` on first emit. Rationale: a hard-declared enum of {accepted,declined} at the column level lets the startup scanner trust get_passive_hook_consent_repos output without a third state. The accept command overwrites to `\"accepted\"`."
  - "AITC_SIDECAR_PATH env var as the DI mechanism instead of threading AppHandle into AgentAdapter::launch. Rationale: keeps the adapter trait stable across built-in and Generic (TOML) adapters; tests can stub the var without a Tauri runtime."
  - "bridge_tick signature grows to `(reg, snap, root, pool, app)` with Options so test harnesses (and the Phase 6 ignored smoke) can pass None. Rationale: avoids polluting the registry constructor with Tauri types while still letting production wiring inject them."
  - "is_object() guard on settings.local.json top-level: we refuse to write when the root is a JSON array/string/etc. (T-08-08). Silently overwriting would be data loss."
metrics:
  duration: "~90m (including build-time cargo waits)"
  completed_date: "2026-04-15"
  tasks: 2
  files_created: 0
  files_modified: 8
---

# Phase 8 Plan 04: Hook Install + Passive Consent + Bundle Finalization Summary

Land the install side of Phase 8: `hook_install::install_aitc_hook` becomes a merge-safe, idempotent, atomic writer of `cwd/.claude/settings.local.json` that also heals stale sidecar paths; `claude_code::launch` installs it automatically unless the user set a bypass chip (D-23); the passive-scan bridge emits a deduplicated per-repo consent prompt for externally-launched Claude processes (D-04); three Tauri commands wrap the accept/decline/resolve flow for Plan 05's dialog; and the Tauri bundle resolves the sidecar's absolute path at startup so `claude_code::launch` can inject it into settings.local.json without threading AppHandle through the AgentAdapter trait.

## Objective Met

After Plan 04, AITC-launched Claude agents (no bypass) write `binaries/aitc-hook` into their cwd's settings.local.json. Passive Claude agents trigger a one-time consent prompt per repo. Previously-accepted repos have their sidecar path auto-healed at startup. Bundle + capability config ship the sidecar as a scoped sidecar executable.

## Task Summary

| Task | Commit    | What                                                                                                           |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------- |
| 1    | b037f55   | hook_install merge writer + upsert + reinstall + 4 app_settings consent helpers; 10 new hook_install tests + 4 new app_settings tests all GREEN (Plan 01 RED → GREEN) |
| 2    | 835905a   | claude_code::launch install gate; 3 Tauri commands; passive_bridge event emit + dedup; lib.rs plugin_shell + AITC_SIDECAR_PATH + background auto-heal; 6 new e2e smokes + 3 new passive_bridge tests + 2 new agents::commands tests all GREEN |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Built and staged `aitc-hook` sidecar binary into `src-tauri/binaries/`**

- **Found during:** Task 1 — tauri-build's externalBin validation refused `cargo check --workspace` because the staged binary at `binaries/aitc-hook-<triple>` did not exist in this worktree (it is gitignored per Plan 01 Task 2).
- **Fix:** Ran `cargo build -p aitc-hook` and copied `target/debug/aitc-hook` to `src-tauri/binaries/aitc-hook-x86_64-unknown-linux-gnu`. No change to `.gitignore` (already excludes `/binaries/`).
- **Commit:** n/a (build artifact, not source)

**2. [Rule 3 - Blocking] Sentinel write must not require an AppHandle**

- **Found during:** Task 2 — my first pass gated the `record_passive_hook_consent` call inside the `Some(app)` branch, so unit tests that pass `app=None` to exercise dedup semantics without a Tauri runtime failed (`sentinel must be written after first sighting`).
- **Fix:** Restructured bridge_tick so the sentinel write happens whenever a pool is available; the `emit()` call is gated separately on the AppHandle being Some. This matches the plan's acceptance criterion that tests can drive the bridge without a Tauri runtime.
- **Commit:** 835905a

**3. [Rule 3 - Blocking] `comms` module made `pub` so integration tests can call `comms::app_settings::*`**

- **Found during:** Task 2 — `end_to_end_smoke.rs` needed to import `aitc_lib::comms::app_settings::ensure_schema/record_passive_hook_consent` for the new startup-auto-heal smoke, but `comms` was `mod comms;` (private).
- **Fix:** Changed `mod comms;` → `pub mod comms;` in `src/lib.rs`. No API change; only visibility.
- **Commit:** 835905a

### No architectural changes

No Rule 4 checkpoints. All decisions were foreseen in 08-CONTEXT.md (D-01, D-04, D-23) and 08-RESEARCH.md (Pitfall 4, Pitfall 6, Tauri v2 sidecar patterns).

## Authentication Gates

None — the sidecar-path resolution uses Tauri's built-in ShellExt, no external auth surface.

## Known Stubs

None introduced by this plan. All Plan 01 RED tests for `hook_install::*` are now GREEN.

**Resolved from Plan 01:**

| File | Symbol | Status |
|------|--------|--------|
| agents/hook_install.rs | `install_aitc_hook` | GREEN (10 tests) |
| agents/hook_install.rs | `upsert_pretool_entry` | GREEN (included above) |
| agents/hook_install.rs | `reinstall_accepted_repos_on_startup` | GREEN (2 tests) |

## Verification Evidence

```
$ cd src-tauri && cargo test --lib -- agents::hook_install comms::app_settings
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 249 filtered out

$ cd src-tauri && cargo test --lib -- pipeline::passive_bridge
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 265 filtered out

$ cd src-tauri && cargo test --lib -- agents::commands
test result: ok. 3 passed; 0 failed

$ cd src-tauri && cargo test --test end_to_end_smoke -- passive_ claude_launch_ startup_auto_heal_
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out

$ cd src-tauri && cargo check --workspace --tests
    Finished `dev` profile [unoptimized + debuginfo] target(s)

$ jq -r '.bundle.externalBin[0]' src-tauri/tauri.conf.json
binaries/aitc-hook

$ jq -r '.permissions[] | objects | select(.identifier=="shell:allow-execute") | .allow[0].name' src-tauri/capabilities/default.json
binaries/aitc-hook

$ rg -n "AITC_SIDECAR_PATH" src-tauri/src | wc -l
6
```

## Acceptance Criteria (from plan)

Task 1:
- [x] `cargo test --lib agents::hook_install` — 10 tests, 0 failed (plan required ≥ 8)
- [x] `pub fn install_aitc_hook` exists
- [x] `pub fn upsert_pretool_entry` exists
- [x] `pub async fn reinstall_accepted_repos_on_startup` exists
- [x] `std::fs::rename` used (atomic write)
- [x] `ends_with("/aitc-hook")` (stale-path healing)
- [x] `get_passive_hook_consent_repos` / `has_passive_hook_consent_entry` / `record_passive_hook_consent` all exist

Task 2:
- [x] `AITC_SIDECAR_PATH` in `src/agents/claude_code.rs`
- [x] `options.dangerously_skip_permissions` + `options.accept_edits` gate
- [x] `install_aitc_hook` called from launch
- [x] 3 Tauri commands registered
- [x] `emit("passive-claude-detected"` in passive_bridge
- [x] `reinstall_accepted_repos_on_startup` called in lib.rs
- [x] `tauri_plugin_shell::init` plugged
- [x] `bundle.externalBin[0]` == `binaries/aitc-hook`
- [x] `shell:allow-execute` scoped to `binaries/aitc-hook`
- [x] All 6 new e2e smokes pass

## Deferred Issues

Pre-existing, out-of-scope, not introduced by this plan (see `deferred-items.md`):

1. `conflict::engine` tests — 2 pre-existing failures on worktree base commit, unrelated to Phase 8 (already tracked as item #4 in deferred-items.md).
2. Phase 9 `claude_resources::fixtures` module file missing — already tracked as item #1.
3. `tsc --noEmit` errors in `src/views/Radar/forceCluster.ts` — Phase 7 d3-force typings, tracked as item #2.

## Threat Flags

No new threat surface introduced beyond what 08-CONTEXT.md plus this plan's `<threat_model>` already covered. `settings.local.json` mutation (T-08-08) mitigated by hand-rolled merge + atomic rename + non-object top-level refusal; consent replay (T-08-09) mitigated by dedup sentinel; D-23 chip bypass (T-08-EoP) mitigated by launch gate test; Pitfall 6 stale-path (T-08-P6) mitigated by basename-suffix match + startup auto-heal.

## Next Steps

- **Plan 08-05 (frontend):** consume the `passive-claude-detected` event + invoke `accept_passive_hook_consent` / `decline_passive_hook_consent` in the consent dialog. Also wire `resolve_sidecar_path` for any UI that needs to display the installed hook path (e.g., settings view).
- **Plan 08-06 (e2e integration):** once 05 lands, drive a full pipeline test: launch claude via `launch_agent` with chips unset → assert settings.local.json written → Claude's PreToolUse fires the sidecar → row lands in approval_requests → approve → `hookSpecificOutput.permissionDecision: allow` round-trips back.

## Self-Check: PASSED

- [x] `src-tauri/src/agents/hook_install.rs` — FOUND (merge writer implemented)
- [x] `src-tauri/src/agents/claude_code.rs` — FOUND (install gate in launch)
- [x] `src-tauri/src/agents/commands.rs` — FOUND (3 new commands)
- [x] `src-tauri/src/comms/app_settings.rs` — FOUND (3 new consent helpers)
- [x] `src-tauri/src/pipeline/passive_bridge.rs` — FOUND (event emission + dedup)
- [x] `src-tauri/src/lib.rs` — FOUND (plugin_shell + AITC_SIDECAR_PATH + auto-heal)
- [x] `src-tauri/tests/end_to_end_smoke.rs` — FOUND (6 new smokes)
- [x] Commit `b037f55` — FOUND in `git log`
- [x] Commit `835905a` — FOUND in `git log`
