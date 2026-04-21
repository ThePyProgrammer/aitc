# Phase 19: Polish Phase 10 chat transcript rendering — Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** `--auto` — recommended options selected for all gray areas

<domain>
## Phase Boundary

Polish the Phase 10 chat transcript rendering pipeline. Four UAT-surfaced gaps:

1. **Coalesce repeated `assistant_text` rows** — aggregator currently writes one DB row per `content_block_delta` flush (idle-flush partials + whole-turn envelope); the transcript shows adjacent duplicated chunks even after the 9c2f4e8 `isContinuation` label fix.
2. **Richer tool-use card summaries + outcome previews** — collapsed row shows only a raw path/command; no hunk count for Edit/MultiEdit, no exit-code/stdout preview for Bash, no size for Write. Visual treatment must tighten to match codey's collapsed details-summary aesthetic.
3. **Markdown rendering for assistant text** — `AssistantTextCard` body currently uses `whitespace-pre-wrap` on plain `<p>`, so triple-backticks/`*emphasis*`/`- lists` render as literal characters. Need `react-markdown` + `remark-gfm` + syntax highlighting via the existing Phase 5 `useSyntaxHighlight` shiki singleton.
4. **Filter SessionStart hook line-noise** — 4×`[HOOK_STARTED] SessionStart:startup` + 4×`[HOOK_RESPONSE] SessionStart:startup` appear at every session boot because `parser::dispatch_system` emits a `SystemNote` for every `hook_*` lifecycle event.

All four are UI/parser polish on the working Phase 10 pipeline. **No schema changes, no new capabilities, no new agent types.**

(New capabilities belong in other phases.)

</domain>

<decisions>
## Implementation Decisions

### D-01 — Chunk coalescing (Gap 1)

- **D-01.1** Merge at the **aggregator** (`chat_runtime::parser::spawn_event_aggregator`), not at a TS store selector. Rationale: keeps DB rows correct (one `assistant_text` row per assistant turn); store stays simple; matches existing "aggregator is single owner of DB writes + emits" invariant.
- **D-01.2** Strategy: **buffer `AssistantText` content in aggregator state until `TurnComplete`, then write ONE row**. Progressive reveal already works via `agent-assistant-delta` events (no DB write needed for progressive UI).
- **D-01.3** Suppress the `insert_agent_event` call on idle-flush `AssistantText` — treat idle-flush only as an internal accumulator trigger (already how it works in the parser; aggregator-side change is the key).
- **D-01.4** Interrupted turn (parser emits `StdoutClosed` before a `TurnComplete`): **flush buffered text as one row tagged `terminal_reason="interrupted"`** in the session_boundary handler. No data loss.
- **D-01.5** The whole-turn `AssistantText` envelope (from `dispatch_assistant` "text" block) **replaces the running buffer** (not concatenated) — it is authoritative; subsequent idle-flushes within the same turn won't occur because `dispatch_assistant` clears `accumulated_text`.
- **D-01.6** Event ordering preserved: `SessionStarted → AssistantDelta* → ToolUse/ToolResult* → AssistantText (coalesced) → TurnComplete`. Only the **DB-row count** changes, not the StreamEvent schema.

### D-02 — Tool-use card enrichment (Gap 2)

- **D-02.1** Per-tool summary derivation replaces the current single `deriveSummary` function with a dispatcher returning `{primary: string, secondary?: string}`:
  - `Edit`: `file_path • 1 hunk`
  - `MultiEdit`: `file_path • {N} hunks` where N = `tool_input.edits.length`
  - `Write`: `file_path • {N} lines` where N = newline count of `tool_input.content` (fallback `{M} chars`)
  - `Read` / `Grep` / `Glob`: existing behavior (path / pattern)
  - `Bash`: command (existing)
  - `WebFetch` / `WebSearch`: `{host} • {path}` parsed from url
- **D-02.2** **Outcome preview via `tool_result` join in the TS store selector.** Store exposes `selectToolUseWithResult(toolUseId)` returning `{ toolUse, toolResult? }`. `ToolUseCard` consumes the joined view; shows:
  - Status dot (green when `tool_result.is_error === false` AND (if Bash) `exit_code === 0`; red when `is_error === true` or `exit_code !== 0`; neutral grey when no paired result yet / in-flight)
  - 1-line truncated stdout/stderr snippet for Bash (when present)
