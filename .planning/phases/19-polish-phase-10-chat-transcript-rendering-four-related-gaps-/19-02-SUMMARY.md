---
phase: 19
plan: 02
subsystem: chat-transcript-polish
tags: [wave-1, rust, aggregator, parser, stream-json, chat-runtime, coalescing, d-01, d-04, turn-buffer]
wave: 1
depends_on: [19-01]
requires:
  - phase: 19
    provides: "hook_pretool_use.jsonl fixture (V-19-21), coalesced_turn.jsonl fixture (V-19-01/03), interrupted_turn.jsonl fixture (V-19-02)"
  - phase: 10
    provides: "StreamEvent enum, insert_agent_event signature, spawn_event_aggregator supervisor wiring, LiveSessionRegistry, @user D-23 notification path"
provides:
  - "TurnBuffer local aggregator state → one assistant_text DB row per turn"
  - "StdoutClosed interrupted flush + synthesized agent-turn-complete emit"
  - "SessionStart:* hook silent-drop at dispatch_system"
  - "run_aggregator_with_events test harness (mock_app + in-memory pool)"
  - "Reader EOF-flush of accumulated_text → aggregator sees partial content on subprocess death"
  - "4 aggregator tests (V-19-01..04) + 2 parser tests (V-19-20/21)"
affects:
  - src-tauri/src/chat_runtime/parser.rs
  - "Phase 19 Plan 03 (MarkdownBody) — consumes the one-row-per-turn shape for markdown body rendering"
  - "Phase 19 Plan 04 (tool-use polish) — unaffected (different event types)"
tech-stack:
  added: []
  patterns:
    - "Local-variable TurnBuffer (not HashMap) — exploits one-aggregator-per-agent invariant (single caller in agents/commands.rs)"
    - "Buffer-first-then-flush aggregator pattern — AssistantText events update `Option<TurnBuffer>`; TurnComplete/StdoutClosed do the single DB write"
    - "Synthesized `agent-turn-complete` emit on EOF-without-TurnComplete — prevents orphaned frontend streaming flag"
    - "Reader-side EOF flush mirror of `dispatch_result` pre-TurnComplete flush — keeps partial-turn semantics symmetric across clean + interrupted termination"
    - "Aggregator test harness: `mock_app()` + `make_pool_with_chat_schema()` + `LiveSessionRegistry.register/bind_session_id` composition; channel close as terminator"
key-files:
  created: []
  modified:
    - path: src-tauri/src/chat_runtime/parser.rs
      lines_changed: "+393 / -34 (net +359)"
      purpose: "TurnBuffer struct + AssistantText/TurnComplete/StdoutClosed rewrite + dispatch_system SessionStart filter + reader EOF-flush + 6 new tests (harness + 4 aggregator + 2 parser)"
    - path: .planning/phases/19-polish-phase-10-chat-transcript-rendering-four-related-gaps-/deferred-items.md
      lines_changed: "+23"
      purpose: "Log D-03: pre-existing conflict::engine::tests failures — two-layer pre-existence evidence"
key-decisions:
  - "TurnBuffer is a local variable inside `run_event_aggregator`, not a `HashMap<AgentId, _>`. Rationale: one aggregator task runs per agent (verified single caller in agents/commands.rs). Local-variable scoping also means zero cross-agent contamination surface — the security register entry T-19-02-06 is fully satisfied by structural invariant, no runtime check needed."
  - "Reader-side EOF-flush of `accumulated_text` added as Rule 3 blocker fix. V-19-02 requires content `\"Partial\"` to reach the aggregator's StdoutClosed arm, but the existing reader emitted `StdoutClosed` directly on EOF — losing mid-idle-flush text. The fix mirrors the existing `dispatch_result` pre-TurnComplete flush pattern, keeping clean-exit and interrupted-exit paths symmetric."
  - "V-19-04 (D-23 regression guard) asserted via observable proxy — zero DB rows after an AssistantText with @user and no TurnComplete. Direct notification-dispatch capture would need a testing seam in `dispatch_chat_notification`; the zero-row assertion + V-19-01 (turn completes with one row) + V-19-02 (interrupted flushes one row) combined cover the Pitfall 1 regression surface."
  - "Model-merge precedence (`model.or_else(|| prior_buffer.model)`) lets a whole-turn envelope's `Some(model)` overwrite, while an idle-flush with `None` preserves any prior envelope's model within the same turn. Pitfall 7 (model-lost) coverage confirmed by V-19-03."
