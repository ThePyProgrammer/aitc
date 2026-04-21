---
phase: 18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma
verified: 2026-04-21T14:10:00Z
status: human_needed
score: 18/18 must-haves verified (all automated)
overrides_applied: 0
human_verification:
  - test: "Live soak test against a dev machine with 3+ concurrent `claude --input-format stream-json` sessions for 10 minutes"
    expected: "After 10 min of idle/chat exchange, `getRegistryStats` returns passive_count ≤ 5 AND capacity_hits_since_start == 0 — the D-01/D-02 filter holds in practice, not just in unit tests"
    why_human: "Requires live CLI + Tauri runtime + real time; explicitly called out in VALIDATION.md § Manual-Only Verifications as the sole live-environment field validation for D-01. Unit tests prove the filter logic; this proves the production scenario that motivated Phase 18 is actually resolved. Optional per VALIDATION.md ('optional soak-test evidence, not a phase gate') but the phase goal 'drop subprocess children whose parent is an in-scope candidate' ultimately means 'flood no longer happens in real usage' — only a human can observe that."
---

# Phase 18: Fix Passive-Scan Registry Flooding Verification Report

**Phase Goal:** Scope `passive_bridge::bridge_tick` to drop subprocess children whose parent is itself an in-scope allowlisted candidate (D-01/D-02 hybrid filter: cwd-in-repo + parent-PID-in-candidate-set), formalize `MAX_AGENTS = 1000` as an intentional emergency ceiling with an explanatory doc comment (D-03), and expose a read-only `get_registry_stats` Tauri command backed by a new `capacity_hits_since_start: AtomicU64` on `AgentRegistry` for post-hoc debugging (D-04). Preserve AGNT-03 (externally-launched agents with non-candidate shell parents still register).

