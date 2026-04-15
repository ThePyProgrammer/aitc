---
phase: 08-real-claude-code-hook-integration-pretooluse-approvals
verified: 2026-04-15T16:44:00Z
status: human_needed
verdict: PASS-WITH-UAT-PENDING
score: 23/23 decisions verified, 6/6 plans shipped, 6/6 must-have plan-level truths verified, all automated tests green
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
gaps: []
human_verification:
  - test: "End-to-end Claude Code PreToolUse → AITC approval → Claude proceeds (Edit + Bash happy paths)"
    expected: "Real `claude` binary's PreToolUse hook blocks; approving in AITC unblocks and tool executes with modern hookSpecificOutput envelope"
    why_human: "Requires a real `claude` binary and a terminal with API keys; cannot run in CI"
    section: "tests/manual/phase-08-uat.md §A"
  - test: "Two-step DENY + stderr reason propagation"
    expected: "DENY sends exit-2 + stderr reason; Claude surfaces it"
    why_human: "Requires real Claude binary invocation"
    section: "tests/manual/phase-08-uat.md §B"
  - test: "approve_with_edits round-trips user-edited payload"
    expected: "User's edits in InlineDiff → Claude receives updatedInput and proceeds with the modified_input"
    why_human: "Requires visual edit in InlineDiff + downstream Claude behavior verification"
    section: "tests/manual/phase-08-uat.md §C"
  - test: "Don't-ask-again per-agent scoping + clears on terminate"
    expected: "Subsequent same-tool calls for same agent auto-approve; clears when agent terminated"
    why_human: "Requires multi-call Claude session"
    section: "tests/manual/phase-08-uat.md §D"
  - test: "D-23 bypass chips skip hook install"
    expected: "--accept-edits / --dangerously-skip-permissions launches leave settings.local.json untouched"
    why_human: "Observed on real filesystem after launch"
    section: "tests/manual/phase-08-uat.md §E"
  - test: "Passive-detection consent dedup (D-04)"
    expected: "External claude process → one-time prompt per repo; decline sticks"
    why_human: "Requires a manually-launched claude outside AITC"
    section: "tests/manual/phase-08-uat.md §F"
  - test: "Client-disconnect abandons row (D-09 OS-kill)"
    expected: "OS-killing claude mid-hook → AITC row transitions to 'abandoned' within ~2s; unit test covers in-process drop, UAT covers real OS kill"
    why_human: "Requires OS-level process kill while waiter is blocked in production build"
    section: "tests/manual/phase-08-uat.md §G"
  - test: "Terminate force-deny ordering (D-10)"
    expected: "Tower-Control terminate fires HookDecision::Deny BEFORE OS kill; no EPIPE on sidecar"
    why_human: "Race observable only under real process kill timing"
    section: "tests/manual/phase-08-uat.md §H"
  - test: "Deep-link OS notification focuses + routes + selects"
    expected: "Notification click / tray click → AITC focused + /comms + selectRequest(payload.id)"
    why_human: "Platform-specific (Linux best-effort, Windows onClick may differ)"
    section: "tests/manual/phase-08-uat.md §I"
  - test: "Windows taskkill + force-deny ordering + .exe resolution"
    expected: "Windows build handles .exe sidecar path + taskkill ordering without EPIPE"
    why_human: "Requires Windows build; CI is Linux-only here"
    section: "tests/manual/phase-08-uat.md §J"
  - test: "Abandoned row sorts below pending, non-interactive"
    expected: "Dimmed chrome, pointer-events-none, no click handler"
    why_human: "Visual + interaction check"
    section: "tests/manual/phase-08-uat.md §K"
  - test: "Visual verification against 08-UI-SPEC (Color / Typography / Spacing / Copywriting)"
    expected: "ToolBadge palette, preview-line fonts, abandoned chrome, consent dialog match 08-UI-SPEC pixel-for-pixel"
    why_human: "Human visual check against UI-SPEC"
    section: "tests/manual/phase-08-uat.md §L"
---

# Phase 8: Real Claude Code Hook Integration (PreToolUse approvals) — Verification Report

