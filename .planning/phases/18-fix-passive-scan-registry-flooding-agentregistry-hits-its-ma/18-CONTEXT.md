# Phase 18: Fix Passive-Scan Registry Flooding - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** --auto (all gray areas auto-selected with recommended defaults)

<domain>
## Phase Boundary

Properly scope passive-scan registration so `AgentRegistry` reflects real standalone agent processes only — not the noisy subprocess children that Phase 10's long-lived `claude --input-format stream-json --output-format stream-json` runtime (and its per-session MCP helpers / hook sidecar fires / node shims) spawn beneath each launched agent.

Formalize the hotfix-raised `MAX_AGENTS = 1000` ceiling as the intentional safety net (was 100 in commit 62612b3) and add lightweight observability so the next time the cap is approached, the cause is visible instead of "mystery capacity errors".

**In scope:**
- Tighten `passive_bridge::bridge_tick` registration filter beyond the current cwd-prefix scope (commit d3573dc) to also skip subprocess children of agents that are already in the snapshot candidate list.
- Keep `MAX_AGENTS = 1000` (hotfix value) and document *why* it is 1000 (not 100, not configurable) inside `registry.rs`.
- Expose a read-only diagnostic Tauri command (e.g., `get_registry_stats`) that returns `{total_agents, passive_count, kagent_count, launched_count, capacity_hits_since_start}` for future troubleshooting without guessing.
- Unit test coverage for the new parent-PID filter + regression test that reproduces the original flood scenario (single parent + many subprocess children should still result in exactly 1 PASSIVE-{pid}).

**Out of scope (explicitly deferred):**
- Changing `/register` self-registration semantics (KAGENT-{pid} path stays untouched — it was never the bleeder).
- Changing `AGENT_NAME_ALLOWLIST` or the three-tier (name/argv/exe) matching in `ProcessSnapshot::refresh` — broad matching is still desired for top-level AGNT-03 detection (externally-launched agents).
- User-configurable passive-scan cadence or registry caps (premature — no evidence current defaults are wrong once scoping lands).
- A diagnostics UI page that *visualizes* the new stats endpoint (backend-only for Phase 18; a Plugin/Skill/Tool Manager-style page would be its own phase).
- Changing the UI `useScopedAgents` rule — layer agreement already holds (Phase 6 D-06).

</domain>

<decisions>
## Implementation Decisions

### Registration Scope Policy (primary fix)

- **D-01:** **Hybrid scope — keep cwd-in-repo filter, layer parent-PID exclusion on top.** `bridge_tick` already drops candidates whose cwd isn't a prefix of `repo_root` (commit d3573dc). Phase 18 adds a second filter: if a candidate's `parent` PID is itself present in the candidate list, drop the child so only the top-of-tree agent process gets a `PASSIVE-{pid}` registry entry. This is the "only parent claude/codex does" directive from the roadmap, applied inside the bridge tick before upsert.
  - Rationale: directly addresses the Phase 10 amplification (one `claude --input-format stream-json` subprocess forks MCP helpers + node shims + hook fires — most of which inherit a matching cwd and pass the allowlist). Preserves AGNT-03 (externally-launched agents) because the top-level parent of an externally-spawned `claude` CLI is typically a shell/PID 1, not another matching candidate.
  - Rejected alternatives: "only register self-registered PIDs" (breaks AGNT-03), "tighten allowlist to exact names" (brittle; node-shim detection was added in commit b000de8 specifically because exact-name matching misses npm-installed CLIs), "track AITC-launched PIDs only" (does nothing for externally-launched floods), "just raise MAX_AGENTS" (already done as the hotfix — not a real fix).

### Subprocess-Child Filter Mechanism

