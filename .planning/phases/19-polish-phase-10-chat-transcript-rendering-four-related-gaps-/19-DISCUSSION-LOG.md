# Phase 19: Polish Phase 10 chat transcript rendering — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `19-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 19-polish-phase-10-chat-transcript-rendering-four-related-gaps-
**Mode:** `--auto` (all gray areas auto-selected; recommended option picked per question)
**Areas discussed:** Chunk coalescing, Tool-use card enrichment, Markdown rendering, Hook noise filter

---

## Area 1: Chunk coalescing (merge repeated assistant_text rows)

### Q1.1 Where should adjacent assistant_text chunks be merged?

| Option | Description | Selected |
|--------|-------------|----------|
| Aggregator-side (Rust) | Merge at turn boundary inside `run_event_aggregator`; one authoritative DB row per turn | ✓ |
| Store-side selector (TS) | Keep DB rows as-is; collapse adjacent events in a Zustand selector | |
| Hybrid | Aggregator merges partial-flush rows, store selector also dedupes | |

**Auto-selected:** Aggregator-side.
**Rationale:** Matches the existing "aggregator is single owner of DB writes + emits" invariant from Phase 10 D-17. DB history stays clean; frontend store stays simple; one source of truth for what rows exist.

### Q1.2 Aggregator strategy — INSERT-then-UPDATE vs buffer-then-INSERT?

| Option | Description | Selected |
|--------|-------------|----------|
| Buffer in memory until TurnComplete, then INSERT once | Progressive UI comes from existing `agent-assistant-delta` events — no DB write needed until turn ends | ✓ |
| INSERT on first chunk, UPDATE on subsequent chunks | Multiple writes per turn; fewer rows than today but more churn than buffering | |
| Emit early empty placeholder row, UPDATE it | Same as above; more complex reconciliation | |

**Auto-selected:** Buffer in memory until `TurnComplete`.
**Rationale:** Minimum DB churn; existing `AssistantDelta` emit path already drives progressive reveal in the UI without needing a DB row in flight.

### Q1.3 Interrupted turn (no TurnComplete) — what happens to buffered text?

| Option | Description | Selected |
|--------|-------------|----------|
| Flush on `StdoutClosed` / session_boundary with `terminal_reason="interrupted"` | No data loss; single row per interrupted turn | ✓ |
| Drop buffered text | Lose the partial output permanently | |
| Separate "interrupted" event variant | Requires StreamEvent schema change; scope creep | |

**Auto-selected:** Flush on disconnect with interrupted marker.
**Rationale:** Preserves partial output; no schema change; aligns with existing session_boundary emit path.

### Q1.4 Idle-flush (250ms) partial AssistantText handling

| Option | Description | Selected |
|--------|-------------|----------|
| Keep idle-flush as internal buffer-only trigger; suppress DB row | Progressive UI already works via `AssistantDelta`; idle-flush just advances internal state | ✓ |
| Keep current DB row per idle-flush | This is the current behavior — the bug | |
| Remove idle-flush entirely | Would delay the `AssistantText` `StreamEvent` until whole-turn envelope; changes StreamEvent ordering | |

**Auto-selected:** Suppress DB row for idle-flush partials.
**Rationale:** The aggregator owns DB writes — suppressing the insert on idle-flush `AssistantText` events is the minimal change to fix the "duplicated chunks" bug without touching the parser's StreamEvent ordering.

---

## Area 2: Tool-use card enrichment

### Q2.1 How to enrich the collapsed-row summary?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-tool summary dispatcher returning `{primary, secondary?}` | Edit/MultiEdit: file + N hunks; Write: file + N lines; WebFetch: host + path; etc. | ✓ |
| Keep current single `deriveSummary`; rely on expand for everything | Doesn't meet the phase goal ("no hunk count for MultiEdit") | |
| Show a multi-line summary (2 lines) | Breaks the tight single-row aesthetic | |

**Auto-selected:** Per-tool summary dispatcher.
**Rationale:** Matches ROADMAP's "richer summary derivation"; keeps single-line truncation; composable with codey's tight vertical rhythm.

### Q2.2 How does the card show tool_result outcome (exit code / success / fail)?

