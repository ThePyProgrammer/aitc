---
phase: 19-polish-phase-10-chat-transcript-rendering-four-related-gaps-
plan: 04
subsystem: chat-transcript-polish
tags: [wave-2, tool-use, store-selector, status-dot, visual-polish, phase-8-contract-lock]
wave: 2
depends_on: [19-01]
requires:
  - phase: 19-01
    provides: "chatStore.test.ts 3-.todo scaffold + mkToolUse/mkToolResult factories for selectToolUseWithResult"
  - phase: 10
    provides: "ToolUseCard shell (Phase 10 D-13/D-16), chatStore event shape (AgentEvent + eventsByAgent partitioning), approval navigation (e.stopPropagation + /comms?tab=requests&request=... route)"
  - phase: 8
    provides: "ToolPreview registry (FROZEN — contract-lock tests gate any change)"
provides:
  - "chatStore.ts — `selectToolUseWithResult(events, toolUseId)` exported pure function returning `{toolUse, toolResult}` (linear scan, both may be null)"
  - "ToolUseCard collapsed row — per-tool `{primary, secondary?}` dispatcher (Edit/MultiEdit/Write/Read/Bash/Grep/Glob/WebFetch/WebSearch + default) with pluralized hunk/line counts"
  - "ToolUseCard status dot — 8px circle before TOOL label; `bg-primary` on success, `bg-error` on is_error, `bg-on-surface-variant/30` when paired tool_result absent"
  - "ToolUseCard visual polish — collapsed button `py-1.5` (was py-2); expanded body `bg-surface-container/10` (was /20)"
  - "Plan 01 `.todo` stubs replaced with 3 real V-19-08 assertions + 7 new V-19-05..V-19-07 / V-19-09..V-19-12 assertions on ToolUseCard"
affects:
  - "no downstream plan — Phase 19 closes here; Phase 19 UAT is the next natural sign-off step"

tech-stack:
  added: []
  patterns:
    - "Pure-function store selector with `useMemo` wrapper — select referentially-stable slice (events array) from Zustand store, memoize the derived object to avoid breaking `useSyncExternalStore` Object.is equality (infinite-render-loop avoidance)"
    - "Module-level `Object.freeze([])` constant for stable empty-array default — prevents thrashing subscriptions when an agent has no events yet"
    - "`vi.mock('../../../stores/chatStore', () => ({ useChatStore, selectToolUseWithResult }))` pattern for component tests that consume store state without exercising the real store"
    - "`{primary, secondary?}` structured summary with raw-text `primary` + `<span>`-wrapped `secondary` inside a single `flex-1 truncate` container — preserves D-02.5 single-line truncation while visually differentiating the two slots"

key-files:
  created: []
  modified:
    - path: src/stores/chatStore.ts
      lines_changed: "+21"
      purpose: "Export `selectToolUseWithResult` pure function after the `useChatStore` block (mirrors positional placement of `totalUnread` but as a free export because two inputs don't fit the zero-arg get-closure shape)"
    - path: src/stores/__tests__/chatStore.test.ts
      lines_changed: "+33 / -10 (net +23, with 3 .todo → 3 real `it` + import update)"
      purpose: "Flip Plan 01 V-19-08 .todo stubs to real assertions covering paired, orphan tool_use, and mismatched tool_use_id cases. Drop Plan 01's `void mkToolUse; void mkToolResult;` markers now that the factories are consumed"
    - path: src/components/chat/ToolUseCard.tsx
      lines_changed: "+113 / -19 (net +94)"
      purpose: "Replace single-string `deriveSummary` with `{primary, secondary?}` dispatcher across 9 tool cases; add `statusDotClass` helper + 8px status dot render; consume paired result via `useChatStore` selector + `useMemo`; apply py-2→py-1.5 + bg-surface-container/20→/10 polish; add `tool_use_id` to payload type cast"
    - path: src/components/chat/__tests__/ToolUseCard.test.tsx
      lines_changed: "+190 / -1 (net +189)"
      purpose: "Add vi.mock stub for chatStore (useChatStore + selectToolUseWithResult); add default-paired `beforeEach`; keep 4 existing tests green; add 7 new V-19-05..V-19-07 + V-19-09..V-19-12 assertions (MultiEdit hunks, Write lines, WebFetch host/path, green/red/grey dot, py-1.5 + DOM order of dot preceding TOOL label)"