- **D-02:** **Parent-PID in-list filter — check `candidate.parent ∈ candidate_pids` inside `bridge_tick`, after cwd-scope, before upsert.** `CandidateProc.parent: Option<u32>` is already populated by `ProcessSnapshot::refresh` (line 178 of `process_snapshot.rs`) so no new data collection is needed in the snapshot layer. Implementation shape: build `let candidate_pids: HashSet<u32> = in_scope.iter().map(|c| c.pid).collect()` once per tick; for each candidate, if `c.parent.map_or(false, |pp| candidate_pids.contains(&pp))`, skip.
  - Rationale: O(n) over candidates, no new syscalls, deterministic for tests via `from_candidates_for_test`. Stays compatible with the existing `reap_passive_agents` step (the dropped subprocess children never had a registry entry to reap).
  - Subtle edge case handled by the spec: if both parent AND child match the allowlist and the parent is filtered out (e.g., by cwd-scope), the child becomes promoted to a top-level candidate in the same tick. That's the correct behavior — a process rooted outside the watched repo spawning a child inside it is still an agent in this airspace.
  - Rejected alternatives: "tighten command-line match to exact binary name" (conflicts with the `node`/`python` shim handling from b000de8), "track AITC-launched PIDs + descendants in a bookkeeping set" (complex cross-task state, no win over parent-in-list).

### MAX_AGENTS Ceiling

- **D-03:** **Keep `MAX_AGENTS = 1000` (hotfix value). Update the doc comment to explain *why* 1000, not just the history.** Once D-01/D-02 land, a developer running 3 concurrent agent launches + 5 externally-detected sessions fills ~8 passive entries. 1000 is 100x headroom — cheap in HashMap, eliminates the cap as a realistic failure mode without paying the complexity cost of making it configurable.
  - Not configurable in v1: no use case yet, and settings surface is the wrong place to absorb what should always be an emergency-only ceiling.
  - Rejected alternatives: "revert to 100 now that scoping is fixed" (re-introduces the risk the moment a new subprocess family appears — cheap headroom is free insurance), "raise further to 5000" (overkill; hides real leaks).

### Capacity-Hit Observability

- **D-04:** **Keep the existing `capacity_hit` coalesced tick-level log warning + add a read-only `get_registry_stats` Tauri command** returning `RegistryStats { total_agents, passive_count, kagent_count, launched_count, capacity_hits_since_start }`. `capacity_hits_since_start` is a new `AtomicU64` field on `AgentRegistry`, incremented inside `upsert_agent`'s "at capacity" error branch. No event emission, no UI work in Phase 18 — pure backend diagnostic surface.
  - Rationale: the existing log warning is sufficient for "something is wrong *right now*"; the stats command is for "was something wrong during this session?" (the question you want to answer when debugging after the fact). Matches the diagnostic-surface pattern already used by pipeline commands (Phase 2/6).
  - Claude's Discretion: whether to also include a lightweight `peak_passive_count` gauge if implementation ends up free. Planner decides.

### Test Strategy

- **D-05:** **Unit tests covering parent-PID filter + a regression test reproducing the original flood scenario** (parent + N subprocess children with the same agent-name token → exactly 1 `PASSIVE-{pid}` registered, no `Registry at capacity` errors). Both tests use `ProcessSnapshot::from_candidates_for_test` so no real process spawning is needed in CI. Skip a full "spawn real claude --stream-json and assert no subprocess PASSIVE entries" integration test for this phase — Phase 10's end-to-end chat smoke test already exercises the live path, and adding a second real-CLI-spawning test doubles flaky-CI surface area for marginal extra confidence.
  - Rationale: the fix lives entirely inside `bridge_tick`, which is already the unit-test boundary Phase 6/8 hardened. Deterministic tests catch 100% of the scoping logic; the Phase 10 e2e catches live regressions.
  - Claude's Discretion: whether to also add a unit test for `get_registry_stats` (likely yes — trivial — but planner decides).

### Claude's Discretion

- Exact struct shape of `RegistryStats` (serde/specta derives, camelCase rename, whether to include `peak_passive_count` / `adapter_breakdown`). Planner picks.
- Whether to refactor `bridge_tick` into `compute_in_scope_candidates` + `upsert_candidates` helpers to keep the unit tests tight. Cosmetic — planner's call.
- Whether to move the `capacity_hits_since_start` counter onto `AgentRegistry` or keep it purely inside `passive_bridge` (scope of the counter). Trade-off: on-registry = counts ALL upsert failures (launched agents too); on-bridge = counts only passive upserts. Recommended to put it on the registry since the hotfix comment already says "Registry at capacity" is a registry-level concern, but either works.
- Whether to also log the *name* of the top-most new PASSIVE entry when reporting `capacity_hits_since_start` so the log line is "capacity hit, last 3 candidates would have been claude, codex, opencode" instead of an anonymous count. Nice-to-have, not required.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Code Being Changed