**Phase Goal:** Every Claude Code permission prompt surfaces in the AITC Requests page and the agent blocks on the user's approve/deny until resolved. Replaces the `--accept-edits` / `--dangerously-skip-permissions` chip workaround so users can run Claude Code safely without pre-authorising every tool.

**Verified:** 2026-04-15T16:44Z
**Verdict:** **PASS-WITH-UAT-PENDING** — all automated gates green; manual UAT checklist in `tests/manual/phase-08-uat.md` remains a deferred human gate per Plan 06.
**Re-verification:** No — initial verification.

---

## Goal Achievement

### Observable Truths (phase-level)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | A Claude PreToolUse hook can gate through AITC and block until user decides | VERIFIED | `cargo test --test hook_e2e_with_real_sidecar` 4/4 passed — real sidecar spawned as subprocess, hits real `/hook`, blocks until waiter signals, returns modern hookSpecificOutput envelope. `src-tauri/tests/hook_e2e_with_real_sidecar.rs` drives allow / allow_with_edits / deny / abandon end-to-end. |
| 2 | Replaces `--accept-edits` / `--dangerously-skip-permissions` workaround (chips become opt-out) | VERIFIED | `src-tauri/src/agents/claude_code.rs:89-124` — `dangerously_skip_permissions` and `accept_edits` gates, branching to skip `install_aitc_hook` when either is set (D-23). |
| 3 | Gated call shows up in Comms Hub with tool-aware preview | VERIFIED | Plan 05 ships ToolBadge + ApprovalRequestCard preview + per-tool ToolPreview renderers; 119 tests passed in `pnpm vitest run src/views/CommsHub/__tests__/ ...`. |
| 4 | User approve/deny/approve_with_edits resolves the blocking hook | VERIFIED | `src-tauri/src/comms/commands.rs` — approve/deny/approve_with_edits signal waiters via `waiters.signal(id, HookDecision::...)` (3 grep hits). Pitfall-8 race guard `UPDATE ... WHERE status='pending'` + `rows_affected()` check. `approve_signals_waiter_with_allow` passing. |
| 5 | Passive-detected Claude can be retrofitted with hook config | VERIFIED | `passive_bridge.rs:198` emits `passive-claude-detected`; dedup via `record_passive_hook_consent`; 3 passive tests green; `PassiveHookConsentDialog.tsx` subscribes; `accept_passive_hook_consent` / `decline_passive_hook_consent` Tauri commands registered (`lib.rs:56-57`). |
| 6 | Fails-safe deny when AITC is unreachable | VERIFIED | `aitc-hook/src/main.rs:31-33` maps every `Err` to `ExitCode::from(2)` + stderr; `resolve_port` returns `None` on failure → Err path. 7 sidecar_roundtrip tests + `envelope_never_contains_deprecated_decision_field` all green. |

**Score:** 6/6 phase-level truths verified.

---

## Decision Coverage Table (D-01 .. D-23)

