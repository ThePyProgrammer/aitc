# Phase 18: Fix Passive-Scan Registry Flooding - Research

**Researched:** 2026-04-21
**Domain:** Rust backend — process-table filtering, Tauri command surface, AtomicU64 observability
**Confidence:** HIGH (all claims verified against the source tree; locked decisions constrain the research, not the reverse)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Hybrid scope — keep cwd-in-repo filter (commit `d3573dc`), layer parent-PID exclusion on top. Only the top-of-tree agent process in a parent/child chain inside the candidate list gets a `PASSIVE-{pid}` entry.
- **D-02:** Parent-PID in-list filter inside `bridge_tick`, applied **after** cwd-scope and **before** upsert. Build `candidate_pids: HashSet<u32>` once per tick; drop candidates whose `parent` PID ∈ `candidate_pids`.
- **D-03:** Keep `MAX_AGENTS = 1000` (hotfix value from commit `62612b3`). Update the doc comment to explain *why* 1000 (not 100, not configurable) rather than just the history. Not configurable in v1.
- **D-04:** Keep the existing coalesced tick-level `capacity_hit` log warning. **Add** a read-only `get_registry_stats` Tauri command returning `RegistryStats { total_agents, passive_count, kagent_count, launched_count, capacity_hits_since_start }`. Increment `capacity_hits_since_start: AtomicU64` on `AgentRegistry` inside `upsert_agent`'s at-capacity branch. No Tauri event emission; no UI in Phase 18.
- **D-05:** Unit tests for the parent-PID filter (parent+children seeded snapshot) + regression test reproducing the original flood scenario. Both use `ProcessSnapshot::from_candidates_for_test`. Skip any real-`claude`-CLI integration test.

### Claude's Discretion

- Exact struct shape of `RegistryStats` (serde/specta derives, camelCase rename, whether to also include `peak_passive_count` or an `adapter_breakdown`). Planner picks.
- Whether to refactor `bridge_tick` into `compute_in_scope_candidates` + `upsert_candidates` helpers for test ergonomics. Cosmetic — planner's call.
- Whether `capacity_hits_since_start` lives on `AgentRegistry` (recommended — counts ALL upsert failures, including launched agents) or scoped to `passive_bridge` (counts passive-only). Either works; trade-off documented below.
- Whether the capacity-hit log line should include the last N candidate names (e.g., "capacity hit, last 3 candidates would have been claude, codex, opencode") for richer debugging. Nice-to-have.
- Whether to add a unit test for `get_registry_stats`. Trivially yes; planner decides.

### Deferred Ideas (OUT OF SCOPE)

- Diagnostics UI page surfacing `get_registry_stats` — Phase 9 territory or a future minor phase.
- User-configurable `MAX_AGENTS` in app settings.
- Peak-passive gauge for historical max tracking.
- LRU-style passive eviction at capacity.
- Adapter-level `is_eligible_for_passive_scan(&CandidateProc) -> bool` predicate.
- Any change to `/register` → `KAGENT-{pid}` semantics.
- Any change to `AGENT_NAME_ALLOWLIST` or the three-tier name/argv/exe match in `ProcessSnapshot::refresh`.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AGNT-03 | System detects and attaches to externally-launched agent processes already running on the codebase. | The parent-PID filter in D-02 preserves this: externally-launched `claude` processes have parent = shell/PID-1, which is NOT in the candidate list (shells are not allowlisted). The top-level externally-launched process therefore still passes the filter and receives a `PASSIVE-{pid}` entry, exactly as before Phase 18. The `AGENT_NAME_ALLOWLIST` three-tier match (name/argv/exe basename) is untouched, so node/python-shim CLI detection from commit `b000de8` still fires. |

This is a **preservation-class requirement** — the phase must not regress AGNT-03. It does not define new behaviour.

</phase_requirements>

## Summary

Phase 18 is a **surgical backend fix, not a feature**. The bleeding point is one function (`bridge_tick` in `src-tauri/src/pipeline/passive_bridge.rs`); the fix is one additional filter (parent-PID ∈ candidate-set → drop) plus one diagnostic Tauri command (`get_registry_stats`) and one doc-comment refresh on the `MAX_AGENTS = 1000` constant.

All the load-bearing infrastructure already exists:
- `CandidateProc.parent: Option<u32>` is populated by `ProcessSnapshot::refresh` via `sysinfo 0.38`'s `proc.parent()` method ([VERIFIED: `src-tauri/src/pipeline/process_snapshot.rs:178`]).
- The cwd-scope filter (commit `d3573dc`, lines 99–105 of `passive_bridge.rs`) already builds the `in_scope: Vec<CandidateProc>` that the new parent-PID filter attaches to.
- The coalesced capacity-hit log pattern at `passive_bridge.rs:160–162, 223–228` is the template for accumulating `capacity_hits_since_start` onto the registry atomic.
- Tauri command registration pattern for `get_registry_stats` is a copy-paste of `list_agents` in `src-tauri/src/agents/commands.rs:23–29` + adding an entry to the `collect_commands![...]` macro in `src-tauri/src/lib.rs:42–97`.