- `src-tauri/src/pipeline/passive_bridge.rs` — `bridge_tick` is where D-01/D-02 lands. Already contains the cwd-scope filter from commit d3573dc and the coalesced capacity-hit log from commit 62612b3. Existing tests in `mod tests` demonstrate the `from_candidates_for_test` pattern new tests should follow.
- `src-tauri/src/pipeline/process_snapshot.rs` — `CandidateProc { parent: Option<u32> }` is the data source for the new filter (already populated at line 178). `AGENT_NAME_ALLOWLIST` and the three-tier name/argv/exe match (lines 124–148) STAY AS-IS. `from_candidates_for_test` (line 234) is the seam used by passive_bridge unit tests.
- `src-tauri/src/agents/registry.rs` — `MAX_AGENTS = 1000` (D-03: update doc comment; do not change value). Likely home for the new `capacity_hits_since_start: AtomicU64` and `RegistryStats { ... }` struct behind `get_registry_stats`. Uses tokio `RwLock`; atomic counter avoids needing an additional write-lock acquisition on the error path.

### Code NOT to Change (load-bearing; touch at your peril)

- `src-tauri/src/agents/self_register.rs` — the `/register` → `KAGENT-{pid}` path is NOT the bleeder. Leave untouched. Only relevant insofar as `find_agent_by_pid` is shared — the filter in D-02 acts before upsert so KAGENT-owned PIDs remain shielded.
- `src-tauri/src/pipeline/commands.rs` §`start_watch` — `spawn_passive_bridge` call site is fine as-is.
- `src-tauri/src/pipeline/pipeline_state.rs` §`ActiveWatch::bridge_task` — lifecycle wiring is correct; no change needed.

### Phase Context (decisions Phase 18 builds on)

- `.planning/phases/03-agent-management-conflict-detection/03-CONTEXT.md` §D-05, §D-06 — hybrid passive-scan + HTTP self-register baseline. Phase 18 preserves both paths; only tightens the passive path.
- `.planning/phases/06-pipeline-activation-integration-wiring/06-CONTEXT.md` §D-06, §D-07 — "passively-detected PIDs appear as unidentified agents", "merge into KAGENT on self-register". Both invariants must still hold after Phase 18.
- `.planning/phases/10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s/10-CONTEXT.md` §D-06, §D-11 — long-lived `claude --input-format stream-json` subprocess + per-session MCP server on self_register axum host. Reading this explains *why* the flood appeared when Phase 10 shipped (4 concurrent chattable sessions × ~dozen short-lived helper subprocesses each).

### Roadmap / Requirements

- `.planning/ROADMAP.md` §"Phase 18" — phase description is the problem statement verbatim ("Scope passive registration to only processes that actually matter: PIDs that self-registered via /register, or PIDs whose cwd is inside the active watched repo AND command-line matches a narrow AITC-compatible shape, or a hybrid where noisy subprocess children do not get their own registry entry (only the parent claude/codex does). Also raise MAX_AGENTS ceiling as a safety net.")
- `.planning/REQUIREMENTS.md` §AGNT-03 — "System detects and attaches to externally-launched agent processes already running on the codebase." The filter must not break this — a standalone externally-launched `claude` still gets a PASSIVE entry under D-01/D-02.

### Relevant Hotfix Commits

- `62612b3` — "fix(agents): raise AgentRegistry cap 100→1000 pending Phase 18" (Phase 18 formalizes this)
- `d3573dc` — "fix(passive): scope registry upserts to the monitored repo" (Phase 18 builds on this)
- `b000de8` — "fix(process-snapshot): detect agents running via node/python shims" (explains why D-02 uses parent-PID instead of narrowing the name match)
- `4ac13f0` — "fix(passive): classify detected processes via registered adapters" (explains `find_adapter_for_process` inside `bridge_tick` — unchanged by Phase 18)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `CandidateProc.parent: Option<u32>` — already populated by `ProcessSnapshot::refresh` at line 178. No snapshot-layer change needed for D-02.
- `ProcessSnapshot::from_candidates_for_test(candidates: Vec<CandidateProc>)` — public test seam (line 234). Tests seed deterministic candidate lists including `parent` values for every test case.
- `AgentRegistry::find_agent_by_pid` — already does O(n) full-map scan; fine at MAX_AGENTS=1000. Useful for the existing KAGENT-ownership check in `bridge_tick` (stays as-is).
- `bridge_tick`'s existing coalesced warning pattern (`capacity_hit` counter + single `tracing::warn!` per tick) — Phase 18 extends this by also accumulating into the registry's `capacity_hits_since_start` atomic.