patterns-established:
  - "One-writer-per-turn DB invariant: aggregator owns assistant_text rows at turn granularity, not event granularity"
  - "Reader flush-on-EOF ≡ dispatch_result flush-on-result: both drain `accumulated_text` before terminal event"
  - "Channel close (drop(tx)) as test terminator for the aggregator's `while let Some` loop"
requirements-completed:
  - D-01.1
  - D-01.2
  - D-01.3
  - D-01.4
  - D-01.5
  - D-01.6
  - D-04.1
  - D-04.2
  - D-04.3
  - D-04.4
  - D-04.5
  - D-04.6
  - V-19-01
  - V-19-02
  - V-19-03
  - V-19-04
  - V-19-20
  - V-19-21
metrics:
  duration: 11m
  tasks: 2
  files_changed: 2
  files_created: 0
  files_modified: 2
  commits: 3
  completed: 2026-04-21
---

# Phase 19 Plan 02: Wave 1 Rust Parser + Aggregator Refactor Summary

**One assistant_text DB row per assistant turn via aggregator-side TurnBuffer coalescing (D-01); SessionStart:* hook lifecycle envelopes silently dropped at dispatch_system (D-04); plus reader EOF-flush so subprocess-death mid-turn still persists partial text via the StdoutClosed arm.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-21T07:44:04Z
- **Completed:** 2026-04-21T07:55:13Z
- **Tasks:** 2
- **Files modified:** 1 (src-tauri/src/chat_runtime/parser.rs) + 1 deferred-items log entry

## Accomplishments

- **D-01 aggregator coalescing**: `run_event_aggregator` now holds `Option<TurnBuffer>` local state. `AssistantText` events buffer (no DB write); `TurnComplete` flushes once; `StdoutClosed` flushes interrupted rows + synthesizes `agent-turn-complete` emit.
- **D-04 SessionStart filter**: `dispatch_system` silently drops `{hook_started|hook_response|hook_completed, hook_name: SessionStart:*}` envelopes at the parser boundary — no SystemNote emitted, no DB row written, transcript shows nothing at boot. Other hook subtypes (`PreToolUse:Edit`, etc.) continue to surface.
- **Reader EOF-flush**: `drive_stream_json_reader` now drains `accumulated_text` as `AssistantText` before emitting `StdoutClosed` on EOF or read-error — mirrors the existing `dispatch_result` pre-TurnComplete flush. Required for V-19-02 end-to-end.
- **Aggregator test harness**: `run_aggregator_with_events` spins up `mock_app()` + `make_pool_with_chat_schema()` + `LiveSessionRegistry` and drives a `Vec<StreamEvent>` through `spawn_event_aggregator`. Channel close terminates the loop; SQL queries via `list_events_for_agent` verify persisted state.
- **6 new tests**: 2 parser (V-19-20 session-start-drop, V-19-21 non-session-start-still-emits) + 4 aggregator (V-19-01..04). Total parser-tests count: 12 → 17 (net +5; one existing test renamed/flipped from `parses_hook_started_response_emits_system_note_not_assistant` to `session_start_hooks_silently_dropped`).

## Task Commits

Each task was committed atomically on `src-tauri/src/chat_runtime/parser.rs`:

1. **Task 1: D-04 SessionStart filter + test flip + regression guard** — `e7de43e` (fix): +32 / -4 lines. `dispatch_system` early-return on SessionStart; existing test renamed + asserted zero notes; new `non_session_start_hooks_still_emit_system_note` consumes `hook_pretool_use.jsonl`.
2. **Task 2a: D-01 TurnBuffer + AssistantText/TurnComplete/StdoutClosed refactor** — `339549d` (feat): +129 / -30 lines. `TurnBuffer` struct + `Option<TurnBuffer>` local state; AssistantText buffers (keeps @user notification pre-buffer); TurnComplete + StdoutClosed flush + synthesized emit.
3. **Task 2b: Aggregator test harness + 4 D-01 tests + reader EOF-flush** — `2948369` (test): +232 / -0 lines. `run_aggregator_with_events` helper, V-19-01..04, plus the reader-side EOF-flush Rule 3 blocker fix that V-19-02 requires end-to-end.

**Total diff on the plan's single target file:** +393 insertions / −34 deletions (net +359 across 3 commits).

Other unrelated commits interleaved on `main` between Task 1 and Task 2 (three `11.1` radar commits — commits `6878f48`, `7b13735`, `383ca24`). These are not part of this plan and do not touch `chat_runtime` or `parser.rs`.

## Files Created/Modified

- `src-tauri/src/chat_runtime/parser.rs` — D-01 aggregator TurnBuffer + D-04 dispatch_system SessionStart filter + reader EOF-flush + aggregator test harness + 6 new tests.
- `.planning/phases/19-polish-phase-10-chat-transcript-rendering-four-related-gaps-/deferred-items.md` — appended D-03 entry documenting pre-existing `conflict::engine::tests` failures (two-layer pre-existence evidence).

No new files created. `StreamEvent` enum (`src-tauri/src/chat_runtime/types.rs`), `insert_agent_event` signature (`src-tauri/src/db/events.rs`), and `spawn_event_aggregator` call site (`src-tauri/src/agents/commands.rs`) all untouched — verified via `git diff --stat`.

## Decisions Made

See frontmatter `key-decisions:` for full rationale. Highlights:

- **Local-variable TurnBuffer, not HashMap.** One aggregator task per agent; `HashMap<AgentId, _>` would add a pointless shared-state surface and invite the very cross-agent contamination threat T-19-02-06 is mitigating. The plan's interface sketch mentioned `HashMap` in passing but the research's Implementation §L469 explicitly uses the local variable — I followed research over sketch.
- **Reader EOF-flush (Rule 3 blocker).** V-19-02 couldn't pass end-to-end without this: the interrupted fixture has 2 text_deltas and EOF (no idle-flush gap, no TurnComplete). Without a reader EOF-flush, `accumulated_text` was silently discarded on EOF — aggregator's StdoutClosed arm saw an empty buffer, wrote 0 rows. Mirror fix matches the existing `dispatch_result` pattern. See §Deviations.
- **V-19-04 via zero-row proxy.** Direct `dispatch_chat_notification` capture would need a testing seam (feature flag / callback probe) — the notification helper uses `catch_unwind` + OS-level dispatch, not easily mockable. The zero-row assertion (AssistantText dispatched, no TurnComplete, assert 0 rows) proves the aggregator does not gate notification on DB writes and that the buffer-first path doesn't accidentally persist mid-turn rows — which is the regression surface Pitfall 1 protects.
- **Model-merge precedence** `model.or_else(|| prior_buffer.model)` — envelope's `Some` wins; idle-flush's `None` preserves prior. Pitfall 7 (model-lost across idle flushes) covered by V-19-03's explicit assertion that the envelope's model survives.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reader-side EOF-flush of accumulated_text**