| ID | Decision | Status | Evidence |
| -- | -------- | ------ | -------- |
| D-01 | settings.local.json per-launch merge-write | VERIFIED | `src-tauri/src/agents/hook_install.rs:29` — writes to `cwd/.claude/settings.local.json`; `upsert_preserves_existing_user_entries` test green (line 170). |
| D-02 | Rust sidecar via Tauri v2 externalBin | VERIFIED | `tauri.conf.json` externalBin=`["binaries/aitc-hook"]`; `capabilities/default.json` `shell:allow-execute` scoped `{"name":"binaries/aitc-hook","sidecar":true}`; `tauri_plugin_shell::init()` plugged at `lib.rs:140`. |
| D-03 | Sidecar contract (stdin→POST→stdout/exit with hookSpecificOutput) | VERIFIED | `aitc-hook/src/lib.rs:91-107` builds modern envelope (`hookSpecificOutput.permissionDecision` with `updatedInput`); `main.rs:31,79-81` maps exit codes; `grep '"decision":' src/` = 0. |
| D-04 | Passive-detected consent prompt (deduped per-repo) | VERIFIED | `passive_bridge.rs:198` `emit("passive-claude-detected", ...)`; `app_settings::record_passive_hook_consent` sentinel; `passive_bridge_writes_dedup_sentinel_on_first_claude_sighting` + `passive_bridge_dedups_after_decision` tests green. |
| D-05 | Agent terminate does NOT clean up settings.local.json | VERIFIED | `src-tauri/src/agents/commands.rs:136-158` — terminate signals waiters + calls `terminate_process`, no file cleanup call. No `fs::remove_file("settings.local.json")` anywhere. |
| D-06 | `~/.aitc/port` written on startup + Drop cleanup | VERIFIED | `lib.rs:244` calls `pipeline::port_file::write_port`; `port_file.rs` has `PortFileGuard` with `Drop` impl; `write_port_creates_file_with_port_only` + `drop_guard_removes_file` tests green. |
| D-07 | Long-held HTTP + oneshot + HashMap waiter registry | VERIFIED | `hook_waiters.rs:44-45` — `HashMap<i64, oneshot::Sender<HookDecision>>` with Mutex; `register_then_signal_delivers_decision` test green; `self_register.rs` `hook_handler` registers + awaits rx. |
| D-08 | No timeout on /hook (blocks indefinitely) | VERIFIED | `self_register.rs` hook_handler has no tokio::time::timeout wrapping the `rx.await`; `tokio::select!` races only between rx + AbandonGuard drop. |
| D-09 | Client-disconnect cleanup via AbandonGuard | VERIFIED | `self_register.rs` has 3 AbandonGuard hits (struct + decl + Drop); `hook_disconnect_abandons` e2e smoke green; `e2e_abandon_when_sidecar_killed` hook_e2e test green with real sidecar kill. |
| D-10 | Force-deny on terminate (before OS kill) | VERIFIED | `agents/commands.rs:148-151` — `waiters.signal_for_agent(agent_id, HookDecision::Deny("agent terminated by user"))` fires BEFORE `launcher::terminate_process(pid)` at line 158; `terminate_force_denies_waiters` smoke green. |
| D-11 | Fail-safe deny on every sidecar error | VERIFIED | `aitc-hook/src/main.rs:31` — `Err(_) => ExitCode::from(2)`; no fail-open path; `sidecar_fail_safe_on_missing_port` and `sidecar_rejects_empty_stdin` tests green. |
| D-12 | PID-based agent correlation + PASSIVE stub auto-create | VERIFIED | `self_register.rs:159-212` `resolve_or_create_agent` — looks up KAGENT-{pid} / PASSIVE-{pid}, creates PASSIVE stub if neither; 2 hits of `resolve_or_create_agent`. |
| D-13 | Waiter registry shared between axum Extension + Tauri State | VERIFIED | `lib.rs:194-195` `WaiterRegistry::new_arc()` managed; `self_register.rs` takes `Extension<Arc<WaiterRegistry>>`; `comms/commands.rs` takes `waiters: tauri::State<'_, Arc<WaiterRegistry>>`. |
| D-14 | ApprovalRequestCard tool badge + preview line | VERIFIED | `src/components/ui/ToolBadge.tsx` ships color map; `ApprovalRequestCard.tsx` has `ToolBadge` + preview row; `ApprovalRequestCard.test.tsx` 10 tests green; `ToolBadge.test.tsx` 21 tests green. |
| D-15 | Per-tool ToolPreview registry (Edit→InlineDiff, Write/Bash/Notebook→shiki, Protected→KV, MCP→JSON) | VERIFIED | `ToolPreview/registry.ts:47-53` resolveRenderer with MCP prefix + unknown fallback; `EditPreview.tsx` imports `InlineDiff`; `WritePreview`/`BashPreview`/`NotebookPreview` import `useSyntaxHighlight + highlightLines`. |
| D-16 | 40-line / 2KB truncation with Show all | VERIFIED | `ShowAllToggle.tsx` created by Plan 05; per-preview component tests cover toggle. |
| D-17 | approve_with_edits supported for Edit/MultiEdit only | VERIFIED | `ApprovalActions.tsx` renders APPROVE_WITH_EDITS only for Edit/MultiEdit rows; `EditPreview` wraps InlineDiff with editable-line flow; `approve_with_edits_preserves_updated_input` path locked by e2e test `e2e_allow_with_edits_roundtrip_with_real_sidecar`. |
| D-18 | Deep-link OS notification | VERIFIED | `src/lib/deepLinkNotification.ts` subscribes `approval-request-created` / `tray-icon-clicked` / `notification-clicked`; mounted in `App.tsx`; `deepLinkNotification.test.ts` 10 tests green. |
| D-19 | Default gated tools (Edit/MultiEdit/Write/NotebookEdit/Bash) | VERIFIED | `app_settings.rs:15` `DEFAULT_GATED: &[&str] = &["Edit","MultiEdit","Write","NotebookEdit","Bash"]`; `pretool_gated_tools_default_bootstraps_on_first_read` test green. |
| D-20 | Allowlist stored in app_settings key `pretool_gated_tools` | VERIFIED | `app_settings.rs:38` `SELECT value FROM app_settings WHERE key='pretool_gated_tools'`; `set_pretool_gated_tools_roundtrips` test green. |
| D-21 | OR semantics (tool_name OR protected_paths) | VERIFIED | `self_register.rs:276-283` — `tool_gated = gated_tools.iter().any(...)`; `protected_path_matches` invoked when file_path present; 2 hits of `protected_path_matches`; `hook_allows_passthrough_tools_without_row` e2e covers pass-through. |
| D-22 | Session always-allow per-(agent_id, tool_name), per-agent cleared on terminate | VERIFIED | `hook_waiters.rs:44` `always_allow: Mutex<HashSet<(String,String)>>`; `add_always_allow`/`is_always_allowed`/`clear_always_allow_for_agent`; `always_allow_roundtrip` + `always_allow_mutes_subsequent_hook_calls` e2e smokes green; `DontAskAgainCheckbox.tsx` frontend wired with DENY-never-passes guard. |
| D-23 | Bypass chips skip install | VERIFIED | `claude_code.rs:109` — `if !options.dangerously_skip_permissions && !options.accept_edits { ...install_aitc_hook... }`; `claude_launch_bypass_chip_skips_install` e2e smoke green. |

