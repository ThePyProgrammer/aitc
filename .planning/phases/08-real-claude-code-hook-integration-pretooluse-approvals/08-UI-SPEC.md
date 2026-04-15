---
phase: 8
slug: real-claude-code-hook-integration-pretooluse-approvals
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-15
---

# Phase 8 -- UI Design Contract

> Visual and interaction contract for the Claude Code PreToolUse hook surfaces. Extends -- does not redesign -- the Phase 4 Comms Hub. Locks only the new/modified elements: tool-name badge, ApprovalRequestCard preview line, ToolPreview detail-panel registry, "don't ask again" checkbox, abandoned row state, and deep-link notification behavior.

---

## Scope of This Spec

| In scope (locked here) | Out of scope (inherits Phase 4) |
|------------------------|---------------------------------|
| Tool-name badge (new component) | 3-panel Comms Hub layout (280 / flex-1 / 260) |
| ApprovalRequestCard preview line (D-14) | RequestQueue structure + virtualization |
| ToolPreview detail-panel renderers (D-15) | Existing InlineDiff + editable lines (reused) |
| `Show all` truncation control (D-16) | UrgencyBadge, StatusBadge, PendingCountBadge |
| "Don't ask again this session" checkbox (D-22) | ApprovalActions APPROVE / DENY / ASK_MORE_INFO / APPROVE_WITH_EDITS buttons |
| Abandoned row visual state (D-09) | Sidebar, TopBar, Tower Control |
| Deep-link notification + tray-click fallback (D-18) | ChatThread, ChatInput, TelemetryPanel, MiniChatCard |

Phase 4 and Phase 5 UI-SPEC remain canonical for everything not enumerated above.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (custom Command Horizon design system) |
| Preset | not applicable |
| Component library | none (hand-built; inherits Phase 1 theme.css + fonts.css) |
| Icon library | Lucide React (`strokeWidth: 1.5`) |
| Font | Space Grotesk (labels, badges, headings) + JetBrains Mono (data, code, file paths, commands) |

Source: `CLAUDE.md` rejects shadcn; Phase 1/4/5 contracts already define the full design system. This phase adds no new library. Inherits `useSyntaxHighlight` (Shiki, Phase 5) for code blocks -- no new theme required.

---

## Spacing Scale

Reuses the Phase 4 scale verbatim. Values used in this phase:

| Token | Value | Phase 8 Usage |
|-------|-------|---------------|
| xs | 4px | Gap between tool-badge icon and label; preview-line gutter after file path |
| sm | 8px | Tool badge internal padding (8px horizontal, 2px vertical); gap between UrgencyBadge and ToolBadge; preview-line top margin |
| md | 16px | ToolPreview panel internal padding; code-block padding; section gap inside ToolPreview (header row -> body) |
| lg | 24px | Vertical rhythm between ToolPreview sections (Description -> Command -> Metadata in BashPreview) |

Exceptions (phase-specific, all multiples of 4):
- ToolBadge height: 20px (matches UrgencyBadge height from Phase 4)
- ToolPreview code-block max-height before `Show all` kicks in: 400px (20 lines * 20px line-height)
- "Don't ask again" checkbox height: 16px square; row height 24px
- Abandoned row preview-line left border: 2px solid `outline-variant` (no change to card total width)
- Toast/notification click → in-app animated highlight band: 2px pulse, 4px outside card (no layout shift)

---

## Typography

Reuses Phase 4 roles verbatim. The new surfaces map to existing roles only:

| New Surface | Role | Font | Size | Weight | Line Height | Letter Spacing |
|-------------|------|------|------|--------|-------------|----------------|
| ToolBadge label text | Label | Space Grotesk | 10px | 400 | 1.4 | 0.1em UPPERCASE |
| ApprovalRequestCard preview line (all tools) | Data-sm | JetBrains Mono | 10px | 400 | 1.4 | -0.025em |
| ToolPreview section heading ("COMMAND", "DESCRIPTION", "ARGUMENTS") | Heading | Space Grotesk | 14px | 700 | 1.4 | 0.1em UPPERCASE |
| ToolPreview metadata key-value keys | Label | Space Grotesk | 10px | 400 | 1.4 | 0.1em UPPERCASE |
| ToolPreview metadata key-value values + code-block contents | Data | JetBrains Mono | 12px | 700 | 1.4 | -0.025em |
| `Show all` toggle link | Label | Space Grotesk | 10px | 700 | 1.4 | 0.1em UPPERCASE |
| "Don't ask again this session for {TOOL}" checkbox label | Label | Space Grotesk | 10px | 400 | 1.4 | 0.1em UPPERCASE |
| Abandoned footer text ("ABANDONED — AGENT EXITED") | Label | Space Grotesk | 10px | 400 | 1.4 | 0.1em UPPERCASE |