key-decisions:
  - "Used `bg-primary` (green #8eff71) and `bg-error` (red #ff7351) for the status dot instead of RESEARCH.md's sketched `bg-status-success` / `bg-status-error` — those tokens don't exist in `src/styles/theme.css`, whereas `bg-primary`/`bg-error` are the established Command Horizon green/red vocabulary used by StatusBadge, RadarPulse, ConflictNavBadge, and PendingCountBadge. Project instruction: 'Don't invent new tokens.' Pending state uses `bg-on-surface-variant/30` which matches the neutral vocabulary in PendingCountBadge"
  - "Selector consumption reshaped to avoid an infinite-render loop. The plan's literal sketch (`useChatStore((s) => selectToolUseWithResult(s.eventsByAgent[agentId] ?? [], toolUseId))`) returns a fresh `{toolUse, toolResult}` object on every selector call, which breaks `useSyncExternalStore`'s Object.is equality and loops React's commit phase — caught by `EventCard.test.tsx > dispatches tool_use -> ToolUseCard` failing with `Maximum update depth exceeded`. Fix: select the events array directly (stable ref) and `useMemo` the pair lookup with `[agentEvents, toolUseId]` deps. Added module-level `EMPTY_EVENTS = Object.freeze([])` so the default when an agent has no events also hits the stable-ref path"
  - "Task 2 tests assert primary text via `container.textContent.toContain(...)` rather than `screen.getByText(exact)` for the two multi-slot cases (V-19-05 file_path, V-19-07 WebFetch host). Primary renders as a raw text node inside the flex-1 summary span, adjacent to the secondary `<span>`; the span's textContent is `path · secondary` so exact-match getByText won't find the lone primary. The secondary still resolves via getByText because it IS wrapped in its own `<span>`"
  - "Landed source + tests as two commits (per plan request) rather than one: the source-only commit was verified to keep the existing 4 ToolUseCard tests green (via `useMemo + EMPTY_EVENTS` stabilization), so there's no mid-plan broken state. Stashed test changes, re-ran source-only tests, got 4/4 green, then committed source, then restored and committed tests"

requirements-completed:
  - D-02.1
  - D-02.2
  - D-02.3
  - D-02.4
  - D-02.5
  - V-19-05
  - V-19-06
  - V-19-07
  - V-19-08
  - V-19-09
  - V-19-10
  - V-19-11
  - V-19-12

duration: 15min
completed: 2026-04-21
---

# Phase 19 Plan 04: Wave 2 Tool-Use Enrichment Summary

**Collapsed `tool_use` rows now show per-tool semantic summaries (`1 hunk`, `3 hunks`, `42 lines`, `example.com · /docs/api`) with a green/red/grey status dot reflecting the paired `tool_result` outcome — and `selectToolUseWithResult` pairs tool_use/tool_result events by `tool_use_id` in a pure linear-scan store selector.**

## Performance

- **Duration:** ~15 min (wall clock)
- **Started:** 2026-04-21T16:19:44Z (baseline test run)
- **Completed:** 2026-04-21T16:35:00Z (approx)
- **Tasks:** 2
- **Files created:** 0
- **Files modified:** 4 (2 source, 2 test)
- **Commits:** 3 (Task 1 + Task 2 source + Task 2 tests)

## Accomplishments

- `chatStore.ts` exports `selectToolUseWithResult(events, toolUseId): {toolUse, toolResult}` — a pure linear-scan function with bounded cost (50 events per page, one scan). No memoization inside the selector (consumer decides via `useMemo`).
- Plan 01's 3 `.todo` stubs in `chatStore.test.ts` replaced with real assertions: paired case, orphan tool_use, mismatched tool_use_id. V-19-08 green across all three shapes.
- `ToolUseCard.tsx` dispatcher returns `{primary, secondary?}`:
  - `Edit`: primary=file_path, secondary="1 hunk"
  - `MultiEdit`: primary=file_path, secondary="N hunks" (singular "1 hunk" when N=1)
  - `Write`: primary=file_path, secondary="N lines" (singular "1 line" when N=1)
  - `Read`: primary=file_path (no secondary)
  - `Bash`: primary=command (no secondary)
  - `Grep`/`Glob`: primary=pattern (no secondary)
  - `WebFetch`/`WebSearch`: primary=url.host, secondary=url.pathname (graceful fallback to raw url on URL parse failure — T-19-04-01 mitigation)
  - default: best-effort across file_path/command/pattern/url