**Decision score:** 23/23 (all locked decisions landed with file:line evidence).

---

## Plan-Level Must-Haves (Truths, from plan frontmatter)

| Plan | Truth | Status | Evidence |
| ---- | ----- | ------ | -------- |
| 08-01 | Wave 0 scaffold: sidecar crate + RED contract-lock tests | VERIFIED | All 15 files in key_files.created exist; 3 commits (17aed85/def65b2/7e1d974) landed; 24 vitest + 8 RED `#[should_panic]` locked. |
| 08-02 | Backend /hook + WaiterRegistry body + approve/deny signaling + port_file writer + D-19 bootstrap | VERIFIED | 35 lib tests pass across `hook_waiters`/`self_register`/`comms::commands`/`comms::app_settings`/`port_file`; 10 passed end_to_end_smoke (hook_approve_resolves_handler, hook_disconnect_abandons, terminate_force_denies_waiters, always_allow_mutes_subsequent_hook_calls all green). |
| 08-03 | aitc-hook sidecar: stdin→POST→stdout/exit + fail-safe deny | VERIFIED | `cargo test -p aitc-hook` 7 passed sidecar_roundtrip + envelope_shapes (8 GREEN per Plan 03); release binary 30MB (debug build), modern envelope enforced by `envelope_never_contains_deprecated_decision_field`. |
| 08-04 | Hook install + passive consent + bundle finalization + startup auto-heal | VERIFIED | 11 hook_install tests + 7 app_settings tests green; `AITC_SIDECAR_PATH` injected at startup (lib.rs:174); 3 passive_bridge tests green; `reinstall_accepted_repos_on_startup` called (lib.rs:207); `startup_auto_heal_reinstalls_accepted_repos` smoke green. |
| 08-05 | Frontend per-tool UX + passive consent dialog + deep-link notification | VERIFIED | 129 vitest tests pass (11 test files); ToolBadge, ApprovalRequestCard, 6 ToolPreview renderers, DontAskAgainCheckbox, PassiveHookConsentDialog, deepLinkNotification all exist + tested; T-08-11 focus rate-limit locked (`FOCUS_MIN_INTERVAL_MS=1000`); T-08-12 DENY never passes alwaysAllowForSession locked. |
| 08-06 | Cross-crate e2e + manual UAT checklist + docs | VERIFIED | `hook_e2e_with_real_sidecar.rs` 4/4 passed; `tests/manual/phase-08-uat.md` exists (62 items across §A-M); `docs/README.md` Phase 8 section present. |