**Verified:** 2026-04-21T14:10:00Z
**Status:** human_needed (all automated criteria PASS; optional live soak remains)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                           | Status     | Evidence                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | bridge_tick drops subprocess children whose parent PID is itself in the post-cwd in-scope candidate list (D-02) | ✓ VERIFIED | `passive_bridge.rs:117-124` layer 2 filter after cwd-scope; test `parent_in_candidate_list_drops_subprocess_children` PASS                                            |
| 2   | 1 parent + N allowlisted children ⇒ exactly 1 PASSIVE-{parent} entry after one tick                             | ✓ VERIFIED | Test `flood_regression_parent_plus_many_children` (1 parent + 50 children): `reg.all_agents().len() == 1` — PASS                                                      |
| 3   | Candidates with `parent_pid = None` (orphaned / PID-1) are never dropped by the new filter                      | ✓ VERIFIED | Filter None-branch at `passive_bridge.rs:122` returns true; test `orphaned_child_with_no_parent_registers` PASS                                                       |
| 4   | Candidates whose parent was dropped by cwd-scope are promoted to top-level                                      | ✓ VERIFIED | Filter order verified: cwd-scope at L99-105, parent-PID at L117-124; test `child_of_cwd_filtered_parent_is_promoted` PASS                                             |
| 5   | AGNT-03 preserved: externally-launched claude with non-candidate parent (e.g., shell PID 1) still registers     | ✓ VERIFIED | Test `externally_launched_with_shell_parent_still_registers` (parent=1 not in candidate_pids) PASS; REQUIREMENTS.md marks AGNT-03 "Complete" via Phase 3 + Phase 18   |
| 6   | MAX_AGENTS = 1000 value preserved (D-03 keeps the hotfix value)                                                 | ✓ VERIFIED | `grep -c "const MAX_AGENTS: usize = 1000" registry.rs` = 1; value/type/visibility unchanged from commit `62612b3`                                                     |
| 7   | MAX_AGENTS doc comment explains WHY 1000, WHY NOT 100, WHY NOT configurable, cites Phase 18 + 62612b3 (D-03)    | ✓ VERIFIED | `registry.rs:13-35` contains "emergency ceiling", "Why 1000 and not configurable", "Why not 100", "Why not exposed to users", "62612b3", "Phase 18" × 4, "D-01/D-02" × 2 |
| 8   | Doc comment forward-references `capacity_hits_since_start` AND `get_registry_stats` for runtime observability   | ✓ VERIFIED | `registry.rs:33-35` — both names present; both resolve to real artifacts in-file (counter at L83) and in `commands.rs:43`                                             |
| 9   | `capacity_hits_since_start: AtomicU64` field on AgentRegistry, initialized to 0 (D-04)                          | ✓ VERIFIED | `registry.rs:83` field decl; `registry.rs:92` init `AtomicU64::new(0)` in `new()`                                                                                     |
| 10  | `upsert_agent` increments the counter on the at-capacity branch via `fetch_add(1, Ordering::Relaxed)`           | ✓ VERIFIED | `registry.rs:126-127` — increment BEFORE `return Err` at L128; test `capacity_hit_increments_counter` asserts 0→1→2 monotonic PASS                                    |
| 11  | `RegistryStats` struct with 5 fields + specta::Type + serde camelCase (D-04)                                    | ✓ VERIFIED | `registry.rs:61-69` derives `Debug, Clone, Serialize, Deserialize, specta::Type` + `#[serde(rename_all = "camelCase")]`                                               |
| 12  | `AgentRegistry::snapshot_stats()` async method with read-lock-only + atomic-load-first (Pitfall 7)              | ✓ VERIFIED | `registry.rs:216-241` — L217 atomic load, L219 `.read().await` SECOND; no `.write()` in function body; test `snapshot_stats_counts_by_prefix_and_atomic` PASS         |
| 13  | `get_registry_stats` Tauri command exists in `agents/commands.rs` and calls `snapshot_stats().await`            | ✓ VERIFIED | `commands.rs:41-47` — `#[tauri::command] #[specta::specta] pub async fn get_registry_stats` → `Ok(registry.snapshot_stats().await)`                                   |
| 14  | Command registered in `collect_commands![]` macro in `lib.rs`                                                   | ✓ VERIFIED | `lib.rs:61` — `agents::commands::get_registry_stats,` entry in the `agents::commands::*` cluster                                                                      |
| 15  | `RegistryStats` registered via `.typ::<agents::registry::RegistryStats>()` in lib.rs                            | ✓ VERIFIED | `lib.rs:111` — `.typ::<agents::registry::RegistryStats>()` in the specta `.typ<...>()` chain                                                                          |
| 16  | `src/bindings.ts` contains `RegistryStats` TS type + `getRegistryStats` command                                 | ✓ VERIFIED | `bindings.ts:850` — `export type RegistryStats = { totalAgents: number; passiveCount: number; kagentCount: number; launchedCount: number; capacityHitsSinceStart: number }`; `bindings.ts:250-252` — `async getRegistryStats() : Promise<Result<RegistryStats, string>>` invoking `"get_registry_stats"` |
| 17  | All pre-existing passive_bridge + registry tests still green (no regression in semantics)                       | ✓ VERIFIED | `cargo test --lib pipeline::passive_bridge::tests` → 12/12 PASS; `cargo test --lib agents::registry::tests` → 11/11 PASS; `cargo test --lib agents::commands` → 7/7 PASS |
| 18  | No scope creep: `AGENT_NAME_ALLOWLIST`, three-tier match, self_register, pipeline/commands unchanged            | ✓ VERIFIED | `git log --since 2026-04-21 12:00 -- src-tauri/src/pipeline/process_snapshot.rs src-tauri/src/agents/self_register.rs src-tauri/src/pipeline/commands.rs` → empty     |

**Score:** 18/18 truths verified

### Required Artifacts

