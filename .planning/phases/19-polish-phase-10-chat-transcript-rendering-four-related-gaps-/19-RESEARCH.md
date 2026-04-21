# Phase 19: Polish Phase 10 chat transcript rendering — Research

**Researched:** 2026-04-21
**Domain:** Rust stream-json aggregator state + React 19 markdown rendering + Zustand store selectors
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Chunk coalescing (Gap 1)**
- **D-01.1** Merge at the **aggregator** (`chat_runtime::parser::spawn_event_aggregator` / `run_event_aggregator`), not at a TS store selector. Keeps DB rows correct (one `assistant_text` row per turn); matches "aggregator is single owner of DB writes" invariant.
- **D-01.2** Buffer `AssistantText` content in aggregator state until `TurnComplete`, then write ONE row. Progressive reveal already works via `agent-assistant-delta` events (no DB write needed for progressive UI).
- **D-01.3** Suppress the `insert_agent_event` call on idle-flush `AssistantText` — treat idle-flush only as an internal accumulator trigger.
- **D-01.4** Interrupted turn (parser emits `StdoutClosed` before a `TurnComplete`): flush buffered text as one row tagged `terminal_reason="interrupted"`. No data loss.
- **D-01.5** The whole-turn `AssistantText` envelope (from `dispatch_assistant` "text" block) **replaces the running buffer** — it is authoritative.
- **D-01.6** StreamEvent schema untouched; only the DB-row count changes.

**D-02 — Tool-use card enrichment (Gap 2)**
- **D-02.1** Per-tool summary dispatcher returning `{primary: string, secondary?: string}`:
  - `Edit` → `file_path • 1 hunk`
  - `MultiEdit` → `file_path • {N} hunks` (N = `tool_input.edits.length`)
  - `Write` → `file_path • {N} lines` (newline count of `tool_input.content`, fallback `{M} chars`)
  - `Read` / `Grep` / `Glob`: existing behavior (path / pattern)
  - `Bash`: command (existing)
  - `WebFetch` / `WebSearch`: `{host} • {path}` parsed from url
- **D-02.2** Outcome preview via `tool_result` join in the TS store selector `selectToolUseWithResult(toolUseId)` returning `{ toolUse, toolResult? }`. Status dot (green = success, red = error, grey = pending) + 1-line stdout/stderr snippet for Bash.
- **D-02.3** Backend unchanged — no new payload fields, no migration.
- **D-02.4** Visual polish: `py-2`→`py-1.5`, status dot before `TOOL` label (shrink-0 8px circle), expanded body `bg-surface-container/10` (currently `/20`). Preserve chevron + approval chip link.
- **D-02.5** Summary stays single-line truncated.

**D-03 — Markdown rendering (Gap 3)**
- **D-03.1** `react-markdown` + `remark-gfm` pinned to React-19-compatible stable.
- **D-03.2** Reuse existing `useSyntaxHighlight` shiki singleton (Phase 5). Custom `code` renderer invokes `highlightLines`. Do NOT instantiate a second shiki highlighter. 7 langs from singleton: typescript/javascript/rust/json/css/html/python. Unknown langs render plain.
- **D-03.3** `rehype-sanitize` belt-and-suspenders; assistant output is untrusted.
- **D-03.4** Scope — only `assistant_text` events render markdown. User messages / system notes / tool use / tool result stay plain.
- **D-03.5** New component `src/components/chat/MarkdownBody.tsx`. `AssistantTextCard` delegates body rendering. Existing `@user` mention highlighting migrates to a custom text-node renderer so D-23 styling survives.
- **D-03.6** Streaming: render partial `content` every re-render. Tolerate mid-stream broken fences; self-heals at TurnComplete.
- **D-03.7** Typography: match codey's `prose prose-sm prose-neutral dark:prose-invert` pattern for the container, scoped so it doesn't bleed. Consider `@tailwindcss/typography`.

**D-04 — SessionStart hook noise filter (Gap 4)**
- **D-04.1** Filter at the parser (`chat_runtime::parser::dispatch_system`), not the aggregator or UI. No DB row, no Tauri emit.
- **D-04.2** Drop silently when `subtype` in {`hook_started`, `hook_response`, `hook_completed`} AND `hook_name` starts with `SessionStart:`.
- **D-04.3** Other hook lifecycles (PreToolUse, UserPromptSubmit, PostToolUse, Stop, etc.) continue to surface as `SystemNote`.
- **D-04.4** Do not fold into a "4 hooks fired" row. Silent drop is the contract.
- **D-04.5** `raw_stdout` events untouched — full lifecycle still available for debugging.
- **D-04.6** Unknown-subtype catch-all `[system/{subtype}]` preserved.

### Claude's Discretion
- Exact TS signature of `selectToolUseWithResult` (D-02.2) — store structure / memoization strategy.
- Exact packaging of the per-tool summary dispatcher (D-02.1) — object map vs switch vs per-tool registry.
- Test structure — unit tests for aggregator coalescing (parser fixtures + in-memory pool), component tests for `MarkdownBody` and enriched `ToolUseCard`, parser-filter tests for SessionStart drop.
- Whether to install `@tailwindcss/typography` — if already installed, reuse; otherwise planner may install.
- Version pins for `react-markdown`, `remark-gfm`, `rehype-sanitize` — pick latest React-19-compatible stable.
- Micro-animations on new status dot / coalesced row appearance.

### Deferred Ideas (OUT OF SCOPE)
- Rich markdown inside `user_text` messages
- Syntax highlighting language expansion beyond Phase 5's 7 langs
- Hook-noise fold-row with count (explicitly rejected for SessionStart)
- Tool-use card outcome timing (ms-elapsed badge)
- Diff-preview thumbnail in collapsed row for Edit/MultiEdit
- Raw-stream card filter parity (raw_stdout untouched)
</user_constraints>

## Summary

Phase 19 is a **surgical polish pass** on the working Phase 10 chat pipeline. Four gaps; all implementable in four files (parser.rs, ToolUseCard.tsx, AssistantTextCard.tsx, chatStore.ts) plus one new file (MarkdownBody.tsx). No schema changes, no new capabilities, no new adapters, no new Tauri commands. Every architectural lever is already locked — this research exists to surface **implementation-level idioms** and **falsifiable validation assertions** so the planner can write tight task-level plans.

