---
phase: 19
slug: polish-phase-10-chat-transcript-rendering-four-related-gaps
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `19-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Backend framework** | Rust `cargo test` + `#[tokio::test]` + `tokio::io::duplex` pattern |
| **Frontend framework** | `vitest@^3.0.0` + `@testing-library/react@^16.0.0` + `jsdom@^26.0.0` |
| **Backend config** | `src-tauri/Cargo.toml` — existing `[[test]]` entries |
| **Frontend config** | `vitest.config.ts` + `package.json` scripts |
| **Quick run (backend)** | `cd src-tauri && cargo test -p aitc --lib chat_runtime::parser::tests` |
| **Quick run (frontend)** | `npm run test -- src/components/chat/__tests__ src/stores/__tests__` |
| **Full suite (backend)** | `cd src-tauri && cargo test --workspace` |
| **Full suite (frontend)** | `npm run test` |
| **Estimated runtime** | ~15s backend scoped / ~8s frontend scoped; ~90s full workspace |

---

## Sampling Rate

- **After every task commit:** Run the scoped quick command matching the touched surface (Rust task → backend quick; TS task → frontend quick).
- **After every plan wave:** Run both full suites (backend + frontend).
- **Before `/gsd-verify-work`:** Both full suites must be green. No new `todo!()`, no skipped tests, no lingering `.only`.
- **Max feedback latency:** ~15s per task commit (scoped suite); ~90s per wave (full suites).

---

## Per-Task Verification Map