| Artifact                                    | Expected                                                                          | Status      | Details                                                                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/pipeline/passive_bridge.rs`  | Parent-PID filter + cand_with_parent helper + 5 new tests                         | ✓ VERIFIED  | L117-124 filter block under `Phase 18 D-02` comment; L267 `cand_with_parent` helper; L461-592 five new tests; all 12 `pipeline::passive_bridge::tests` pass                 |
| `src-tauri/src/agents/registry.rs`          | AtomicU64 counter + RegistryStats struct + snapshot_stats + MAX_AGENTS doc rewrite | ✓ VERIFIED  | L9 atomic import; L13-35 rewritten MAX_AGENTS doc; L61-69 `RegistryStats`; L83 counter; L92 init; L126-127 increment; L216-241 `snapshot_stats`; 11/11 tests pass            |
| `src-tauri/src/agents/commands.rs`          | `get_registry_stats` Tauri command wrapper                                        | ✓ VERIFIED  | L41-47 command body; fully-qualified return `crate::agents::registry::RegistryStats`; 7/7 `agents::commands` tests pass                                                    |
| `src-tauri/src/lib.rs`                      | collect_commands entry + .typ::<...>() entry                                      | ✓ VERIFIED  | L61 `agents::commands::get_registry_stats`; L111 `.typ::<agents::registry::RegistryStats>()`; `cargo build --lib` clean                                                    |
| `src/bindings.ts`                           | Auto-regenerated TS binding for `RegistryStats` + `getRegistryStats`               | ✓ VERIFIED  | L250 `async getRegistryStats()`; L252 `TAURI_INVOKE("get_registry_stats")`; L850 camelCase `export type RegistryStats`; existing `listAgents`/`AgentInfo` preserved          |

### Key Link Verification

| From                                         | To                                                  | Via                                                                  | Status  | Details                                                                                                                         |
| -------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `passive_bridge::bridge_tick` (cwd filter)    | `passive_bridge::bridge_tick` (parent-PID filter)   | Second `filter(...)` shadows `in_scope` Vec after `candidate_pids` built | WIRED  | `grep "candidate_pids.contains" passive_bridge.rs` = 1 hit at L121; runs after cwd filter L99-105, before live_pids reap L126    |
| `passive_bridge::bridge_tick` tests           | `process_snapshot::from_candidates_for_test`        | `seeded_snapshot` + `cand` + `cand_with_parent` helpers               | WIRED  | `from_candidates_for_test` at `process_snapshot.rs`; `cand_with_parent` at `passive_bridge.rs:267`                                |
| `AgentRegistry::upsert_agent`                 | `AgentRegistry::capacity_hits_since_start`          | `self.capacity_hits_since_start.fetch_add(1, Ordering::Relaxed)`     | WIRED  | `registry.rs:126-127` on at-capacity branch BEFORE `return Err` at L128                                                          |
| `AgentRegistry::snapshot_stats`               | `AgentRegistry::capacity_hits_since_start` + RwLock | Load atomic FIRST, read-lock SECOND                                  | WIRED  | `registry.rs:217-219` — Pitfall 7 ordering explicit; no write-lock in function body                                              |
| `agents::commands::get_registry_stats`        | `AgentRegistry::snapshot_stats`                     | `registry.snapshot_stats().await`                                    | WIRED  | `commands.rs:46` direct await invocation; takes `tauri::State<'_, Arc<AgentRegistry>>`                                           |
| `lib.rs::collect_commands!`                   | `agents::commands::get_registry_stats`              | `collect_commands![... agents::commands::get_registry_stats, ...]`  | WIRED  | `lib.rs:61` inside the `agents::commands::*` cluster of the `collect_commands!` macro                                            |
| `lib.rs::.typ::<...>()` chain                 | `agents::registry::RegistryStats`                   | `.typ::<agents::registry::RegistryStats>()`                         | WIRED  | `lib.rs:111` inside the `.typ::<...>()` specta chain; emits TS binding on debug compile+binary-start                             |
| `MAX_AGENTS` doc comment                      | `capacity_hits_since_start` + `get_registry_stats`  | Forward-pointer sentence in doc block                                | WIRED  | `registry.rs:33-35` — both names present; both resolve to real artifacts in this phase's scope                                   |

### Data-Flow Trace (Level 4)

| Artifact                       | Data Variable                         | Source                                                             | Produces Real Data | Status    |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------ | ------------------ | --------- |
| `get_registry_stats` command   | `RegistryStats` return                | `registry.snapshot_stats().await` → real HashMap scan + atomic load | Yes                | ✓ FLOWING |
| `snapshot_stats`                | `total_agents`, `passive_count`, etc. | `self.agents.read().await` scan over real ManagedAgent entries     | Yes                | ✓ FLOWING |
| `snapshot_stats`                | `capacity_hits_since_start`           | `self.capacity_hits_since_start.load(Ordering::Relaxed)`           | Yes                | ✓ FLOWING |
| `upsert_agent` counter bump    | `capacity_hits_since_start` atomic    | Real error branch after `agents.len() >= MAX_AGENTS` check         | Yes                | ✓ FLOWING |
| parent-PID filter `candidate_pids` | HashSet<u32>                       | `in_scope.iter().map(|c| c.pid).collect()` — real post-cwd Vec     | Yes                | ✓ FLOWING |

No hollow props, no hardcoded empties, no disconnected data sources. Every artifact's output is derived from real backing state.

### Behavioral Spot-Checks