- **D-02.3** Backend unchanged — no new payload fields, no migration. Correlation keys (`tool_use_id`) are already stored in payloads.
- **D-02.4** Visual polish to match codey's collapsed-row aesthetic:
  - Tighten vertical rhythm: `py-2` → `py-1.5`
  - Status dot rendered before `TOOL` label (shrink-0 8px circle)
  - Expanded body gains `bg-surface-container/10` tint (currently `/20`) for a lighter divider feel
  - Keep the existing chevron + approval chip link — don't break Phase 10 navigation.
- **D-02.5** Summary must remain a single-line truncation (existing `truncate` CSS) — enrichment adds structure, not wrap points.

### D-03 — Markdown rendering (Gap 3)

- **D-03.1** Library stack: `react-markdown` + `remark-gfm`. Pinned to a version range compatible with React 19.
- **D-03.2** **Reuse the existing `useSyntaxHighlight` shiki singleton** (`src/hooks/useSyntaxHighlight.ts`). A custom `code` renderer in `react-markdown` invokes `highlightLines` from the existing hook for fenced code blocks. Do NOT instantiate a second shiki highlighter.
  - Supported languages are whatever the singleton already loads (typescript, javascript, rust, json, css, html, python). Unknown languages render as plain `<pre><code>` — no error.
- **D-03.3** Sanitization: `react-markdown` default (HTML off) + **`rehype-sanitize`** belt-and-suspenders. Assistant output is untrusted.
- **D-03.4** Scope — only `assistant_text` events render markdown for Phase 19. User messages (`user_text`) stay monospace plain — users type commands, not markdown. `system_note` stays plain. `tool_use` / `tool_result` stay plain.
- **D-03.5** New component: `src/components/chat/MarkdownBody.tsx`. `AssistantTextCard` delegates body rendering to it. Existing `@user` mention highlighting migrates into a custom text-node renderer on `MarkdownBody` so the Phase 10 D-23 styling doesn't regress.
- **D-03.6** Streaming: render partial `content` through `MarkdownBody` every re-render. Tolerate transient parser glitches on mid-stream broken fences/tags — self-heals at TurnComplete. No special "freeze until complete" logic.
- **D-03.7** Typography: match codey's `prose prose-sm prose-neutral dark:prose-invert` pattern for the container, scoped so it doesn't bleed into surrounding UI (consider `@tailwindcss/typography` if not already installed — planner verifies).

### D-04 — SessionStart hook noise filter (Gap 4)

- **D-04.1** Filter at the **parser** (`chat_runtime::parser::dispatch_system`), not the aggregator or the UI. No DB row, no Tauri emit — the noise never reaches the transcript in the first place.
- **D-04.2** Filter predicate: when `subtype` is one of `hook_started` / `hook_response` / `hook_completed` AND `hook_name` starts with `SessionStart:` (or equals `SessionStart`), **drop the envelope silently** (no `SystemNote` emitted).
- **D-04.3** Other hook lifecycle events (PreToolUse, UserPromptSubmit, PostToolUse, Stop, etc.) continue to surface as `SystemNote`. Those carry signal the user wants visible.
- **D-04.4** **Do not fold into a collapsed "4 hooks fired" row.** SessionStart hooks are boot ceremony with zero user value; silent drop is cleaner than a placeholder.
- **D-04.5** `raw_stdout` events are untouched — full hook lifecycle remains available for debugging via the RawStreamCard.
- **D-04.6** The unknown-subtype catch-all (`[system/{subtype}]`) is preserved for other unknown system events — only confirmed SessionStart noise is silenced.

### Claude's Discretion

- **Exact TS signature of `selectToolUseWithResult`** (D-02.2) — store structure / memoization strategy is Claude's call; requirement is single-pass lookup by `tool_use_id`.
- **Exact packaging of the per-tool summary dispatcher** (D-02.1) — object map vs switch vs per-tool registry — Claude picks the shape that matches existing patterns in `ToolPreview/registry.ts`.
- **Test structure** — unit tests for the aggregator coalescing behavior (parser fixtures + in-memory pool), component tests for `MarkdownBody` and the enriched `ToolUseCard`, and parser-filter tests for the SessionStart drop. Claude picks fixtures and assertion style.
- **Whether to install `@tailwindcss/typography`** — if already installed, reuse; otherwise planner may install and wire it for `MarkdownBody`.
- **Version pins** for `react-markdown`, `remark-gfm`, `rehype-sanitize` — pick latest React-19-compatible stable.
- **Micro-animations** on the new status dot / coalesced row appearance — Phase 10's motion conventions apply; Claude interprets.

### Folded Todos