| ID | Decision | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Fixture | Status |
|----|----------|------|-------------|------------|-----------------|-----------|-------------------|---------|--------|
| V-19-01 | D-01.1 | 1 | One `assistant_text` row per turn (from N idle-flush deltas + 1 whole-turn envelope) | — | Row count matches turn count | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::aggregator_coalesces_one_row_per_turn` | ❌ W0 — `coalesced_turn.jsonl` | ⬜ pending |
| V-19-02 | D-01.4 | 1 | On `StdoutClosed` without `TurnComplete`, aggregator writes interrupted row + synthesizes `agent-turn-complete` emit with `terminalReason:"interrupted"` | V7 — error-handling graceful exit | No data loss; synthetic TurnComplete fires | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::aggregator_flushes_interrupted_on_stdout_closed` | ❌ W0 — `interrupted_turn.jsonl` | ⬜ pending |
| V-19-03 | D-01.5 | 1 | Whole-turn `AssistantText` envelope REPLACES buffered deltas | — | Final row == envelope content, not concatenation | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::aggregator_whole_turn_envelope_replaces_buffer` | ❌ W0 — `coalesced_turn.jsonl` | ⬜ pending |
| V-19-04 | D-01 regression | 1 | `@user` notification fires on each `AssistantText` event (not delayed to TurnComplete) | V7 | D-23 notification timing unchanged | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::aggregator_fires_at_user_notification_before_flush` | ❌ W0 | ⬜ pending |
| V-19-05 | D-02.1 | 2 | `deriveSummary` returns `{primary, secondary: "N hunks"}` for `MultiEdit` with `edits.length===N` | — | Pure function correctness | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing | ⬜ pending |
| V-19-06 | D-02.1 | 2 | `deriveSummary` returns `{primary, secondary: "N lines"}` for `Write` | — | Pure function correctness | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing | ⬜ pending |
| V-19-07 | D-02.1 | 2 | `deriveSummary` returns `{primary, secondary: "host"}` for `WebFetch` / `WebSearch` | — | URL parsing correctness | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing | ⬜ pending |
| V-19-08 | D-02.2 | 2 | `selectToolUseWithResult` returns `{toolUse, toolResult}` when both exist; `{toolUse, toolResult: null}` when only tool_use seen | — | Selector join correctness | Unit (TS) | `npm run test -- src/stores/__tests__/chatStore.test.ts` | ❌ W0 (new/extend) | ⬜ pending |
| V-19-09 | D-02.2 | 2 | `ToolUseCard` renders green dot when paired `tool_result.is_error === false` | — | Status indicator correctness | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing | ⬜ pending |
| V-19-10 | D-02.2 | 2 | `ToolUseCard` renders red dot when paired `tool_result.is_error === true` | — | Status indicator correctness | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing | ⬜ pending |
| V-19-11 | D-02.2 | 2 | `ToolUseCard` renders grey (in-flight) dot when no paired `tool_result` yet | — | Status indicator correctness | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing | ⬜ pending |
| V-19-12 | D-02.4 | 2 | Collapsed row uses `py-1.5` (CSS class assertion) and displays status dot before `TOOL` label | — | Visual polish | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing | ⬜ pending |
| V-19-13 | D-03.1 | 2 | `MarkdownBody` renders `**bold**` as `<strong>` | — | remark correctness | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ W0 | ⬜ pending |
| V-19-14 | D-03.1 | 2 | `MarkdownBody` renders `- item` as `<ul><li>` (GFM) | — | remark-gfm correctness | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ W0 | ⬜ pending |
| V-19-15 | D-03.2 | 2 | Fenced ` ```typescript ``` ` block invokes `highlightLines` with `lang="typescript"` | V5 — token escaping reuse | Shiki integration via existing singleton | Unit (TS, mocked) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ W0 | ⬜ pending |
| V-19-16 | D-03.2 | 2 | Unknown language fenced block renders as plain `<pre><code>` without crashing | V7 | Graceful fallback | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ W0 | ⬜ pending |
| V-19-17 | D-03.3 | 2 | `<script>` tag in assistant markdown does NOT end up in rendered DOM | **V5 — XSS mitigation** | react-markdown HTML-off + rehype-sanitize | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ W0 | ⬜ pending |
| V-19-18 | D-03.5 | 2 | `@user` mention in rendered markdown still wears `text-secondary font-bold` class | — | Phase 10 D-23 styling preserved | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ W0 | ⬜ pending |
| V-19-19 | D-03.6 | 2 | `MarkdownBody` with partial fenced code (no closing ```) does NOT throw | V7 | Streaming tolerance | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ W0 | ⬜ pending |
| V-19-20 | D-04.2 | 1 | Parser drops `{subtype:"hook_started", hook_name:"SessionStart:startup"}` → NO `SystemNote` emitted | — | Silent drop correctness | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::session_start_hooks_silently_dropped` | ✅ extend `hook_started_response.jsonl` | ⬜ pending |
| V-19-21 | D-04.3 | 1 | Parser surfaces `{subtype:"hook_started", hook_name:"PreToolUse:Edit"}` as `SystemNote` (regression guard) | — | Scope discipline | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::non_session_start_hooks_still_emit_system_note` | ❌ W0 — `hook_pretool_use.jsonl` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 scaffolds that MUST exist before Wave 1 implementation starts:

- [ ] `src-tauri/tests/fixtures/stream_json/coalesced_turn.jsonl` — init + 3 `text_delta` chunks across 250ms gap + whole-turn `assistant` envelope + `result` envelope. Used by V-19-01 and V-19-03.
- [ ] `src-tauri/tests/fixtures/stream_json/interrupted_turn.jsonl` — init + 2 `text_delta` chunks + EOF (no `result` envelope). Used by V-19-02.
- [ ] `src-tauri/tests/fixtures/stream_json/hook_pretool_use.jsonl` — `{type:"system", subtype:"hook_started", hook_name:"PreToolUse:Edit"}`. Used by V-19-21.
- [ ] Aggregator test harness — extend `src-tauri/src/chat_runtime/parser.rs::tests` with a helper that drives `run_event_aggregator` against `make_pool_with_chat_schema()` + a mock `tauri::AppHandle<MockRuntime>` + mpsc feed, collecting emitted events.
- [ ] `src/components/chat/__tests__/MarkdownBody.test.tsx` — new vitest suite mirroring `AssistantTextCard.test.tsx` `mk()` factory pattern; mocks `useSyntaxHighlight` to return a stub highlighter.
- [ ] `src/stores/__tests__/chatStore.test.ts` — may already exist for earlier phases; verify. If missing, create and add `selectToolUseWithResult` suite.
- [ ] Dependency installs: `npm install react-markdown@^10.1.0 remark-gfm@^4.0.1 rehype-sanitize@^6.0.0` and `npm install -D @tailwindcss/typography@^0.5.19`. Verify Tailwind v4 `@plugin` directive loading (Open Question #3 from RESEARCH.md).

---

## Manual-Only Verifications

| Behavior | Decision | Why Manual | Test Instructions |
|----------|----------|------------|-------------------|
| Codey-matching visual polish on tool-use cards (tighter vertical rhythm, surface-container/10 expand tint, status dot) | D-02.4 | Subjective visual comparison against codey reference | Launch `npm run tauri dev`, open CommsHub, trigger a few tool calls (Edit, Bash, MultiEdit), confirm collapsed-row density + tint feel match codey's `PlaygroundPage.MessageRow` aesthetic. |
| SessionStart hook noise absence in transcript | D-04.1 | Requires live Claude Code session with hooks configured | Launch a new Claude Code agent, confirm ChatTranscript shows zero `[HOOK_STARTED] SessionStart:startup` rows at boot. |
| Markdown rendering with real streamed assistant text (partial fences, long code blocks, lists, emphasis) | D-03 | Unit tests use static fixtures; streaming behavior needs live validation | Launch CommsHub, prompt Claude to emit a long markdown reply with fenced code and lists; confirm no visual glitches during streaming, final render is styled. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or explicit Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (3 new fixtures + 1 new vitest suite + dependency installs)
- [ ] No watch-mode flags in quick-run commands
- [ ] Feedback latency budget: ~15s per task commit
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 lands

**Approval:** pending