**Key findings:**
1. **D-01 aggregator state is simple** — `spawn_event_aggregator` spawns *one task per agent* (see `agents/commands.rs:243`), so per-agent turn buffering needs only **local variables inside `run_event_aggregator`**, not a `HashMap<AgentId, TurnBuffer>`. The orchestrator CONTEXT suggests HashMap; the actual codebase uses one aggregator-per-agent — a single local `TurnBuffer` struct inside the `run_event_aggregator` scope is the idiomatic fix. `[VERIFIED: src-tauri/src/chat_runtime/parser.rs:451-705, src-tauri/src/agents/commands.rs:243]`
2. **D-02 tool_result.content can be string OR array** — per the Anthropic Messages API spec, `tool_result.content` is *either* `string` *or* `Array<TextBlockParam|ImageBlockParam|…>`. Current parser stores the raw `Value` via `content.cloned()` (no parsing). The Bash-stdout 1-line preview needs a tiny extractor that handles both shapes. There is **no `exit_code` field** — tool success/failure is reflected only via `is_error`. `[CITED: platform.claude.com/docs/en/api/messages]` `[VERIFIED: src-tauri/src/chat_runtime/parser.rs:340-374]`
3. **D-03 react-markdown v10.1.0 pairs cleanly with React 19** — peer dep is `react: >=18`. The `components.code` renderer receives `{children, className, node}` where `className = "language-{lang}"`; the canonical shiki integration uses `highlighter.codeToHtml` / `codeToTokens` inside the renderer and injects via `dangerouslySetInnerHTML`. Shiki HTML-escapes tokens → T-05-07 mitigation preserved. `[CITED: github.com/remarkjs/react-markdown]` `[VERIFIED: npm view react-markdown@10.1.0 peerDependencies]`
4. **D-03 rehype-sanitize defaults strip shiki styling** — `defaultSchema` follows GitHub's allowlist and removes inline `style` attributes on `<span>` (which is exactly what Shiki emits via `<span style="color:#...">`). The planner MUST extend `defaultSchema` or the code blocks render as unstyled text. `[CITED: github.com/rehypejs/rehype-sanitize]`
5. **D-04 SessionStart filter is a 4-line parser edit** — `dispatch_system` already branches on `subtype`; the hook_name check is a single-line `if` added to the `hook_started|hook_response|hook_completed` match arm. Fixture `hook_started_response.jsonl` confirms the exact shape: `{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup",...}`. `[VERIFIED: src-tauri/tests/fixtures/stream_json/hook_started_response.jsonl]`

**Primary recommendation:** Split implementation into **two independent waves**: Wave 1 (backend — parser.rs coalescing + SessionStart filter, both touch the same file) and Wave 2 (frontend — store selector + MarkdownBody + ToolUseCard enrichment). Wave 1 can land without Wave 2 (the store just sees one row per turn; existing rendering still works). Wave 2 then polishes the presentation.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Assistant text coalescing | Rust aggregator | — | Aggregator is authoritative DB writer (Phase 10 D-17); coalescing changes what gets written, not what gets displayed |
| SessionStart hook silencing | Rust parser (`dispatch_system`) | — | Noise must never reach DB or frontend; filter at earliest sink |
| Per-tool collapsed-row summary | React component (`ToolUseCard.tsx`) | Zustand store (`chatStore.ts`) | Presentation logic belongs in component; store selector joins event pairs |
| `tool_use` ↔ `tool_result` correlation | Zustand store selector | — | Store owns cross-event correlation (established pattern) |
| Assistant markdown rendering | React component (`MarkdownBody.tsx`) | — | Presentation only; no backend impact |
| Code-fence syntax highlighting | Existing `useSyntaxHighlight` shiki singleton | — | Already owned by Phase 5 hook; reused verbatim |

## Phase Requirements

No REQ-IDs are directly mapped to this phase. Phase 19 is a polish phase bounded by CONTEXT.md decisions D-01..D-04. The phase improves user-facing rendering of the working Phase 10 CHAT surface without introducing new capabilities.

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01 | Coalesce `assistant_text` rows at aggregator | §Gap 1 Implementation + TurnBuffer reasoning |
| D-02 | Tool-use card summary + outcome dispatcher | §Gap 2 Implementation + tool_result.content schema |
| D-03 | Markdown rendering via react-markdown | §Gap 3 Implementation + react-markdown v10 + rehype-sanitize schema |
| D-04 | SessionStart hook silent drop | §Gap 4 Implementation + fixture ground truth |

## Project Constraints (from CLAUDE.md)

- **Stack (locked):** Tauri v2, React 19.2, TypeScript 5.8, Vite 8, Zustand 5.0, Tailwind v4. Phase 19 fits cleanly inside this stack.
- **IPC:** snake_case payloads on the wire, camelCase TS types via specta. Phase 19 introduces **no new Tauri commands** and **no new specta types** → no `bindings.ts` regen step.
- **Commit cadence (user memory):** commit-per-change, not batched.
- **Only fix own bugs (user memory):** phase tasks must not widen into fixing pre-Phase-10 bugs discovered during execution.
- **GSD workflow enforcement:** all file edits happen through GSD execute-phase — planner should scope tasks to single concerns so `/gsd-execute-phase` hooks stay green.

## Standard Stack

### Libraries to install (Wave 2 Gap 3)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react-markdown` | `^10.1.0` | Renders markdown → React element tree | De-facto standard for React markdown. Peer dep `react: >=18` — works with React 19.2. Component-override API (`components.code`) is the canonical extension point. `[VERIFIED: npm view react-markdown@10.1.0]` |
| `remark-gfm` | `^4.0.1` | GitHub-flavored markdown (tables, task-lists, strikethrough, autolinks) | Matches the codey `prose` aesthetic the user wants. `[VERIFIED: npm view remark-gfm]` |
| `rehype-sanitize` | `^6.0.0` | HTML sanitization; strips XSS vectors even if markdown syntax slips through | Assistant output is untrusted (D-03.3). Default schema is GitHub's allowlist. `[VERIFIED: npm view rehype-sanitize]` |
| `@tailwindcss/typography` | `^0.5.19` | `.prose` utility class system for scoped typography | Not currently in `package.json`. Small plugin, peer dep `tailwindcss >=3.0.0 || >=4.0.0-beta.1` — compatible with Tailwind v4.2.0. Enables `prose-sm prose-neutral dark:prose-invert` pattern. `[VERIFIED: npm view @tailwindcss/typography@0.5.19 peerDependencies]` |

**Already installed (reuse verbatim):**

| Library | Version | Role in Phase 19 |
|---------|---------|------------------|
| `shiki` | `^4.0.2` | Reuse singleton via `useSyntaxHighlight` hook for code-fence highlighting (D-03.2) |
| `motion` | `^12.0.0` | `layout` + `AnimatePresence` for tool-use card expand/collapse (D-02.4) |
| `lucide-react` | `^1.7.0` | Chevron icons in tool-use card |
| `zustand` | `^5.0.0` | `chatStore.ts` host for `selectToolUseWithResult` selector |

**Installation commands:**
```bash
npm install react-markdown@^10.1.0 remark-gfm@^4.0.1 rehype-sanitize@^6.0.0
npm install -D @tailwindcss/typography@^0.5.19
```

### Rust side — zero new crates

Phase 19 Rust changes (D-01, D-04) use only already-in-use APIs: `serde_json::Value`, `tokio::sync::mpsc`, `sqlx::SqlitePool`, `tauri::Emitter`, `tracing`. No new dependencies in `Cargo.toml`.

## Current-State Analysis

### Rust: `src-tauri/src/chat_runtime/parser.rs` (997 lines)

**`dispatch_system` (L209-237) — SessionStart filter target.**

```rust
async fn dispatch_system(v: &serde_json::Value, sink: &mpsc::Sender<StreamEvent>) {
    let subtype = v.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
    match subtype {
        "init" => { /* emits SessionStarted */ }
        "hook_started" | "hook_response" | "hook_completed" => {
            let hook_name = v.get("hook_name").and_then(|s| s.as_str()).unwrap_or("");
            let text = format!("[{subtype}] {hook_name}");
            let _ = sink.send(StreamEvent::SystemNote { text }).await;
        }
        _ => { /* catch-all generic SystemNote */ }
    }
}
```

**D-04 edit:** inside the `hook_started | hook_response | hook_completed` arm, before `sink.send`, add:
```rust
if hook_name.starts_with("SessionStart:") {
    return;  // silent drop per D-04.2
}
```
Four lines of diff. Does not touch the `init` branch or catch-all. **`hook_name` is already extracted** — no extra parsing work.