### Established Patterns

- Pipeline tasks are `JoinHandle<()>` stored on `ActiveWatch` and aborted on `stop_watch` via `Drop` — Phase 18 doesn't change lifecycle, only the logic inside one existing task.
- Tauri commands use `#[tauri::command] #[specta::specta]` and are registered in `lib.rs`. New `get_registry_stats` follows the `get_agent`/`all_agents` shape in `agents/commands.rs`.
- `AtomicU64::fetch_add(1, Ordering::Relaxed)` is the existing idiom for counters on shared structs (see `pipeline_state.rs` batch/dropped counters).
- Unit tests live in `mod tests` blocks inside the same file as the SUT; passive_bridge tests already demonstrate the `seeded_snapshot(vec![cand(pid, name)])` helper.

### Integration Points

- `bridge_tick` signature stays stable — callers (`spawn_passive_bridge`, test harness) don't change.
- `AgentRegistry::new` stays a no-arg constructor (the atomic initializes to 0) — lib.rs managed-state injection unchanged.
- New `get_registry_stats` command registered alongside existing `get_agent`/`all_agents` via `tauri-specta` — auto-generates the TS binding, so a future diagnostics UI consumes it type-safely.

</code_context>

<specifics>
## Specific Ideas

- The parent-PID filter elegantly handles Phase 10's specific amplification pattern: `claude --input-format stream-json` (parent matches "claude", cwd=repo) forks MCP helpers (parent PID = claude's PID, cwd inherited, argv contains "claude-mcp-helper" or similar so the allowlist hits). With D-02, the helpers are dropped because their `parent` is already in the candidate set. Top-level `claude` still registers.
- Externally-launched agent case (AGNT-03): `claude` spawned from a user terminal has parent = bash/fish PID, which is NOT in the candidate list. D-02 does NOT drop it — AGNT-03 stays green.
- Test fixture idea: a single test `parent_in_candidate_list_drops_subprocess_children` with a list like `[cand_parent(100, "claude", parent=None), cand_child(101, "claude-mcp", parent=Some(100)), cand_child(102, "node-claude-helper", parent=Some(100))]` — assert only `PASSIVE-100` registered.
- `capacity_hits_since_start` is monotonic across the process lifetime (not per-watch) because the counter lives on `AgentRegistry`, which outlives `ActiveWatch`. That is the right semantic: "have we ever hit the ceiling in this AITC session?"
- Doc comment wording for `MAX_AGENTS = 1000`: cite commit 62612b3 and Phase 18 D-03, explain *why not configurable* (emergency-only ceiling, never the intended constraint), explain *why not 100* (insufficient headroom once multiple concurrent Phase 10 sessions run).

</specifics>

<deferred>
## Deferred Ideas

- **Diagnostics UI page surfacing `get_registry_stats`.** Phase 18 ships the backend command; a visible Plugin/Skill/Tool Manager-adjacent page is Phase 9's territory or a future minor phase. Capture the stats endpoint in Phase 18's IPC so Phase 9 can trivially display it.
- **User-configurable `MAX_AGENTS` in app settings.** No evidence anyone will want this. Revisit if a user ever hits 1000.
- **Peak-passive gauge for historical max tracking.** Potentially free to add; explicitly Claude's Discretion in D-04 rather than a locked decision.
- **Evicting oldest PASSIVE at capacity (LRU instead of reject).** Tempting but risky — churn during active conflict detection could lose live attributions. Defer until/unless capacity hits become common again.
- **Adapter-level registration gating (let each adapter return `is_eligible_for_passive_scan(&CandidateProc) -> bool`).** Cleaner but over-engineered for a fix that can be one filter in one tick. Revisit only if a third adapter-specific filter rule shows up.

</deferred>

---

*Phase: 18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma*
*Context gathered: 2026-04-21*
*Mode: --auto (recommended defaults selected across all five gray areas)*