**Primary recommendation:** Land the filter as a 4-line addition inside `bridge_tick` after the cwd-scope filter (no helper-function refactor needed for correctness — it's Claude's Discretion and the planner can decide based on test-readability taste); add `capacity_hits_since_start: AtomicU64` and `RegistryStats` + `get_registry_stats` in `registry.rs` + `agents/commands.rs` following the existing `get_agent`/`all_agents` shape; write two unit tests + one regression test per D-05; register the command in `lib.rs`. No structural changes to `passive_bridge` callers, `ActiveWatch` wiring, `/register` flow, or frontend code.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Parent-PID filtering of passive-scan candidates | Rust backend — `pipeline/passive_bridge` | — | Process-table logic belongs in the bridge tick; it's the same layer that already runs the cwd-scope filter. No frontend/IPC surface. |
| Raising `MAX_AGENTS` ceiling + doc comment | Rust backend — `agents/registry` | — | Registry cap is a registry concern. Pure constant update + rustdoc rewrite. |
| `capacity_hits_since_start` counter | Rust backend — `agents/registry` (atomic field on `AgentRegistry`) | Rust backend — `agents/commands` (reader via `get_registry_stats`) | Counter lives where `upsert_agent`'s error branch fires so no extra lock contention. Outlives `ActiveWatch` lifecycles — correct semantic for "this AITC session". |
| `get_registry_stats` Tauri command | Rust backend — `agents/commands` + `lib.rs` registration | Frontend — auto-generated via `tauri-specta` (consumer deferred to a future UI phase) | Follows the existing `list_agents`/`get_agent` shape. Specta auto-emits the TS binding; no frontend work in Phase 18. |
| Deterministic tests | Rust backend — `mod tests` inside `passive_bridge.rs` and `registry.rs` | — | `from_candidates_for_test` already in place; no integration-test surface needed. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `sysinfo` | `0.38` (already vendored — [VERIFIED: `src-tauri/Cargo.toml`]) | Process table walk; `proc.parent()` populates `CandidateProc.parent`. | Already in use; `Process::parent()` returns `Option<Pid>` and is populated without requiring an additional `ProcessRefreshKind::with_parent()` flag. [CITED: https://docs.rs/sysinfo/latest/sysinfo/struct.ProcessRefreshKind.html, https://docs.rs/sysinfo/latest/sysinfo/struct.Process.html]. On Windows the PPID is static for the process lifetime (it's captured at process creation and never reassigned); on Linux/macOS it follows POSIX — a child whose parent exits is reparented to PID 1 (`init`/`launchd`). |
| `tokio` | `^1.0` (already vendored) | Async runtime; `RwLock` on `AgentRegistry.agents` and bridge task. | Unchanged — Phase 18 uses existing primitives. |
| `std::sync::atomic::AtomicU64` | std | `capacity_hits_since_start` counter without write-lock acquisition on the error path. | Matches existing counter idiom in `src-tauri/src/pipeline/watcher.rs:113,296` and `src-tauri/src/conflict/types.rs:40`. [VERIFIED: repo grep for `AtomicU64 \| fetch_add`.] |
| `serde` + `specta` | `^1.0` / `^2.0` (already vendored) | Serialize `RegistryStats` struct + export TS binding. | Standard Tauri v2 + tauri-specta idiom. The `#[derive(Serialize, specta::Type)]` + `#[serde(rename_all = "camelCase")]` pattern is used on e.g. `ProcessInfo` at `src-tauri/src/pipeline/process_snapshot.rs:42–50`. |
| `tauri-specta` | `^2.0` (already vendored) | Type-safe IPC — auto-generates the TS binding for `get_registry_stats` into `src/bindings.ts`. | Existing project convention; zero-config from the planner's side once the command is added to `collect_commands![...]` and the type is registered with `.typ::<...>()` at `src-tauri/src/lib.rs:98–135`. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tracing` | `^0.1` | Structured warn-level log for `capacity_hit` tick-level coalesced message. | Already in use at `passive_bridge.rs:224`; Phase 18 preserves it. |
| `std::collections::HashSet` | std | Build `candidate_pids` once per tick for the parent-PID filter. | New allocation, scoped to one tick; O(n) size; no hand-rolled linear search. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `HashSet<u32>` for `candidate_pids` | `Vec<u32> + .contains()` | Linear search per candidate — O(n²) total. With up to hundreds of candidates on a Phase 10 session pile-up, HashSet's O(1) lookup is the right default. |
| `AtomicU64` on `AgentRegistry` | `Mutex<u64>` on registry | Write-lock on every upsert failure adds contention in exactly the window we're debugging. Atomic `fetch_add(1, Relaxed)` has the right semantics and is already the project idiom. |
| Refactor `bridge_tick` into helpers | Inline filter | Cosmetic — only worth it if test readability suffers. Four-line inline addition after the `in_scope` `Vec` is the smallest diff. Planner's call per Claude's Discretion. |
| Scope `capacity_hits_since_start` to `passive_bridge` only | Scope to `AgentRegistry` | Registry-level counter also captures launched-agent upsert failures (which would be a different bug — launched agents hitting a cap means something is very wrong). Centralising it on the registry aligns with where the error message lives (`registry.rs:77`). Recommended. |

**Installation:** No new crates. All dependencies are already vendored.

**Version verification:**
- `sysinfo = "0.38"` — confirmed in `src-tauri/Cargo.toml` [VERIFIED]. Latest published is `0.38.x`; no upgrade needed.
- No other crate version changes are required for Phase 18.

## Architecture Patterns

### System Architecture Diagram (scoped to Phase 18 surface)

```
┌──────────────────────────┐     2s tick      ┌────────────────────────────┐
│ ProcessSnapshot refresher│────────────────▶ │ RwLock<ProcessSnapshot>    │
│ (sysinfo::refresh)       │                  │  candidates: HashMap<PID,  │
│                          │                  │    CandidateProc {         │
│                          │                  │      pid, name, cwd,       │
│                          │                  │      exe, parent ←───┐     │
│                          │                  │    }>                │     │
└──────────────────────────┘                  └──────────┬───────────┘     │
                                                         │                 │
                                  2s tick                │                 │
                                                         ▼                 │
                                             ┌──────────────────────────┐  │
                                             │ passive_bridge::         │  │
                                             │   bridge_tick            │  │
                                             │                          │  │
                                             │   (A) snap.candidates()  │──┘
                                             │   (B) cwd-scope filter   │
                                             │       (commit d3573dc)   │
                                             │   (C) ★ NEW: build       │
                                             │       candidate_pids     │
                                             │       HashSet            │
                                             │   (D) ★ NEW: drop if     │
                                             │       parent ∈           │
                                             │       candidate_pids     │
                                             │   (E) reap stale         │
                                             │   (F) upsert each        │
                                             │       remaining          │
                                             └──────────┬───────────────┘
                                                        │
                                                        ▼
                                             ┌─────────────────────────┐
                                             │ AgentRegistry           │
                                             │   agents: RwLock<HashMap│
                                             │     <String,            │
                                             │      ManagedAgent>>     │
                                             │   ★ NEW: capacity_hits_ │
                                             │     since_start:        │
                                             │     AtomicU64           │
                                             └──────────┬──────────────┘
                                                        │ read-only
                                                        ▼
                              ┌──────────────────────────────────────────┐
                              │ ★ NEW: get_registry_stats Tauri command  │
                              │   RegistryStats {                        │
                              │     total_agents, passive_count,         │
                              │     kagent_count, launched_count,        │
                              │     capacity_hits_since_start,           │
                              │   }                                      │
                              └──────────┬───────────────────────────────┘
                                         │ tauri-specta auto-binding
                                         ▼
                              src/bindings.ts (auto-generated TS)
                              [no UI consumer in Phase 18 — Phase 9 territory]
```

★ denotes Phase-18 additions. Boxes without ★ are existing, unchanged code. Data flow is tick-driven: refresher → snapshot → bridge_tick → registry.

### Recommended Project Structure

No new modules. All changes land in:

```
src-tauri/src/
├── agents/
│   ├── commands.rs      # add get_registry_stats command
│   └── registry.rs      # add RegistryStats struct + capacity_hits_since_start + getter
├── pipeline/
│   └── passive_bridge.rs # add parent-PID filter + 3 new tests
└── lib.rs               # register get_registry_stats in collect_commands![] + .typ::<RegistryStats>()
```

Frontend:
- `src/bindings.ts` — regenerated by `tauri-specta` in debug builds (no hand edit).

### Pattern 1: HashSet-Driven Parent-PID Filter

**What:** Build a `HashSet<u32>` of all in-scope candidate PIDs once per tick; filter out candidates whose `parent` is in the set.

**When to use:** Right here, in `bridge_tick`, between the cwd-scope step and the reap/upsert loop.

**Example:**
```rust
// Source: new, matches the pattern at src-tauri/src/pipeline/passive_bridge.rs:107-110
// where `live_pids: HashSet<u32>` is already built per tick.
let candidate_pids: std::collections::HashSet<u32> =
    in_scope.iter().map(|c| c.pid).collect();
let in_scope: Vec<_> = in_scope
    .into_iter()
    .filter(|c| match c.parent {
        Some(pp) => !candidate_pids.contains(&pp),
        None => true, // no parent known (orphaned / PID-1 child) -> keep
    })
    .collect();
```

Note: the `live_pids` HashSet that follows this step (used by `reap_passive_agents`) must still be built from the **final** filtered `in_scope` — dropping subprocess children means those PIDs should not count as "live" for reap purposes either (they never had a PASSIVE entry to reap, so this is a no-op, but it keeps semantics tight).

### Pattern 2: AtomicU64 Counter on Shared Struct

**What:** Relaxed-ordering atomic counter that lives on `AgentRegistry`, incremented on the at-capacity error path in `upsert_agent`.

**When to use:** Any monotonic counter shared across async tasks where strict ordering is not required.

**Example:**
```rust
// Source: matches pattern at src-tauri/src/pipeline/watcher.rs:138
//   dropped_clone.fetch_add(1, Ordering::Relaxed);

// In registry.rs (new field):
use std::sync::atomic::{AtomicU64, Ordering};
pub struct AgentRegistry {
    agents: RwLock<HashMap<String, ManagedAgent>>,
    adapters: Vec<Arc<dyn AgentAdapter>>,
    capacity_hits_since_start: AtomicU64, // NEW
}

// In upsert_agent, at capacity branch (registry.rs:76-80):
if agents.len() >= MAX_AGENTS {
    self.capacity_hits_since_start.fetch_add(1, Ordering::Relaxed);
    return Err(format!(
        "Registry at capacity ({MAX_AGENTS}). Cannot add agent '{id}'"
    ));
}
```

### Pattern 3: Tauri Command + Specta Registration

**What:** Zero-overhead read-only Tauri command following the `list_agents` shape.

**When to use:** Any new read-only query command on registered state.

**Example:**
```rust
// Source: mirrors src-tauri/src/agents/commands.rs:23-29

#[tauri::command]
#[specta::specta]
pub async fn get_registry_stats(
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<RegistryStats, String> {
    Ok(registry.snapshot_stats().await)
}
```

`snapshot_stats` is a new method on `AgentRegistry` that reads the agents map once under a read lock, counts by ID-prefix, and loads the atomic. Single read-lock acquisition keeps the snapshot internally consistent.

Registration in `lib.rs`:
```rust
// Add to collect_commands![...] at lib.rs:42
agents::commands::get_registry_stats,

// Add to type exports at lib.rs:98
.typ::<agents::registry::RegistryStats>()
```

### Anti-Patterns to Avoid

- **Don't acquire the registry write-lock to increment `capacity_hits_since_start`.** That defeats the point — the at-capacity branch is already holding the write-lock (`registry.rs:68`), but the atomic is fine to increment there and also lets the counter be read from `snapshot_stats` without contending. The atomic is preferred over a `u64` guarded by the existing lock because a future change that factors the at-capacity check OUT of the write-lock (e.g., into a fast-path check before locking) will still work.
- **Don't duplicate the filter in `spawn_passive_bridge`.** The filter belongs inside `bridge_tick`, where the existing tests can drive it directly via `from_candidates_for_test`. Moving it to the spawn site makes it untestable.
- **Don't regress the "no-cwd-root" fallback path.** The cwd-scope filter at `passive_bridge.rs:101–105` keeps a candidate when `repo_root` is `None` (headless/test harness). The new parent-PID filter should NOT add an implicit cwd-requirement — a candidate with `parent = None` in a seeded test must still pass.
- **Don't emit Tauri events on capacity hits.** Explicitly deferred in CONTEXT.md. Event emission is noisy, and the stats endpoint is the authoritative diagnostic surface.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parent PID retrieval on Windows | Custom `GetProcessInformation` / `NtQueryInformationProcess` FFI | `sysinfo::Process::parent()` — already in use | `sysinfo 0.38` handles cross-platform PPID reads, including Windows PEB/WoW64 quirks. PPID is static on Windows so no refresh flag needed. |
| Descendant-tree tracking | `tokio::sync::Mutex<HashSet<u32>>` of "AITC-descended PIDs" updated across every launch | Parent-in-candidate-list check in one tick | Explicit tree tracking is cross-task state that must be reconciled at agent termination and across crashes. The parent-in-list check is stateless — it rederives the answer from the snapshot every tick. |
| Structured capacity observability | Hand-rolled ring buffer of "last N capacity events" | Single `AtomicU64` counter | A single monotonic counter answers the only question we have ("was the ceiling hit in this session?"). A ring buffer solves a richer problem we don't have yet. |
| Frontend-side TS type for `RegistryStats` | Hand-written `interface RegistryStats { ... }` in TypeScript | `tauri-specta` auto-generation via `.typ::<RegistryStats>()` | Project convention; drift-free; already wired in `lib.rs:98–135`. |

**Key insight:** Every "tempting" alternative in this phase trades simpler-to-explain for less-maintainable. The parent-in-list filter is a 4-line addition that the existing test seam exercises deterministically; any richer scheme (descendant sets, adapter-level predicates, LRU eviction) is at least 10x more code and breaks invariants Phase 6 hardened.

## Runtime State Inventory

> This phase is a backend code change. There is no rename, no migration, no reconfiguration of external services, no new stored state. The inventory below is included for completeness per the GSD contract.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `capacity_hits_since_start` is process-local `AtomicU64`, not persisted. No DB schema changes. `MAX_AGENTS` is a compile-time constant, not stored anywhere. | None |
| Live service config | None — no external service config (n8n, Datadog, Tailscale, Cloudflare) references `MAX_AGENTS` or `PASSIVE-{pid}` shape. The `AITC_PORT` / `~/.aitc/port` file carries the self-register port only. `settings.local.json` holds Phase 8 consent state, untouched here. | None |
| OS-registered state | None — AITC does not register tasks in Windows Task Scheduler or launchd on behalf of itself. Spawned agents (claude/codex) are children of the AITC process, which is the exact reason Phase 10 amplified the flood. No OS-registered state needs re-registering. | None |
| Secrets / env vars | None — `AITC_SIDECAR_PATH`, `AITC_PORT`, `RUST_LOG` are unchanged. `MAX_AGENTS` is not env-driven. | None |
| Build artifacts / installed packages | None — the Rust crate is recompiled on every `cargo build`. The frontend `src/bindings.ts` is regenerated by `tauri-specta` in debug builds (on `cargo build` + Tauri-dev run). No `.egg-info`, no `dist/`, no globally-installed CLI with the old state. | None — `cargo build` + `npm run build` (for bindings consumers) refreshes everything. |

**Canonical question:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?* — Answer: nothing. Phase 18 touches compile-time state only. Restart AITC, done.

## Common Pitfalls

### Pitfall 1: Parent PID reuse across process lifetime

**What goes wrong:** A candidate's `parent` field carries a PID that has since been recycled by the OS to a different, unrelated process — and that unrelated process happens to be in `candidate_pids`. The child is erroneously dropped.

**Why it happens:** On Linux and macOS, PIDs wrap around `pid_max` (commonly 4,194,304 on modern Linux); on Windows, PIDs are multiples of 4 and can reuse after process death. Between the moment a parent exits and the moment the child's next `bridge_tick` runs, the old parent's PID could theoretically be reassigned.

**How to avoid:** This is a non-issue in practice for AITC's scope. Reasons:
1. Reuse requires the same exact PID value to be assigned to another allowlisted (claude/codex/opencode/node) process within a 2-second window. The birthday-collision probability is effectively zero.
2. Even in the pathological case, the failure mode is "top-level agent incorrectly dropped for one tick" — next tick, when the recycled PID is refreshed, the snapshot rebuilds `candidate_pids` from scratch. There's no persistent state to poison.
3. sysinfo refreshes the entire process table each tick, so a dead parent PID disappears from the candidate set immediately.

**Warning signs:** If a developer reports "my agent disappears from Tower Control for a moment and comes back" while heavy PID churn happens, revisit. No mitigation needed for Phase 18.

### Pitfall 2: `sysinfo::Process::parent()` returning stale data on Windows

**What goes wrong:** On Windows, PPID is captured at process creation and never updated ([CITED: sysinfo issue tracker — "on Windows the parent process ID never changes"]). If AITC's model of the process tree depends on live PPID changes (it doesn't), there would be a bug.