| Option | Description | Selected |
|--------|-------------|----------|
| TS store selector joins paired tool_result by `tool_use_id`; card shows status dot + 1-line snippet | No backend change; selector lives in `chatStore` | ✓ |
| Wait for user to expand | Doesn't meet ROADMAP call-out for exit-code preview | |
| Separate status row below tool_use | Duplicates display; breaks single-row flow | |
| New backend payload field carrying result status | Requires Phase 10 schema change — explicitly out of scope | |

**Auto-selected:** Store-side selector join.
**Rationale:** No backend change; keeps payloads Claude-stream-json-shaped; correlation key (`tool_use_id`) already stored.

### Q2.3 Visual treatment to match codey's collapsed details-summary aesthetic

| Option | Description | Selected |
|--------|-------------|----------|
| Tighter rhythm (py-1.5), status dot before tool name, subtle surface-container/10 expand tint, keep chevron | Minimum-change polish that lands the aesthetic | ✓ |
| Keep current styling | Phase goal explicitly calls for match | |
| Radical redesign (bubble chrome, different layout) | Scope creep; breaks Phase 10 UI contract | |

**Auto-selected:** Tighter rhythm + status dot + subtle tint.
**Rationale:** Scoped polish; preserves approval chip + expand behavior; aligns with codey reference.

### Q2.4 Hunk-count derivation for MultiEdit

| Option | Description | Selected |
|--------|-------------|----------|
| `tool_input.edits.length` (MultiEdit) / 1 (Edit) | Simple, correct, no parser change | ✓ |
| Parse `old_string`/`new_string` into unified diff and count hunks | Overengineered for a collapsed-row summary | |
| Count lines of changes via InlineDiff internals | Couples collapsed-row to expand-body logic | |

**Auto-selected:** Array-length / constant.
**Rationale:** Exactly the information a collapsed row needs; full diff lives in the expanded `EditPreview`.

---

## Area 3: Markdown rendering

### Q3.1 Library choice

| Option | Description | Selected |
|--------|-------------|----------|
| `react-markdown` + `remark-gfm` | Matches ROADMAP exactly; composable with rehype plugins; React-19 compatible | ✓ |
| `marked` / `markdown-it` | Raw HTML output; heavier XSS handling | |
| Build from scratch | Not acceptable | |

**Auto-selected:** `react-markdown` + `remark-gfm`.
**Rationale:** ROADMAP spec; ecosystem standard.

### Q3.2 Syntax highlighting integration

| Option | Description | Selected |
|--------|-------------|----------|
| Custom rehype/ref transformer wired to existing `useSyntaxHighlight` shiki singleton | Zero new highlighter instances; reuse Phase 5 infra | ✓ |
| New per-component shiki instantiation via a `rehype-shiki` plugin | Would spawn a second highlighter; wasteful | |
| Plain `<pre>` code blocks with no syntax | Phase goal explicitly mentions shiki | |
| Use `prism-react-renderer` or similar | New dependency that duplicates what we already have | |

**Auto-selected:** Reuse existing `useSyntaxHighlight` singleton.
**Rationale:** One highlighter across the app; same 7-language + github-dark setup as the merge diff viewer.

### Q3.3 Sanitization stance

| Option | Description | Selected |
|--------|-------------|----------|
| react-markdown default (no raw HTML) + `rehype-sanitize` belt-and-suspenders | Defense in depth; assistant output untrusted | ✓ |
| Allow raw HTML | XSS risk unacceptable | |
| Regex-based tag stripping | Unreliable | |

**Auto-selected:** react-markdown default + `rehype-sanitize`.
**Rationale:** Assistant output is untrusted; two independent layers is cheap and correct.

### Q3.4 Which event types render markdown?

| Option | Description | Selected |
|--------|-------------|----------|
| `assistant_text` only for Phase 19 | Matches ROADMAP scope; users type commands not markdown | ✓ |
| Assistant + user | Scope creep; low value for user messages | |
| Assistant + user + system_note | Same concern plus system_note is already sparse plain text | |

**Auto-selected:** Assistant-only.

### Q3.5 Renderer placement

