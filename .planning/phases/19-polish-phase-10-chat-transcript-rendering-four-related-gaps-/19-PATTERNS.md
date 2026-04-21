# Phase 19: Polish Phase 10 chat transcript rendering — Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 11 (3 modified backend/frontend, 2 modified tests, 2 new components, 3 new fixtures, 1 modified fixture assertion)
**Analogs found:** 11 / 11 (MarkdownBody has no role-exact analog — uses structural match only)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src-tauri/src/chat_runtime/parser.rs` (modify: `dispatch_system` + `run_event_aggregator`) | parser / aggregator | event-driven (mpsc → DB+emit) | Self — existing `dispatch_system` (L209-237) + `run_event_aggregator` (L461-705) | exact (in-file evolution) |
| `src-tauri/src/chat_runtime/parser.rs::tests` (extend) | Rust test suite | request-response (fixture→events) | Self — existing `run_reader_against_bytes` harness (L714-738) + `parses_hook_started_response_emits_system_note_not_assistant` (L867-881) | exact |
| `src/stores/chatStore.ts` (modify: add `selectToolUseWithResult`) | Zustand store selector | pure function (cross-event join) | Self — existing `totalUnread()` closure selector (L377-380) | exact (pattern match) |
| `src/stores/__tests__/chatStore.test.ts` (extend) | vitest store suite | request-response | Self — `useChatStore.setState` + assertion pattern throughout the file | exact |
| `src/components/chat/AssistantTextCard.tsx` (modify) | React 19 component | request-response (props → JSX) | Self — existing component (L1-105) | exact (in-place refactor) |
| `src/components/chat/ToolUseCard.tsx` (modify) | React 19 component | request-response (props + store selector → JSX) | Self (L1-143); see also `ApprovalLinkCard.tsx` for status-navigate pattern | exact |
| `src/components/chat/MarkdownBody.tsx` (NEW) | React 19 component | transform (string → parsed → JSX) | Structural: `src/views/CommsHub/ToolPreview/WritePreview.tsx` (shiki imperative integration) + `AssistantTextCard.tsx` (props shape, `@user` renderer) | no prior analog for `react-markdown` — use structural composite |
| `src/components/chat/__tests__/MarkdownBody.test.tsx` (NEW) | vitest component suite | request-response | `AssistantTextCard.test.tsx` (mk() factory + plain render); `ToolUseCard.test.tsx` (vi.mock for `motion/react` + ToolPreview) | exact structural match |
| `src/components/chat/__tests__/ToolUseCard.test.tsx` (extend) | vitest component suite | request-response | Self — existing suite (L1-107) | exact |
| `src-tauri/tests/fixtures/stream_json/coalesced_turn.jsonl` (NEW) | Rust test fixture | batch (JSONL lines) | `single_turn_text.jsonl` (10 lines — `init` + deltas + assistant envelope + result) | exact |
| `src-tauri/tests/fixtures/stream_json/interrupted_turn.jsonl` (NEW) | Rust test fixture | batch (JSONL lines) | `single_turn_text.jsonl` — but truncated before `result` | role-match (truncate the analog) |
| `src-tauri/tests/fixtures/stream_json/hook_pretool_use.jsonl` (NEW) | Rust test fixture | batch (JSONL lines) | `hook_started_response.jsonl` (2 lines) | exact (shape twin, different `hook_name`) |
| `src-tauri/tests/fixtures/stream_json/hook_started_response.jsonl` (existing — preserve) | Rust test fixture | batch (JSONL lines) | Self — assertion changes from `note_count == 2` to `note_count == 0` | exact |

## Pattern Assignments

### `src-tauri/src/chat_runtime/parser.rs` — `dispatch_system` SessionStart filter (D-04)

**Analog:** Self (in-file evolution of the existing `hook_started | hook_response | hook_completed` match arm).

**Current pattern** (`parser.rs` L209-237) — `dispatch_system`:
```rust
async fn dispatch_system(v: &serde_json::Value, sink: &mpsc::Sender<StreamEvent>) {
    let subtype = v.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
    match subtype {
        "init" => {
            if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                let _ = sink
                    .send(StreamEvent::SessionStarted {
                        session_id: sid.to_string(),
                    })
                    .await;
            }
        }
        // Pitfall 2: hook lifecycle metadata — surface as SystemNote so the
        // UI can render it subtly, not as assistant chat text.
        "hook_started" | "hook_response" | "hook_completed" => {
            let hook_name = v
                .get("hook_name")
                .and_then(|s| s.as_str())
                .unwrap_or("");
            let text = format!("[{subtype}] {hook_name}");
            let _ = sink.send(StreamEvent::SystemNote { text }).await;
        }
        _ => {
            let text = format!("[system/{subtype}]");
            let _ = sink.send(StreamEvent::SystemNote { text }).await;
        }
    }
}
```

**To copy from:** the existing `hook_name` extraction idiom (`v.get("hook_name").and_then(|s| s.as_str()).unwrap_or("")`) is already in place; the Phase 19 change inserts a single `if hook_name.starts_with("SessionStart:") { return; }` guard immediately after the extraction, before the `sink.send`. Preserve the `// Pitfall 2` comment and the `"init"` / `_` arms verbatim.