**`run_event_aggregator` (L461-705) — coalescing target.**

The aggregator runs `while let Some(event) = rx.recv().await { match event { … } }` and handles 10 StreamEvent variants. Each aggregator task is **scoped to a single agent** (`agent_id: String` parameter passed once; see `spawn_event_aggregator` at L451 and its caller `agents/commands.rs:243` which spawns one task per launched agent). So the per-agent turn buffer is a **local scope variable**, not a HashMap.

**Current AssistantText handling (L496-534):**
```rust
StreamEvent::AssistantText { content, model } => {
    if is_awaiting_user_mention(&content) {
        super::notifications::dispatch_chat_notification(...);  // D-23 fire
    }
    let session_id = sessions.session_id_for(&agent_id).await;
    let payload = serde_json::json!({ "content": content, "model": model });
    // insert_agent_event → emit "agent-event-appended"
}
```

**D-01 refactor shape:**
```rust
// --- local state, declared once at function top ---
struct TurnBuffer {
    content: String,
    model: Option<String>,
}
let mut turn_buffer: Option<TurnBuffer> = None;

// --- inside StreamEvent::AssistantText arm ---
StreamEvent::AssistantText { content, model } => {
    // @user notification MUST still fire per-event (D-23 not regressed)
    if is_awaiting_user_mention(&content) {
        super::notifications::dispatch_chat_notification(&app_handle, &agent_id,
            &truncate_for_notification(&content, 80), Some(&agent_id));
    }
    // D-01.5: the whole-turn envelope (model is Some) REPLACES the buffer.
    // D-01.3: idle-flush partials (model is None) overwrite/accumulate.
    turn_buffer = Some(TurnBuffer {
        content,
        model: model.or(turn_buffer.as_ref().and_then(|b| b.model.clone())),
    });
    // NO DB write here.
}

// --- inside StreamEvent::TurnComplete arm ---
// BEFORE the existing delivery-status flip, flush turn_buffer as ONE row.
if let Some(buf) = turn_buffer.take() {
    let payload = serde_json::json!({ "content": buf.content, "model": buf.model });
    if let Ok(row) = crate::db::events::insert_agent_event(
        &pool, &agent_id, session_id.as_deref(), "assistant_text",
        &payload, None, None, None,
    ).await {
        let _ = app_handle.emit("agent-event-appended", &row);
    }
}

// --- inside StreamEvent::StdoutClosed arm (D-01.4 interrupted flush) ---
StreamEvent::StdoutClosed => {
    if let Some(buf) = turn_buffer.take() {
        // Synthesize an interrupted-terminal-reason row.
        let session_id = sessions.session_id_for(&agent_id).await;
        let payload = serde_json::json!({ "content": buf.content, "model": buf.model });
        if let Ok(row) = crate::db::events::insert_agent_event(
            &pool, &agent_id, session_id.as_deref(), "assistant_text",
            &payload, None, None, None,
        ).await {
            let _ = app_handle.emit("agent-event-appended", &row);
        }
        // Synthesize a turn-complete emit so frontend streaming flag flips off.
        let tc_payload = serde_json::json!({
            "agentId": agent_id, "terminalReason": "interrupted", "isError": false
        });
        let _ = app_handle.emit("agent-turn-complete", &tc_payload);
    }
    tracing::debug!(agent_id = %agent_id, "stdout closed; aggregator draining");
}
```

**Key invariants preserved:**
- `insert_agent_event` is still the only DB writer (frequency drops from N-per-turn to 1-per-turn).
- `@user` notification fires per `AssistantText` event (per idle-flush or whole-turn envelope), not per-content-block — this preserves D-23 latency.
- `agent-assistant-delta` emit (L485-495) remains untouched — progressive reveal still works in real time.
- `StreamEvent` schema untouched (D-01.6).
- `session_id_for` await pattern unchanged.

**`dispatch_user` (L340-374) — tool_result shape reference.**

```rust
if block_type == "tool_result" {
    let tool_use_id = block.get("tool_use_id").and_then(|n| n.as_str()).unwrap_or("").to_string();
    let content_val = block.get("content").cloned().unwrap_or(serde_json::Value::Null);
    let is_error = block.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false);
    // → sink.send(StreamEvent::ToolResult { tool_use_id, content: content_val, is_error })
}
```

`content_val` is a raw `serde_json::Value` that round-trips into `payloadJson.content` on the frontend. The frontend extractor in D-02 must handle both of these real-world shapes `[CITED: platform.claude.com/docs/en/api/messages]`:

```json
// shape A — string
{"tool_use_id":"toolu_01","content":"command output text","is_error":false}

// shape B — array of blocks
{"tool_use_id":"toolu_01","content":[{"type":"text","text":"line 1\nline 2"}],"is_error":false}
```

There is **no `exit_code` field** in `tool_result`. The Bash tool reports non-zero exits through `is_error: true`. The D-02.2 status-dot therefore reduces to `is_error === true ? red : green` (grey when no paired result). The CONTEXT mentioned "Bash exit_code !== 0" — there is no such field to check. **Document this in the plan** so the task writer doesn't hunt for a non-existent field.

### Frontend: `src/components/chat/AssistantTextCard.tsx` (105 lines)

**Current body render (L84-105):** `<p className="… whitespace-pre-wrap …">{renderContent(content)}{streaming && <StreamingCursor />}</p>`.

The `renderContent` function (L32-59) tokenizes `@user` mentions manually. It returns `React.ReactNode[]`. D-03.5 migrates this into a `MarkdownBody` custom text-node renderer so the regex runs on the parsed-markdown text content instead of the raw string.

**Edit footprint for D-03:**
- Keep `isContinuation` logic (L80-82) — still valid.
- Keep `streaming` detection and `bodyColor` (L71-75).
- Replace `<p>…</p>` with `<MarkdownBody content={content} streaming={streaming}>`.
- Move `renderContent`'s `@user` logic into `MarkdownBody` (custom text renderer that still returns the `<span className="text-secondary font-bold">@user</span>` element).

### Frontend: `src/components/chat/ToolUseCard.tsx` (143 lines)

**Current `deriveSummary` (L23-49):** hand-written switch mapping tool name → single-string summary. Returns raw truncation of the first plausible field. No hunk count, no line count, no host extraction.

**Edit footprint for D-02:**
- Replace `deriveSummary(): string` with `deriveSummary(): {primary: string; secondary?: string}`.
- New `per-tool summary dispatcher` — Claude's discretion whether object-map (`Record<ToolName, (input) => Summary>`) or switch.
- Import `useChatStore` + selector `selectToolUseWithResult(toolUseId)` to obtain paired `tool_result`.
- Status-dot component: 8px `<span className="shrink-0 rounded-full …">` before `TOOL` label.
- Status color: green (`bg-status-success` or `bg-phosphor-green`), red (`bg-status-error`), grey (`bg-on-surface-variant/30`) based on `toolResult?.is_error`.
- Visual diff: `py-2` → `py-1.5`; expanded body `bg-surface-container/20` → `/10`.
- Preserve `AnimatePresence` + `layout` + navigation-on-approval-chip click.

### Frontend: `src/stores/chatStore.ts` (392 lines)