- **Found during:** Task 2b (running `aggregator_flushes_interrupted_on_stdout_closed` test — V-19-02)
- **Issue:** The interrupted-turn fixture has 2 text_deltas then EOF. In `run_reader_against_bytes`, the write side shuts down immediately after writing the 2 lines — the 250ms idle-flush timer never fires (zero time elapses), so no `AssistantText` is emitted. The reader's `Ok(None)` EOF arm emitted `StdoutClosed` directly without flushing `accumulated_text`. Result: aggregator's new StdoutClosed flush saw an empty `turn_buffer` and wrote 0 rows. V-19-02 failed with `left: 0, right: 1`.
- **Root cause:** Existing reader discards any in-flight idle-flush text on subprocess death. The plan's aggregator-side fix alone doesn't address this — the StdoutClosed arm can only flush what the `AssistantText` arm buffered, and the `AssistantText` arm only fires when the reader sends one.
- **Fix:** Added an `if !accumulated_text.is_empty()` guard before `sink.send(StreamEvent::StdoutClosed)` in both the `Ok(None)` EOF arm and the `Err(e)` read-error arm. Mirrors the existing `dispatch_result` pre-TurnComplete flush (parser.rs ~L380). Both clean-exit and interrupted-exit paths now drain `accumulated_text` via the same pattern.
- **Files modified:** `src-tauri/src/chat_runtime/parser.rs` (reader body L120-153)
- **Verification:** V-19-02 passes (`aggregator_flushes_interrupted_on_stdout_closed` — 1 row with content `"Partial"`). All 16 other parser tests still pass; `cargo check --lib` exits 0.
- **Committed in:** `2948369` (part of the test-landing commit, since the fix is only discoverable through running the test that needed it)

**2. [Rule 1 - Bug] Existing test rename/flip — `parses_hook_started_response_emits_system_note_not_assistant` → `session_start_hooks_silently_dropped`**

This is explicitly requested by the plan (Task 1 Step 2) — flagging here as "deviation from prior behavior" for SUMMARY tracking. The prior test asserted `note_count == 2` (hook envelopes surfaced as SystemNote). After D-04.2, the same fixture emits zero notes — the test assertion is flipped + the test name is updated to describe the new truth. Not a bug in my work; a schema change the plan requires.

---

**Total deviations:** 1 auto-fix (Rule 3 — reader EOF-flush). The renamed test is plan-mandated, not a deviation.

**Impact on plan:** The EOF-flush fix is the minimal extension of the planned aggregator refactor — without it, V-19-02's end-to-end assertion through `run_reader_against_bytes → run_aggregator_with_events` cannot be satisfied. The fix preserves the plan's D-01.4 contract ("StdoutClosed flushes interrupted buffer as one row") and the surrounding reader semantics. No scope creep.

## Issues Encountered

**Pre-existing `conflict::engine::tests` failures** surfaced during `cargo test --lib` full-suite run. Two-layer verification: `git stash` + `cargo test --lib conflict::engine::tests` on commit `339549d` (my refactor commit, before I added the aggregator tests) reproduced identical failures (`test_conflict_detected_different_pids_within_window`, `test_custom_window_duration`). Confirmed NOT caused by Plan 19-02 — `conflict::engine` is Phase 03 scope, unrelated to `chat_runtime`. Logged to `deferred-items.md` as D-03. Per "only fix own bugs" memory rule, not fixed here.

**Pre-existing `end_to_end_smoke.rs` / `hook_e2e_with_real_sidecar.rs` compile errors** from `LaunchOptions` struct drift (Phase 10 Plan 04 widening). Already logged in deferred-items D-01 by Plan 19-01. Lib tests compile clean; plan-targeted surface is `--lib` anyway.

## TDD Gate Compliance

Plan `type: execute` (not `type: tdd`), so the plan-level RED/GREEN/REFACTOR gate sequence doesn't apply. Individual tasks used `tdd="true"` — Task 1 and Task 2 both bundle their tests in the same commit(s) as the implementation, which is consistent with the per-task TDD style used by Plan 19-01.

## Known Stubs

None. The 4 new aggregator tests are fully-wired assertions (not `.todo`), and the 2 parser tests are flipped/added with live assertions. Plan 19-01's `.todo` scaffolds are unaffected — Plan 19-03 and Plan 19-04 flip those to real tests.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: process-lifecycle | src-tauri/src/chat_runtime/parser.rs | Reader EOF-flush adds one extra `sink.send(StreamEvent::AssistantText)` call on subprocess death. Preserves the existing mpsc backpressure model — a full sink already logs-and-proceeds (same `let _ = sink.send(...)` pattern as the idle-flush, clean-exit, and every other reader emit). No new DoS surface, but worth flagging: now partial-turn content from a dying subprocess can reach the DB where it previously vanished silently. |