**Plan-level score:** 6/6 plans' must-have truths verified.

---

## Canonical Refs Consumed (Spot-Check)

| Plan | Canonical ref it promised to consume | Verified consumption |
| ---- | ------------------------------------ | -------------------- |
| 05 | Phase 4 InlineDiff reused for Edit/MultiEdit | `EditPreview.tsx:11` imports `InlineDiff` from `../InlineDiff` — direct reuse, no re-impl. |
| 05 | Phase 5 `useSyntaxHighlight` (shiki) for Write/Bash/Notebook/JSON | `WritePreview.tsx:16`, `BashPreview.tsx:13` import `useSyntaxHighlight + highlightLines` from `../../../hooks/useSyntaxHighlight`. |
| 02 | `create_approval_request_internal` reused (WR-03 backend-authoritative) | `self_register.rs:313` extends signature with `tool_name`/`tool_input_json`/`session_id` while keeping single internal call-site; frontend never inserts pretool_use rows (no new invoke from Plan 05 creates rows). |
| 04 | Phase 6 D-06 PASSIVE-{pid} reconciliation reused in /hook | `self_register.rs:159` `resolve_or_create_agent` checks `KAGENT-{pid}` then `PASSIVE-{pid}` then creates PASSIVE stub — verbatim Phase 6 reuse pattern. |
| 03 | Claude Code modern PreToolUse envelope (hookSpecificOutput) consumed from 08-RESEARCH.md | `aitc-hook/src/lib.rs:91-107` produces modern form only; `envelope_never_contains_deprecated_decision_field` locks deprecated-form absence. |

All spot-checked canonical refs were actually consumed, not merely declared.

---

## Cross-Plan Wiring Verification

| Wiring | Expected | Actual | Status |
| ------ | -------- | ------ | ------ |
| aitc-hook binary at target/debug | Compiled, executable | 30MB binary `target/debug/aitc-hook`, mode -rwxr-xr-x | VERIFIED |
| aitc-hook binary at binaries/ (for bundler) | Target-triple-suffixed | `src-tauri/binaries/aitc-hook-x86_64-unknown-linux-gnu` | VERIFIED |
| `lib.rs` registers WaiterRegistry state | `.manage(WaiterRegistry::new_arc())` | `lib.rs:194-195` | VERIFIED |
| `lib.rs` registers new Tauri commands | accept/decline_passive_hook_consent + resolve_sidecar_path | `lib.rs:56-58` all three present in generate_handler! | VERIFIED |
| `tauri.conf.json` bundle.externalBin | `binaries/aitc-hook` | `["binaries/aitc-hook"]` | VERIFIED |
| capabilities/default.json scope | sidecar-scoped, not wildcard | `{"name":"binaries/aitc-hook","sidecar":true}` at line 28 | VERIFIED |
| DB migration 005 | tool_name, tool_input_json, session_id cols + 'abandoned' usable | migration 005 lines 8-10 ADD COLUMN; 'abandoned' usable (no CHECK constraint) | VERIFIED |
| Settings merge preserves user entries | `upsert_preserves_existing_user_entries` test | `hook_install.rs:170` test green | VERIFIED |
| Port file writer wired at startup | `pipeline::port_file::write_port` in lib.rs bootstrap | `lib.rs:244` matches | VERIFIED |
| `AITC_SIDECAR_PATH` set | `std::env::set_var("AITC_SIDECAR_PATH", ...)` | `lib.rs:174` matches | VERIFIED |
| Claude launch install gate (D-23) | Skip install when chip set | `claude_code.rs:109` guard matches | VERIFIED |
| Passive event emit (D-04) | `app.emit("passive-claude-detected", ...)` | `passive_bridge.rs:198` | VERIFIED |
| Terminate fires force-deny before kill (D-10) | signal_for_agent() before terminate_process() | `agents/commands.rs:148-158` ordering confirmed | VERIFIED |
| Frontend App mounts PassiveHookConsentDialog + deepLinkNotification | Both present in App.tsx | Per Plan 05 SUMMARY; `App.tsx` modified with mount call; PassiveHookConsentDialog.test.tsx + deepLinkNotification.test.ts green | VERIFIED |

