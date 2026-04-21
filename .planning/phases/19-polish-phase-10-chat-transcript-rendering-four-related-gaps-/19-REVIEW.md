---
phase: 19
slug: polish-phase-10-chat-transcript-rendering-four-related-gaps
status: issues_found
reviewed: 2026-04-21
depth: standard
diff_base: fc09eef
files_reviewed: 11
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
---

# Phase 19 — Code Review

**Scope:** Phase 19 source files (9 modified/created + package.json + theme.css). Excludes `.planning/`, plan/summary artifacts, JSONL fixtures, `package-lock.json`.

## Summary

Phase 19 polish of the Phase 10 chat transcript pipeline is solid. The four decisions (D-01 aggregator-side coalescing, D-02 tool_use/result pairing, D-03 react-markdown + shiki, D-04 SessionStart hook drop) are implemented cleanly with a well-designed test surface. The XSS mitigation strategy (rehype-sanitize on the markdown tree + shiki HTML injected outside the sanitizer via `dangerouslySetInnerHTML` with pre-escaped tokens) is correctly wired. The security-critical `is_awaiting_user_mention` notification path is preserved byte-for-byte before the new turn buffering.

No Critical issues. Three Warnings are minor timing/defensive concerns; three Info items are style/maintenance suggestions.

## Warnings

### WR-01: `TurnBuffer` is silently dropped when the mpsc channel closes without TurnComplete or StdoutClosed

**File:** `src-tauri/src/chat_runtime/parser.rs` — `run_event_aggregator` main loop (`while let Some(event) = rx.recv().await`)

**Issue:** Aggregator flushes buffered content on `TurnComplete` and `StdoutClosed`. If the parser task panics, the supervisor teardown drops the sender early, or the test harness drops `tx` mid-turn (as `aggregator_fires_at_user_notification_before_flush` deliberately exercises), any buffered `TurnBuffer` is silently discarded without flushing. In production this path is only reachable on shutdown or parser-task panic, but a panicking parser task in production would lose a real assistant turn.

The V-19-04 test actually asserts this loss is the observable behavior (zero rows on channel-close-without-StdoutClosed), which locks in the current design. The notification-timing property it proves would be better asserted by intercepting `dispatch_chat_notification` via a testing seam.

**Fix (follow-up):** Add a post-loop flush after the `while` loop exits, mirroring the `StdoutClosed` arm with a distinct terminal reason like `"drained"`. Add a `tracing::warn!` so shutdown drops are visible. Update V-19-04 to assert notification timing via a notification-path spy rather than row-count.

**Severity:** Warning — production reach is limited but real; no blocker for ship.

### WR-02: `mapChildrenWithAtUser` tokenizes only top-level text nodes — @user inside `**bold**`, `*italic*`, or nested spans is missed

**File:** `src/components/chat/MarkdownBody.tsx` — `mapChildrenWithAtUser` (recursion handles string + array-of-string children only; skips React elements)

**Issue:** The function comments candidly flag this (D-03.5 gap). No MarkdownBody test validates or pins it. A common assistant-text pattern like `"**@user** please review"` renders with the @user mention unstyled because a `<strong>` child is passed through untouched. Pre-Phase-19 the `renderContent` tokenizer ran on the raw string *before* markdown parsing, so nested mentions still got styled. Phase 19 is a narrow visual regression for that subset.

The backend D-23 notification still fires (Rust-side `is_awaiting_user_mention` is independent of render), so the functional contract holds. Only visual styling regresses.

**Fix (follow-up):** Either (a) add a test pinning the current limitation so future regressions don't go silent, or (b) lift the tokenizer into a rehype text-visitor that walks any text node regardless of nesting. Minimum fix is (a).

**Severity:** Warning — visual regression on a narrow but real pattern.

### WR-03: `AT_USER_RE` uses a stateful `g` flag with shared `lastIndex` — fragile under re-entrant calls

**File:** `src/components/chat/MarkdownBody.tsx` — module-level `AT_USER_RE`

**Issue:** `AT_USER_RE` is a module-level `/g`-flagged regex. Current code resets `AT_USER_RE.lastIndex = 0` before each `exec` loop so sequential calls are safe. But if a future rehype visitor wires tokenization recursively, the shared `lastIndex` becomes a race hazard. Today's code isn't re-entrant; the pattern is just fragile.