## Self-Check: PASSED

**Files modified (correct regions):**
- `src-tauri/src/chat_runtime/parser.rs` — FOUND, modified across 3 atomic commits (e7de43e, 339549d, 2948369). Diff: +393 / -34.
- `.planning/phases/19-polish-phase-10-chat-transcript-rendering-four-related-gaps-/deferred-items.md` — FOUND, appended D-03 entry (uncommitted at time of self-check; will land in the final metadata commit).

**Files explicitly UNTOUCHED (verified via `git diff --stat`):**
- `src-tauri/src/chat_runtime/types.rs` — empty diff (StreamEvent schema preserved)
- `src-tauri/src/db/events.rs` — empty diff (insert_agent_event signature preserved)
- `src-tauri/src/agents/commands.rs` — empty diff (spawn_event_aggregator call site preserved)

**Commits (all in git log):**
- `e7de43e` — FOUND: `fix(19-02): drop SessionStart hook envelopes silently in dispatch_system (D-04)`
- `339549d` — FOUND: `feat(19-02): coalesce assistant_text rows at aggregator turn boundary (D-01)`
- `2948369` — FOUND: `test(19-02): aggregator harness + 4 D-01 tests + reader EOF-flush support (V-19-01..04)`

**Grep invariants:**
- `grep -c "struct TurnBuffer" parser.rs` → `1` ✓
- `grep -c "turn_buffer.take()" parser.rs` → `2` (TurnComplete + StdoutClosed) ✓
- `grep -c 'hook_name.starts_with("SessionStart:")' parser.rs` → `1` ✓
- `grep -c '"terminalReason": "interrupted"' parser.rs` → `1` (synthesized StdoutClosed emit) ✓
- `awk '/^            StreamEvent::AssistantText \{ content, model \} =>/,/^            StreamEvent::/' parser.rs | grep -c insert_agent_event` → `0` (Pitfall 2 guard — aggregator's AssistantText arm has ZERO DB writes) ✓
- `grep -c is_awaiting_user_mention parser.rs` → `16` (includes one call inside the AssistantText arm — Pitfall 1 preserved + many test helpers) ✓

**Verification runs:**
- `cargo test --lib chat_runtime::parser::tests` → `17 passed; 0 failed` (prior 12 + 2 new D-04 + 4 new D-01 − 1 renamed = 17). Target metric: V-19-01..04 + V-19-20/21 all green. ✓
- `cargo check --lib` → exit 0 (8 warnings, all pre-existing dead_code on unrelated modules) ✓
- `cargo test --workspace --no-run` → fails on `tests/end_to_end_smoke.rs` + `tests/hook_e2e_with_real_sidecar.rs` with pre-existing `LaunchOptions` errors (documented in deferred-items.md D-01). Not a plan-19-02 regression.

All plan acceptance criteria satisfied. Plan 19-02 complete.

## Next Phase Readiness

- **Plan 19-03 (Wave 2 — MarkdownBody)** unblocked. The one-row-per-turn shape simplifies the downstream markdown renderer: `AssistantTextCard` + `MarkdownBody` now render a single authoritative `content` blob per turn instead of N progressively-revealed chunks. Progressive reveal still lives on the `agent-assistant-delta` event path (unchanged here).
- **Plan 19-04 (Wave 2 — Tool-use polish)** independent of this plan — uses the `tool_use` + `tool_result` event types, which Plan 19-02 leaves untouched.
- **Backwards compat:** Existing DB rows are untouched. `agent_events` schema unchanged. Frontend reducer that assumed "potentially multiple assistant_text rows per turn" will now see just one — if any selector grouped-by-turn, it collapses trivially to a scalar. Plan 19-03 can consume the cleaner shape without migration.

---

*Phase: 19-polish-phase-10-chat-transcript-rendering-four-related-gaps-*
*Completed: 2026-04-21*