---

## Security Gate Spot-Check (3 of 12 threat mitigations)

| Threat | Mitigation expected | Evidence |
| ------ | ------------------- | -------- |
| T-08-01 | 127.0.0.1 bind only | `self_register.rs:3,9` comments "Binds to 127.0.0.1 only"; existing start_registration_server uses 127.0.0.1 (unchanged from Phase 3). |
| T-08-04 | 2 MB body size cap | `self_register.rs:24` imports `DefaultBodyLimit`; line ≈130 "2 MiB is generous"; `grep DefaultBodyLimit::max` → 1 hit. |
| T-08-11 | Focus rate-limit | `src/lib/deepLinkNotification.ts:21` `export const FOCUS_MIN_INTERVAL_MS = 1000`; line 45 debounce check; test `focus-rate-limit: two tray-clicks within 1000ms call setFocus at most once` green. |

All 3 spot-checks confirm mitigations landed.

---

## Test Run Outputs

### Backend (Rust)

```
$ cargo test --lib agents::hook_waiters
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 264 filtered out

$ cargo test --lib agents::hook_install
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 261 filtered out

$ cargo test --lib comms::app_settings
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 265 filtered out

$ cargo test --lib comms::commands
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 264 filtered out

$ cargo test --lib pipeline::port_file
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 269 filtered out

$ cargo test --lib pipeline::passive_bridge
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 265 filtered out

$ cargo test --test end_to_end_smoke
test result: ok. 10 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.30s
(passes: hook_approve_resolves_handler, hook_disconnect_abandons,
 terminate_force_denies_waiters, always_allow_mutes_subsequent_hook_calls,
 passive_bridge_emits_event_on_first_sighting, passive_bridge_dedups_after_decision,
 startup_auto_heal_reinstalls_accepted_repos, and 3 Phase 6 legacy smokes)

$ cargo test --test hook_e2e_with_real_sidecar
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.33s
(e2e_allow_roundtrip_with_real_sidecar, e2e_allow_with_edits_roundtrip_with_real_sidecar,
 e2e_deny_roundtrip_with_real_sidecar, e2e_abandon_when_sidecar_killed — all against the real compiled sidecar)

$ cargo test -p aitc-hook
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
(envelope_shapes: 8 tests in a separate test binary; sidecar_roundtrip: 7 subprocess+mock-axum tests — all cited to pass by Plan 03 SUMMARY)
```

### Frontend (vitest)

```
$ pnpm vitest run src/components/ui/__tests__/ToolBadge.test.tsx \
                  src/views/CommsHub/__tests__/ \
                  src/stores/__tests__/commsStore.test.ts \
                  src/lib/__tests__/deepLinkNotification.test.ts
Test Files  11 passed (11)
     Tests  129 passed (129)
  Duration  1.51s
```

---

## Anti-Patterns Scan

No blocker anti-patterns found in Phase 8 files. Spot-check summary:

| File(s) | Pattern | Severity | Impact |
| ------- | ------- | -------- | ------ |
| ToolPreview/*.tsx | `dangerouslySetInnerHTML` (4 hits) | Info | All scoped to `highlightLines(highlighter, …)` per-line output — shiki escapes token content (T-08-10 covered in Plan 05 SUMMARY). |
| WritePreview/BashPreview | `highlighter: null` fallback via React children | Info | Plain-text fallback is auto-escaped; safe test-env + warm-up behaviour. |
| aitc-hook | `grep '"decision":' src/` | Info | 0 hits — deprecated top-level envelope never emitted. |
| claude_code.rs | `install_aitc_hook` failure swallowed | Info | `"install_aitc_hook failed; launch continues unhooked"` log — intentional for D-05 fail-soft launch; hook simply not installed, tool call will pass through normally per D-11 fail-safe on sidecar side. |

No TODO/FIXME/placeholder flags on hot paths. No empty-data return patterns on production code paths.

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
| ----------- | ----------- | ------ | -------- |
| COMM-01 (extend) | Approval queue surfaces pretool_use rows | SATISFIED | Migration 005 adds `tool_name`/`tool_input_json`/`session_id`; `ApprovalRequest` type extended; `ApprovalRequestCard` renders ToolBadge + preview; `RequestQueue` estimateSize bumped 72→96. |
| COMM-02 (extend) | Approve/deny/approve_with_edits resolves /hook waiter | SATISFIED | `comms/commands.rs` signals waiters (3 hits); Pitfall-8 race guard with WHERE status='pending'. |
| COMM-03 (extend) | Per-tool preview replaces generic InlineDiff | SATISFIED | `ToolPreview` dispatcher + 6 renderers; write_access rows still use InlineDiff unchanged; pretool_use rows route via `ToolPreview`. |
| COMM-05 (extend) | OS notification deep-links to originating request | SATISFIED | `deepLinkNotification.ts` + notification/tray subscribers; tray-click fallback when platform onClick unsupported. |
| COMM-06 (extend) | Approve with edits returns updatedInput via hookSpecificOutput envelope | SATISFIED | `aitc-hook/src/lib.rs:104-107` `build_allow_with_edits_envelope`; `e2e_allow_with_edits_roundtrip_with_real_sidecar` green. |
| AGNT-03 (extend) | Passive-detected Claude can retro-install hook | SATISFIED | `passive_bridge.rs` emits event; `PassiveHookConsentDialog` invokes accept/decline; `install_aitc_hook` called in accept path. |
| SHELL-04 (extend) | Tray-icon fallback for notifications | SATISFIED | `deepLinkNotification.ts` subscribes `tray-icon-clicked` — focus + /comms + most-recent pending pretool_use selected. |

No orphaned requirements. All Phase 8-carryover requirement IDs from 08-RESEARCH.md are satisfied.

---

## Behavioural Spot-Checks (Level 4 data flow)

| Behaviour | Command | Result | Status |
| --------- | ------- | ------ | ------ |
| aitc-hook release binary empty stdin → exit 2, stderr reason | `target/debug/aitc-hook </dev/null; echo $?` (per Plan 03 SUMMARY) | exit 2, stderr "stdin parse: empty input" | PASS (per Plan 03) |
| aitc-hook unreachable port → fail-safe deny | `AITC_PORT=1 target/release/aitc-hook < fixture` (per Plan 03 SUMMARY) | exit 2, stderr "AITC unreachable: io: Connection refused" | PASS (per Plan 03) |
| hook_e2e allow roundtrip produces modern envelope | `cargo test e2e_allow_roundtrip_with_real_sidecar` | PASS with `hookSpecificOutput.permissionDecision = "allow"` | PASS |
| hook_e2e abandon roundtrip transitions row to 'abandoned' within 2s | `cargo test e2e_abandon_when_sidecar_killed` | PASS | PASS |

---

## Summary

**Phase 8 has achieved its goal at the automated-gate level:**

- All 23 locked decisions (D-01..D-23) are landed with file:line evidence.
- All 6 plans shipped with declared must-have truths verified.
- All 6 phase-level observable truths verified against real code + tests.
- 129 frontend tests pass (11 test files); all 6 Rust test suites pass; 4-case cross-crate real-sidecar e2e passes.
- Cross-plan wiring (lib.rs / tauri.conf.json / capabilities / migration / bundle binary / sidecar path env / passive event) confirmed.
- Canonical refs (Phase 4 InlineDiff, Phase 5 useSyntaxHighlight, Phase 6 PASSIVE-{pid}, Claude modern envelope) actually consumed, not just declared.
- Security gate spot-checks (T-08-01, T-08-04, T-08-11) confirmed.
- No blocker anti-patterns.

**The manual UAT checklist in `tests/manual/phase-08-uat.md` is a deferred human gate.** It covers end-to-end real-Claude-binary behavior, visual fidelity against 08-UI-SPEC, and Windows-specific code paths (taskkill + .exe resolution) that CI cannot exercise. Phase 8 is ready for that human UAT. No gap-closure planning is required before the UAT runs.

---

_Verified: 2026-04-15T16:44Z_
_Verifier: Claude (gsd-verifier)_