Font size scale unchanged: 10, 12, 14, 20 (4 sizes).
Font weights unchanged: 400 regular + 700 bold (2 weights).

---

## Color

Reuses Phase 4 palette verbatim. No new tokens introduced. Phase-8 specific reservations:

### Tool Badge -- Per-Tool Color Mapping

Write-class tools use `primary` (phosphor green) as their house color — they are the gated default set. Execution + system tools use `tertiary` (amber) to signal "non-file, higher blast radius". Read-class gating (triggered only by `protected_paths`) uses `on-surface-variant` to stay visually subordinate. MCP + unknown use `secondary` (cyan) to flag "contract-unverified source".

| Tool Name (backend `tool_name`) | Badge Label | Badge Icon (Lucide) | Text Color | Background | Border |
|---------------------------------|-------------|---------------------|------------|------------|--------|
| `Edit` | `EDIT` | `Edit3` | `#8eff71` (primary) | `rgba(142,255,113,0.10)` | `rgba(142,255,113,0.20)` |
| `MultiEdit` | `MULTI-EDIT` | `Edit3` | `#8eff71` (primary) | `rgba(142,255,113,0.10)` | `rgba(142,255,113,0.20)` |
| `Write` | `WRITE` | `FilePlus` | `#8eff71` (primary) | `rgba(142,255,113,0.10)` | `rgba(142,255,113,0.20)` |
| `NotebookEdit` | `NOTEBOOK` | `BookOpen` | `#8eff71` (primary) | `rgba(142,255,113,0.10)` | `rgba(142,255,113,0.20)` |
| `Bash` | `BASH` | `Terminal` | `#ffd16f` (tertiary) | `rgba(255,209,111,0.10)` | `rgba(255,209,111,0.20)` |
| `Read` | `READ` | `Eye` | `#adaaaa` (on-surface-variant) | `rgba(173,170,170,0.08)` | `rgba(173,170,170,0.20)` |
| `LS` | `LS` | `FolderOpen` | `#adaaaa` | `rgba(173,170,170,0.08)` | `rgba(173,170,170,0.20)` |
| `Grep` | `GREP` | `Search` | `#adaaaa` | `rgba(173,170,170,0.08)` | `rgba(173,170,170,0.20)` |
| `Glob` | `GLOB` | `SearchCode` | `#adaaaa` | `rgba(173,170,170,0.08)` | `rgba(173,170,170,0.20)` |
| `WebFetch` | `WEBFETCH` | `Globe` | `#00cffc` (secondary) | `rgba(0,207,252,0.10)` | `rgba(0,207,252,0.20)` |
| `WebSearch` | `WEBSEARCH` | `Globe` | `#00cffc` (secondary) | `rgba(0,207,252,0.10)` | `rgba(0,207,252,0.20)` |
| `Task` | `TASK` | `ListTodo` | `#00cffc` | `rgba(0,207,252,0.10)` | `rgba(0,207,252,0.20)` |
| `mcp__*` (any MCP tool; prefix match) | `MCP` | `Plug` | `#00cffc` | `rgba(0,207,252,0.10)` | `rgba(0,207,252,0.20)` |
| anything else | `UNKNOWN` | `HelpCircle` | `#00cffc` | `rgba(0,207,252,0.10)` | `rgba(0,207,252,0.20)` |

