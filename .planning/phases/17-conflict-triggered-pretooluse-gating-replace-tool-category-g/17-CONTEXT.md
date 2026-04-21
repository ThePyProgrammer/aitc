# Phase 17: Conflict-triggered PreToolUse gating — Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Gathered via:** `/gsd-discuss-phase 17 --auto` (recommended-default selection for every gray area; see `17-DISCUSSION-LOG.md` for full audit trail)

<domain>
## Phase Boundary

Swap the PreToolUse gating predicate from **tool-category** (gate every `Edit`/`Write`/`NotebookEdit`/`Bash`) to **file conflict** (gate only when another active agent is currently touching the same file path). Every Claude Code hook that would today create an approval row must, in v1 of this phase, pass through instantly unless the `ConflictEngine`'s active-file index already lists another live agent on that canonical path within the existing conflict window. Protected-paths gating, the always-allow session cache, the bypass chips, and the Phase 8 long-held `/hook` transport all stay intact.

**In scope:**
- New query surface on `ConflictEngine` (`could_conflict_with(path, except_agent, now) -> Option<agent_id>`) that reuses the existing sliding-window `recent_writes` index.
- Rewrite of the gating branch in `hook_handler` (`src-tauri/src/agents/self_register.rs:270–285`) to drive off that query instead of `get_pretool_gated_tools`.
- New `src-tauri/src/agents/bash_paths.rs` — best-effort Bash command → target-path extractor + narrow read-only safelist.
- DB migration `007_conflict_gating.sql` — adds `conflict_with_agent_id` TEXT + `gate_reason` TEXT columns on `approval_requests`; default-empties `pretool_gated_tools`.
- Shared state: wrap `ConflictEngine` in `Arc<Mutex<_>>` so the pipeline task and the axum handler share one instance; inject via axum `Extension` + Tauri `State`.
- Approval-card UI renders the conflicting agent ID and the trigger reason ("file conflict" vs "protected path").
- Tests: two-agent integration, single-agent instant-allow, Bash-parser unit tests, safelist tests, protected-path still-gates test.

**Out of scope (deferred):**
- Gating Reads against a currently-written file (read-vs-write conflicts).
- Import-graph / module-cluster conflict scope (needs Phase 16 Louvain output).
- Compiler/build-output inference (`cargo build` → `target/`, `npm install` → `node_modules/`).
- Predictive conflict avoidance (agents announce intent before writing).
- Cross-worktree / cross-repo conflict tracking.
- New conflict-resolution UI beyond the existing approval card.

</domain>

<decisions>
## Implementation Decisions

### Conflict scope and semantics
- **D-01:** "Same file" = **canonical path only** (no directory-widening, no module-cluster widening). Rationale: matches the existing `ConflictEngine.recent_writes: HashMap<PathBuf, Vec<FileWriteRecord>>` key shape — no new index needed. Directory-widening produces too many false positives (unrelated siblings); module-clustering depends on Phase 16 which has not landed.
- **D-02:** Canonicalize the incoming `tool_input.file_path` with `fs::canonicalize()` when the file exists; fall back to **lexical normalization** (resolve `.`/`..`, normalize separators) when it does not (Write/NotebookEdit on a new file). **No case folding** on any platform — if a user's repo has both `Auth.rs` and `auth.rs` we treat them as distinct nodes, consistent with radar rendering. Preferred lexical helper: `path-clean` crate or a thin local helper; planner picks.
- **D-03:** Time window = **reuse the existing `ConflictState.window_ms`** (same atomic that drives CNFL-02 real-time alerts; Phase 3 D-10, default 5000ms, user-configurable). The hook query asks "any *other* live agent write to this canonical path within the last `window_ms`?". Single knob, single source of truth.
- **D-04:** **Liveness gate** — the conflicting agent must still be in `AgentRegistry` with state ≠ `Terminated`. Stale window entries from agents that already exited are ignored (the engine is allowed to have them; the query filters). Prevents "ghost conflicts" from long-dead sessions leaving residue in the sliding window.
- **D-05:** **Self-write suppression** — `could_conflict_with(path, except_agent_id, now)` skips records whose `agent_id == except_agent_id`. Mirrors the `existing.agent_id != agent_id` check already in `ConflictEngine::process_batch`. An agent's own prior writes must never gate its next tool call.