### `src-tauri/src/chat_runtime/parser.rs` — `run_event_aggregator` coalescing (D-01)

**Analog:** Self (in-file evolution of `run_event_aggregator` L461-705).

**Per-agent-task topology** (`agents/commands.rs:243`):
```rust
crate::chat_runtime::parser::spawn_event_aggregator(
    event_rx,
    agent_id.clone(),
    pool.clone(),
    chat_sessions.clone(),
    app_handle.clone(),
);
```
One aggregator task is spawned per launched agent. This is the only caller. **Implication for the `TurnBuffer`**: it's a local variable inside `run_event_aggregator`'s scope, **not** a `HashMap<AgentId, TurnBuffer>`.

**Current AssistantText arm** (`parser.rs` L496-534) — the DB write that must move to `TurnComplete`:
```rust
StreamEvent::AssistantText { content, model } => {
    // D-23: check for word-bounded @user BEFORE the DB write so a
    // slow DB doesn't delay the notification. catch_unwind inside
    // dispatch_chat_notification makes this safe even in tests.
    if is_awaiting_user_mention(&content) {
        super::notifications::dispatch_chat_notification(
            &app_handle,
            &agent_id,
            &truncate_for_notification(&content, 80),
            Some(&agent_id),
        );
    }
    let session_id = sessions.session_id_for(&agent_id).await;
    let payload = serde_json::json!({
        "content": content,
        "model": model,
    });
    match crate::db::events::insert_agent_event(
        &pool,
        &agent_id,
        session_id.as_deref(),
        "assistant_text",
        &payload,
        None,
        None,
        None,
    )
    .await
    {
        Ok(row) => {
            if let Err(e) = app_handle.emit("agent-event-appended", &row) {
                tracing::debug!(agent_id = %agent_id, err = %e, "event-appended emit");
            }
        }
        Err(e) => {
            tracing::warn!(agent_id = %agent_id, err = %e, "assistant_text insert");
        }
    }
}
```

**Patterns to preserve when coalescing:**
- **@user notification fires BEFORE any DB op** — this exact early-fire call (L500-507) must stay inside the `AssistantText` arm so D-23 latency is not regressed (see Pitfall 1 in RESEARCH.md).
- **Session-id lookup idiom** — `let session_id = sessions.session_id_for(&agent_id).await;` before the insert (L508). Re-use verbatim inside the `TurnComplete` flush path and the `StdoutClosed` flush path.
- **Payload shape** — `serde_json::json!({ "content": content, "model": model })` (L509-512). Keys are snake_case per Phase 10 D-07 (matches Claude stream-json). Do NOT rename to camelCase — the `AssistantTextCard` reads `payloadJson.content` which tauri-specta passes through as-is, and the coalesced row must match the existing frontend reader. **Verify with:** `AssistantTextCard.tsx` L65-69 payload cast.
- **Insert → emit error handling** — `match … { Ok(row) => emit, Err(e) => tracing::warn! }` (L513-533). Copy this exact match shape for the new `TurnComplete` flush write.
- **`tauri::Emitter` import** — already at L468 (`use tauri::Emitter;`). Do not re-import inside the flush branch.