Accent reserved additions (beyond Phase 4):
- `primary` (#8eff71) -- write-class ToolBadge (Edit/MultiEdit/Write/NotebookEdit)
- `tertiary` (#ffd16f) -- Bash ToolBadge only; no other Phase 8 usage
- `secondary` (#00cffc) -- MCP/Task/WebFetch/WebSearch/Unknown ToolBadge; deep-link highlight pulse ring
- `error` (#ff7351) -- unchanged (still DENY only); Phase 8 adds no destructive action of its own

Never decorative. Each new accent usage maps to a tool-identity or state signal.

### Preview-line Character Color (ApprovalRequestCard, below file path)

| Preview-line kind | Leading glyph color | Content color |
|-------------------|---------------------|---------------|
| Edit/MultiEdit addition (`+`) | `#8eff71` (primary) | `#adaaaa` (on-surface-variant) |
| Edit/MultiEdit removal (`-`) | `#ff7351` (error) | `#adaaaa` |
| Write first line (`+`) | `#8eff71` | `#adaaaa` |
| NotebookEdit first line (`+`) | `#8eff71` | `#adaaaa` |
| Bash command (`$`) | `#ffd16f` (tertiary) | `#adaaaa` |
| Read/LS/etc. on protected path (`—`) | `#adaaaa/60` | `#adaaaa/60` |

### Abandoned Row

| Element | Treatment |
|---------|-----------|
| Card background | `bg-surface-container/40` (40% of normal alpha; visibly dimmed) |
| Agent ID, file path, preview line | `text-on-surface-variant/40` (all content fades to 40% opacity) |
| UrgencyBadge + ToolBadge | Opacity 40%; colors unchanged |
| Left border | `2px solid outline-variant` (neutral grey; never primary/secondary) |
| Footer (replaces timestamp) | `ABANDONED — AGENT EXITED` in `text-on-surface-variant/60`, Label role, single line |
| Hover state | No hover effect (non-actionable) |
| Click | No-op (`pointer-events-none` on action target; wrapper remains readable but inert) |

---

## Component Inventory (Phase 8 additions)

### New Components

| Component | Location | Description |
|-----------|----------|-------------|
| ToolBadge | `src/components/ui/ToolBadge.tsx` | Per-tool badge adjacent to UrgencyBadge. Props: `toolName: string`. Resolves label/icon/color via the D-14 mapping table. Lucide icon at 12px `strokeWidth 1.5` + Label text. 20px height, 2px vertical padding, 8px horizontal padding, 4px icon-to-label gap. Border 1px solid of the mapped border color. Zero-radius corners. `motion` fade-in (150ms, parity with UrgencyBadge). |
| ToolPreview (dispatcher) | `src/views/CommsHub/ToolPreview/index.tsx` | Routes to per-tool renderer by `toolName`. Receives `toolInputJson: unknown` + `filePath: string \| null`. Replaces the InlineDiff slot in `RequestDetail` for `requestType === 'pretool_use'` rows. For `write_access` rows, RequestDetail keeps rendering InlineDiff unchanged. Edit/MultiEdit routes INTO the existing InlineDiff (full reuse). |
| EditPreview / MultiEditPreview | `src/views/CommsHub/ToolPreview/EditPreview.tsx` | Thin wrapper that reads the pre-image via the new `read_file_snapshot` command, computes the simulated diff against `new_string`, and hands it to the existing `InlineDiff` component. MultiEdit iterates edits in order and stacks InlineDiff segments separated by `md` spacing with a `HUNK_N/M` HunkNavigator-style label (reuse the Phase 5 label style at 10px Space Grotesk UPPERCASE). |
| WritePreview | `src/views/CommsHub/ToolPreview/WritePreview.tsx` | Language-inferred code block via `useSyntaxHighlight`. `bg-surface-container-lowest`, 16px padding, 400px max-height with `Show all` footer. Ghost border at `outline-variant/15`. Header row: `CREATE` label + file path in Data font, right-aligned language pill (`TS`, `PY`, etc.) at Label size. |
| BashPreview | `src/views/CommsHub/ToolPreview/BashPreview.tsx` | Three stacked sections with 24px (lg) gap: (1) optional `DESCRIPTION` section — Body font text of Claude's description field; (2) `COMMAND` section — shiki `bash` highlighted code block, same visual rules as WritePreview's block; (3) `METADATA` section — two-column key-value table with `CWD` and `TIMEOUT` keys when present. If description is absent, omit the section entirely (no empty placeholder). |
| NotebookPreview | `src/views/CommsHub/ToolPreview/NotebookPreview.tsx` | Identical to WritePreview but shiki language pulled from the cell's declared language (`python` default). Header row shows `NOTEBOOK_EDIT` + file path + cell index (`CELL 03`). |
| ProtectedPathPreview | `src/views/CommsHub/ToolPreview/ProtectedPathPreview.tsx` | Renders when a Read/LS/Grep/Glob/WebFetch/WebSearch was gated solely because `file_path` matched a `protected_paths` glob. Two-column table of `tool_input` fields (path, pattern, offset, limit, etc.) in Label/Data pair styling. No code block. |
| UnknownToolPreview | `src/views/CommsHub/ToolPreview/UnknownToolPreview.tsx` | Fallback for `mcp__*` and unrecognized tool names. Renders `tool_input` as pretty-printed JSON inside a shiki `json` code block. Same visual rules as WritePreview's block. Banner at top: `UNVERIFIED_TOOL — AITC has no renderer for this tool; raw input shown below.` in `text-tertiary` at Label size. |
| DontAskAgainCheckbox | `src/views/CommsHub/DontAskAgainCheckbox.tsx` | 16px square checkbox with 8px gap to label. Label copy: `DON'T_ASK_AGAIN_THIS_SESSION_FOR_{TOOL_NAME}`. Only rendered when `requestType === 'pretool_use'`. Placed in ApprovalActions footer, full-width row BELOW the button row with 8px top margin. Checked state is passed to `approveRequest` / `approveWithEdits` as a 2nd argument. Not persisted across AITC restart (session-scoped per D-22). |
| AbandonedRowChrome | (applied inside ApprovalRequestCard) | Not a standalone component — a conditional CSS/class branch inside `ApprovalRequestCard` triggered by `request.status === 'abandoned'`. Visual treatment per the Abandoned Row table in §Color. |
| PretoolNotificationHandler | `src/lib/deepLinkNotification.ts` | Tauri event subscriber that receives `approval-request-created` payloads, binds to the tray-icon click and notification-click events, and dispatches the deep-link navigation described in §Interaction Contracts → Deep-Link Notification. |

### Extended Components

| Component | Extension |
|-----------|-----------|
| ApprovalRequestCard | Accepts `toolName?: string \| null` and `toolInputJson?: unknown` from the extended ApprovalRequest. Renders ToolBadge to the right of the UrgencyBadge (8px gap) when `toolName` is present. Renders the D-14 single-line preview between file path and timestamp (8px top margin, single line, `overflow-hidden text-ellipsis whitespace-nowrap`). Truncation: ~50 chars for file-content previews, ~60 chars for Bash commands, literal em-dash `—` for Read/LS protected-path rows (preview line exists but carries no content). When `request.status === 'abandoned'`, applies the Abandoned Row chrome from §Color and replaces the timestamp line with the abandoned footer. |
| RequestDetail | Branches on `requestType`: `write_access` → existing InlineDiff (unchanged); `pretool_use` → renders the `ToolPreview` dispatcher in the same slot, same padding, same siblings (header above, ApprovalActions below, ChatThread + ChatInput still attached). Header row adds ToolBadge between StatusBadge and UrgencyBadge. |
| ApprovalActions | Renders the new `DontAskAgainCheckbox` below the button row when `requestType === 'pretool_use'`. Checkbox value flows into `approveRequest`/`approveWithEdits` Zustand actions as a new `{ alwaysAllowForSession?: boolean }` options arg. For `write_access` rows the checkbox is never rendered (not applicable). The DENY two-step confirmation, the ASK_FOR_MORE_INFO ghost button, and the 44px button row are unchanged. APPROVE_WITH_EDITS remains visible only for Edit/MultiEdit rows (D-17). |
| RequestQueue | Shows abandoned rows **inline in the same queue** (no tab split) at their original chronological position, but they sort AFTER pending rows of equal age (pending first, then abandoned, then approved/denied if ever shown). Virtualizer item size grows from 72px → 96px to fit the new D-14 preview line (see §Layout Contracts); abandoned rows reuse the same 96px height. Empty-state copy unchanged. |
| commsStore | `ApprovalRequest` type gains `toolName: string \| null`, `toolInputJson: unknown \| null`, and `status` union extends with `'abandoned'`. New in-memory Map `sessionAlwaysAllow: Map<string, Set<string>>` keyed by `agentId` → Set of `toolName` values the user muted this session. The Map is populated optimistically on approve-with-checkbox-checked and cleared on AITC reload. The store action signatures update to `approveRequest(id, opts?)` and `approveWithEdits(id, editedContent, opts?)` where `opts.alwaysAllowForSession?: boolean`; backend wiring of the always-allow flag is planner territory (D-22 says per-agent per-tool HashSet lives on the waiter registry). |

### Reused Components (no changes for this phase)

| Component | Used In |
|-----------|---------|
| InlineDiff (Phase 4) | EditPreview / MultiEditPreview (wrapped, not modified) |
| UrgencyBadge (Phase 4) | ApprovalRequestCard (sibling of new ToolBadge) |
| StatusBadge (Phase 4/5) | RequestDetail header |
| Button primary/destructive (Phase 5 extensions) | APPROVE / DENY / APPROVE_WITH_EDITS in ApprovalActions |
| useSyntaxHighlight (Phase 5) | WritePreview, BashPreview, NotebookPreview, UnknownToolPreview |

---

## Layout Contracts

### ApprovalRequestCard (extended) -- 96px virtualizer estimate (bumped from 72px)

```
+-------------------------------------------------+
| agent_id (Data, on-surface)      [URGENCY][TOOL]|  row 1: 20px (unchanged)
+-------------------------------------------------+
| PRETOOL_USE (Label, 10px, on-surface-variant)   |  row 2: 16px (unchanged)
+-------------------------------------------------+
| src/lib/foo.ts  (Data, on-surface-variant)      |  row 3: 16px (unchanged)
+-------------------------------------------------+
| + const newLine = ...  (Data-sm, preview)       |  row 4 NEW: 14px (8px mt)
+-------------------------------------------------+
| 14:32:07  (Data-sm, on-surface-variant/60)      |  row 5: 14px (unchanged)
+-------------------------------------------------+
```

Row 4 adds +22px (14px content + 8px top margin) to the previous card height. Update `RequestQueue.estimateSize` from 72px to 96px in the planner's Phase 4 amendment. This is mechanical — same virtualizer API.

### ToolPreview slot inside RequestDetail

The ToolPreview component replaces ONLY the InlineDiff slot for `pretool_use` rows. Everything else in RequestDetail stays:

```
+-- RequestDetail (flex-1, surface-container-highest bg) ----------+
| px-6 py-4                                                         |
|   Header row: agent_id  [STATUS]  [URGENCY]  [TOOL]               |  <- ToolBadge added
|   PRETOOL_USE  (Label row)                                        |
|   /absolute/path/foo.ts  (Data row, full file path, not truncated)|
+-------------------------------------------------------------------+
| px-6  (flex-1)                                                    |
|   <ToolPreview> ...per-tool renderer...   </ToolPreview>          |  <- replaces InlineDiff
+-------------------------------------------------------------------+
| px-6 py-4                                                         |
|   ApprovalActions                                                 |
|   └─ 44px button row (APPROVE / APPROVE_WITH_EDITS / DENY / ASK)  |
|   └─ DontAskAgainCheckbox (pretool_use only, 8px mt, 24px row)    |  <- new
+-------------------------------------------------------------------+
| px-6 pb-2                                                         |
|   ChatThread agentId={request.agentId}                            |  (unchanged)
+-------------------------------------------------------------------+
| px-6 pb-4                                                         |
|   ChatInput agentId={request.agentId}                             |  (unchanged)
+-------------------------------------------------------------------+
```

### BashPreview internal layout (most novel renderer)

```
+-- bg-surface-container-highest, 16px padding ----------+
| DESCRIPTION  (Heading 14px, 10px bottom margin)        |   <- omitted if field absent
| Run the integration tests and write results to log.    |   (Body 14px)
+--------------------------------------------------------+
| 24px gap (lg)                                          |
+--------------------------------------------------------+
| COMMAND  (Heading 14px, 10px bottom margin)            |
| +-- shiki bash code block --------------------------+  |
| | bg-surface-container-lowest, 16px padding         |  |
| | max-height 400px, overflow-y auto                 |  |
| | Data font 12px / 20px line-height                 |  |
| | 1px outline-variant/15 ghost border               |  |
| +---------------------------------------------------+  |
| [Show all] toggle row (only if > 400px or > 2KB)       |   <- right-aligned, Label 10px
+--------------------------------------------------------+
| 24px gap (lg)                                          |
+--------------------------------------------------------+
| METADATA  (Heading 14px, 10px bottom margin)           |
| CWD     :  /home/prannayag/proj                        |   <- Label : Data rows
| TIMEOUT :  120000ms                                    |   (omit rows whose field is null)
+--------------------------------------------------------+
```

### Write / Notebook / UnknownTool preview internal layout

Single section only (no description, no metadata rows). Same code-block rules:
- `bg-surface-container-lowest`, 16px padding, max-height 400px, `outline-variant/15` ghost border.
- Shiki highlighting via `useSyntaxHighlight`.
- Header strip above the code block: `WRITE` / `NOTEBOOK_EDIT` / `UNVERIFIED_TOOL` label on the left, language pill on the right.
- `Show all` toggle in the footer, identical copy and styling as BashPreview.

### EditPreview / MultiEditPreview internal layout

Delegates to `InlineDiff` from Phase 4. No new chrome for the single-Edit case. For MultiEdit:

```
HUNK 01 / 03          (Label 10px, 8px bottom margin)
<InlineDiff diffContent={hunk1} ... />
16px gap
HUNK 02 / 03          (Label 10px)
<InlineDiff diffContent={hunk2} ... />
16px gap
HUNK 03 / 03          (Label 10px)
<InlineDiff diffContent={hunk3} ... />
```

Each hunk's diff is scrollable independently; wrapper is a single flex column.

### ProtectedPathPreview internal layout

Two-column key-value table, zero chrome. `outline-variant/15` row separators.

```
TARGET     /home/prannayag/proj/.env
PATTERN    password=*
LIMIT      100
OFFSET     0
```

Left column: Label 10px UPPERCASE, 120px fixed width. Right column: Data 12px, flex-1, truncate with tooltip.

---

## Interaction Contracts

### Tool Badge

- Purely presentational — not clickable, no hover state, no focus ring.
- Rendered to the right of `UrgencyBadge` with an 8px gap.
- Phosphor fade-in (150ms via `motion`, parity with UrgencyBadge).
- `aria-label`: `"{TOOL_NAME} tool"` (e.g. `"Bash tool"`).

### ApprovalRequestCard Preview Line

- Single line, `overflow-hidden text-ellipsis whitespace-nowrap`.
- Length limits per D-14: 50 chars (Edit/Write/Notebook), 60 chars (Bash command), em-dash single glyph (Read/LS on protected path).
- No tooltip on truncation — full content is visible in the ToolPreview panel. Over-adding a title attribute would add noise for a screen-reader user who already has the full preview in the active panel.
- If `toolInputJson` is null OR the expected field is missing, render em-dash (never a blank line — preserves card height consistency).

### ToolPreview Panel

- Renders immediately when a `pretool_use` request is selected (no loading spinner — tool_input is already in-memory from the approval row).
- For Edit/MultiEdit: pre-image fetch via `read_file_snapshot` MAY briefly show the Phase 5 `MERGE_LOAD_FAILED`-style error surface on failure. Follow Phase 5 copy style: `PREIMAGE_LOAD_FAILED — Unable to read {file_path}. File may have been deleted or renamed.`
- `Show all` toggle:
  - Hidden when content fits within 400px height AND 2 KB bytes.
  - Visible when either limit is exceeded. Copy: `SHOW_ALL` (expanded) / `SHOW_LESS` (collapsed).
  - Expansion keeps the code block at natural height; the RequestDetail panel scrolls (inherits Phase 4 `overflow-auto`).
  - No external-editor fallback (D-16).
- Language inference for Write/Notebook: file extension → shiki language. Supported today (from `useSyntaxHighlight`): `ts`, `tsx`, `js`, `jsx`, `rs`, `py`, `json`, `css`, `html`. Unknown extensions fall back to plaintext (no syntax colors, but still monospace).

### "Don't Ask Again This Session" Checkbox

- Rendered ONLY for `pretool_use` rows (skip for `write_access`).
- Default state: unchecked on every request (never remembered across requests — this is the session-scope guarantee).
- Label dynamically includes the tool name: `DON'T_ASK_AGAIN_THIS_SESSION_FOR_{TOOL_NAME}`. Example: `DON'T_ASK_AGAIN_THIS_SESSION_FOR_BASH`.
- Clicking the checkbox flips state; does not itself submit the approval.
- When the user subsequently clicks `APPROVE` (or `APPROVE_WITH_EDITS`), the checked state is passed to the backend via the new `{ alwaysAllowForSession: true }` option. Store action signatures become `approveRequest(id, opts?)` and `approveWithEdits(id, editedContent, opts?)`. DENY ignores the checkbox entirely (denying never auto-mutes future requests).
- Visual state:
  - Unchecked: 16px square, 1px `outline-variant/30` border, transparent fill, zero-radius corners.
  - Checked: 1px `primary/40` border, `primary/10` fill, 10px Lucide `Check` icon centered in `primary` color.
  - Focus: 2px `primary` outline (keyboard-visible only).
- `aria-label`: `"Don't ask again this session for {tool_name}"`.

### Abandoned Row

- Appears inline in RequestQueue when the backend flips `status` to `abandoned` (D-09).
- Not clickable. `tabIndex={-1}`, no keyboard focus.
- If this row was the `selectedRequestId` at the moment of abandonment: RequestDetail immediately shows a takeover empty-state card (`REQUEST_ABANDONED` heading + `The agent exited before responding. Select another request from the queue.` body) and `selectedRequestId` is cleared.
- Abandoned rows persist in the queue until the user clicks a new pending request OR until the next `fetchRequests` pass drops them (backend decides — planner's call).

### Deep-Link Notification (D-18)

Target behavior (happy path, desktop notification click works):
1. Backend fires `dispatch_approval_notification` with payload `{ requestId, agentId, toolName, filePath }`.
2. Notification click → Tauri event `notification-clicked` with `requestId` in payload.
3. Frontend handler:
   a. `WindowExt::set_focus()` on the main window (via Tauri command `focus_main_window`).
   b. `history.pushState` or router `navigate('/comms')` if not already on the Comms route.
   c. `useCommsStore.getState().selectRequest(requestId)`.
   d. Scroll the RequestQueue to the selected row via `virtualizer.scrollToIndex`.
   e. Phase 5 `phosphor-in` fade on RequestDetail (parity with other request-switch transitions, 150ms).

Fallback behavior (tauri-plugin-notification does not support desktop onClick per RESEARCH.md §Pitfall 9):
1. Notification is fire-and-forget (no click handler on the toast itself).
2. Tray-icon click is the user's "return to AITC" gesture: clicking the tray focuses the main window and routes to `/comms`, then calls `selectRequest` with the **most-recent pending pretool_use row** (highest `createdAt`). If there is no pending pretool_use row, it falls back to the most-recent pending `write_access` row. If no pending rows at all, it navigates to `/comms` and leaves selection null (empty state).
3. When the Comms view is already focused and a new pretool_use request arrives while the user is idle in the view, render an in-app highlight pulse on the newly-arrived card in RequestQueue:
   - `secondary` (#00cffc) 2px outline band, 0 → 40% → 0 alpha over 1.2s.
   - `cubic-bezier(0, 0, 0.2, 1)` easing.
   - Triggers only for `pretool_use` (write_access already pulses the PendingCountBadge on nav from Phase 4; this is a complementary in-view signal).
   - Suppressed if the user has scrolled away from the top of RequestQueue (i.e., they are deliberately looking at older rows).

Both paths coexist — the fallback highlight pulse runs regardless of whether the toast fires, so no notification is ever "lost" if the OS swallows the click.

---

## Animations

Adds to the Phase 4 animation contract. Reuses existing primitives only.

| Animation | Spec | Usage |
|-----------|------|-------|
| Tool Badge fade-in | 150ms opacity 0→1 via `motion` | ToolBadge mount (parity with UrgencyBadge) |
| New Pretool Pulse | `secondary` 2px outline, alpha 0 → 0.4 → 0, 1.2s, cubic-bezier(0, 0, 0.2, 1), once | New pretool_use row while Comms view is focused (D-18 fallback) |
| Show All toggle | 150ms height `max-height: 400px` → `max-height: none` via Motion layout animation | ToolPreview code-block expand |
| Abandoned transition | 200ms opacity 1 → 0.4 on card content | When `status` flips `pending` → `abandoned` |
| Don't-ask-again check | 100ms `primary` border-color fade + 100ms icon opacity 0→1 | Checkbox toggle |

All inherit reduced-motion fallback from Phase 5: respect `prefers-reduced-motion: reduce` → skip the pulse and the expand animation, instant state change.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Tool badge labels | `EDIT` / `MULTI-EDIT` / `WRITE` / `NOTEBOOK` / `BASH` / `READ` / `LS` / `GREP` / `GLOB` / `WEBFETCH` / `WEBSEARCH` / `TASK` / `MCP` / `UNKNOWN` |
| ToolPreview section headings | `DESCRIPTION` / `COMMAND` / `METADATA` / `ARGUMENTS` |
| ToolPreview expand toggle (collapsed) | `SHOW_ALL` |
| ToolPreview expand toggle (expanded) | `SHOW_LESS` |
| Write header | `CREATE` (file will be created / overwritten) |
| Notebook header | `NOTEBOOK_EDIT` |
| Unverified tool banner | `UNVERIFIED_TOOL — AITC has no renderer for this tool; raw input shown below.` |
| BashPreview metadata keys | `CWD` / `TIMEOUT` |
| Don't-ask-again checkbox label | `DON'T_ASK_AGAIN_THIS_SESSION_FOR_{TOOL_NAME}` |
| Abandoned row footer | `ABANDONED — AGENT EXITED` |
| Abandoned-when-selected takeover heading | `REQUEST_ABANDONED` |
| Abandoned-when-selected takeover body | `The agent exited before responding. Select another request from the queue.` |
| Pre-image load failure (Edit/MultiEdit) | `PREIMAGE_LOAD_FAILED — Unable to read {file_path}. File may have been deleted or renamed.` |
| Hook-unreachable notification (passive) | (fires from sidecar's stderr, not UI — noted here for the planner only) |
| Tray-icon tooltip when pretool_use pending | `AITC — {N}_PENDING_REQUESTS` |

Phase 4 copy reused verbatim: `APPROVE`, `DENY`, `CONFIRM_DENY`, `APPROVE_WITH_EDITS`, `ASK_FOR_MORE_INFO`, `TYPE_QUERY...`, `NO_PENDING_REQUESTS`, `SELECT_REQUEST`, empty-state text.

Rules:
- All labels UPPER_SNAKE_CASE with underscores replacing spaces.
- Body text (e.g., takeover body, banner detail) uses sentence case for readability.
- `{TOOL_NAME}` placeholder in copy substitutes the badge label (`BASH`, `WRITE`, etc.), NOT the raw Claude tool_name (`Bash`, `Write`).
- File paths truncated with ellipsis if > 40 chars (matches Phase 4 rule).

---

## State Shapes (extensions only)

### commsStore.ts — `ApprovalRequest` extension

```typescript
export interface ApprovalRequest {
  // ...existing fields unchanged...
  status: 'pending' | 'approved' | 'denied' | 'info_requested' | 'abandoned'; // + 'abandoned'
  toolName: string | null;         // NEW: backend tool_name, e.g. 'Edit', 'Bash'
  toolInputJson: unknown | null;   // NEW: backend tool_input verbatim (any shape)
}
```

### commsStore.ts — session-scoped always-allow map

```typescript
interface CommsStore {
  // ...existing fields unchanged...
  sessionAlwaysAllow: Map<string, Set<string>>; // agentId -> Set<toolName>
  approveRequest: (id: number, opts?: { alwaysAllowForSession?: boolean }) => Promise<void>;
  approveWithEdits: (id: number, editedContent: string, opts?: { alwaysAllowForSession?: boolean }) => Promise<void>;
  // NEW action:
  clearAlwaysAllowForAgent: (agentId: string) => void; // called when an agent terminates
}
```

The Map is mirrored on the backend's waiter registry (D-22); the frontend copy is optimistic — used only to display state (e.g., future UX could surface "you are auto-approving BASH for agent KAGENT-1234" somewhere, though v1 has no such surface).

### Deep-link event contract

```typescript
// frontend side
type NotificationClickedPayload = {
  requestId: number;
  agentId: string;
};
// Tauri event name: 'notification-clicked'
// Emitter: Rust side, from dispatch_approval_notification onClick handler
//   OR from tray-icon click handler (fallback path) — in which case requestId
//   is computed backend-side from "most recent pending pretool_use row".
```

---

## Accessibility

| Concern | Approach |
|---------|----------|
| Tool badge | `aria-label="{TOOL_NAME} tool"`; badge itself `role="img"` since it's presentational. |
| Don't-ask-again checkbox | Standard `<input type="checkbox">` with visible label; `aria-describedby` points to a hidden helper text: `"Approves all {TOOL_NAME} calls from {agent_id} until AITC restarts or the agent exits."` |
| Abandoned row | `aria-disabled="true"` on the card wrapper; `role="listitem"` (not `button`); screen reader announces `"Abandoned. Agent exited. {agent_id} {tool_name} request for {file_path}."` via an `aria-label` on the li. |
| Show-all toggle | `<button aria-expanded="true/false" aria-controls="toolpreview-body-{id}">`. |
| ToolPreview code block | `role="region"` with `aria-label="{TOOL_NAME} preview for {file_path}"`. |
| Deep-link navigation | Focus must land on the RequestDetail heading (`h2`) after `selectRequest`, via `ref.current?.focus()` in RequestDetail header effect. Keyboard users re-orient immediately. |
| Color contrast | All badge text colors meet WCAG AA (4.5:1) against their translucent backgrounds on the page's surface tiers. Verified by Phase 4 checker for the same color tokens (primary on surface-container, tertiary on surface-container, etc.). Phase 8 introduces no new color pairing. |
| Reduced motion | New Pretool Pulse and Show-All expand both honor `prefers-reduced-motion: reduce` — pulse becomes a static 200ms opacity flash, Show-All becomes instant. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn not used on this project |
| third-party | none | not applicable |

All Phase 8 new components (ToolBadge, ToolPreview + renderers, DontAskAgainCheckbox) are hand-built. No external UI block imports, no registry fetches. Inherits Phase 4's "custom Command Horizon" posture per CLAUDE.md.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