### Write-class scope
- **D-06:** Gate only **write-class tools** in v1: `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, and `Bash` (when the parser returns a target path). `Read`/`LS`/`Grep`/`Glob`/`WebFetch`/`WebSearch`/`Task`/MCP are **always pass-through**, the same as Phase 8 D-19. Read-vs-write gating is an explicit defer (users who want it can add globs to `protected_paths`).
- **D-07:** The `protected_paths` OR-branch (Phase 8 D-21) **stays**. If `tool_input.file_path` matches any `protected_paths` glob the hook gates regardless of conflict state. Keeps the "strict paths" power-user workflow intact.
- **D-08:** The always-allow session cache (Phase 8 D-22, `WaiterRegistry::is_always_allowed`) **stays and runs first**. If the `(agent_id, tool_name)` pair is cached, instant allow — no conflict query, no row. Mirrors current behavior.

### Bash path extraction
- **D-09:** New module `src-tauri/src/agents/bash_paths.rs`. Exposes `extract_target_paths(command: &str, cwd: &Path) -> BashParseResult` where `BashParseResult` is `{ Safelisted, Targets(Vec<PathBuf>), ParseFailed }`. All paths are resolved relative to `cwd` and returned absolute-but-non-canonicalized (canonicalization happens in the hook handler to share the D-02 code path with Edit/Write).
- **D-10:** **Parse-failure fallback: Allow.** When `BashParseResult::ParseFailed` fires (unknown binary, pipelines, shell functions, heredocs we don't interpret), the hook returns `Allow`. Rationale: the phase thesis is "conflict-triggered, not category-triggered"; a command we can't locate a write target in is, by definition, not a known conflict surface. `protected_paths` + `--dangerously-skip-permissions` + "always allow this session" are the escape hatches for stricter postures.
- **D-11:** **Read-only safelist** (instant allow, no parse, no conflict query). First-token match (plus git subcommand where needed):
  - Single-word: `ls`, `pwd`, `cat`, `head`, `tail`, `echo`, `wc`, `which`, `whoami`, `date`, `uname`, `env` (no args with `=`), `test`, `[`
  - `git status`, `git diff` (without `>` redirect), `git log`, `git show`, `git branch`, `git remote -v`, `git stash list`
  - `find PATH` **only when `-exec`, `-execdir`, `-delete`, `-ok` are all absent** (any of those flags → fall through to the parser)
  - Any command containing a stdout redirect (`>`, `>>`, `2>`, `&>`, `|& tee`) is **never** safelisted — always parsed, because the target of the redirect is the write.
- **D-12:** **Parser target verbs** (v1 — narrow and explicit):
  - Stdout/stderr redirects: `>`, `>>`, `2>`, `&>`, `|& tee`, plus `tee PATH` and `tee -a PATH`
  - Mutating POSIX utils with explicit path args: `cp SRC DST`, `mv SRC DST`, `rm PATH…`, `touch PATH…`, `mkdir PATH`, `patch PATH`, `sed -i … PATH`, `awk -i inplace … PATH` (last positional = path), `dd of=PATH`, `install SRC DST`
  - **Explicitly excluded from v1**: compiler/build-output inference (`cargo build` → `target/`, `rustc -o PATH`, `npm install` → `node_modules/`). Too much guesswork; revisit if it becomes a pain.
  - Strategy: first-token verb dispatch, argv split via `shell-words` or equivalent (planner picks). Commands with shell operators (`|`, `&&`, `||`, `;`) split at operators and each segment is parsed independently; any segment yielding paths contributes to the returned `Vec<PathBuf>`.
- **D-13:** Safelist + parser both emit `tracing::debug!(kind = "bash_parse", ...)` with the derived targets (or `Safelisted`/`ParseFailed`) so we can audit parser quality from logs without exposing the `command` string at info-level.

### Conflict-index data path
- **D-14:** **Extend `ConflictEngine`** — add `pub fn could_conflict_with(&self, path: &Path, except_agent_id: &str, now_ms: i64) -> Option<String>` that returns the most-recent *other* agent id whose record on `path` is still within `window`. Pure read method; no mutation, no sweep. Compares `existing.agent_id != except_agent_id` consistent with D-05.
- **D-15:** **Wrap the engine in `Arc<Mutex<ConflictEngine>>`** (`tokio::sync::Mutex` — the `/hook` handler is async and the pipeline task is async; std Mutex would work but tokio avoids awkward blocking patterns). The pipeline `conflict_task` (currently `pipeline/commands.rs:181–202`) acquires `lock().await` per batch and calls `process_batch`; the hook handler acquires `lock().await` and calls `could_conflict_with`. Localhost, low rate — contention is not a concern.
- **D-16:** Share the handle via **axum `Extension<Arc<Mutex<ConflictEngine>>>`** on the router (same pattern as `WaiterRegistry`) AND **Tauri `State<Arc<Mutex<ConflictEngine>>>`** for any future commands. Register in `lib.rs` alongside the existing `ConflictState` registration.
- **D-17:** **No new "active-files" index.** Phase 17 rides the sliding window exclusively. An agent's pending-but-unresolved /hook request does NOT preemptively claim the path. If A is hovering on a pretool_use for `foo.rs` and B hooks first for the same file, whichever one's `could_conflict_with` returns `None` first passes through. Acceptable race: pathological case; the existing file-watcher will re-converge the moment either agent actually writes. (Revisit if it surfaces in UAT.)

### Legacy gating layer
- **D-18:** **Remove tool-category gating from the `/hook` path.** The `get_pretool_gated_tools` call + `tool_gated` branch in `hook_handler` is deleted. Migration `007_conflict_gating.sql` sets `pretool_gated_tools` to `"[]"` for all existing installs (old value, typically `["Edit","MultiEdit","Write","NotebookEdit","Bash"]`, is discarded).
- **D-19:** **Keep the `pretool_gated_tools` storage + `get_pretool_gated_tools`/`set_pretool_gated_tools` helpers** in `comms/app_settings.rs` — do not delete the plumbing. Dead-but-ready code costs ~80 LOC and hands us a trivial power-user restore path ("put your tool names back in and the old gating returns" — future settings screen or a debug command). `#[allow(dead_code)]` where warnings fire; do NOT call from `/hook`.

### Approval row shape + UI
- **D-20:** Migration `007_conflict_gating.sql` adds two nullable TEXT columns to `approval_requests`: `conflict_with_agent_id` (the agent that triggered the gate, when reason = `file_conflict`) and `gate_reason` (enum: `'file_conflict' | 'protected_path' | 'unknown'`; persisted as string, not enum). Existing rows keep both NULL — they were gated under the old semantics.
- **D-21:** `create_approval_request_internal` gains two optional params (`conflict_with_agent_id: Option<&str>`, `gate_reason: Option<&str>`). Hook handler passes them based on which branch fired. Frontend `ApprovalRequest` type gains `conflictWithAgentId?: string` + `gateReason?: 'file_conflict' | 'protected_path' | 'unknown'` via the existing tauri-specta bindings pipeline.
- **D-22:** `ApprovalRequestCard.tsx` renders a **Conflict line** beneath the existing file-path line whenever `gateReason === 'file_conflict'`. Format: `⚠ CONFLICT with {agentId}` in the Command Horizon error/amber tint (reuse existing `text-error` / `bg-error` utilities — see Phase 18/19 convention). When `gateReason === 'protected_path'` render `🔒 PROTECTED path` instead (phosphor warning tint). No-conflict rows (legacy or future) render nothing extra.
- **D-23:** `dispatch_approval_notification` payload grows a `conflictAgentId?` field; notification body prefixes `⚠ CONFLICT: ` when present (else unchanged). The deep-link route (`/comms?requestId={id}`) stays identical.

### Claude's Discretion
- Exact crate for Bash argv splitting (`shell-words` is the obvious pick but planner may prefer a manual tokenizer if the crate surface is too large).
- Exact lexical-normalization helper (`path-clean` crate vs. a hand-rolled function).
- Module placement for the new `could_conflict_with` query method — could live on `ConflictEngine` directly or behind a thin `ActiveFiles` view struct; contract (D-14 signature) is locked, internal shape is not.
- Whether to introduce a `GateReason` Rust enum (with Serde) or keep it a string at the DB + IPC boundary.
- Whether the approval-card conflict line lives inside `ApprovalRequestCard` or in a new `ConflictChip` component that the card composes.
- The exact tracing key names and log levels for the Bash-parser audit trail (D-13).
- Whether to add a dev-only Tauri command to dump `ConflictEngine.recent_writes` for debugging multi-agent tests.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements
- `.planning/ROADMAP.md` §"Phase 17" — Scope one-liner ("replace tool-category gating with file-conflict gating"), dependency on Phase 8
- `.planning/REQUIREMENTS.md` — COMM-01..COMM-06 (approval workflow carries forward); CNFL-01/02/06 (file-conflict detection semantics that Phase 17 rides on)
- `.planning/PROJECT.md` §"Core Value" — "prevent destructive conflicts between concurrent agents" — the gating predicate now matches the tagline

### Phase Context (prior decisions that constrain this phase)
- `.planning/phases/03-agent-management-conflict-detection/03-CONTEXT.md` §D-10 — Default 5s conflict window, user-configurable; Phase 17 reuses exactly this window
- `.planning/phases/08-real-claude-code-hook-integration-pretooluse-approvals/08-CONTEXT.md` §D-07 (long-held HTTP), §D-11 (fail-safe deny), §D-12 (PASSIVE-{pid} auto-create), §D-19 (old allowlist — superseded), §D-21 (protected_paths OR-semantics — kept), §D-22 (always-allow cache — kept), §D-23 (bypass chips — kept)
- `.planning/phases/06-pipeline-activation-integration-wiring/06-CONTEXT.md` §D-06/D-07 — PASSIVE→KAGENT reconciliation that `resolve_or_create_agent` depends on

### Existing Backend Code
- `src-tauri/src/agents/self_register.rs:209–404` — `hook_handler`. Phase 17 rewrites the gating branch (lines ~270–285) and extends the axum router with a new `Extension<Arc<Mutex<ConflictEngine>>>` layer.
- `src-tauri/src/agents/self_register.rs:132–149` — `protected_path_matches` (keep unchanged; the OR-branch still calls it).
- `src-tauri/src/conflict/engine.rs` — `ConflictEngine`. Adds `could_conflict_with`. Share via `Arc<Mutex<_>>`.
- `src-tauri/src/conflict/types.rs` — `ConflictState.get_window_ms()` is the source of truth for D-03's window knob.
- `src-tauri/src/pipeline/commands.rs:176–202` — conflict task (owns the engine today). Must refactor to share the `Arc<Mutex<_>>` with the hook layer.
- `src-tauri/src/agents/registry.rs` — `AgentRegistry::get_agent` / `find_agent_by_pid` for the liveness gate (D-04).
- `src-tauri/src/comms/commands.rs` — `create_approval_request_internal`. Signature extension for D-21.
- `src-tauri/src/comms/app_settings.rs` — `get_pretool_gated_tools` / `set_pretool_gated_tools`. Not called from `/hook` anymore (D-18) but kept for future power-user revival (D-19).
- `src-tauri/src/db/migrations/` — Add `007_conflict_gating.sql` for D-18 + D-20.
- `src-tauri/src/lib.rs` — Register `Arc<Mutex<ConflictEngine>>` as both Tauri State and axum Extension; wire into `start_registration_server`.

### Existing Frontend Code
- `src/views/CommsHub/ApprovalRequestCard.tsx` — Add conflict/protected-path line (D-22).
- `src/stores/commsStore.ts` — Extend `ApprovalRequest` type (D-21) via regenerated tauri-specta bindings.
- `src/bindings.ts` — Auto-regenerate via `cargo build --bin aitc && timeout --preserve-status 8 ./target/debug/aitc` (this repo's canonical regen command; see Phase 18 D-03 learning).

### Existing Tests (patterns to mirror)
- `src-tauri/src/conflict/engine.rs` `mod tests` (10 tests) — Sliding-window test patterns; Phase 17 adds `could_conflict_with` coverage here.
- `src-tauri/src/agents/self_register.rs` `mod tests` — `hook_gates_edit_and_blocks_until_approved` (line 857) pivots from "tool in allowlist → gate" to "other agent on same file → gate". `hook_allows_passthrough_tools_without_row` (line 827) pivots to "no conflict, no protected path → allow regardless of tool_name". `hook_gates_protected_path_even_on_read` (line 926) stays as-is.
- `src-tauri/tests/end_to_end_smoke.rs` — Extend with a two-agent conflict-gating scenario.

### Claude Code Hook Contract (external — unchanged)
- Claude Code PreToolUse hook spec — locked in Phase 8. Wire shape `{ session_id, hook_event_name, tool_name, tool_input, ... }` stays identical. AITC's internal gating predicate is the only thing that changes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConflictEngine.recent_writes: HashMap<PathBuf, Vec<FileWriteRecord>>` — already the exact data shape the hook gate needs. The new `could_conflict_with` method is ~15 lines of read-only traversal over this map.
- `ConflictState.get_window_ms()` — atomic, cheap to read; hook handler reads once per request.
- `AgentRegistry::get_agent(&id)` — synchronous-friendly `Option<AgentInfo>` lookup for the liveness gate (D-04).
- `WaiterRegistry::is_always_allowed(agent_id, tool_name)` — fast-path session cache; runs first in the rewrite (D-08).
- `protected_path_matches(pool, file_path)` — OR-branch stays; no changes.
- `create_approval_request_internal` — extend with two optional params; all existing callers pass `None`/`None` via defaults or explicit args.
- `dispatch_approval_notification` — payload extension only; tray/focus flow unchanged.
- `ApprovalRequestCard` conditional rendering pattern (e.g. `{request.toolName && <ToolBadge …/>}`) — the D-22 conflict line follows the same pattern.
- `shell-words` crate — if already in `Cargo.toml` as a transitive dep, zero cost to use; otherwise add as a direct dep for D-12 argv splitting.

### Established Patterns
- `Arc<Mutex<_>>` for axum-Extension-shared async state — exactly what `WaiterRegistry` already does.
- Migration-per-feature in `src-tauri/src/db/migrations/` — additive `ALTER TABLE` only; Phase 17 follows the 005/006 shape.
- `#[tauri::command] #[specta::specta]` with managed State + auto-regen bindings (Phase 18 D-03 canonical regen command).
- Structured `tracing` with a `kind = "…"` key for machine-readable log filtering (already pervasive in `self_register.rs`, `passive_bridge.rs`).
- `tokio::sync::Mutex` for async-friendly locking (not `std::sync::Mutex`); see `WaiterRegistry` and `RateLimiter`.

### Integration Points
- `start_registration_server` (self_register.rs) — add the new `Extension<Arc<Mutex<ConflictEngine>>>` layer where the existing `Extension<Arc<WaiterRegistry>>` is inserted.
- `pipeline::commands::start_watch` — the `conflict_task` must accept the shared `Arc<Mutex<ConflictEngine>>` handle instead of constructing a local `ConflictEngine`. All existing behavior (emit events, dispatch notifications, push to ConflictState) stays inside the lock.
- `lib.rs` — `.manage(Arc::new(Mutex::new(ConflictEngine::new(Duration::from_millis(DEFAULT_WINDOW_MS)))))` registration; pass the same handle into `start_registration_server` and into the pipeline `start_watch` flow.
- `comms/commands.rs::create_approval_request_internal` — two new optional parameters (see D-21).
- Frontend: `bindings.ts` regen → `commsStore` picks up the new fields automatically → `ApprovalRequestCard` conditional render (D-22).

### Known Risks / Things to Verify in Planning
- **Lock granularity**: the conflict_task holds the engine lock for the duration of `process_batch`, which iterates every event in a batch. Under burst writes (notify debouncer flushes 100+ events) this could briefly starve `/hook` calls. Verify during planning — if measurable, switch `recent_writes` to a `DashMap` or split the lock per-file. Not worth pre-optimizing.
- **Process-death detection for liveness**: `AgentInfo.state` transitions to `Terminated` via a specific path (`terminate_process`, `reap_passive_agents`). Confirm that crashed agents (SIGKILL / OOM) reach `Terminated` state reliably — if not, the liveness gate false-negatives. Existing issue, not introduced by Phase 17, but worth calling out.
- **Race between `/hook` and batch processing**: the forwarder fans events out to the conflict_task *after* the `Channel.send` to the frontend. A hook for a file that's about to be written can arrive before the write event reaches the engine. Acceptable in v1 (conservative miss, not a false-positive); revisit if UAT surfaces it.

</code_context>

<specifics>
## Specific Ideas

(Preserved from the original Phase 17 pitch, augmented with `/gsd-discuss-phase 17 --auto` commentary.)

- The current implementation is a safe default that has become a usability bug — users either over-approve out of fatigue or flip the `--dangerously-skip-permissions` chip and lose all oversight. Phase 17 moves AITC from "approval firewall" to "conflict firewall", which is what the tagline has always promised.
- Phase 8 shipped the hook pipeline and gave us every primitive needed: long-held HTTP response, session binding, PID validation, passive stub auto-create, always-allow cache, protected_paths OR-semantics. Only the gating predicate needs to change — a single function's worth of code. Everything else in Phase 8 CONTEXT (D-07..D-23) carries forward unchanged.
- The escape-hatch hierarchy stays intact: (1) `--dangerously-skip-permissions` / `--accept-edits` chip bypasses the hook entirely at launch; (2) `protected_paths` still gates regardless of conflict; (3) "Don't ask again this session" per-tool cache still auto-allows; (4) the new conflict gate is the default. Users who want the old tool-category posture back can populate `pretool_gated_tools` via `set_pretool_gated_tools` — the plumbing is preserved (D-19).
- Bash parse-failure "allow" is the deliberate call-with-a-safety-net: every parse-failure emits a `tracing::debug` with the command string hash so we can audit the parser's quality from logs. If a destructive command pattern turns out to slip through frequently, we add it to D-12's verb list. "Gate on parse failure" would partially re-introduce the noise we're replacing — users would still see Bash approvals for every `make test`, `cargo check`, `npm run build` with no corresponding conflict risk.
- Reusing `ConflictState.window_ms` means zero new configuration knobs. The user tunes one setting and it governs both (a) real-time CNFL-02 alerts and (b) PreToolUse gating. Semantically coherent: the same "conflict" definition applies.
- D-17's accepted race (two agents pending on the same file) is the one place we're accepting a known gap. The pathological case is rare — two agents simultaneously hitting PreToolUse on the same file within ms of each other with nothing in the sliding window yet. The filesystem watcher will re-converge the moment either writes. If UAT shows this is a real pattern (unlikely with 5s window), we add a "pending-hook-rows claim the path" layer. Deferred rather than over-built.
- D-18's "delete the allowlist layer entirely" is semantically the right call but keeping D-19's storage helpers preserves a clean power-user revival: future settings UI can offer "strict mode" (populate the allowlist) with zero backend changes.

</specifics>

<deferred>
## Deferred Ideas

- Read-vs-write gating — gate Reads when another agent is actively writing the same file. Real failure class (stale reads on in-flight changes) but scope-exploding; power users can add globs to `protected_paths` for files they want strict on.
- Import-graph / module-cluster conflict scope (Q1 option c) — semantically correct but depends on Phase 16 Louvain output. Revisit after Phase 16 lands.
- Directory-widening conflict scope (Q1 option b) — rejected for v1; over-prompts on unrelated siblings. Could revisit as an opt-in "strict mode" toggle later.
- Predictive / intent-based conflict avoidance — agents announce "I'm about to edit X" before starting. Interesting but requires agent-side cooperation AITC can't assume.
- Cross-worktree / cross-repo conflict tracking — current pipeline is scoped to the active repo; multi-root extension is a separate phase.
- Pending-hook-row claims — the D-17 race mitigation. Add only if UAT shows the pathological case matters.
- Bash compiler/build-output inference (`cargo build` → `target/`, `npm install` → `node_modules/`, `rustc -o PATH`) — deliberately excluded from v1 parser; too much guesswork.
- Destructive-pattern highlighting on Bash previews (flagging `rm -rf /`, `sudo`, `curl | sh`) — deferred; orthogonal to gating predicate, better scoped to its own UI polish phase.
- Settings UI for `pretool_gated_tools` revival — the storage stays alive (D-19) but a UI is out of scope.
- `GateReason` typed enum across the whole stack — v1 uses a string at the DB boundary for simplicity; tighten later.
- Dev-only `dump_conflict_index` Tauri command for debugging — nice-to-have, planner can decide whether to sneak it in.

</deferred>

---

*Phase: 17-conflict-triggered-pretooluse-gating-replace-tool-category-g*
*Context gathered: 2026-04-21*