| Behavior                                                           | Command                                                              | Result                                                    | Status  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------- | ------- |
| Parent-PID filter tests (5 new + 7 pre-existing)                   | `cargo test --lib pipeline::passive_bridge::tests`                  | 12 passed; 0 failed                                       | ✓ PASS  |
| Registry tests (2 new + 9 pre-existing)                            | `cargo test --lib agents::registry`                                 | 11 passed; 0 failed                                       | ✓ PASS  |
| Agents commands tests (7 pre-existing, `get_registry_stats` builds) | `cargo test --lib agents::commands`                                 | 7 passed; 0 failed                                        | ✓ PASS  |
| Library builds cleanly with new code                               | `cargo build --lib`                                                  | Finished dev profile; 8 pre-existing warnings, 0 errors   | ✓ PASS  |
| TypeScript binding emits RegistryStats + getRegistryStats          | `grep -c "RegistryStats\|getRegistryStats\|get_registry_stats" src/bindings.ts` | 4 hits (type export, type reference in Promise, command decl, TAURI_INVOKE) | ✓ PASS  |
| `capacity_hits_since_start` counter total occurrences (field + init + increment + load + struct + tests) | `grep -c "capacity_hits_since_start" src-tauri/src/agents/registry.rs` | 13 hits (≥ 5 required) | ✓ PASS  |
| MAX_AGENTS doc comment contains required keywords                  | `grep -B30 "const MAX_AGENTS" registry.rs \| grep -E "Phase 18\|62612b3\|emergency\|D-01/D-02\|capacity_hits_since_start\|not exposed"` | All 6 keywords present (Phase 18 × 4, 62612b3 × 1, emergency × 2, D-01/D-02 × 2, capacity_hits_since_start × 1, not exposed × 1) | ✓ PASS  |

### Requirements Coverage

| Requirement | Source Plan                  | Description                                                                                                       | Status       | Evidence                                                                                                                                                                          |
| ----------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AGNT-03     | 18-01, 18-02, 18-03, 18-04    | System detects and attaches to externally-launched agent processes already running on the codebase (preservation) | ✓ SATISFIED  | Test `externally_launched_with_shell_parent_still_registers` (parent=1, non-candidate shell PID) registers PASSIVE-777 ⇒ AGNT-03 not regressed; REQUIREMENTS.md marks Phase 3 + Phase 18 Complete |

### Anti-Patterns Found

| File                                    | Line   | Pattern                                 | Severity  | Impact                                                                                                 |
| --------------------------------------- | ------ | --------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| src-tauri/src/conflict/engine.rs        | 415    | Test assertion `left == right` failing  | ℹ️ Info   | Pre-existing from Phase 03 commit `ec769ba` — NOT owned by Phase 18. Documented in deferred-items.md, confirmed not caused by this phase (no Phase 18 commit touched `conflict/`) |

No Phase-18-owned TODOs, FIXMEs, placeholders, empty renderers, hardcoded empty props, or console.log-only implementations found. Every forward reference in code (capacity_hits_since_start, get_registry_stats, D-01/D-02, 62612b3) resolves to a real artifact in this phase's scope.

### Human Verification Required

#### 1. Live soak: 3+ concurrent claude stream-json sessions for 10 minutes

**Test:**
1. Open AITC against a real watched repo.
2. Spawn 3+ parallel `claude --input-format stream-json --output-format stream-json` sessions via the Deploy dialog (or externally to exercise AGNT-03).
3. Exchange a handful of chat messages in each; let them idle 10 min so MCP helpers / node shims / hook sidecars have maximum opportunity to proliferate.
4. Invoke `getRegistryStats()` from the Tauri dev console (`await window.__TAURI__.core.invoke('get_registry_stats')`).

**Expected:**
- `passiveCount` ≤ 5 (≈ one per top-level session + any externally-detected standalone claude).
- `capacityHitsSinceStart` === 0 (no at-capacity rejections occurred at any point).
- No PASSIVE-{pid} entries visible in the UI corresponding to `claude-mcp*` / `node-claude-helper*` / `aitc-hook*` subprocess children.

**Why human:** Requires live Claude CLI + Tauri runtime + 10 minutes of real interaction. Unit tests prove the filter LOGIC is correct against `from_candidates_for_test` fixtures; this proves the LIVE PROCESS TREE (with real sysinfo `parent: Option<u32>` values, cross-platform PPID semantics, and concurrent registry upserts) exercises the filter as designed. Explicitly called out in `18-VALIDATION.md § Manual-Only Verifications` as optional soak-test evidence. Not a phase gate — 18/18 automated truths pass — but the phase goal's real-world payoff ("flood no longer happens") is only observable by a human running the scenario.

### Gaps Summary

**No gaps.** All 18 observable truths verified against the actual codebase (not just SUMMARY claims). Filter, counter, struct, method, Tauri command, and TS bindings all exist, are substantively implemented (not stubs), are wired end-to-end, and have real data flowing through them. AGNT-03 preserved. Pre-existing `conflict::engine` test failures confirmed not owned by Phase 18 (no Phase 18 commit touched `conflict/`, and the root cause is commit `ec769ba` from Phase 03).

Phase 18 is complete from an automated-verification standpoint. The one `human_needed` item is the optional live soak test noted in VALIDATION.md, which the planner explicitly marked "optional soak-test evidence, not a phase gate." The verifier flags it here so the developer has the option to close the loop in production conditions before closing the phase formally.

---

*Verified: 2026-04-21T14:10:00Z*
*Verifier: Claude (gsd-verifier)*