**Why it happens:** Windows doesn't track PPID dynamically; POSIX does (orphans reparent to PID 1). sysinfo respects the native behaviour.

**How to avoid:** No action needed — the parent-in-list filter checks "was this process *spawned* by one of our current candidates?", which is exactly the semantic sysinfo's `parent()` gives on all three platforms. The only Windows-specific concern (stale PPID after original parent dies) is handled by the fact that when the parent dies, it disappears from `candidate_pids` too — so the child is no longer filtered out on subsequent ticks.

**Warning signs:** None expected. If on Windows an agent is observed dropping from Tower Control after its parent dies but before the next snapshot refresh, that is consistent — it'll re-appear in ≤ 2 s.

### Pitfall 3: Orphaned subprocess children crossing tick boundaries

**What goes wrong:** Between ticks, the parent `claude` process exits (user Ctrl-C'd) but the MCP helper subprocess is slow to reap. On the next tick: parent is gone from the snapshot, helper's `parent` is now a stale PID pointing at a dead process (or re-parented to PID 1 on POSIX). Helper gets promoted to a top-level candidate and registers as `PASSIVE-{helper_pid}`.

**Why it happens:** POSIX re-parenting. On Linux, orphaned children re-parent to `init` (PID 1) which is never in `candidate_pids`, so the filter doesn't catch them.

**How to avoid:** This is actually the **correct** behaviour: a process rooted outside the watched repo set that happens to be inside the repo cwd IS an agent in this airspace. CONTEXT.md D-02 explicitly calls this out as desired behaviour, not a bug. The only countermeasure needed is the existing `reap_passive_agents` step, which will drop the stale entry on the next tick after the helper itself exits.

**Warning signs:** Transient `PASSIVE-{pid}` entries that self-reap within 2-4 seconds of a parent `claude` termination. Expected; do not treat as a leak.

### Pitfall 4: Parent filtered by cwd-scope, child legitimately promoted

**What goes wrong:** An agent rooted in `/unrelated/repo` spawns a helper that `chdir`s into `/watched/repo`. Per cwd-scope, the parent is dropped (its cwd isn't inside `repo_root`); per parent-PID filter, the child's parent-PID is still in `candidate_pids` if the parent *itself* was in the full candidate list — which it isn't after filtering.

**Why it happens:** This is the "both parent and child match the allowlist, but parent is out-of-scope" edge case.

**How to avoid:** The filter order in D-02 is explicit: **cwd-scope first, then parent-PID exclusion**. This means `candidate_pids` is built from `in_scope` (post-cwd-filter), not from the raw snapshot. If a parent is filtered out by cwd-scope, it never enters `candidate_pids`, and the child is not dropped by the parent-PID filter. The child becomes the top-level in-scope candidate and gets a PASSIVE entry. CONTEXT.md §D-02 explicitly notes this is the correct behaviour.

**Warning signs:** None — this is the designed semantic.

### Pitfall 5: PID-32-bit / u32 collision in `candidate_pids`

**What goes wrong:** `HashSet<u32>` — what if a PID exceeds `u32::MAX`?

**Why it happens:** It doesn't. Linux `pid_max` is ≤ 4,194,304 (22 bits); Windows PIDs are 32-bit; macOS PIDs are `pid_t` (32-bit signed, positive range). `CandidateProc.pid: u32` is the existing type, set at `process_snapshot.rs:56`. No action.

**Warning signs:** None.

### Pitfall 6: Test seeding — `parent: None` default

**What goes wrong:** Existing tests in `passive_bridge.rs` use the helper `fn cand(pid, name)` which sets `parent: None` (`passive_bridge.rs:244`). New tests that exercise the parent-PID filter must explicitly construct `CandidateProc` with `parent: Some(parent_pid)` or add a second helper `cand_with_parent(pid, name, parent_pid)`.

**Why it happens:** The existing helper is intentionally minimal. It's used by 6+ tests that don't care about parenting.

**How to avoid:** Don't modify the existing `cand` — add a sibling helper `cand_child(pid, name, parent_pid)` to keep old tests readable. Recommended planner decision.

### Pitfall 7: `snapshot_stats` race with concurrent upserts

**What goes wrong:** `get_registry_stats` reads `agents` under a read lock, then loads `capacity_hits_since_start`. Between those two reads, a concurrent `upsert_agent` could fail and increment the atomic, producing a "from the future" count relative to the agent counts. Or an agent is added/removed between the two reads.

**Why it happens:** The read lock on the map and the atomic load are separate operations. This is a classic stats-endpoint inconsistency.

**How to avoid:** For a diagnostic surface, "eventually consistent" is fine — the counts are counts, not a transactional snapshot. Load the atomic BEFORE the map read so the worst case is `capacity_hits_since_start` is smaller than it should be relative to the map state (reader sees a "slightly old" counter). This matches what every Linux `/proc` reader accepts. If the planner wants strict consistency, hold the write lock while reading both — strictly unnecessary and adds contention.

**Warning signs:** If Phase 9 (future UI) displays jittery `capacity_hits_since_start` that briefly goes backward across refreshes, THAT would be a bug. A monotonic counter that briefly lags reality is fine.

### Pitfall 8: `_` underscore in nested module name confusing the allowlist

**What goes wrong:** The allowlist substring check (`raw_name.contains(**a)`) matches `"claude"` in `claude-code`, `claude`, `claude-mcp-helper`, and any `node-*-claude` shim. This is intentional per commit `b000de8` for node/python-shim detection. The parent-PID filter does NOT tighten this match — it reduces REGISTRATION, not DETECTION.

**Why it happens:** Researcher tempted to "also narrow the allowlist". That regresses AGNT-03 for npm-installed CLIs.

**How to avoid:** Leave `AGENT_NAME_ALLOWLIST` and the three-tier match alone. CONTEXT.md explicitly scopes this out.

**Warning signs:** None — just don't touch `process_snapshot.rs:118–148`.

## Code Examples

### Example 1: Parent-PID filter drop-in for `bridge_tick`

```rust
// Source: new, to land at src-tauri/src/pipeline/passive_bridge.rs after line 105
// (current in_scope: Vec<_> = candidates.into_iter().filter(cwd-scope).collect())

// Phase 18 D-02: drop subprocess children whose parent is itself an in-scope
// allowlisted candidate. Prevents Phase 10's MCP-helper / node-shim / aitc-hook
// amplification from flooding PASSIVE-{pid} entries under each top-level agent.
// Filter order matters: cwd-scope BEFORE this step so a parent filtered out by
// cwd does not keep its child in-filter (see Pitfall 4 / CONTEXT.md D-02).
let candidate_pids: std::collections::HashSet<u32> =
    in_scope.iter().map(|c| c.pid).collect();
let in_scope: Vec<_> = in_scope
    .into_iter()
    .filter(|c| match c.parent {
        Some(pp) => !candidate_pids.contains(&pp),
        None => true,
    })
    .collect();
```

### Example 2: `RegistryStats` + getter on `AgentRegistry`

```rust
// Source: new additions to src-tauri/src/agents/registry.rs
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RegistryStats {
    pub total_agents: u32,
    pub passive_count: u32,
    pub kagent_count: u32,
    pub launched_count: u32,
    pub capacity_hits_since_start: u64,
}

impl AgentRegistry {
    pub async fn snapshot_stats(&self) -> RegistryStats {
        // Load the atomic first so any concurrent upsert failure it races with
        // is reflected in the next call, not this one. Monotonic, slightly
        // lagging counter is fine for a diagnostic surface (see Pitfall 7).
        let capacity_hits_since_start =
            self.capacity_hits_since_start.load(Ordering::Relaxed);
        let agents = self.agents.read().await;
        let total_agents = agents.len() as u32;
        let mut passive_count = 0u32;
        let mut kagent_count = 0u32;
        let mut launched_count = 0u32;
        for (id, managed) in agents.iter() {
            if id.starts_with("PASSIVE-") { passive_count += 1; }
            else if id.starts_with("KAGENT-") { kagent_count += 1; }
            if managed.launched_by_aitc { launched_count += 1; }
        }
        RegistryStats {
            total_agents, passive_count, kagent_count, launched_count,
            capacity_hits_since_start,
        }
    }
}
```

Note: `kagent_count` + `passive_count` may not equal `total_agents` if a future ID scheme is added; `launched_count` is orthogonal (launched agents have `KAGENT-` IDs and `launched_by_aitc = true`, so they appear in both the kagent count and the launched count). This is by design — the counts answer different questions.

### Example 3: Tauri command

```rust
// Source: new addition to src-tauri/src/agents/commands.rs, after list_agents.
// Mirrors the shape of list_agents at line 23-29.

/// Read-only diagnostic: snapshot of the agent registry counts + lifetime
/// capacity-hit counter. Safe to call at any cadence; single read-lock
/// acquisition. Intended for post-hoc debugging of "why did KAGENT launch
/// fail with 'Registry at capacity'" questions.
#[tauri::command]
#[specta::specta]
pub async fn get_registry_stats(
    registry: tauri::State<'_, Arc<AgentRegistry>>,
) -> Result<crate::agents::registry::RegistryStats, String> {
    Ok(registry.snapshot_stats().await)
}
```

### Example 4: Registration in `lib.rs`

```rust
// Source: additions to src-tauri/src/lib.rs

// Line 42 area — add to collect_commands![...]:
agents::commands::get_registry_stats,

// Line 98 area — add to type exports:
.typ::<agents::registry::RegistryStats>()
```

### Example 5: Updated `MAX_AGENTS` doc comment (D-03)

```rust
// Source: replacement for src-tauri/src/agents/registry.rs:12-20 doc comment.

/// Maximum number of agents the registry will accept.
///
/// **Why 1000 and not configurable:** this is an emergency ceiling, not the
/// intended operating constraint. Phase 18's D-01/D-02 scoping (cwd-in-repo
/// + parent-PID-in-list filter inside `passive_bridge::bridge_tick`) is the
/// real capacity control. Under normal operation a developer with three
/// concurrent AITC launches plus five externally-detected standalone agents
/// fills roughly eight entries — two orders of magnitude below the cap.
///
/// **Why not 100:** that was the original Phase 3 value (T-03-03) set when
/// passive detection was young. Phase 10's long-lived stream-json sessions
/// each fork MCP helpers + node shims + hook sidecar fires; without
/// subprocess-child filtering the 100 cap filled within seconds (commit
/// 62612b3 raised it to 1000 as a hotfix pending Phase 18).
///
/// **Why not exposed to users:** no use case has emerged; the settings
/// surface is the wrong place to absorb what should always be an
/// emergency-only ceiling. If a user ever legitimately hits 1000, revisit
/// the scoping policy, not the constant.
///
/// See `capacity_hits_since_start` below for runtime observability of how
/// often this cap is actually approached.
const MAX_AGENTS: usize = 1000;
```

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust built-in `#[test]` / `#[tokio::test]` inside `mod tests` blocks |
| Config file | `src-tauri/Cargo.toml` (no separate test harness) |
| Quick run command | `cd src-tauri && cargo test --lib pipeline::passive_bridge::tests -- --nocapture` |
| Full suite command | `cd src-tauri && cargo test --lib` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-02 (parent in list) | Parent + two subprocess children with same allowlisted name → only PASSIVE-{parent} registered | unit | `cargo test --lib pipeline::passive_bridge::tests::parent_in_candidate_list_drops_subprocess_children -- --nocapture` | new test in `passive_bridge.rs` |
| D-02 (orphaned child) | Child with `parent = None` → registered (not dropped) | unit | `cargo test --lib pipeline::passive_bridge::tests::orphaned_child_with_no_parent_registers -- --nocapture` | new test in `passive_bridge.rs` |
| D-02 (child of out-of-scope parent) | Parent out-of-scope by cwd, child in-scope → child promoted, PASSIVE-{child} registered (not dropped) | unit | `cargo test --lib pipeline::passive_bridge::tests::child_of_cwd_filtered_parent_is_promoted -- --nocapture` | new test in `passive_bridge.rs` |
| D-01/D-02 (flood regression) | 1 parent + 50 subprocess children with claude-name → exactly 1 PASSIVE entry, zero capacity errors | regression | `cargo test --lib pipeline::passive_bridge::tests::flood_regression_parent_plus_many_children -- --nocapture` | new test in `passive_bridge.rs` |
| D-03 (MAX_AGENTS=1000) | Inserting 1000 unique agents succeeds; the 1001st returns capacity error and increments the counter | unit | `cargo test --lib agents::registry::tests::capacity_hit_increments_counter -- --nocapture` | new test in `registry.rs` |
| D-04 (get_registry_stats) | After seeding 2 KAGENT + 3 PASSIVE + 1 capacity-hit, stats struct fields match | unit | `cargo test --lib agents::registry::tests::snapshot_stats_counts_by_prefix_and_atomic -- --nocapture` | new test in `registry.rs` (Claude's Discretion per D-05) |
| AGNT-03 (preservation) | Externally-launched claude (parent = some non-candidate PID like 1) still registers | unit | `cargo test --lib pipeline::passive_bridge::tests::externally_launched_with_shell_parent_still_registers -- --nocapture` | new test in `passive_bridge.rs` |

### Sampling Rate

- **Per task commit:** `cargo test --lib pipeline::passive_bridge::tests agents::registry::tests -- --nocapture` (roughly 10 tests, < 2 s total; bounded by `from_candidates_for_test` — no real process spawning).
- **Per wave merge:** `cargo test --lib` (full backend suite — typically 5–15 s; covers no cross-phase regressions in registry/self_register/launcher paths).
- **Phase gate:** Full `cargo test --lib` green + `npm run build` (specta binding regen confirms no IPC type drift) before `/gsd-verify-work`.

### Wave 0 Gaps

None — the existing test infrastructure fully covers the phase.

- Test framework is already present in every file we're touching.
- `ProcessSnapshot::from_candidates_for_test` exists at `process_snapshot.rs:234` and is the exact seam new tests need.
- The `seeded_snapshot(vec![cand(...)])` + `bridge_tick(&reg, &snap, None, None, None).await.unwrap()` pattern at `passive_bridge.rs:252–263` is the template.
- No new test fixture files needed; no framework install required.

The only optional addition is a second test helper (`cand_with_parent(pid, name, parent_pid)` or `cand_child(pid, name, parent_pid)`) to keep parent-carrying fixtures readable. This is Claude's Discretion / planner territory.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `cargo` / Rust toolchain | Compile backend | ✓ (project baseline) | project-pinned (rust-toolchain.toml if present, else stable) | — |
| `sysinfo` crate | Parent PID population | ✓ (vendored) | `0.38` | — |
| `tauri-specta` | TS binding generation | ✓ (vendored) | `^2.0` | — |
| `tokio` | Async bridge task + `#[tokio::test]` | ✓ (vendored) | `^1.0` | — |
| Node.js / `npm` | `npm run build` to regenerate `src/bindings.ts` consumers | ✓ (project baseline) | project-pinned | Not strictly needed for Phase 18 since no frontend consumer lands; the binding file is emitted on `cargo build` in debug mode and the TS file is valid even with no importer. |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

Phase 18 can be fully implemented, tested, and shipped with zero environmental changes.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — `get_registry_stats` is a local Tauri IPC command; Tauri's command surface is inherently local-only (no network exposure). |
| V3 Session Management | no | N/A |
| V4 Access Control | no | Same as V2 — the Tauri command surface is not network-reachable. |
| V5 Input Validation | yes (minimal) | `get_registry_stats` takes no parameters. Nothing to validate. The parent-PID filter operates on snapshot data produced inside the same process; trust boundary is the sysinfo refresh. |
| V6 Cryptography | no | N/A |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unbounded registry growth (T-03-03, original throttle) | DoS (Denial of Service) | `MAX_AGENTS` cap; Phase 18's scoping (D-01/D-02) is the primary fix, not the cap. |
| Registry diagnostic leaking PID info to untrusted caller | Information Disclosure | Not applicable — Tauri IPC commands run inside the desktop app's main process; no remote caller can invoke them. |
| Lock-contention DoS from diagnostic polling | DoS | `snapshot_stats` uses a read lock + atomic load only; does not contend with upsert path. High-frequency polling from a future UI is safe. |
| Counter overflow (`capacity_hits_since_start`) | Data Corruption | Using `AtomicU64::fetch_add(1, Relaxed)`; overflow would require 2^64 capacity hits in one session (≈ 580 years at one hit per nanosecond). Not a real failure mode. |

No new attack surface. The threat model is unchanged from Phase 3 (T-03-03 registry cap + T-03-04 /register PID validation + T-03-05 adapter allowlist on launch).

## State of the Art

No "state of the art" changes relevant to this phase. The fix applies well-established idioms:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `MAX_AGENTS = 100` | `MAX_AGENTS = 1000` | hotfix commit `62612b3` (2026-04-21, pre-phase) | Already in tree; Phase 18 formalises. |
| Bridge upserts all allowlisted machine-wide processes | Bridge upserts only cwd-in-repo candidates | commit `d3573dc` (2026-04-21, pre-phase) | Already in tree; Phase 18 extends. |
| Bridge promotes every in-scope candidate | Bridge drops subprocess children of in-scope candidates | Phase 18 (this phase) | Parent-in-list filter. |

**Deprecated/outdated:** None. The three-tier name/argv/exe allowlist match from commit `b000de8` remains the right solution for the "node-shim detection" subproblem it was added to solve.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | sysinfo 0.38 populates `parent()` on all three target platforms (Windows, macOS, Linux) without needing an explicit `ProcessRefreshKind` flag. | Standard Stack, Common Pitfalls #2 | LOW — behaviour verified in practice by existing `process_snapshot.rs:178` usage, and sysinfo docs confirm. If wrong on some platform, `parent = None` just disables the filter for that candidate (safe default — candidate is kept). |
| A2 | Under typical use (3 concurrent AITC launches + 5 externally-detected agents), `~8` registry entries is representative. | D-03 rationale | LOW — this is a rough calibration for "why 1000 headroom is generous". If real-world usage runs 2× higher, the 1000 ceiling is still 60× headroom. |
| A3 | 4-line inline filter addition does not significantly hurt readability of `bridge_tick`. | "Example 1" + Claude's Discretion | LOW — purely aesthetic. Planner can choose to refactor into helpers for test ergonomics; doesn't change correctness. |
| A4 | `kagent_count + passive_count ≈ total_agents` is a reasonable invariant for current ID schemes. | "Example 2" / RegistryStats | LOW — other ID prefixes are not currently in use. Future ID schemes would require updating `snapshot_stats`. The struct documents this as a design decision. |
| A5 | The diagnostic `get_registry_stats` endpoint has no meaningful security exposure given Tauri IPC is local-only. | Security Domain | LOW — standard Tauri threat model; Tauri commands are not network-reachable. |

All five assumptions are LOW risk. None require user confirmation before execution — they are either verified properties of the existing codebase, conservative calibrations, or standard Tauri facts.

## Open Questions

1. **Whether to refactor `bridge_tick` into `compute_in_scope_candidates(snapshot, repo_root) -> Vec<CandidateProc>` + `upsert_candidates(registry, candidates, pool, app)`.**
   - What we know: CONTEXT.md explicitly lists this as Claude's Discretion. Existing tests at `passive_bridge.rs:252–425` already cover the current monolithic function.
   - What's unclear: whether the new tests would read more cleanly if they called a pure filter function instead of driving `bridge_tick` end-to-end.
   - Recommendation: do the refactor **only if** a test for the parent-PID filter needs to assert the post-filter candidate list *without* also exercising the upsert and reap paths. If the existing "assert PASSIVE entries exist" style remains readable, keep `bridge_tick` monolithic. Favouring the status quo by default — the existing tests are clear and the helper extraction is scope-creep.

2. **Whether `capacity_hits_since_start` should live on `AgentRegistry` or `passive_bridge`.**
   - What we know: CONTEXT.md Claude's Discretion recommends registry. Registry-level captures ALL upsert failures including launched agents (which is actually useful — if a `launch_agent` ever hits the cap, we want to know).
   - What's unclear: whether the bridge-level counter would ever show a different number than the registry-level counter. Probably not in practice (launched-agent upserts failing means something is deeply wrong).
   - Recommendation: put it on `AgentRegistry`. It aligns with the error-message source (`registry.rs:77`) and captures the full picture.

3. **Whether to add `peak_passive_count` / `peak_total_count` gauges.**
   - What we know: CONTEXT.md Claude's Discretion in D-04 calls this out as optional.
   - What's unclear: whether "peak seen this session" adds diagnostic value over "hit capacity N times".
   - Recommendation: skip for Phase 18. The counter answers the specific question we have. A gauge can be added in a future minor phase if requested.

4. **Whether to add `adapter_breakdown: HashMap<String, u32>` to `RegistryStats`.**
   - What we know: Phase 10's flood was claude-specific; being able to see "90 entries are claude-code, 10 are unknown" would have debugged it faster.
   - What's unclear: whether this is premature elaboration for a backend-only diagnostic.
   - Recommendation: skip for Phase 18. Easy to add later if the basic counts prove insufficient. Default to minimal struct shape.

5. **Whether to add a "last-seen PASSIVE candidate that was skipped by the parent filter" log line to aid future debugging.**
   - What we know: CONTEXT.md notes this as a nice-to-have.
   - What's unclear: tracing volume — if a tick drops 50 children, a per-child DEBUG log is fine but a per-child WARN is noisy.
   - Recommendation: if added, do it at `tracing::debug!` level with the counts, not `warn`. Planner's call.

## File Impact Map

**Files to MODIFY:**

| File | Reason | Approx Change |
|------|--------|---------------|
| `src-tauri/src/pipeline/passive_bridge.rs` | Add parent-PID filter after cwd-scope filter (inside `bridge_tick`); add 4 new `#[tokio::test]` blocks at bottom of `mod tests`. | +30 lines body, +120 lines tests |
| `src-tauri/src/agents/registry.rs` | Add `capacity_hits_since_start: AtomicU64` field; increment in `upsert_agent`'s at-capacity branch; add `RegistryStats` struct + `snapshot_stats()` method; update `MAX_AGENTS` doc comment per D-03; add 2 `#[tokio::test]` blocks. | +60 lines body, +80 lines tests, ~12 lines of doc-comment rewrite |
| `src-tauri/src/agents/commands.rs` | Add `get_registry_stats` command. | +15 lines |
| `src-tauri/src/lib.rs` | Register `get_registry_stats` in `collect_commands![...]`; register `RegistryStats` via `.typ::<...>()`. | +2 lines |

**Files to CREATE:** None.

**Files that will AUTO-REGENERATE:**

| File | By What |
|------|---------|
| `src/bindings.ts` | `tauri-specta` emits on `cargo build` in debug mode (existing wiring in `src-tauri/src/lib.rs:137–145`). |

**Files NOT to touch (per CONTEXT.md canonical_refs):**

- `src-tauri/src/agents/self_register.rs` — `/register` → `KAGENT-{pid}` path is not the bleeder.
- `src-tauri/src/pipeline/commands.rs` — `spawn_passive_bridge` call site is fine.
- `src-tauri/src/pipeline/pipeline_state.rs` — `ActiveWatch::bridge_task` lifecycle is correct.
- `src-tauri/src/pipeline/process_snapshot.rs` — `AGENT_NAME_ALLOWLIST` and three-tier match stay as-is; `CandidateProc.parent` already populated.
- `src-tauri/src/agents/claude_code.rs` — Phase 10 long-lived stream-json launch is the amplification source but not the fix site.

## Project Constraints (from CLAUDE.md)

- **Tech stack**: Tauri v2 + React + TypeScript + Rust backend with tokio, sqlx, sysinfo, tauri-specta. All of this is already in use; Phase 18 adds no new stack components.
- **Agent integration**: Must be extensible — adapter pattern. Phase 18 does not touch the adapter trait; preserves it.
- **Performance**: File watchers must handle large codebases without excessive CPU/memory. The parent-PID filter adds O(n) HashSet build + O(n) parent lookup per tick, both trivially below any performance budget. The existing 2 s `BRIDGE_INTERVAL_MS` cadence is preserved.
- **GSD Workflow Enforcement**: Edits must go through a GSD command. This research phase sets up the planner; the planner will produce task-level plans that the executor runs under `/gsd-execute-phase`.
- **Commit after every change**: User feedback preference — the planner should scope tasks so each logical change (filter, counter, stats command, doc comment, tests) can commit independently.
- **Only fix own bugs**: User feedback preference — the fix is self-contained; no adjacent-phase bug touching needed. If the executor notices something odd in self_register.rs or claude_code.rs during implementation, diagnose in the task log but do NOT edit.

## Sources

### Primary (HIGH confidence)

- Repo source tree — read directly:
  - `src-tauri/src/pipeline/passive_bridge.rs` (SUT)
  - `src-tauri/src/pipeline/process_snapshot.rs` (CandidateProc.parent source)
  - `src-tauri/src/agents/registry.rs` (MAX_AGENTS, upsert_agent)
  - `src-tauri/src/agents/self_register.rs` (KAGENT path; untouched)
  - `src-tauri/src/agents/commands.rs` (Tauri command pattern template)
  - `src-tauri/src/lib.rs` (command registration template)
  - `src-tauri/src/pipeline/pipeline_state.rs` (ActiveWatch wiring)
  - `src-tauri/Cargo.toml` (sysinfo 0.38 version pin)
- CONTEXT.md (locked decisions D-01..D-05)
- DISCUSSION-LOG.md (rejected alternatives, audit trail)
- Prior phase contexts (03, 06, 10) — load-bearing invariants around passive-scan and subprocess amplification
- `.planning/REQUIREMENTS.md` (AGNT-03 text)
- `.planning/ROADMAP.md` (Phase 18 description verbatim)

### Secondary (MEDIUM confidence)

- [sysinfo crate docs](https://docs.rs/sysinfo/latest/sysinfo/) — `Process::parent()` returns `Option<Pid>`; PPID is static on Windows, POSIX-normal on Linux/macOS.
- [sysinfo ProcessRefreshKind docs](https://docs.rs/sysinfo/latest/sysinfo/struct.ProcessRefreshKind.html) — confirms no `with_parent()` flag needed.
- [sysinfo crate — crates.io](https://crates.io/crates/sysinfo) — version verification.
- [sysinfo CHANGELOG](https://github.com/GuillaumeGomez/sysinfo/blob/main/CHANGELOG.md) — WoW64 parent refresh fix; no regressions in 0.38.x relevant to our use.

### Tertiary (LOW confidence)

None. Every load-bearing claim in this research is either verified directly against the source tree or cited from the official sysinfo docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already vendored and in active use; no upgrade needed.
- Architecture: HIGH — fix lives entirely inside one function with a well-established test seam.
- Pitfalls: HIGH — all edge cases traced to concrete line numbers in the existing code; PPID-reuse and Windows-static-PPID verified against sysinfo docs.
- Test strategy: HIGH — `from_candidates_for_test` is already the unit-test boundary Phases 6 and 8 used successfully.

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days — backend is stable; sysinfo releases every ~2 months; no impending breaking changes on the horizon)

## RESEARCH COMPLETE

**Phase:** 18 — Fix passive-scan registry flooding
**Confidence:** HIGH

### Key Findings

- The fix is a 4-line parent-PID filter added inside `bridge_tick` (`src-tauri/src/pipeline/passive_bridge.rs`) between the existing cwd-scope filter and the reap/upsert loop. All data needed (`CandidateProc.parent: Option<u32>`) is already populated by `ProcessSnapshot::refresh` via `sysinfo 0.38`.
- AGNT-03 preservation is structural: externally-launched agents have a shell/PID-1 parent that is never in the allowlisted candidate set, so the filter never drops them.
- `capacity_hits_since_start: AtomicU64` belongs on `AgentRegistry` (not `passive_bridge`) so it captures all upsert failures, not just passive. Monotonic across the AITC process lifetime.
- `get_registry_stats` Tauri command follows the existing `list_agents` shape exactly — new command + `.typ::<RegistryStats>()` registration in `lib.rs`, auto-emitted TS binding, no frontend consumer in Phase 18.
- All tests are deterministic via `ProcessSnapshot::from_candidates_for_test`; no real-CLI spawning is needed. The regression test (1 parent + 50 children → 1 PASSIVE entry) bounds the flood scenario concretely.

### File Created

`/home/prannayag/pragnition/htx/aitc/.planning/phases/18-fix-passive-scan-registry-flooding-agentregistry-hits-its-ma/18-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All crates vendored; sysinfo 0.38 parent() semantics verified against official docs. |
| Architecture | HIGH | Fix lives in one function; existing tests use the same test seam new tests will use. |
| Pitfalls | HIGH | All edge cases (PID reuse, Windows static PPID, orphans, cwd-filtered parents) traced to concrete code lines and CONTEXT.md decisions. |
| Test strategy | HIGH | Deterministic unit/regression tests inside existing `mod tests`; no framework changes. |

### Open Questions

Five Claude's-Discretion items captured in "Open Questions" — all cosmetic/diagnostic choices. None block planning. Defaults recommended:
1. Keep `bridge_tick` monolithic (no helper refactor).
2. Counter on `AgentRegistry` (not `passive_bridge`).
3. Skip `peak_passive_count` gauge for Phase 18.
4. Skip `adapter_breakdown` in `RegistryStats`.
5. Skip per-dropped-candidate log lines (or put behind `tracing::debug!` if added).

### Ready for Planning

Research complete. Planner can now produce PLAN.md files. The fix naturally decomposes into ~5 commit-scoped tasks per the user's "commit per change" preference:
1. Registry: `MAX_AGENTS` doc-comment rewrite + `capacity_hits_since_start` atomic + `RegistryStats` struct + `snapshot_stats` method + registry tests.
2. Bridge: parent-PID filter + 4 new unit/regression tests.
3. Commands: `get_registry_stats` Tauri command.
4. lib.rs: command + type registration.
5. (Optional) Binding verification — `npm run build` or equivalent to confirm `src/bindings.ts` regen is drift-free.