**Current selectors:** store exposes `eventsByAgent: Record<string, AgentEvent[]>` but no pre-built selectors for cross-event joins. The `sendMessage` / `subscribeToChat` paths modify the array in place.

**Edit footprint for D-02.2:**
- Add a **pure function**, not a hook, exported from `chatStore.ts`:
  ```ts
  export function selectToolUseWithResult(
    events: AgentEvent[],
    toolUseId: string
  ): { toolUse: AgentEvent | null; toolResult: AgentEvent | null } {
    // Linear scan; events array is small (paginated 50/page).
    // toolUse: find event where eventType==='tool_use' && payloadJson.tool_use_id===toolUseId
    // toolResult: find event where eventType==='tool_result' && payloadJson.tool_use_id===toolUseId
  }
  ```
- Or expose it as a **store-bound selector via Zustand's `useChatStore(selector)` pattern**. Claude's discretion (D-02.2 note).
- ToolUseCard consumes via `useChatStore((s) => selectToolUseWithResult(s.eventsByAgent[agentId] ?? [], toolUseId))` — memoized by Zustand's `shallow` equality if needed.

### Existing Test Infrastructure

**Rust:**
- `src-tauri/src/chat_runtime/parser.rs:707-997` — 12 existing `#[tokio::test]` cases using `run_reader_against_bytes(&bytes)` against JSONL fixtures. Aggregator tests don't exist yet — parser.rs `#[cfg(test)]` only exercises `drive_stream_json_reader`, not `run_event_aggregator`. **Phase 19 Wave 1 MUST add `run_event_aggregator` tests** that drive an in-memory `SqlitePool` (helper `make_pool_with_chat_schema` already exists in `db::events::tests`). The helper is `pub(crate) mod tests` so cross-module use works after re-exporting or building a local variant.
- `src-tauri/tests/fixtures/stream_json/*.jsonl` — 7 existing fixtures covering happy-path + edge cases. Phase 19 needs 2 new fixtures + 1 extended fixture (see §Test Fixtures below).

**Frontend:**
- `src/components/chat/__tests__/` — 9 existing vitest suites. `AssistantTextCard.test.tsx` (72 lines) and `ToolUseCard.test.tsx` (108 lines) both use a `mk()` factory + `motion/react` mock. New `MarkdownBody.test.tsx` copies the mocking pattern.

## Architecture Patterns

### Pattern 1: Aggregator-local Turn Buffer (D-01)

**What:** Use a single `TurnBuffer` local variable inside `run_event_aggregator` (one task per agent), not a `HashMap<AgentId, TurnBuffer>`.

**When to use:** For any per-agent aggregator state — because Phase 10 spawns one aggregator task per agent (`agents/commands.rs:243`), per-agent storage is local scope, not a shared map. `[VERIFIED: src-tauri/src/chat_runtime/parser.rs:451-705]`

**Anti-pattern:** A `HashMap<AgentId, TurnBuffer>` shared across tasks introduces `Arc<Mutex<…>>` overhead and risks cross-agent races for no benefit.

### Pattern 2: Store Selector for Cross-Event Join (D-02.2)

**What:** A pure function `selectToolUseWithResult(events, toolUseId)` that walks the events array once to find both the `tool_use` row and its paired `tool_result` row via `tool_use_id`. Consumed from the component via `useChatStore(selector)`.

**Why:** Phase 10 decided "store selectors own cross-event correlation" (D-17 corollary). Consistent with D-23 `@user` detection pattern and the existing `totalUnread()` selector (L377-380).

**Anti-pattern:** Joining on the backend would require a payload schema change — explicitly rejected by D-02.3.

### Pattern 3: Reuse Singleton Shiki via `highlightLines` (D-03.2)

**What:** Inside the `react-markdown` `components.code` renderer, call `useSyntaxHighlight()` to obtain the singleton, detect language from `className`, and inject pre-computed HTML via `dangerouslySetInnerHTML`. `highlightLines` already escapes token content (T-05-07 mitigation, `useSyntaxHighlight.ts:99-111`).

**Example:**
```tsx
import { useSyntaxHighlight, highlightLines } from '../../hooks/useSyntaxHighlight';

function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const { highlighter } = useSyntaxHighlight();
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match?.[1] ?? 'text';
  const source = String(children).replace(/\n$/, '');
  const lines = highlighter ? highlightLines(highlighter, source, lang) : null;
  if (!lines) return <pre><code className={className}>{source}</code></pre>;
  return (
    <pre className="bg-surface-container-lowest p-3 overflow-auto font-mono text-xs">
      {lines.map((html, i) => (
        <div key={i} dangerouslySetInnerHTML={{ __html: html === '' ? '&nbsp;' : html }} />
      ))}
    </pre>
  );
}
```

**Why not `react-shiki`?** Adds ~100KB + duplicate highlighter state. The existing Phase 5 hook is the contract (D-03.2).

### Pattern 4: Extend `rehype-sanitize` Default Schema for Shiki (D-03.3)

**What:** The default schema strips `style` attributes on `<span>`, which is exactly how `highlightLines` injects color. Since we use `dangerouslySetInnerHTML` inside our own code-block renderer (the shiki output is already escaped), the sanitizer only needs to protect the **markdown-generated** HTML tree — our code block output is outside the sanitized tree boundary because it's injected imperatively through `dangerouslySetInnerHTML` inside our custom component.

