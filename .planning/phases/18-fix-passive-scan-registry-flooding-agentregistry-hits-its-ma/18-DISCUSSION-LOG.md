# Phase 18: Fix Passive-Scan Registry Flooding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma
**Mode:** `--auto` (all gray areas auto-selected with recommended defaults; no interactive user input)
**Areas discussed:** Registration Scope Policy, Subprocess-Child Filter Mechanism, MAX_AGENTS Ceiling, Capacity-Hit Observability, Test Strategy

---

## Registration Scope Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Only self-registered PIDs | Drop passive scan entirely; require `/register` handshake before registry entry. Simplest, most restrictive. | |
| cwd-in-repo + narrow command-line match | Keep cwd-prefix filter (already landed d3573dc) and tighten `AGENT_NAME_ALLOWLIST` to exact binary names. | |
| Hybrid — cwd scope + parent-PID exclusion of subprocess children | Keep existing cwd filter; add filter dropping candidates whose parent PID is itself in the candidate list. Only top-of-tree agent processes get PASSIVE entries. | ✓ |
| Just raise MAX_AGENTS further | Cap is already 1000 after hotfix. Raising more is not a real fix. | |

**Auto-selection rationale:** Addresses Phase 10's subprocess amplification directly (MCP helpers + node shims + hook sidecar fires inherit cwd and match the allowlist, but all share the `claude` parent PID). Preserves AGNT-03 (externally-launched agents have non-matching shell parents). Matches the "hybrid — noisy subprocess children do not get their own registry entry" option the roadmap description called out as preferred.

**Notes:** Rejected "tighten allowlist to exact names" because commit b000de8 ("detect agents running via node/python shims") specifically loosened matching to catch npm-installed CLIs; reverting would regress externally-launched agent detection. Rejected "only self-registered" because it kills AGNT-03 entirely for users who haven't opted into AITC hooks.

---

## Subprocess-Child Filter Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Parent-PID in-list filter | Inside `bridge_tick`, build `candidate_pids: HashSet<u32>`; drop candidates whose `parent ∈ candidate_pids`. | ✓ |
| Narrower command-line allowlist | Require exact binary name match; reject argv-substring hits. | |
| AITC-launched PID descendant tracking | Track all PIDs AITC spawned (plus their descendants) and reject them. | |
| Combined parent-PID + narrower allowlist | Belt-and-suspenders of both mechanisms. | |

**Auto-selection rationale:** `CandidateProc.parent: Option<u32>` is already populated by `ProcessSnapshot::refresh` (line 178 of `process_snapshot.rs`). No new data collection needed. O(n) cost per tick. Deterministic in tests via `from_candidates_for_test`. Doesn't conflict with the node/python shim detection from commit b000de8.

**Notes:** Edge case — if parent matches allowlist but is filtered out by cwd-scope, the child is promoted to top-level in the same tick. This is correct behavior: a process rooted outside the watched repo spawning a child inside it is still an in-airspace agent.

---

## MAX_AGENTS Ceiling

| Option | Description | Selected |
|--------|-------------|----------|
| Keep at 1000 (hotfix value) | Formalize the 100→1000 hotfix as the intentional safety net. Update doc comment to explain *why*. | ✓ |
| Raise further to 5000 | Extra headroom. | |
| Make configurable via app settings | User-facing knob. | |
| Revert to 100 after scoping lands | Tight cap relying on scoping alone. | |

**Auto-selection rationale:** Once D-01/D-02 scoping lands, a power user with 3 launched + 5 externally-detected agents fills ~8 passive entries. 1000 is 100x headroom in HashMap — effectively free. Reverting to 100 re-introduces flood risk the moment a new subprocess family appears. Configuration surface is premature (no evidence anyone wants to tune this).

**Notes:** Doc comment wording should cite commit 62612b3, Phase 18 D-03, and explain that the ceiling is emergency-only, not the intended constraint.

---

## Capacity-Hit Observability

| Option | Description | Selected |
|--------|-------------|----------|
| Tick-level log warning + read-only `get_registry_stats` Tauri command | Keep existing coalesced warning; add diagnostic command returning counts + `capacity_hits_since_start` atomic. | ✓ |
| Log warning only (status quo) | No structured diagnostic surface. | |
| Log + Tauri event emission | Push events to frontend on every capacity hit. | |
| Log + auto-evict oldest PASSIVE | LRU on capacity. | |

**Auto-selection rationale:** The existing log warning answers "something is wrong right now"; the stats command answers "was something wrong during this session?" — the debugging question you want after the fact. Matches the diagnostic-surface pattern used by pipeline commands (Phase 2/6). Event emission is noisy. LRU eviction risks losing live attributions during conflicts.

**Notes:** `capacity_hits_since_start: AtomicU64` lives on `AgentRegistry` so it outlives per-watch `ActiveWatch` lifecycles — correct semantic is "have we ever hit the ceiling in this AITC session?". Peak-passive gauge is Claude's Discretion.

---

## Test Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Unit tests (parent+children seeded snapshot) + regression test for original flood | Deterministic coverage of the new filter + prove flood doesn't recur. | ✓ |
| Add full integration test spawning real `claude --stream-json` and asserting no subprocess PASSIVE | Live-CLI coverage. | |
| Unit tests only | Minimum viable coverage. | |
| Skip tests (hotfix was untested) | No new tests. | |

**Auto-selection rationale:** Fix lives entirely inside `bridge_tick`, which is already the unit-test boundary hardened by Phases 6/8. `from_candidates_for_test` gives deterministic coverage of all filter branches. Phase 10's existing e2e chat smoke test already exercises the live path — adding a second real-CLI test doubles flaky-CI surface for marginal confidence.

**Notes:** Fixture idea — `parent_in_candidate_list_drops_subprocess_children`: `[cand_parent(100, "claude", parent=None), cand_child(101, "claude-mcp", parent=Some(100)), cand_child(102, "node-claude-helper", parent=Some(100))]` → assert only `PASSIVE-100` registered. Whether to add a test for `get_registry_stats` is Claude's Discretion.

---

## Claude's Discretion

- Exact `RegistryStats` struct shape (whether to include `peak_passive_count`, `adapter_breakdown`).
- Whether to refactor `bridge_tick` into helper functions for test ergonomics.
- Whether `capacity_hits_since_start` lives on registry (counts all upsert failures) or passive_bridge (counts only passive upserts) — registry recommended.
- Whether to include last-N candidate names in the capacity-hit log line.
- Whether to add a unit test for `get_registry_stats` (trivially yes, but planner decides).

## Deferred Ideas

- Diagnostics UI page surfacing `get_registry_stats` (Phase 9 territory or later minor phase).
- User-configurable `MAX_AGENTS` setting.
- Peak-passive gauge for historical max tracking.
- LRU-style passive eviction at capacity.
- Adapter-level `is_eligible_for_passive_scan()` predicate.