None. No pending todos were flagged as relevant to Phase 19.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase boundary + scope

- `.planning/ROADMAP.md` — Phase 19 entry is the authoritative scope definition (four enumerated gaps). Don't widen.

### Upstream Phase 10 decisions (all still locked)

- `.planning/phases/10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s/10-CONTEXT.md` — conversation model, D-17 (aggregator authority over DB writes), payload-key convention (snake_case matching Claude stream-json).
- `.planning/phases/10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s/10-UI-SPEC.md` — chat surface design contract; `assistant_text` full-width row, `tool_use` inline row, approval chip rendering.
- `.planning/phases/10-implement-a-proper-chat-user-interface-for-agents-i-deploy-s/10-RESEARCH.md` §Pitfall 2 — hook envelopes must NOT surface as assistant_text (already respected; Phase 19 tightens further to silent-drop for SessionStart).

### Files that Phase 19 modifies (primary targets)

- `src-tauri/src/chat_runtime/parser.rs` — aggregator coalescing (D-01), SessionStart filter (D-04). Single file owns both backend fixes.
- `src/components/chat/AssistantTextCard.tsx` — delegates body to `MarkdownBody` (D-03.5). Preserves `isContinuation` logic + `@user` mention styling.
- `src/components/chat/ToolUseCard.tsx` — per-tool summary dispatcher (D-02.1), status-dot styling (D-02.4), consumes paired result via store (D-02.2).

### Files that Phase 19 creates

- `src/components/chat/MarkdownBody.tsx` — new assistant markdown renderer (D-03.5).

### Files that Phase 19 reuses (do NOT modify these)

- `src/hooks/useSyntaxHighlight.ts` — existing shiki singleton + `highlightLines`. Reuse verbatim for D-03.2 code fences.
- `src/views/CommsHub/ToolPreview/registry.ts` — **FROZEN by Phase 8 contract-lock tests.** Expanded-body detail comes from here; Phase 19 only enriches the collapsed-row summary.
- `src-tauri/src/chat_runtime/types.rs` — `StreamEvent` enum. Coalescing is internal to the aggregator; StreamEvent schema is untouched.
- `src-tauri/src/db/events.rs` — `insert_agent_event` reused for the single post-`TurnComplete` row write.

### Store / state

- `src/stores/chatStore.ts` — where `selectToolUseWithResult` lands (D-02.2). Existing selectors pattern should guide the new one.

### Test infrastructure

- `src-tauri/src/chat_runtime/parser.rs` existing test module (`#[cfg(test)] mod tests`) — has fixtures under `src-tauri/tests/fixtures/stream_json/` including `hook_started_response.jsonl`, `single_turn_text.jsonl`, `multi_turn_persistent.jsonl`, `tool_use_edit.jsonl`. New coalescing + SessionStart-drop tests extend this suite.
- `src/components/chat/__tests__/` — existing vitest suites for chat cards; `MarkdownBody.test.tsx` and an enriched `ToolUseCard.test.tsx` land here.

### External docs the planner researches

- `react-markdown` v10+ docs (compatibility with React 19.2)
- `remark-gfm` current
- `rehype-sanitize` current + its default allowlist (the default is safe; verify)
- (Optional) `@tailwindcss/typography` v0.5+ if not already installed

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`useSyntaxHighlight` hook** (`src/hooks/useSyntaxHighlight.ts`) — shiki singleton, 7 langs (typescript/javascript/rust/json/css/html/python), github-dark theme, plus `highlightLines` helper returning per-line HTML strings. Directly consumable from a custom `react-markdown` code renderer.
- **ToolPreview registry** (`src/views/CommsHub/ToolPreview/registry.ts`) — already wired into the expanded `ToolUseCard` body via `<ToolPreview />`. Full-detail per-tool rendering (EditPreview, WritePreview, BashPreview, NotebookPreview, ProtectedPathPreview, UnknownToolPreview) already exists. Phase 19 does not change the registry — it enriches only the collapsed-row summary.
- **`is_awaiting_user_mention` regex helper** (`src-tauri/src/chat_runtime/parser.rs`) — untouched by Phase 19.
- **Phase 10 StreamEvent enum** (`src-tauri/src/chat_runtime/types.rs`) — full shape reused; no new variants.
- **`insert_agent_event` DB helper** (`src-tauri/src/db/events.rs`) — same INSERT call; Phase 19 simply calls it less (one row per turn instead of N).
- **Frontend `@user` mention renderer** (`AssistantTextCard.renderContent`) — migrates into a `MarkdownBody` text-node renderer so the D-23 Phase 10 styling survives the markdown pass.