| Option | Description | Selected |
|--------|-------------|----------|
| New `src/components/chat/MarkdownBody.tsx` consumed by `AssistantTextCard` | Single home; AssistantTextCard stays thin; future phases can share MarkdownBody | ✓ |
| Inline inside `AssistantTextCard` | Makes AssistantTextCard bloated; harder to test in isolation | |
| Replace `AssistantTextCard` entirely | Unnecessary blast radius | |

**Auto-selected:** New `MarkdownBody` component.

### Q3.6 `@user` mention highlighting preservation

| Option | Description | Selected |
|--------|-------------|----------|
| Migrate `renderContent` into a custom text-node renderer on MarkdownBody | Preserves Phase 10 D-23 styling; keeps regex single-sourced | ✓ |
| Drop the special styling | Regresses Phase 10 functionality | |
| Pre-process content to wrap @user in inline HTML before markdown | Conflicts with sanitization | |

**Auto-selected:** Custom text-node renderer.

### Q3.7 Streaming behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Render partial content through markdown every re-render; tolerate mid-stream glitches | Self-heals at TurnComplete; minimum special-casing | ✓ |
| Freeze rendering to plain text until turn completes | Loses progressive-reveal affordance | |
| Debounce markdown rendering to every N tokens | Premature optimization | |

**Auto-selected:** Render partial every re-render.

---

## Area 4: SessionStart hook noise filter

### Q4.1 Filter location

| Option | Description | Selected |
|--------|-------------|----------|
| Parser-side suppression in `dispatch_system` | No DB row, no Tauri emit; simplest and cheapest | ✓ |
| Aggregator-side folding (one collapsed row per session) | Adds visual noise the user explicitly doesn't want | |
| Frontend filter | DB still collects noise forever; harder to evolve | |

**Auto-selected:** Parser-side suppression.
**Rationale:** `agent_events` is a user-facing transcript, not a debug log; `raw_stdout` still captures the full hook lifecycle for debugging.

### Q4.2 Filter scope (which hooks to silence)

| Option | Description | Selected |
|--------|-------------|----------|
| Suppress `hook_name.starts_with("SessionStart:")` for `hook_started`/`hook_response`/`hook_completed` subtypes | Covers `SessionStart:startup` + future SessionStart subtypes; leaves other hooks visible | ✓ |
| Only `SessionStart:startup` exact match | Too narrow; new subtypes would leak | |
| All hook lifecycle events | Too broad; user wants PreToolUse/UserPromptSubmit visibility | |

**Auto-selected:** `SessionStart:` prefix match.

### Q4.3 Folded placeholder row?

| Option | Description | Selected |
|--------|-------------|----------|
| No fold — silent drop | Boot ceremony with zero user value; cleanest | ✓ |
| One system_note per session "4 hooks fired on SessionStart" | Adds friction for no benefit | |

**Auto-selected:** Silent drop.

### Q4.4 Unknown system subtype catch-all

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve existing `[system/{subtype}]` catch-all for non-SessionStart unknowns | Future unknowns remain visible for triage | ✓ |
| Silence all unknown system subtypes | Hides signal with noise | |

**Auto-selected:** Preserve catch-all.

---

## Claude's Discretion

- Exact TypeScript signature of `selectToolUseWithResult` (D-02.2) — store structure / memoization is Claude's call.
- Exact packaging of the per-tool summary dispatcher (D-02.1) — object map vs switch vs registry.
- Test structure — unit tests for aggregator coalescing, component tests for `MarkdownBody` and enriched `ToolUseCard`, parser-filter test for SessionStart drop.
- Whether to install `@tailwindcss/typography` if not already present.
- Version pins for `react-markdown`, `remark-gfm`, `rehype-sanitize`.
- Micro-animation details for the new status dot and coalesced row.

## Deferred Ideas

- Rich markdown inside user_text messages
- Syntax highlighting language expansion beyond the Phase 5 7-lang set
- Hook-noise fold-row with count (explicitly rejected for SessionStart)
- Tool-use card duration badges (needs backend change)
- Diff-preview thumbnail on the collapsed tool-use row
- Raw-stream card filter parity