- 8px status dot renders before the TOOL label (data-testid=`tool-status-dot`, data-status `pending`/`success`/`error`):
  - `bg-primary` (green) when `paired.toolResult.is_error === false`
  - `bg-error` (red) when `paired.toolResult.is_error === true`
  - `bg-on-surface-variant/30` (grey) when no paired tool_result exists yet
  - Strict boolean narrowing on `is_error` — malformed payloads fall through as success (T-19-04-05 mitigation), never spoof red
- Visual polish applied: collapsed button `py-2 → py-1.5`; expanded body `bg-surface-container/20 → /10`. Hover state `hover:bg-surface-container/20` preserved.
- Phase 8 ToolPreview registry contract preserved verbatim — `git diff --stat src/views/CommsHub/ToolPreview/` is empty. The `<ToolPreview />` invocation props (`toolName`, `toolInputJson`, `filePath`, `requestId`) are untouched.
- Phase 10 approval-chip navigation guard preserved: `handleApprovalClick` + `e.stopPropagation()` present in the source with their original signatures. `→ APPROVAL_{id}` chip still renders when `event.approvalRequestId` is set.
- All 3 V-19-08 + 7 V-19-05..07/09..12 tests land green (10 new total). 4 existing ToolUseCard tests + 9 existing EventCard tests + 21 existing chatStore tests still green — 0 regressions.

## Task Commits

1. **Task 1 — selectToolUseWithResult selector + V-19-08 tests** — `368958c` (feat) — pure exported function in chatStore.ts + 3 real assertions replacing Plan 01 .todo stubs.
2. **Task 2 — ToolUseCard enrichment (source)** — `9a5f876` (feat) — dispatcher, status dot, visual polish, paired-result consumption with useMemo stabilization, EMPTY_EVENTS constant.
3. **Task 2 — ToolUseCard tests (V-19-05..V-19-12)** — `090b57e` (test) — vi.mock stub for chatStore, 7 new assertions covering hunks/lines/host-path/dot-tri-state/py-1.5/DOM-order.

## Files Modified

| File | Lines changed |
|------|---------------|
| `src/stores/chatStore.ts` | +21 (pure exported selector after the useChatStore block) |
| `src/stores/__tests__/chatStore.test.ts` | +33 / −10 (3 .todo → 3 real `it`, dropped `void` markers, updated import) |
| `src/components/chat/ToolUseCard.tsx` | +113 / −19 (dispatcher, status dot, useMemo, visual polish) |
| `src/components/chat/__tests__/ToolUseCard.test.tsx` | +190 / −1 (vi.mock + 7 new V-19 assertions) |

## Selector Signature Shipped

Confirm matches the plan's frontmatter truth:

```ts
export function selectToolUseWithResult(
  events: AgentEvent[],
  toolUseId: string,
): { toolUse: AgentEvent | null; toolResult: AgentEvent | null }
```