**Recommended approach (CLEANEST):** Apply `rehype-sanitize` to the markdown tree but let the `CodeBlock` component emit unsanitized raw HTML via its own `dangerouslySetInnerHTML` (since the content is auto-escaped by `highlightLines`'s own T-05-07 mitigation). `rehype-sanitize` never sees the shiki spans because they're rendered by React **after** sanitization runs on the rest of the markdown tree.

**Alternative (if the planner wants a single sanitization pass):** Use a custom schema extending `defaultSchema` that allows `style` on `<span>` — requires stricter validation because inline styles can carry CSS injection. The `safeCssColor` validator in `useSyntaxHighlight.ts:81-90` shows the sanitization shape needed. **Preferred to skip this path** — the imperative approach is safer.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown parser | Custom regex-based parser for `**bold**` / fenced blocks / lists | `react-markdown` + `remark-gfm` | Edge cases explode (nested emphasis, code spans inside lists, GFM tables). Battle-tested library. |
| HTML sanitizer | Allowlist regex filter | `rehype-sanitize` | XSS surface area is huge; GitHub's schema is audited. |
| Syntax highlighter | New shiki instance or regex fallback | Existing `useSyntaxHighlight` singleton | Already loads 7 langs, already HTML-escapes, already has safeCssColor validator — Phase 5 debt. |
| Per-agent turn state map | `Arc<Mutex<HashMap<AgentId, TurnBuffer>>>` | Local `TurnBuffer` in `run_event_aggregator` scope | One task per agent already; map is pure overhead. |
| Backend tool_use/tool_result join | New payload field carrying joined shape | TS store selector `selectToolUseWithResult` | Backend schema change violates D-02.3; selector is cheap. |

## Runtime State Inventory

Phase 19 is **not** a rename/refactor. All changes are (a) additive in the aggregator (new local state, no DB schema), (b) code-level filter in parser, (c) additive in frontend (new component, new selector, enriched card). No stored data, no live service config, no OS-registered state, no secrets, no build artifacts carry old names. **None — verified by §Current-State Analysis.**

## Common Pitfalls

### Pitfall 1: Regressing `@user` notification latency (D-23 defender)

**What goes wrong:** If `@user` detection moves from "per-AssistantText-event" to "per-coalesced-turn," a mid-turn `@user` mention waits until `TurnComplete` before the OS notification fires.

**Why it happens:** Naïve D-01 refactors that only fire the notification from the `TurnComplete` flush path.

**How to avoid:** Keep `is_awaiting_user_mention` + `dispatch_chat_notification` inside the `AssistantText` arm (pre-buffer), not in the flush path. The aggregator branch still sees every `AssistantText` event (idle-flushes + whole-turn envelope) — just don't DB-write from that branch.

**Warning signs:** Notification arrives seconds late on a long streamed turn. Verify with fixture that has `@user` inside a mid-turn text_delta.

### Pitfall 2: `insert_agent_event` still-called-N-times

**What goes wrong:** Aggregator task accidentally keeps the old `insert_agent_event` call inside `StreamEvent::AssistantText` while also writing from the `TurnComplete` flush.

**Why it happens:** Copy-paste; failing to remove the old block.

**How to avoid:** Single source of truth — the `StreamEvent::AssistantText` arm has NO DB call post-refactor. Enforce via Nyquist assertion ("exactly one `assistant_text` row per turn").

**Warning signs:** Transcript shows 2-3 rows where there should be 1; aggregator test shows `insert_count > 1`.

### Pitfall 3: StdoutClosed without TurnComplete — orphaned streaming flag

**What goes wrong:** When parser emits `StdoutClosed` without a preceding `TurnComplete`, the frontend's last assistant_text row stays stuck with `streaming: true` forever because nothing fires `agent-turn-complete`.

**Why it happens:** The parser's `dispatch_result` flush path only runs on `result` envelopes. A crashed subprocess closes stdout without emitting one.

**How to avoid:** In `StreamEvent::StdoutClosed` aggregator arm (D-01.4), after flushing the buffered text as an interrupted row, **synthetically emit `agent-turn-complete`** with `terminalReason: "interrupted"`. The frontend's existing reducer (chatStore L252-293) will flip the last streaming row off.

**Warning signs:** UI leaves the STREAMING… label visible after an abrupt subprocess exit.

### Pitfall 4: Shiki spans stripped by rehype-sanitize

**What goes wrong:** Fenced code blocks render as plain unstyled monospace text because `rehype-sanitize`'s default schema removed the inline `style` attributes on Shiki's color spans.

**Why it happens:** Assuming the default schema allows `style` — it doesn't.

**How to avoid:** Use the imperative Pattern 3 approach — Shiki HTML generation happens inside a React component that uses `dangerouslySetInnerHTML` **outside the sanitizer's tree**. The sanitizer still processes the surrounding markdown, just not the code-block interior. Verify by testing fenced-block rendering.

**Warning signs:** Code blocks render as plain text with no color; inspect DOM → spans are bare `<span>` with no `style`.

### Pitfall 5: Broken-fence self-heal requires tolerance

**What goes wrong:** During streaming, an incomplete fenced block (```` ```typescript ```` without the closing ```` ``` ````) can make `react-markdown` emit a giant code span that swallows the rest of the turn.

**Why it happens:** Markdown parser's normal behavior — unclosed fence consumes everything until EOF.

**How to avoid:** Accept the visual glitch during streaming (D-03.6 tolerates this); self-heals at TurnComplete when the authoritative text replaces the buffer. Add a test case that feeds a partial fence to `MarkdownBody` and asserts *no crash* (even if visual is imperfect).

**Warning signs:** Unit test `MarkdownBody with streaming broken fence doesn't crash` fails with thrown error.

### Pitfall 6: Phase 8 ToolPreview registry contract lock

**What goes wrong:** Enriching `ToolUseCard.tsx` accidentally modifies `ToolPreviewProps` or `resolveRenderer` — breaks the Phase 8 contract-lock tests.

**Why it happens:** D-02.1 summary work looks adjacent to expanded-body work; scope creep.

**How to avoid:** **Only** modify `ToolUseCard.tsx` collapsed-row rendering. Do not touch anything under `src/views/CommsHub/ToolPreview/`. Verify via `git diff --stat src/views/CommsHub/ToolPreview/` → empty.

**Warning signs:** Phase 8 tests fail.

### Pitfall 7: Aggregator model field lost across idle flushes

**What goes wrong:** Idle-flush `AssistantText` events have `model: None`. If the buffer simply assigns `model = model` on each event, the whole-turn envelope's model (which carries the real name) gets overwritten back to `None` if another idle-flush happens later.

**Why it happens:** Naïve `turn_buffer.model = model`.

**How to avoid:** `model = model.or(previous_buffer.model)` — retain the first non-None model seen in the turn. See snippet in §Current-State Analysis.

**Warning signs:** Coalesced `assistant_text` rows lose their `"model": "claude-opus-4-7"` footer.

## Code Examples

### Aggregator `StreamEvent::AssistantText` refactor (D-01)

```rust
// src-tauri/src/chat_runtime/parser.rs — inside run_event_aggregator

// Top of function — local turn buffer (one task = one agent).
struct TurnBuffer {
    content: String,
    model: Option<String>,
}
let mut turn_buffer: Option<TurnBuffer> = None;

// Inside the match:
StreamEvent::AssistantText { content, model } => {
    // D-23: @user check fires immediately (every event, not only on flush).
    if is_awaiting_user_mention(&content) {
        super::notifications::dispatch_chat_notification(
            &app_handle,
            &agent_id,
            &truncate_for_notification(&content, 80),
            Some(&agent_id),
        );
    }
    // D-01.5: whole-turn envelope (model carries signal) REPLACES buffer.
    // D-01.3: idle-flush partials accumulate (model is None, keep prior model).
    let merged_model = model.or(turn_buffer.as_ref().and_then(|b| b.model.clone()));
    turn_buffer = Some(TurnBuffer { content, model: merged_model });
    // NO DB write. (Was: insert_agent_event → emit.)
}

StreamEvent::TurnComplete { terminal_reason, is_error } => {
    let session_id = sessions.session_id_for(&agent_id).await;
    // D-01.2: flush buffer as ONE assistant_text row BEFORE the turn-complete emit.
    if let Some(buf) = turn_buffer.take() {
        let payload = serde_json::json!({ "content": buf.content, "model": buf.model });
        if let Ok(row) = crate::db::events::insert_agent_event(
            &pool, &agent_id, session_id.as_deref(), "assistant_text",
            &payload, None, None, None,
        ).await {
            let _ = app_handle.emit("agent-event-appended", &row);
        }
    }
    // Existing delivery-status flip + turn-complete emit (unchanged).
    // ... existing code ...
}

StreamEvent::StdoutClosed => {
    // D-01.4: flush remainder as interrupted row.
    if let Some(buf) = turn_buffer.take() {
        let session_id = sessions.session_id_for(&agent_id).await;
        let payload = serde_json::json!({ "content": buf.content, "model": buf.model });
        if let Ok(row) = crate::db::events::insert_agent_event(
            &pool, &agent_id, session_id.as_deref(), "assistant_text",
            &payload, None, None, None,
        ).await {
            let _ = app_handle.emit("agent-event-appended", &row);
        }
        // Synthesize agent-turn-complete so frontend streaming flag flips off.
        let payload = serde_json::json!({
            "agentId": agent_id,
            "terminalReason": "interrupted",
            "isError": false,
        });
        let _ = app_handle.emit("agent-turn-complete", &payload);
    }
    tracing::debug!(agent_id = %agent_id, "stdout closed; aggregator draining");
}
```

### Parser SessionStart filter (D-04)

```rust
// src-tauri/src/chat_runtime/parser.rs — dispatch_system (L209-237)

async fn dispatch_system(v: &serde_json::Value, sink: &mpsc::Sender<StreamEvent>) {
    let subtype = v.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
    match subtype {
        "init" => { /* unchanged */ }
        "hook_started" | "hook_response" | "hook_completed" => {
            let hook_name = v.get("hook_name").and_then(|s| s.as_str()).unwrap_or("");
            // D-04.2: silent drop for SessionStart hooks.
            if hook_name.starts_with("SessionStart:") {
                return;
            }
            let text = format!("[{subtype}] {hook_name}");
            let _ = sink.send(StreamEvent::SystemNote { text }).await;
        }
        _ => { /* unchanged */ }
    }
}
```

### MarkdownBody component skeleton (D-03)

```tsx
// src/components/chat/MarkdownBody.tsx  (new file)

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { useSyntaxHighlight, highlightLines } from '../../hooks/useSyntaxHighlight';
import { StreamingCursor } from './StreamingCursor';

const AT_USER_RE = /(^|\W)(@user)(?=\W|$)/g;

function renderAtUserMentions(text: string): React.ReactNode[] {
  // Copy of the existing AssistantTextCard.renderContent tokenizer.
  // Returns ReactNode[] with @user spans.
  // ... (from AssistantTextCard.tsx L32-59) ...
}

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { highlighter } = useSyntaxHighlight();
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match?.[1] ?? 'text';
  const source = String(children).replace(/\n$/, '');
  if (!highlighter) {
    return (
      <pre className="bg-surface-container-lowest p-3 overflow-auto font-mono text-xs">
        <code>{source}</code>
      </pre>
    );
  }
  const lines = highlightLines(highlighter, source, lang);
  return (
    <pre className="bg-surface-container-lowest p-3 overflow-auto font-mono text-xs">
      {lines.map((html, i) => (
        <div
          key={i}
          dangerouslySetInnerHTML={{ __html: html === '' ? '&nbsp;' : html }}
        />
      ))}
    </pre>
  );
}

export interface MarkdownBodyProps {
  content: string;
  streaming?: boolean;
}

export function MarkdownBody({ content, streaming = false }: MarkdownBodyProps) {
  return (
    <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none font-mono">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          code: ({ className, children }) => (
            <CodeBlock className={className}>{children}</CodeBlock>
          ),
          // D-03.5: @user mentions in text nodes.
          p: ({ children }) => (
            <p>
              {typeof children === 'string'
                ? renderAtUserMentions(children)
                : children}
            </p>
          ),
        }}
      >
        {content}
      </Markdown>
      {streaming && <StreamingCursor />}
    </div>
  );
}
```

### Store selector for tool_use/tool_result join (D-02.2)

```ts
// src/stores/chatStore.ts — add below existing totalUnread (L377-380)

export function selectToolUseWithResult(
  events: AgentEvent[],
  toolUseId: string,
): { toolUse: AgentEvent | null; toolResult: AgentEvent | null } {
  let toolUse: AgentEvent | null = null;
  let toolResult: AgentEvent | null = null;
  for (const e of events) {
    const p = (e.payloadJson as { tool_use_id?: string } | null) ?? {};
    if (p.tool_use_id !== toolUseId) continue;
    if (e.eventType === 'tool_use') toolUse = e;
    else if (e.eventType === 'tool_result') toolResult = e;
  }
  return { toolUse, toolResult };
}
```

### Per-tool summary dispatcher sketch (D-02.1)

```ts
// src/components/chat/ToolUseCard.tsx — replace deriveSummary (L23-49)

interface ToolSummary {
  primary: string;
  secondary?: string;
}

function parseContentToString(content: unknown): string {
  // Claude tool_result.content: string OR array of {type:'text',text:string}.
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('');
  }
  return '';
}

function deriveSummary(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
): ToolSummary {
  if (!toolInput) return { primary: '' };
  const filePath = toolInput.file_path as string | undefined;
  switch (toolName) {
    case 'Edit':
      return { primary: filePath ?? '', secondary: '1 hunk' };
    case 'MultiEdit': {
      const edits = toolInput.edits as unknown[] | undefined;
      const n = Array.isArray(edits) ? edits.length : 0;
      return { primary: filePath ?? '', secondary: `${n} hunk${n === 1 ? '' : 's'}` };
    }
    case 'Write': {
      const body = String(toolInput.content ?? '');
      const lines = body === '' ? 0 : body.split('\n').length;
      return { primary: filePath ?? '', secondary: `${lines} line${lines === 1 ? '' : 's'}` };
    }
    case 'Read':
      return { primary: filePath ?? '' };
    case 'Bash':
      return { primary: String(toolInput.command ?? '') };
    case 'Grep':
    case 'Glob':
      return { primary: String(toolInput.pattern ?? '') };
    case 'WebFetch':
    case 'WebSearch': {
      const url = String(toolInput.url ?? '');
      try {
        const u = new URL(url);
        return { primary: u.host, secondary: u.pathname };
      } catch {
        return { primary: url };
      }
    }
    default:
      return { primary: String(filePath ?? toolInput.command ?? toolInput.pattern ?? toolInput.url ?? '') };
  }
}

// Status dot color from paired tool_result.
function statusColor(result: AgentEvent | null): 'green' | 'red' | 'grey' {
  if (!result) return 'grey';
  const isErr = ((result.payloadJson as { is_error?: boolean } | null) ?? {}).is_error === true;
  return isErr ? 'red' : 'green';
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual regex for `@user` tokenization | Same regex, now inside a react-markdown text-node renderer | Phase 19 | No behavior change; just moved from AssistantTextCard into MarkdownBody |
| Whitespace-pre-wrap `<p>` for assistant body | `react-markdown` + `remark-gfm` + `rehype-sanitize` | Phase 19 | Markdown renders as markdown; code blocks get shiki highlighting |
| One `assistant_text` DB row per content_block_delta flush | One `assistant_text` DB row per turn | Phase 19 (aggregator buffer) | DB row count drops; no semantic loss (progressive UI via `agent-assistant-delta` event path) |
| `[HOOK_STARTED] SessionStart:startup` system_note rows | Silent drop at parser | Phase 19 | 8+ noise rows removed per session boot; `raw_stdout` still captures for debug |

**Deprecated / outdated:** The `deriveSummary` single-string function in `ToolUseCard.tsx` is superseded by the `{primary, secondary?}` dispatcher shape.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Shiki's `highlightLines` output remains safe when injected via `dangerouslySetInnerHTML` inside a custom `code` renderer *outside* the rehype-sanitize pass | Pattern 4 + MarkdownBody example | If shiki token content contains attacker-controlled HTML that escapes T-05-07 escaping, XSS surface opens. Mitigation: `highlightLines` already HTML-escapes token content per `useSyntaxHighlight.ts:104-107`; the color style uses `safeCssColor` validator per `useSyntaxHighlight.ts:81-90`. Plan should include a test that assistant text like ``` ```html\n<script>alert(1)</script>``` ``` does NOT execute the script |
| A2 | `react-markdown@10.1.0` runs cleanly in React 19.2 despite peer dep being `>=18` (no runtime error from React 19's stricter concurrent-mode semantics) | Standard Stack | If react-markdown hits a React 19 regression, planner may need to pin to a later patch. Mitigation: verify on first install with a smoke render of fenced block + list + table |
| A3 | `@tailwindcss/typography@0.5.19` + Tailwind v4 `@theme` directive coexist without requiring config file changes | Standard Stack | Tailwind v4's CSS-first config may not auto-load typography plugin; may require `@plugin "@tailwindcss/typography"` in the CSS. Mitigation: verify on first install and adjust the app's Tailwind CSS entry accordingly |
| A4 | Phase 10 aggregator task is truly per-agent (not multiplexed) across all launch paths (launcher + auto_resume + relaunch) | Current-State Analysis | If any launch path shares an aggregator across agents, the local `TurnBuffer` variable approach breaks and a `HashMap` would be required. Mitigation: grep all `spawn_event_aggregator` call sites — only `agents/commands.rs:243` currently. Planner should confirm no other spawner adds multi-agent fan-in during Wave 0 |

## Open Questions

1. **Where should the `@user` regex live post-refactor — in `MarkdownBody` or shared utility?**
   - What we know: `AssistantTextCard.renderContent` (L32-59) owns it today; `MarkdownBody` needs to run it as a text-node renderer.
   - What's unclear: Should we extract `src/utils/atUserRegex.ts`? Or keep it co-located in MarkdownBody?
   - Recommendation: Extract to `src/utils/atUserRegex.ts` — the Rust side also has its own copy (`parser.rs` `at_user_regex()`), and consolidating the TS side makes future Phase-23 tests simpler. Claude's discretion.

2. **Should `selectToolUseWithResult` accept `agentId` or a pre-filtered event array?**
   - What we know: `useChatStore((s) => s.eventsByAgent[agentId] ?? [])` gives the array; the selector then scans for tool_use_id.
   - What's unclear: API ergonomics — does it pay to memoize?
   - Recommendation: Function-style `selectToolUseWithResult(events, toolUseId)` (shown above) — callers decide memoization via Zustand's `shallow` equality if perf matters. Claude's discretion per CONTEXT D-02.2.

3. **Does Tailwind v4 need `@plugin "@tailwindcss/typography"` in its CSS entry?**
   - What we know: Tailwind v4 uses `@theme` and `@plugin` directives in CSS instead of `tailwind.config.js`.
   - What's unclear: Exact syntax — `@plugin "@tailwindcss/typography";` vs. an import.
   - Recommendation: Planner confirms by running `npm install` + adding the `@plugin` line to `src/index.css` (or wherever Tailwind is loaded) and visually verifying a `.prose` block.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | Install react-markdown stack | ✓ | (existing — see package.json) | — |
| Rust / cargo | Compile parser changes | ✓ | (existing — see Cargo.toml) | — |
| SQLite in-memory | Aggregator tests use `sqlx::memory:` | ✓ | (existing — see `db::events::tests::make_pool_with_chat_schema`) | — |

**No missing dependencies** — phase is entirely additive code/libraries.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (backend) | Rust `cargo test` + `#[tokio::test]` + `tokio::io::duplex` pattern |
| Framework (frontend) | `vitest@^3.0.0` + `@testing-library/react@^16.0.0` + `jsdom@^26.0.0` |
| Backend config | `src-tauri/Cargo.toml` — existing `[[test]]` entries |
| Frontend config | `vitest.config.ts` + `package.json` scripts `test` / `test:watch` |
| Quick run (backend) | `cd src-tauri && cargo test -p aitc --lib chat_runtime::parser::tests` |
| Quick run (frontend) | `npm run test -- src/components/chat/__tests__` |
| Full suite (backend) | `cd src-tauri && cargo test --workspace` |
| Full suite (frontend) | `npm run test` |

### Phase Requirements → Test Map

| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| D-01.1 | Aggregator writes ONE `assistant_text` row per turn (from 3 idle-flush deltas + 1 whole-turn envelope) | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::aggregator_coalesces_one_row_per_turn` | ❌ Wave 0 |
| D-01.4 | On `StdoutClosed` without `TurnComplete`, aggregator writes interrupted row + synthesizes `agent-turn-complete` emit with `terminalReason:"interrupted"` | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::aggregator_flushes_interrupted_on_stdout_closed` | ❌ Wave 0 |
| D-01.5 | Whole-turn `AssistantText` envelope (model: Some) REPLACES buffer; prior idle-flush content is discarded | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::aggregator_whole_turn_envelope_replaces_buffer` | ❌ Wave 0 |
| D-01 (regression) | `@user` notification fires immediately on `AssistantText` event (not delayed to `TurnComplete`) | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::aggregator_fires_at_user_notification_before_flush` | ❌ Wave 0 |
| D-02.1 | `deriveSummary` returns `{primary: "/path", secondary: "3 hunks"}` for `MultiEdit` with `edits.length===3` | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing |
| D-02.1 | `deriveSummary` returns `{primary: "/path", secondary: "N lines"}` for `Write` | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing |
| D-02.2 | `selectToolUseWithResult` returns paired `{toolUse, toolResult}` when both exist; `{toolUse, toolResult: null}` when only tool_use | Unit (TS) | `npm run test -- src/stores/__tests__/chatStore.test.ts` | ❌ Wave 0 |
| D-02.2 | `ToolUseCard` renders green dot when paired `tool_result.is_error === false` | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing |
| D-02.2 | `ToolUseCard` renders red dot when paired `tool_result.is_error === true` | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing |
| D-02.2 | `ToolUseCard` renders grey dot when no paired result yet (in-flight) | Unit (TS) | `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` | ✅ extend existing |
| D-03.1 | `MarkdownBody` renders `**bold**` as `<strong>` | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ Wave 0 |
| D-03.1 | `MarkdownBody` renders `- item` as `<ul><li>` | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ Wave 0 |
| D-03.2 | `MarkdownBody` fenced ` ```typescript ``` ` block invokes `highlightLines` with lang="typescript" | Unit (TS, mocked) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ Wave 0 |
| D-03.2 | Unknown language fenced block renders as plain `<pre><code>` without crashing | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ Wave 0 |
| D-03.3 | Sanitization — `<script>` tag in assistant markdown does NOT end up in rendered DOM | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ Wave 0 |
| D-03.5 | `@user` mention in rendered markdown still wears `text-secondary font-bold` class | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ Wave 0 |
| D-03.6 | `MarkdownBody` with partial fenced code (no closing ```) does NOT throw | Unit (TS) | `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` | ❌ Wave 0 |
| D-04.2 | Parser drops `{subtype: "hook_started", hook_name: "SessionStart:startup"}` with NO `SystemNote` emit | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::session_start_hooks_silently_dropped` | ✅ extend existing (`hook_started_response.jsonl`) |
| D-04.3 | Parser surfaces `{subtype: "hook_started", hook_name: "PreToolUse:Edit"}` as `SystemNote` (regression guard) | Integration (Rust) | `cargo test -p aitc --lib chat_runtime::parser::tests::non_session_start_hooks_still_emit_system_note` | ❌ Wave 0 (new fixture) |

### Sampling Rate

- **Per task commit:** `cd src-tauri && cargo test -p aitc --lib chat_runtime::parser::tests` (Rust-affecting tasks) OR `npm run test -- {touched suite}` (TS-affecting tasks).
- **Per wave merge:** `cd src-tauri && cargo test --workspace` + `npm run test`.
- **Phase gate:** Both full suites green before `/gsd-verify-work`. No new `todo!()`, no skipped tests, no lingering `.only`.

### Wave 0 Gaps

Wave 0 scaffolds that must exist BEFORE Wave 1 implementation starts:

- [ ] **New fixture** `src-tauri/tests/fixtures/stream_json/coalesced_turn.jsonl` — one turn with 3 text_deltas across the 250ms idle boundary + one whole-turn envelope + one `result`. Used by `aggregator_coalesces_one_row_per_turn` and `aggregator_whole_turn_envelope_replaces_buffer`.
- [ ] **New fixture** `src-tauri/tests/fixtures/stream_json/interrupted_turn.jsonl` — one `init` + 2 text_deltas + EOF (no `result` envelope). Used by `aggregator_flushes_interrupted_on_stdout_closed`.
- [ ] **New fixture** `src-tauri/tests/fixtures/stream_json/hook_pretool_use.jsonl` — `{type:"system", subtype:"hook_started", hook_name:"PreToolUse:Edit"}`. Used by `non_session_start_hooks_still_emit_system_note` (D-04.3 regression guard).
- [ ] **Extend fixture** `src-tauri/tests/fixtures/stream_json/hook_started_response.jsonl` unchanged (already tests silent drop semantics post-D-04 — only the assertion changes from "2 SystemNotes" to "0 SystemNotes").
- [ ] **New Rust test helper** — aggregator harness that drives `run_event_aggregator` against `make_pool_with_chat_schema()` + a mock `tauri::AppHandle<MockRuntime>` + an mpsc feed, collecting emitted events via `listen`. Model on Phase 10 Plan 04 existing test harness if one exists; otherwise build from scratch.
- [ ] **New vitest file** `src/components/chat/__tests__/MarkdownBody.test.tsx` — mirrors the `mk()` factory pattern from existing `AssistantTextCard.test.tsx`; mocks `useSyntaxHighlight` to return a stub highlighter.
- [ ] **New vitest file** `src/stores/__tests__/chatStore.test.ts` (may already exist for earlier phases — planner verifies) with a `selectToolUseWithResult` suite.
- [ ] **Framework installs:** `npm install react-markdown@^10.1.0 remark-gfm@^4.0.1 rehype-sanitize@^6.0.0` and `npm install -D @tailwindcss/typography@^0.5.19`. Verify Tailwind v4 plugin loading per Open Question #3.

## Security Domain

> `security_enforcement` is not explicitly disabled in `.planning/config.json` — treating as enabled. Phase 19 renders assistant-generated content as HTML, which makes **V5 Input Validation** and **V14 Configuration** directly relevant.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Stack decisions locked (D-03.1); research documents Pattern 4 for sanitizer placement |
| V2 Authentication | no | No auth surface in Phase 19 |
| V3 Session Management | no | Phase 10's session model unchanged |
| V4 Access Control | no | No new commands or endpoints |
| V5 Input Validation | **YES** | `rehype-sanitize` + Shiki's existing T-05-07 escaping + `safeCssColor` validator |
| V6 Cryptography | no | No crypto surface |
| V7 Error Handling | yes | Partial/broken-fence streaming tolerance (D-03.6); aggregator's graceful StdoutClosed path (D-01.4) |
| V8 Data Protection | no | No new stored data |
| V13 API | no | No new Tauri commands, no new MCP tools |
| V14 Configuration | yes | `rehype-sanitize` default schema + any extension (see Pitfall 4) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via assistant-generated markdown HTML (e.g., `<script>` in fenced blocks or direct HTML) | Tampering | `rehype-sanitize` on the markdown tree; react-markdown does NOT allow raw HTML by default |
| XSS via shiki code-block interior (attacker-controlled source in fenced block with `<script>`) | Tampering | `highlightLines` HTML-escapes token content (T-05-07, `useSyntaxHighlight.ts:104-107`); `safeCssColor` validates inline colors |
| CSS injection via inline `style` on shiki spans | Tampering | `safeCssColor` allowlist (hex / named / rgb/a only) |
| Regex catastrophic backtracking in `@user` detection | DoS | Existing regex `(?:^|[^\w])@user(?:[^\w]|$)` is linear; no new regex added |
| Broken-stream render crash (partial code fence) | DoS via error boundary | Pitfall 5 test; MarkdownBody accepts arbitrary partial input without throwing |
| SQL injection via aggregator payload | Tampering | Unchanged — `insert_agent_event` uses `sqlx::bind` (T-10-02/T-10-12 mitigation preserved) |

**Explicit non-threat:** The aggregator coalescing does NOT introduce a new privilege surface. The same row shape ends up in the DB — just fewer of them. `is_awaiting_user_mention` runs on every AssistantText event, so the D-23 notification pathway is unchanged.

## Sources

### Primary (HIGH confidence)
- [Anthropic Messages API — tool_result schema](https://platform.claude.com/docs/en/api/messages) — authoritative on `content: string | Array<Block>` and `is_error` semantics; confirms no `exit_code` field
- [react-markdown GitHub](https://github.com/remarkjs/react-markdown) — current `components.code` renderer API
- [rehype-sanitize GitHub](https://github.com/rehypejs/rehype-sanitize) — default schema behavior + shiki compatibility note
- `src-tauri/src/chat_runtime/parser.rs` (997 lines) — aggregator + parser source
- `src-tauri/tests/fixtures/stream_json/hook_started_response.jsonl` — confirms `hook_name: "SessionStart:startup"` shape
- `src/hooks/useSyntaxHighlight.ts` — shiki singleton + `highlightLines` + `safeCssColor`
- `src/components/chat/AssistantTextCard.tsx` + `ToolUseCard.tsx` + `stores/chatStore.ts` — current-state refactor targets

### Secondary (MEDIUM confidence)
- [react-shiki (AVGVSTVS96) — README](https://github.com/AVGVSTVS96/react-shiki) — pattern for imperative shiki usage inside react-markdown `code` renderer
- [react-markdown npm](https://www.npmjs.com/package/react-markdown) — version 10.1.0 confirmed current; peer dep `react: >=18`
- [assistant-ui syntax highlighting](https://www.assistant-ui.com/docs/ui/SyntaxHighlighting) — alt pattern reference

### Tertiary (needs validation in session)
- WebSearch results on Claude stream-json Bash tool_result — no authoritative confirmation of `exit_code` absence beyond the Messages API spec. Flagged as `[ASSUMED not present]` in A1; confirmed indirectly by the API reference only listing `tool_use_id`, `type`, `content`, `cache_control`, `is_error` as the block fields.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — library versions verified via `npm view`; peer deps confirmed.
- Current-state analysis: HIGH — every line-reference verified against local files.
- Aggregator refactor shape: HIGH — matches existing per-agent-task architecture; code snippets syntax-checked against surrounding patterns.
- Markdown integration: MEDIUM — `rehype-sanitize` schema behavior confirmed; exact Tailwind v4 typography plugin wiring is an Open Question.
- tool_result shape: HIGH — Anthropic Messages API is authoritative; absence of `exit_code` is explicit.
- Validation assertions: HIGH — every assertion maps to a specific code location or fixture.

**Research date:** 2026-04-21
**Valid until:** 2026-07-21 (90 days — react-markdown ecosystem is stable; Claude API schemas are additive)