**TurnComplete arm** (`parser.rs` L598-634) — where the new `if let Some(buf) = turn_buffer.take()` flush lands BEFORE the existing `find_last_user_text_id` delivery-flip:
```rust
StreamEvent::TurnComplete {
    terminal_reason,
    is_error,
} => {
    // Flip the most recent user_text row's delivery_status to
    // "consumed" — the turn that just ended was the assistant's
    // response to that message.
    let session_id = sessions.session_id_for(&agent_id).await;
    // ... delivery flip ...
    let payload = serde_json::json!({
        "terminalReason": terminal_reason,
        "isError": is_error,
    });
    if let Err(e) = app_handle.emit("agent-turn-complete", &payload) {
        tracing::debug!(agent_id = %agent_id, err = %e, "turn-complete emit");
    }
}
```
The Phase 19 flush INSERT must land AFTER `let session_id = sessions.session_id_for(&agent_id).await;` (reuse the same session_id value for the flush + the delivery flip) and BEFORE the `agent-turn-complete` emit (so the frontend's turn-complete handler sees the coalesced row before it flips `streaming: false`).

**StdoutClosed arm** (`parser.rs` L698-702) — current body is a single `tracing::debug!`:
```rust
StreamEvent::StdoutClosed => {
    // Reader hit EOF; the supervisor's wait() will emit the
    // session_boundary row. Nothing to do here.
    tracing::debug!(agent_id = %agent_id, "stdout closed; aggregator draining");
}
```
Phase 19 D-01.4 adds the interrupted-turn flush before the debug log. Reuse the exact same INSERT + emit match-on-result shape as the `AssistantText` arm (L513-533) and the same `agent-turn-complete` emit shape as L627-633 (payload keys `agentId`, `terminalReason`, `isError` — camelCase here because this is a Tauri emit payload, not a DB payload; matches existing convention).

### `src-tauri/src/chat_runtime/parser.rs::tests` — aggregator + SessionStart tests (extend)

**Analog (in-file):** `run_reader_against_bytes` harness + existing fixture tests.

**Reader harness pattern** (`parser.rs` L714-738):
```rust
async fn run_reader_against_bytes(bytes: &[u8]) -> Vec<StreamEvent> {
    let (mut write_half, read_half) = tokio::io::duplex(64 * 1024);
    let buf = bytes.to_vec();
    let write_task = tokio::spawn(async move {
        write_half.write_all(&buf).await.unwrap();
        write_half.shutdown().await.unwrap();
        drop(write_half);
    });
    let (tx, mut rx) = mpsc::channel(256);
    let reader_task = tokio::spawn(drive_stream_json_reader(
        read_half,
        "A-1".to_string(),
        tx,
    ));
    let mut out = Vec::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while let Ok(Some(ev)) = tokio::time::timeout_at(deadline, rx.recv()).await {
        out.push(ev);
    }
    let _ = write_task.await;
    let _ = reader_task.await;
    out
}

fn load_fixture(name: &str) -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/stream_json")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("read fixture {name}: {e}"))
}
```

**SessionStart drop test pattern** — directly adapt the existing `parses_hook_started_response_emits_system_note_not_assistant` (L866-881):
```rust
#[tokio::test]
async fn parses_hook_started_response_emits_system_note_not_assistant() {
    let bytes = load_fixture("hook_started_response.jsonl");
    let events = run_reader_against_bytes(&bytes).await;
    let note_count = events
        .iter()
        .filter(|e| matches!(e, StreamEvent::SystemNote { .. }))
        .count();
    let asst_count = events
        .iter()
        .filter(|e| matches!(e, StreamEvent::AssistantText { .. }))
        .count();
    assert_eq!(note_count, 2);
    assert_eq!(asst_count, 0);
}
```
**D-04 Phase 19 change:** flip the assertion from `note_count == 2` to `note_count == 0` (silent drop). Add a twin test `non_session_start_hooks_still_emit_system_note` that loads `hook_pretool_use.jsonl` and asserts `note_count == 1` (one `hook_started` envelope for `PreToolUse:Edit`).

**Aggregator test harness — new wrapper (Wave 0 scaffold).** Model on `supervisor.rs` L95-146 which shows the canonical `tauri::test::mock_app()` + `make_pool_with_chat_schema()` + `LiveSessionRegistry` composition:
```rust
// From src-tauri/src/chat_runtime/supervisor.rs:115-146
let pool = make_pool_with_chat_schema().await;
let registry = Arc::new(LiveSessionRegistry::new());
let (sess, _rx) = make_live_session("A-1");
registry.register(sess).await;
registry.bind_session_id("A-1", "sess-1".into()).await;

let app = tauri::test::mock_app();
let app_handle = app.handle().clone();
// … spawn + await … then read rows back:
let rows = crate::db::events::list_events_for_agent(&pool, "A-1", None, 10)
    .await
    .unwrap();
let boundary = rows
    .iter()
    .find(|e| e.event_type == "session_boundary")
    .expect("session_boundary row inserted");
assert_eq!(boundary.payload_json["kind"], serde_json::json!("ended"));
```

**To copy from:**
- `make_pool_with_chat_schema()` — already `pub(crate)` from `crate::db::events::tests` (L214-274 in `events.rs`).
- `make_live_session("A-1")` — already `pub(crate)` from `crate::chat_runtime::session_registry::tests` (L124).
- `tauri::test::mock_app().handle().clone()` — the aggregator takes `tauri::AppHandle<R>` generically (signature `pub fn spawn_event_aggregator<R: tauri::Runtime>(…)`), so `MockRuntime` satisfies the bound.
- Row-readback assertion via `crate::db::events::list_events_for_agent(&pool, "A-1", None, 10)` — this is the idiomatic way to observe aggregator writes.

**Aggregator harness sketch for Phase 19 (new, lands in `parser.rs::tests`):**
```rust
async fn run_aggregator_with_events(
    agent_id: &str,
    events: Vec<StreamEvent>,
) -> (sqlx::SqlitePool, std::sync::Arc<LiveSessionRegistry>) {
    let pool = crate::db::events::tests::make_pool_with_chat_schema().await;
    let registry = LiveSessionRegistry::new_arc();
    let (sess, _rx) = crate::chat_runtime::session_registry::tests::make_live_session(agent_id);
    registry.register(sess).await;
    let app = tauri::test::mock_app();
    let app_handle = app.handle().clone();
    let (tx, rx) = mpsc::channel::<StreamEvent>(64);
    let handle = spawn_event_aggregator(rx, agent_id.to_string(), pool.clone(), registry.clone(), app_handle);
    for ev in events {
        tx.send(ev).await.unwrap();
    }
    drop(tx); // closes the channel so the aggregator's while-let returns
    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), handle).await;
    (pool, registry)
}
```
Then per-test: construct an input `Vec<StreamEvent>` (N `AssistantText`s + one `TurnComplete`), call the harness, assert `list_events_for_agent` returns exactly one `assistant_text` row with the merged content.

### `src/stores/chatStore.ts` — `selectToolUseWithResult` selector (D-02.2)

**Analog:** existing `totalUnread()` closure selector in the same file (L377-380).

**Existing selector pattern** (`chatStore.ts` L377-380):
```ts
totalUnread: () => {
  const counts = Object.values(get().unreadByAgent);
  return counts.reduce((a, b) => a + b, 0);
},
```
This is a **state method** on the store — the precedent for "store-side derived data" is a no-arg closure that pulls from `get()`.

**Why a pure export, not a method, for `selectToolUseWithResult`:** unlike `totalUnread`, the tool-use/tool-result join needs (a) an `agentId` or pre-filtered events array and (b) a `toolUseId` argument. That's two inputs, which doesn't fit the zero-arg `get()`-closure shape. Export as a **free function** that takes `(events, toolUseId)` and call via `useChatStore((s) => selectToolUseWithResult(s.eventsByAgent[agentId] ?? [], toolUseId))` — mirrors the existing `useChatStore((s) => s.eventsByAgent[agentId] ?? [])` selector call shape already widespread in the codebase (see chatStore test L171, component render paths).

**AgentEvent type shape** (`chatStore.ts` L18-28):
```ts
export interface AgentEvent {
  id: number;
  agentId: string;
  sessionId: string | null;
  eventType: string;
  payloadJson: unknown;
  approvalRequestId: number | null;
  sequenceNumber: number | null;
  createdAt: string;
  deliveryStatus: 'queued' | 'delivered' | 'consumed' | 'unsupported' | null;
}
```
**`payloadJson` is `unknown`** — consumers narrow with a typed cast like `(e.payloadJson as { tool_use_id?: string } | null) ?? {}` (compare `ToolUseCard.tsx` L54-58 and `AssistantTextCard.tsx` L65-69). Reuse that narrowing idiom inside `selectToolUseWithResult`.

### `src/stores/__tests__/chatStore.test.ts` — selector tests (extend)

**Analog:** the full existing test file — specifically the `useChatStore.setState` + direct function-call assertion pattern used by `totalUnread` (L375-378):
```ts
it('totalUnread sums unreadByAgent', () => {
  useChatStore.setState({ unreadByAgent: { a: 2, b: 5, c: 0 } });
  expect(useChatStore.getState().totalUnread()).toBe(7);
});
```

**For `selectToolUseWithResult`** — seed `eventsByAgent` with a synthesized `tool_use` + `tool_result` pair via `setState`, then call the exported function directly (not via `useChatStore`):
```ts
it('selectToolUseWithResult pairs tool_use and tool_result by tool_use_id', () => {
  const toolUse = mkToolUse(5, 'toolu_01');    // helper to be added
  const toolResult = mkToolResult(6, 'toolu_01', false);
  useChatStore.setState({ eventsByAgent: { a: [toolUse, toolResult] } });
  const { toolUse: tu, toolResult: tr } =
    selectToolUseWithResult(useChatStore.getState().eventsByAgent['a'] ?? [], 'toolu_01');
  expect(tu?.id).toBe(5);
  expect(tr?.id).toBe(6);
});
```

**To copy from:** the existing `mkUser` / `mkAssistant` factory functions (L40-76) — mirror that pattern to define `mkToolUse(id, toolUseId, overrides?)` and `mkToolResult(id, toolUseId, isError, overrides?)`.

### `src/components/chat/AssistantTextCard.tsx` (modify — delegate body to MarkdownBody)

**Analog:** Self (in-place swap of body render).

**Current body** (L84-105):
```tsx
return (
  <div data-testid="assistant-text-card" className={wrapperClass}>
    {!isContinuation && (
      <div className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/70 mb-1">
        CLAUDE
      </div>
    )}
    <p className={`font-mono text-sm ${bodyColor} whitespace-pre-wrap leading-relaxed`}>
      {renderContent(content)}
      {streaming && <StreamingCursor />}
    </p>
    {streaming && (
      <span
        aria-live="polite"
        className="font-headline text-[10px] font-bold tracking-widest uppercase text-secondary mt-2 inline-block"
      >
        STREAMING…
      </span>
    )}
  </div>
);
```

**Preserve verbatim:** `data-testid`, `wrapperClass`, `isContinuation` check (L80-82), `bodyColor` derivation (L71-75), `streaming` label block (L95-102). **Replace only:** the `<p>...</p>` body at L91-94 becomes `<MarkdownBody content={content} streaming={streaming} bodyColor={bodyColor} />` (or similar — Claude's discretion on prop shape per CONTEXT §D-03.5). The `renderContent` function at L32-59 and `AT_USER_RE` regex at L30 move **into** `MarkdownBody.tsx` or a shared util (see Open Question 1 in RESEARCH.md).

### `src/components/chat/ToolUseCard.tsx` (modify — dispatcher + status dot + paired result)

**Analog:** Self (in-place enrichment).

**`deriveSummary` current shape** (L23-49) — single-string return, switch-based dispatcher:
```tsx
function deriveSummary(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
): string {
  if (!toolInput) return '';
  const filePath = toolInput.file_path as string | undefined;
  const command = toolInput.command as string | undefined;
  const pattern = toolInput.pattern as string | undefined;
  const url = toolInput.url as string | undefined;
  switch (toolName) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'Read':
      return filePath ?? '';
    case 'Bash':
      return command ?? '';
    case 'Grep':
    case 'Glob':
      return pattern ?? '';
    case 'WebFetch':
    case 'WebSearch':
      return url ?? '';
    default:
      return (filePath ?? command ?? pattern ?? url ?? '') as string;
  }
}
```

**Patterns to keep for the enriched dispatcher:** the `switch (toolName)` shape + the per-tool `toolInput.X as string | undefined` narrowing pattern. Per CONTEXT §D-02.1 / RESEARCH §Code Examples, extend to return `{ primary: string; secondary?: string }` — splitting the file_path (primary) from structural count (secondary, e.g. `"1 hunk"`, `"3 lines"`). Mirror the tool-name list exactly — Phase 8 registry (`src/views/CommsHub/ToolPreview/registry.ts` L32-45) is the canonical catalog: `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, `Bash`, `Read`, `LS`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `Task`. **Do not modify** `registry.ts` (Phase 8 contract-lock — see Pitfall 6).

**Store-selector consumption pattern** (new — model on the `selectedAgentId` derivation idiom in the store itself; component-side, use `useChatStore((s) => …)` — seen throughout the codebase):
```tsx
// NEW — inside ToolUseCard component body
import { useChatStore, selectToolUseWithResult } from '../../stores/chatStore';
// …
const toolUseId = (payload.tool_use_id as string | undefined) ?? '';
const agentId = event.agentId;
const paired = useChatStore(
  (s) => selectToolUseWithResult(s.eventsByAgent[agentId] ?? [], toolUseId),
);
const toolResult = paired.toolResult;
```

**Status-dot placement** — inject a `<span className="shrink-0 rounded-full w-2 h-2 {color}" />` just before the `TOOL` label at L87-89 (keep the label's `shrink-0` + `font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/50` classes — tailwind shapes dict the visual rhythm). Color classes reference the existing design-token system (`bg-status-success` / `bg-status-error` / `bg-on-surface-variant/30`).

**Visual polish to apply:** `py-2` → `py-1.5` on the inner `<button>` (L84); `bg-surface-container/20` → `bg-surface-container/10` on the expanded body `<div>` (L130). The surrounding `motion.div layout` + `AnimatePresence` wrapper (L75-79, L121-140) stays unchanged.

**Navigation guard** — `handleApprovalClick` + `e.stopPropagation()` (L64-72) is a Phase 10 pattern: preserve exactly. Do not let the new status dot intercept clicks.

### `src/components/chat/MarkdownBody.tsx` (NEW)

**Analog:** **No exact React-markdown precedent in the repo.** Closest structural matches:
- **Shiki imperative integration:** `src/views/CommsHub/ToolPreview/WritePreview.tsx` (L14-78) — the canonical pattern for consuming `useSyntaxHighlight` + `highlightLines` and routing through `dangerouslySetInnerHTML`.
- **Props-shape + testid + body-render composition:** `AssistantTextCard.tsx` (full file) — this is the parent that will delegate to `MarkdownBody`; props should be narrowly-typed mirror of that file's `content` + `streaming` inputs.
- **`@user` tokenizer:** `AssistantTextCard.renderContent` (L32-59) — copy this verbatim as the text-node renderer inside `MarkdownBody`.

**Shiki integration pattern** (from `WritePreview.tsx` L14-78):
```tsx
import { useState, useMemo } from 'react';
import { useSyntaxHighlight, highlightLines } from '../../../hooks/useSyntaxHighlight';
import { inferLanguage } from './helpers';

const { highlighter } = useSyntaxHighlight();

const lines = useMemo(() => {
  if (!highlighter || content === '') return null;
  try {
    return highlightLines(highlighter, content, lang);
  } catch {
    return null;
  }
}, [highlighter, content, lang]);

// Render:
<div
  className="bg-surface-container-lowest p-4 border border-outline-variant/15 overflow-auto font-mono text-xs leading-5"
  // …
>
  {lines
    ? lines.map((html, i) => (
        <div key={i} dangerouslySetInnerHTML={{ __html: html === '' ? '&nbsp;' : html }} />
      ))
    : // Fallback: render the raw content with React (auto-escaped) while
      // the shiki highlighter warms up or if highlighting fails.
      content.split('\n').map((line, i) => (
        <div key={i}>{line === '' ? ' ' : line}</div>
      ))}
</div>
```

**Critical safety notes (preserve from `WritePreview.tsx` L6-13 + `useSyntaxHighlight.ts` L97-112):**
- `highlightLines` HTML-escapes token content internally (T-05-07); `dangerouslySetInnerHTML` receives pre-escaped shiki spans only.
- Wrap the `highlightLines` call in `try { … } catch { return null; }` so a shiki failure falls back to plain `<pre><code>` (RESEARCH Pitfall 5 — broken-fence self-heal).
- Use `useMemo` keyed on `[highlighter, content, lang]` to avoid re-highlighting every frame during streaming.

**`@user` renderer pattern** (`AssistantTextCard.tsx` L30, L32-59):
```tsx
const AT_USER_RE = /(^|\W)(@user)(?=\W|$)/g;

function renderContent(content: string): React.ReactNode[] {
  if (!content) return [];
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  AT_USER_RE.lastIndex = 0;
  while ((match = AT_USER_RE.exec(content)) !== null) {
    const leading = match[1] ?? '';
    const mentionStart = match.index + leading.length;
    if (mentionStart > cursor) {
      parts.push(content.slice(cursor, mentionStart));
    }
    parts.push(
      <span key={`mention-${key++}`} className="text-secondary font-bold">
        @user
      </span>,
    );
    cursor = mentionStart + '@user'.length;
  }
  if (cursor < content.length) {
    parts.push(content.slice(cursor));
  }
  return parts;
}
```
Use this tokenizer as the `components.p`-level text-node renderer inside `MarkdownBody` so the D-23 styling survives the markdown pass.

**StreamingCursor preservation** (`AssistantTextCard.tsx` L15, L93):
```tsx
import { StreamingCursor } from './StreamingCursor';
// …
{streaming && <StreamingCursor />}
```
The cursor lives at the end of the rendered body — trail it after the `<Markdown>` element inside the same prose container.

### `src/components/chat/__tests__/MarkdownBody.test.tsx` (NEW)

**Analog:** `AssistantTextCard.test.tsx` (L1-71) for the `mk()` factory + shape; `ToolUseCard.test.tsx` (L1-35) for `vi.mock` composition of child modules.

**`mk()` factory pattern** (`AssistantTextCard.test.tsx` L6-19):
```tsx
function mk(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 2,
    agentId: 'a',
    sessionId: '0d836c4f',
    eventType: 'assistant_text',
    payloadJson: { content: 'OK' },
    approvalRequestId: null,
    sequenceNumber: null,
    createdAt: '2026-04-17T12:00:00Z',
    deliveryStatus: null,
    ...overrides,
  };
}
```
For `MarkdownBody.test.tsx` the factory signature simplifies to `mk({ content?, streaming? })` returning raw props, since the component doesn't take an `AgentEvent`.

**Module-mocking pattern** (`ToolUseCard.test.tsx` L8-35) — copy the `vi.mock(…, () => ({ … }))` structure:
```tsx
vi.mock('motion/react', () => ({
  motion: { /* strip motion props */ },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../views/CommsHub/ToolPreview', () => ({
  ToolPreview: (props: Record<string, unknown>) => (
    <div data-testid="tool-preview-stub" data-tool-name={props.toolName as string} />
  ),
}));
```
For `MarkdownBody.test.tsx`:
- Mock `useSyntaxHighlight` to return a stub `highlighter: {}` and a deterministic `highlightLines` (e.g., returns `['<span>STUB</span>']`) so tests can assert the code-block path without waiting for the shiki singleton.
- `react-markdown` runs unmocked (D-03.2 — want real markdown output to verify `**bold**` → `<strong>`).

**Assertion idioms** (`AssistantTextCard.test.tsx` L55-65 — the `@user` assertion):
```tsx
it('@user tokens are wrapped in a secondary-colored span', () => {
  render(<AssistantTextCard event={mk({ payloadJson: { content: 'please confirm @user thanks' } })} />);
  const highlight = screen.getByText('@user');
  expect(highlight.tagName).toBe('SPAN');
  expect(highlight.className).toContain('text-secondary');
  expect(highlight.className).toContain('font-bold');
});
```
**Copy this exact pattern** for the `MarkdownBody` `@user` preservation test.

### `src/components/chat/__tests__/ToolUseCard.test.tsx` (extend)

**Analog:** Self. Existing factory `mk` (L37-53) + `renderWithRouter` (L55-57) + `vi.mock` block (L8-35).

**Stub `useChatStore` for selector** — the Phase 19 component now reads paired `tool_result` via `useChatStore((s) => selectToolUseWithResult(…))`. Add a `vi.mock('../../../stores/chatStore', () => ({ ... }))` block at the top of the file mirroring the `ToolPreview` mock shape — return a controllable stub:
```tsx
vi.mock('../../../stores/chatStore', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ eventsByAgent: { a: [] } }),
  selectToolUseWithResult: vi.fn(),
}));
```
Then per test, override `selectToolUseWithResult.mockReturnValue({ toolUse: …, toolResult: … })`.

**Status-dot assertion pattern** — use `querySelector` against the expected color class, mirroring `ToolUseCard.test.tsx` L77-79 (querySelector against an attribute):
```tsx
const dot = card.querySelector('[data-testid="tool-status-dot"]');
expect(dot).not.toBeNull();
expect(dot!.className).toContain('bg-status-success');
```

### Rust test fixtures (NEW)

**Analog per file:**

| New fixture | Analog | Lines to mirror |
|-------------|--------|-----------------|
| `coalesced_turn.jsonl` | `single_turn_text.jsonl` (10 lines) | L1 (`init`), L2 (`message_start`), L3 (`content_block_start`), L4-5 (`text_delta` — DUPLICATE/extend to 3 deltas across time-gap boundary), L6 (`assistant` envelope with merged content), L7-9 (`content_block_stop`, `message_delta`, `message_stop`), L10 (`result`). The key variant: 3 deltas instead of 2 so the test asserts "3 idle-flush `AssistantText` events + 1 whole-turn envelope → 1 DB row". |
| `interrupted_turn.jsonl` | `single_turn_text.jsonl` with truncation | L1 (`init`), L2 (`message_start`), L3 (`content_block_start`), L4-5 (two `text_delta` events), then **EOF** — no `assistant` envelope, no `result`. This fires the `StdoutClosed` flush path with content `"OK"` (or whatever the partials accumulated to). |
| `hook_pretool_use.jsonl` | `hook_started_response.jsonl` (2 lines) | Same envelope shape, just change `hook_name` from `"SessionStart:startup"` to `"PreToolUse:Edit"`. This is the D-04.3 regression guard — non-SessionStart hooks must still emit `SystemNote`. |

**Copy from `single_turn_text.jsonl`** (the canonical happy-path fixture — L1-10 verbatim is the reusable spine):
```jsonl
{"type":"system","subtype":"init","cwd":"/tmp","session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7","tools":["Bash","Edit","Read","Write"],"mcp_servers":[],"model":"claude-opus-4-7[1m]","permissionMode":"default","claude_code_version":"2.1.112","uuid":"855e569a-0000-0000-0000-000000000001"}
{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-opus-4-7","id":"msg_017pTBm93vejH2pi8QVfg18p","type":"message","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":4,"output_tokens":1}}},"session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7"}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7"}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"O"}},"session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7"}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"K"}},"session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7"}
{"type":"assistant","message":{"model":"claude-opus-4-7","id":"msg_017pTBm93vejH2pi8QVfg18p","type":"message","role":"assistant","content":[{"type":"text","text":"OK"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":4,"output_tokens":2}},"session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7"}
{"type":"stream_event","event":{"type":"content_block_stop","index":0},"session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7"}
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null,"stop_details":null},"usage":{"input_tokens":4,"output_tokens":2}},"session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7"}
{"type":"stream_event","event":{"type":"message_stop"},"session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7"}
{"type":"result","subtype":"success","is_error":false,"duration_ms":2223,"num_turns":1,"result":"OK","stop_reason":"end_turn","session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7","total_cost_usd":0.299,"terminal_reason":"completed"}
```

**Copy from `hook_started_response.jsonl`** (2-line twin pattern):
```jsonl
{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup","session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7"}
{"type":"system","subtype":"hook_response","hook_name":"SessionStart:startup","session_id":"0d836c4f-8546-4aeb-a994-6fb94ba800b7"}
```
For `hook_pretool_use.jsonl` — flip `hook_name` to `"PreToolUse:Edit"` (one line is sufficient for the D-04.3 regression guard; the existing 2-line pattern works too).

## Shared Patterns

### Payload key convention (snake_case on wire, camelCase in Tauri emit)

**Source:** `src-tauri/src/chat_runtime/parser.rs` L542-550 (tool_use aggregator payload) and L509-512 (assistant_text aggregator payload).

**Apply to:** every new DB payload constructed inside `run_event_aggregator` (D-01 flush writes must use the same convention).
```rust
let payload = serde_json::json!({
    "content": content,
    "model": model,
});
```
vs. a Tauri emit payload (L627-630):
```rust
let payload = serde_json::json!({
    "terminalReason": terminal_reason,
    "isError": is_error,
});
```
**Rule:** DB payloads = snake_case (round-trip to frontend `payloadJson` unchanged — the specta bridge does not rename keys inside a `Value`). Tauri emit payloads with named fields = camelCase (matches the TS listener payload types in `chatStore.ts` L41-58).

### Type-narrowed `payloadJson` consumption (frontend)

**Source:** `src/components/chat/AssistantTextCard.tsx` L65-69 + `ToolUseCard.tsx` L54-58.

**Apply to:** every component/selector that reads `AgentEvent.payloadJson`.
```tsx
const payload =
  (event.payloadJson as {
    content?: string;
    streaming?: boolean;
  } | null) ?? {};
```
For `selectToolUseWithResult` the narrowing shape is `{ tool_use_id?: string } | null`. Never consume `payloadJson` raw — always narrow with a typed cast + `?? {}` fallback.

### Test isolation (vitest + zustand)

**Source:** `src/stores/__tests__/chatStore.test.ts` L95-103.
```ts
beforeEach(() => {
  useChatStore.getState().reset();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
```
**Apply to:** every new vitest suite that touches `useChatStore` — both `chatStore.test.ts` extensions and any component test that imports the real store.

### Rust aggregator DB-write + emit match shape

**Source:** `src-tauri/src/chat_runtime/parser.rs` L513-533 (`AssistantText` arm).
```rust
match crate::db::events::insert_agent_event(
    &pool,
    &agent_id,
    session_id.as_deref(),
    "assistant_text",
    &payload,
    None,
    None,
    None,
)
.await
{
    Ok(row) => {
        if let Err(e) = app_handle.emit("agent-event-appended", &row) {
            tracing::debug!(agent_id = %agent_id, err = %e, "event-appended emit");
        }
    }
    Err(e) => {
        tracing::warn!(agent_id = %agent_id, err = %e, "assistant_text insert");
    }
}
```
**Apply to:** both the new D-01.2 `TurnComplete` flush path and the D-01.4 `StdoutClosed` flush path in `run_event_aggregator`. Do not invent a new error-handling shape.

### Rust fixture-driven test pattern

**Source:** `src-tauri/src/chat_runtime/parser.rs` L747-799 (happy-path fixture test structure).

**Apply to:** all new `session_start_hooks_silently_dropped`, `non_session_start_hooks_still_emit_system_note`, `aggregator_*` tests.
```rust
#[tokio::test]
async fn name_describing_expected_behavior() {
    let bytes = load_fixture("fixture_name.jsonl");
    let events = run_reader_against_bytes(&bytes).await;
    // assertions via .iter().filter().count() or .find_map()
}
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/components/chat/MarkdownBody.tsx` | React 19 component | transform (markdown → JSX) | No `react-markdown` usage exists in the codebase. Structural analog is `WritePreview.tsx` (shiki imperative) + `AssistantTextCard.tsx` (props shape + `@user` tokenizer), composed. Planner should reference RESEARCH §Code Examples §MarkdownBody component skeleton (L560-641) for the composition sketch, and RESEARCH §Architecture Patterns §Pattern 3 (L345-370) for the shiki-inside-`code`-renderer pattern. |

## Metadata

**Analog search scope:**
- `src-tauri/src/chat_runtime/parser.rs` (997 lines — dispatch_system, run_event_aggregator, tests module)
- `src-tauri/src/chat_runtime/supervisor.rs` (aggregator-test harness idiom via `tauri::test::mock_app`)
- `src-tauri/src/chat_runtime/commands.rs` (further `tauri::test::mock_app` patterns)
- `src-tauri/src/agents/commands.rs` L230-278 (one-aggregator-per-agent spawn confirmation)
- `src-tauri/src/db/events.rs` L206-274 (`make_pool_with_chat_schema` helper)
- `src-tauri/tests/fixtures/stream_json/` (all 7 existing fixtures — identified `single_turn_text.jsonl` and `hook_started_response.jsonl` as the closest spines)
- `src/components/chat/` (all 14 chat components — identified `AssistantTextCard.tsx`, `ToolUseCard.tsx`, `ApprovalLinkCard.tsx` as analogs)
- `src/components/chat/__tests__/` (9 suites — identified `AssistantTextCard.test.tsx` + `ToolUseCard.test.tsx` as vitest analogs)
- `src/stores/chatStore.ts` (392 lines — identified existing `totalUnread` selector + payload-narrowing idiom)
- `src/stores/__tests__/chatStore.test.ts` (400 lines — vitest test pattern)
- `src/hooks/useSyntaxHighlight.ts` (138 lines — shiki singleton + highlightLines)
- `src/views/CommsHub/ToolPreview/WritePreview.tsx` (79 lines — canonical imperative-shiki integration)
- `src/views/CommsHub/ToolPreview/registry.ts` (Phase 8 contract-locked catalog — read-only reference)

**Files scanned:** ~20 source files + 7 fixture files.
**Pattern extraction date:** 2026-04-21.