### Established Patterns

- **Aggregator is the single owner of DB writes + emits** (Phase 10 D-17). Coalescing is the textbook extension of this invariant — bundle a turn's text into one authoritative DB row.
- **Payload keys mirror Claude stream-json** (Phase 10 D-07 / Plan 02 comments). `tool_name`, `tool_input`, `tool_use_id`, `is_error`, `terminal_reason` — don't rename.
- **Store selectors own cross-event correlation.** Phase 19's `tool_use` → `tool_result` join lives in a selector, not in a backend payload. This matches how `chatStore` already composes events for transcript rendering.
- **Snake_case payloads, camelCase TS types.** specta/tauri-specta bridges the two. Phase 19 introduces no new types, so no new bindings.
- **Shiki is loaded once, never re-instantiated.** The Phase 5 hook is the contract.
- **Motion `layout` + `AnimatePresence`** power the tool-use card expand/collapse (Phase 10 pattern). Preserve for D-02.4 visual changes.

### Integration Points

- **`parser::dispatch_system`** (`src-tauri/src/chat_runtime/parser.rs` ~line 209-237) — SessionStart filter inserts a predicate before the current `hook_started`/`hook_response`/`hook_completed` → `SystemNote` emit.
- **`parser::run_event_aggregator`** (`src-tauri/src/chat_runtime/parser.rs` ~line 461-705) — aggregator gains per-agent turn state: `HashMap<AgentId, TurnBuffer>` holding accumulated assistant text + paired model. On `AssistantText` StreamEvent → append/replace buffer; on `TurnComplete` → INSERT one row + clear buffer; on `StdoutClosed` → flush remainder as interrupted row.
- **`AssistantTextCard` body render** (`src/components/chat/AssistantTextCard.tsx` L84-105) — swap the `<p>` body for `<MarkdownBody content={content} streaming={streaming} />`.
- **`ToolUseCard` summary line** (`src/components/chat/ToolUseCard.tsx` L93) — derive summary via the new dispatcher; inject status dot before `TOOL` label; consume paired `tool_result` via new selector.
- **No new Tauri commands.** Everything Phase 19 needs is already reachable through Phase 10's surface.
- **No schema migrations.** Fewer rows get written; existing rows keep their shape.

</code_context>

<specifics>
## Specific Ideas

- **Codey's details-summary aesthetic** (D-02.4) — the reference is the `codey` frontend previously cited across Phase 10 (`PlaygroundPage.MessageRow`, `prose prose-sm prose-neutral dark:prose-invert` typography). Match tone, not pixel-for-pixel.
- **Green/red status dot** mirrors the existing conflict/approval status-color vocabulary (surface-container + phosphor accents from Command Horizon design system).
- **"Silent drop" for SessionStart** (D-04.4) is explicit: no placeholder row, no "N hooks folded" summary. The transcript should look like boot never happened.
- **Markdown typography container** — if `@tailwindcss/typography` is not already in `package.json`, prefer installing it over hand-rolling `.prose-*` utilities; the plugin is small and well-scoped.

</specifics>

<deferred>
## Deferred Ideas

- **Rich markdown inside user_text messages** — low value; users type commands, not markdown. If a future phase surfaces multi-line user authoring (paste long prompts, template snippets), reconsider.
- **Syntax highlighting language expansion** — Phase 19 reuses the Phase 5 7-lang set. Adding Go, Ruby, etc. is a separate ergonomics concern.
- **Hook-noise fold-row with count** — explicitly rejected for SessionStart (D-04.4). If a different hook family later proves noisy and user wants visibility, the fold UI can ship as a tiny separate phase.
- **Tool-use card outcome timing** (e.g., ms-elapsed badge) — Phase 10 events don't carry duration; adding it would require a backend change. Out of scope.
- **Diff-preview thumbnail in the collapsed row** for Edit/MultiEdit — the expanded `EditPreview` already renders the full diff. A thumbnail would duplicate that real estate.
- **Raw-stream card filter parity** — Phase 19 silences SessionStart in the user-facing transcript only; `raw_stdout` events still show everything. Any raw-stream UI filter is its own scope.

### Reviewed Todos (not folded)

None — no pending todos were surfaced for Phase 19.

</deferred>

---

*Phase: 19-polish-phase-10-chat-transcript-rendering-four-related-gaps-*
*Context gathered: 2026-04-21*