Linear single-pass iteration; no memoization (consumer's job). Matches D-02.2 exactly.

## Decisions Made

- **`bg-primary` / `bg-error` color tokens** for the status dot instead of the RESEARCH.md sketch's `bg-status-success` / `bg-status-error`. Rationale: `bg-status-*` aren't defined in `src/styles/theme.css`. The established Command Horizon vocabulary (StatusBadge, RadarPulse, ConflictNavBadge, PendingCountBadge all use `bg-primary` for green success and `bg-error` for red failure) is what the design system actually speaks. Per CLAUDE.md / plan instruction: "Don't invent new tokens." Pending/neutral continues to use `bg-on-surface-variant/30`.
- **useMemo + stable-slice selector** — the plan's literal `useChatStore((s) => selectToolUseWithResult(...))` call returned a fresh `{toolUse, toolResult}` every render, breaking `useSyncExternalStore`'s Object.is equality and triggering an infinite-render loop (caught by the existing `EventCard.test.tsx > dispatches tool_use -> ToolUseCard` test failing with `Maximum update depth exceeded`). Fix: select the events array directly (Zustand guarantees referential stability across the store-update shallow-copy protocol), then `useMemo` the pair lookup with deps `[agentEvents, toolUseId]`. Added a module-level `EMPTY_EVENTS = Object.freeze([])` so the "agent has no events yet" branch also hits a stable ref.
- **`container.textContent.toContain(...)` for primary-slot assertions** (V-19-05, V-19-07) — the primary text is a raw text node inside the flex-1 summary `<span>`, adjacent to the secondary `<span>` wrapper. The span's aggregated textContent is `path · secondary`, so `getByText('path', { exact: true })` can't find it. The secondary still resolves via `getByText` because it lives inside its own `<span>` node.
- **Two-commit split for Task 2** per plan request. Verified the source-only commit (`9a5f876`) stands alone: `git stash`'d the test changes, re-ran the existing 4 ToolUseCard tests against the new source, saw 4/4 green, then committed source. Then popped the stash and committed the tests. This preserves the user's memory rule ("commit after every change") and the plan's split, without ever leaving the tree in a red-CI state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug introduced by source change] Infinite-render loop in EventCard.test.tsx `dispatches tool_use -> ToolUseCard`**

- **Found during:** Task 2 post-source full-suite verification run.
- **Issue:** ToolUseCard's new `useChatStore((s) => selectToolUseWithResult(s.eventsByAgent[agentId] ?? [], toolUseId))` returns a fresh `{toolUse, toolResult}` object on every selector call. Zustand's default Object.is equality comparison always returns false → React re-renders the subscriber → subscriber re-runs the selector → repeat. `useSyncExternalStore` bails with `Maximum update depth exceeded`. Caught by the pre-existing `EventCard > dispatches tool_use -> ToolUseCard` test, which mounts ToolUseCard without a chatStore mock.
- **Fix:** Reshape the selector to consume a referentially-stable slice of the store (`s.eventsByAgent[agentId] ?? EMPTY_EVENTS`) and `useMemo` the pair lookup with deps `[agentEvents, toolUseId]`. Added a module-level `const EMPTY_EVENTS: readonly AgentEvent[] = Object.freeze([])` so the "no events yet" default also hits a stable ref (every call would otherwise allocate a fresh `[]`). Zustand's immutable-update protocol guarantees the per-agent array ref only changes when an event is actually appended.
- **Files modified:** `src/components/chat/ToolUseCard.tsx` (selector shape + new imports).
- **Verification:** `npm run test -- src/components/chat/__tests__/EventCard.test.tsx` → 9/9 pass post-fix. `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` → 11/11 pass (including the 7 new V-19 assertions, which do exercise the mocked selector with non-null paired results and confirm the useMemo dep-tracking correctly refires when the mock changes).
- **Committed in:** `9a5f876` (Task 2 source commit — same commit as the intended source change; the fix is intrinsic to the correct shape, not a follow-up).
- **Why Rule 1 not a plan deviation:** The plan's pseudocode was directionally correct (use `useChatStore(selector)`) but the concrete shape it sketched returned a fresh object inside the selector, which React 19's useSyncExternalStore semantics don't tolerate. The architectural decision (store-side join via pure selector) is unchanged — only the consumption wrapper is tightened. No downstream consumer API changes.

**2. [Rule 1 — Test fixture / assertion] `getByText(exact)` can't match the raw-text primary in V-19-05 and V-19-07**

- **Found during:** Task 2 first test-suite run after writing the new assertions.
- **Issue:** The summary renders `{primary}{secondary && <>· <span>{secondary}</span></>}` inside a `flex-1 truncate` span. `primary` is a raw text node, `secondary` is a wrapped `<span>`. The outer span's normalized textContent becomes `path/to/file · 3 hunks`, which is not a match for `getByText('path/to/file', { exact: true })`.
- **Fix:** V-19-05 and V-19-07 primary-slot assertions switched to `expect(container.textContent ?? '').toContain(...)`. Secondary-slot assertions (which ARE wrapped in their own `<span>`) continue to use `screen.getByText(...)` for precision — this exercises the wrapper guarantee.
- **Files modified:** `src/components/chat/__tests__/ToolUseCard.test.tsx` (V-19-05 and V-19-07 assertion shape).
- **Verification:** 11/11 ToolUseCard tests green post-fix.
- **Committed in:** `090b57e` (Task 2 test commit — contained in the same commit as the new assertions).
- **Why Rule 1:** The plan's acceptance criteria demand "renders `/tmp/x.ts` and `3 hunks` for MultiEdit" — both assertions still hold, just with the correct DOM-aware API.

**Total deviations:** 2 auto-fixed (1 source, 1 test-assertion shape). Both landed in the same commits as the respective intended changes; no separate fix commits.

## Phase 8 Contract Lock Verification

The frozen `src/views/CommsHub/ToolPreview/` directory is untouched:

```
$ git diff --stat 368958c~1..HEAD -- src/views/CommsHub/ToolPreview/
(empty)
```

The `<ToolPreview />` invocation inside the expanded `<AnimatePresence>` block retains its exact prop shape (`toolName`, `toolInputJson`, `filePath`, `requestId`) — no widening, no narrowing.

Phase 8 contract-lock tests (`src/views/CommsHub/ToolPreview/__tests__/contract.test.tsx` and siblings) were not explicitly re-run in isolation during this plan, but full-suite `npm run test` passes 555 (minus 4 pre-existing documented failures) — which includes all Phase 8 suites. None of the 4 pre-existing failures are in `src/views/CommsHub/ToolPreview/`.

## Backend Untouched Verification (D-02.3)

```
$ git diff --stat 368958c~1..HEAD -- src-tauri/
(empty)
```

No payload fields added, no schema change, no new Tauri command, no parser/aggregator touch.

## Wave 2 Peer Non-overlap

Plan 19-03 owned `src/components/chat/MarkdownBody.tsx` + `AssistantTextCard.tsx`. Plan 19-04 owns `src/stores/chatStore.ts` + `ToolUseCard.tsx`:

```
$ git diff --stat 368958c~1..HEAD -- src/components/chat/AssistantTextCard.tsx src/components/chat/MarkdownBody.tsx
(empty)
```

Zero file overlap. Wave 2 parallelism contract preserved.

## Existing ToolUseCard Tests Migrated

None were deleted. The 4 existing tests (collapsed render / click expand / APPROVAL pill / Bash summary) all still pass unchanged against the new source. The Bash test's `mk` now inherits a default `tool_use_id: 'toolu_mk_default'` in `payloadJson` (added so the new selector can find paired results when the mock returns non-null), but the test's own override replaces the full `payloadJson` so this change is invisible to it.

## Manual UAT

**Deferred.** Plan `<output>` requests "Whether manual UAT for green/red dot visual verification was performed." Automated tests cover all 10 V-19 assertions (V-19-05..V-19-12 + the 3-shape V-19-08 selector coverage in chatStore.test.ts) including the dot color classes and the DOM order of dot vs TOOL label. A live Tauri smoke (Bash `exit 0` → green, Bash `exit 1` → red, MultiEdit with 3 edits → "3 hunks") is the natural Phase 19 sign-off step, best batched with the Plan 19-03 Markdown UAT (also deferred). Recommend running both together as a single Phase-19 UAT pass before advancing STATE.md to "Phase 19 complete."

## Issues Encountered

- **Four pre-existing full-suite failures** (all documented in `deferred-items.md`):
  - `src/hooks/__tests__/useGraphLayout.test.ts > posts pin/unpin when pinnedNodeIds Set diff changes` — D-04 (Phase 11 flake; isolated run passes).
  - `src/__tests__/arsenal/MasterDetailShell.test.tsx > rail region has w-[220px] shrink-0 classes` — D-02 (Phase 10 shell expectation drift).
  - `src/__tests__/arsenal/MasterDetailShell.test.tsx > detail region has 2xl:w-[520px] xl:w-[480px] shrink-0 classes` — D-02 (same file, related).
  - `src/views/Radar/__tests__/HeatMapOverlay.test.ts > heatTintForNode(0) returns the default surface-container color (#1a1919)` — D-02 (Phase 06 radar).
  - Per `memory/MEMORY.md` rule "only fix own bugs," left alone. Plan 19-04 touches ZERO files under any of these failing suites.

- **Two intervening commits landed between my Task 1 and Task 2 work** (`03197f3 fix(11.1): reset lastIdsRef in useGraphLayout worker cleanup` and `cfb6238 docs(debug): open cold-boot-stuck-building-grap session`). Those are not Plan 19-04's work — they arrived from concurrent Phase 11.1 activity. My Plan 19-04 commits (`368958c`, `9a5f876`, `090b57e`) form a contiguous logical sequence on top of whatever the branch state was; no interaction between the two streams.

## Threat Flags

No new network endpoints, no new auth paths, no new filesystem surface, no schema change. Threat register T-19-04-01..T-19-04-08 all accepted/mitigated within the plan's scope:
- T-19-04-01 (malformed URL crash): mitigated — `try/catch` on `new URL()` in WebFetch/WebSearch branches.
- T-19-04-03 (Phase 8 contract lock violation): mitigated — `git diff --stat src/views/CommsHub/ToolPreview/` empty.
- T-19-04-04 (XSS via dispatcher output): negligible — React auto-escapes; `grep -c dangerouslySetInnerHTML src/components/chat/ToolUseCard.tsx` returns 0.
- T-19-04-05 (status-dot spoofing on malformed is_error): mitigated — strict `=== true` check; non-boolean values fall through to success (green).

No new threat flags introduced. Omitting the section.

## Self-Check: PASSED

**Files modified (all commits verify against working tree):**
- `src/stores/chatStore.ts` — `export function selectToolUseWithResult` present (grep count = 2: definition + export binding)
- `src/stores/__tests__/chatStore.test.ts` — `grep -c "it.todo"` = 0; `grep -c "selectToolUseWithResult"` = 7 (import + describe + 3 uses + 2 in comments)
- `src/components/chat/ToolUseCard.tsx` — `ToolSummary` present (2x), `statusDotClass` present (2x), `selectToolUseWithResult` consumed (2x: import + call), `data-testid="tool-status-dot"` present (1x), `py-1.5` present (1x), `bg-surface-container/10` present (1x, expanded body only), `bg-surface-container/20` appears ONLY under `hover:` (allowed), dispatcher cases count = 9 (Edit/MultiEdit/Write/Read/Bash/Grep/Glob/WebFetch/WebSearch)
- `src/components/chat/__tests__/ToolUseCard.test.tsx` — 7 new `it(…)` V-19-05..V-19-12 cases present; vi.mock for chatStore present; 11/11 green

**Commits (all in git log):**
- `368958c` — FOUND: `feat(19-04): export selectToolUseWithResult selector + V-19-08 tests (D-02.2)`
- `9a5f876` — FOUND: `feat(19-04): per-tool summary dispatcher + status dot on ToolUseCard (D-02.1, D-02.2, D-02.4)`
- `090b57e` — FOUND: `test(19-04): ToolUseCard V-19-05..V-19-12 assertions (D-02)`

**Verification runs:**
- `npx tsc --noEmit` → exit 0
- `npm run test -- src/stores/__tests__/chatStore.test.ts` → 24/24 green (21 existing + 3 new V-19-08)
- `npm run test -- src/components/chat/__tests__/ToolUseCard.test.tsx` → 11/11 green (4 existing + 7 new V-19-05..V-19-12)
- `npm run test -- src/components/chat/__tests__/EventCard.test.tsx` → 9/9 green (infinite-loop regression fixed)
- `npm run test` full-suite → 555 passed + 5 skipped + 4 todo + 4 failed (all 4 failures pre-existing per `deferred-items.md` D-02/D-04; zero new)
- `npm run build` → exit 0 (17.37s; standard bundle warnings unrelated to Plan 19-04)
- `git diff --stat src/views/CommsHub/ToolPreview/ HEAD~3..HEAD` → empty (Phase 8 contract preserved)
- `git diff --stat src-tauri/ HEAD~3..HEAD` → empty (D-02.3 backend untouched)
- `git diff --stat src/components/chat/AssistantTextCard.tsx src/components/chat/MarkdownBody.tsx HEAD~3..HEAD` → empty (Plan 19-03 non-overlap)

All plan acceptance criteria satisfied. Plan 19-04 complete. Phase 19 ready for combined manual UAT (green/red dot + markdown prose body) → close-out.

---
*Phase: 19-polish-phase-10-chat-transcript-rendering-four-related-gaps-*
*Completed: 2026-04-21*