**Fix:** Use `matchAll` (doesn't mutate `lastIndex`) or construct a fresh regex per call:

```tsx
const re = /(^|\W)(@user)(?=\W|$)/g; // fresh instance per call
for (const match of input.matchAll(re)) { ... }
```

**Severity:** Warning — latent defect; no current bug.

## Info

### IN-01: `selectToolUseWithResult` does an unbounded linear scan on every render

**File:** `src/stores/chatStore.ts` — `selectToolUseWithResult`, consumed by `src/components/chat/ToolUseCard.tsx` `useMemo`

**Issue:** O(N) iteration over the agent-events array per rendered ToolUseCard. With `INITIAL_LIMIT = 50` and M rendered tool_use rows, cost is O(N · M) on every event append. Acceptable at current scale; scales linearly if pagination window grows.

**Note:** The ToolUseCard comment explicitly acknowledges this as deliberate (the Map-returning selector was rejected for referential stability reasons).

**Fix (future):** Secondary `toolResultByToolUseId: Record<string, AgentEvent>` store slice built incrementally on `agent-event-appended`. O(1) lookup, zero selector iteration. Defer until scale demands it.

**Severity:** Info — deliberately deferred performance optimization.

### IN-02: `deriveSummary` silently coerces non-string values via `String(…)` — `[object Object]` leakage risk

**File:** `src/components/chat/ToolUseCard.tsx` — `deriveSummary` branches

**Issue:** Phase 19's contract is `tool_input: Record<string, unknown>` — the TypeScript types don't guarantee strings on keys like `command`, `pattern`, `url`, `file_path`. An MCP server producing structured inputs (e.g. `command: ['ls', '-la']`) would leak `[object Object]` into the UI.

**Fix:** `typeof` guard before coercion:

```tsx
const cmd = typeof toolInput.command === 'string' ? toolInput.command : '';
```

Apply consistently to `command`, `pattern`, `url`, `file_path`.

**Severity:** Info — defensive hygiene; no current crashes.

### IN-03: `package.json` new deps use caret ranges — sanitize-schema drift risk on minor upgrades

**File:** `package.json`

**Issue:** New dependencies:
- `react-markdown: ^10.1.0`
- `rehype-sanitize: ^6.0.0`
- `remark-gfm: ^4.0.1`
- `@tailwindcss/typography: ^0.5.19` (devDep)

Caret ranges are fine — no CVE flags on these packages as of April 2026. However, since MarkdownBody is the XSS boundary for assistant-generated content, a silent minor upgrade to `rehype-sanitize` could change the default sanitize schema. The schema pinning is implicit in the major version.

**Fix (future):** Pass an explicit sanitize schema via `defaultSchema` from `hast-util-sanitize` so future upgrades require explicit opt-in to schema changes:

```ts
import { defaultSchema } from 'hast-util-sanitize';
const SCHEMA = { ...defaultSchema /* freeze or extend deliberately */ };
```

**Severity:** Info — advisory for future `npm update` review, not a current vulnerability.

## Verification of phase-context concerns (from the review brief)

Explicitly checked against the six questions in the review brief:

1. **MarkdownBody sanitizer wiring** — `rehypeSanitize` is wired as a rehype plugin to `<Markdown>`; `react-markdown` defaults to `allowDangerousHtml: false` preserved; shiki HTML via `dangerouslySetInnerHTML` on a React element returned by the `code:` override — bypasses the rehype tree entirely. Shiki's inline-style spans correctly survive because they never enter the sanitizer. XSS protection intact: `<script>` stripped by rehype-sanitize, `highlightLines` HTML-escapes token content, `safeCssColor` validates inline colors. **Correctly wired (Pattern 4).**

2. **parser.rs `TurnBuffer` lifetime** — `is_awaiting_user_mention` fires on every `AssistantText` arm BEFORE the buffer write, preserving D-23 timing. `AssistantDelta` arm byte-identical to pre-Phase-19. Flush paths: `TurnComplete` and `StdoutClosed`. **Gap on normal channel-close (WR-01).**

3. **chatStore.ts `selectToolUseWithResult`** — O(N) iteration (IN-01). Defensive on missing `tool_use_id`. No internal Map leakage. **Correct.**

4. **ToolUseCard.tsx status dot** — semantics correct. `is_error === true` → red, `is_error === false` → green, no paired result → grey. `<ToolPreview>` invocation preserves Phase 8 contract. **Correct.**

5. **package.json CVE scan** — no known CVEs on any of the 4 new deps (April 2026).

6. **Tests** — realistic assertions, not over-mocked. V-19-13..V-19-19 cover real behaviors. The `highlightLines` spy mock is necessary-and-sufficient. Only gap: no `@user` in `**bold**` test (WR-02).

## Files Reviewed

- `package.json`
- `src-tauri/src/chat_runtime/parser.rs`
- `src/components/chat/AssistantTextCard.tsx`
- `src/components/chat/MarkdownBody.tsx`
- `src/components/chat/ToolUseCard.tsx`
- `src/components/chat/__tests__/AssistantTextCard.test.tsx`
- `src/components/chat/__tests__/MarkdownBody.test.tsx`
- `src/components/chat/__tests__/ToolUseCard.test.tsx`
- `src/stores/chatStore.ts`
- `src/stores/__tests__/chatStore.test.ts`
- `src/styles/theme.css`
