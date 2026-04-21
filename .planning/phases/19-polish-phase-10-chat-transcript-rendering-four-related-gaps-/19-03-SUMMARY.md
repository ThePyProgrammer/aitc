---
phase: 19-polish-phase-10-chat-transcript-rendering-four-related-gaps-
plan: 03
subsystem: chat-transcript-polish
tags: [wave-2, markdown, react-markdown, remark-gfm, rehype-sanitize, shiki, xss, prose, typography]
wave: 2
depends_on: [19-01]
requires:
  - phase: 19-01
    provides: react-markdown@10.1.0 + remark-gfm@4.0.1 + rehype-sanitize@6.0.0 + @tailwindcss/typography@0.5.19 + MarkdownBody.test.tsx 7-.todo scaffold
  - phase: 05
    provides: "useSyntaxHighlight shiki singleton + highlightLines (T-05-07 HTML-escape, safeCssColor validator)"
  - phase: 10
    provides: "AssistantTextCard shell — wrapperClass, isContinuation, bodyColor, CLAUDE role label, STREAMING aria-live label, @user D-23 styling contract"
provides:
  - "src/components/chat/MarkdownBody.tsx — react-markdown renderer with custom CodeBlock (shiki via dangerouslySetInnerHTML, Pattern 4) + @user tokenizer (migrated from AssistantTextCard)"
  - "AssistantTextCard body delegates to MarkdownBody (shell-only — dropped 105 → 68 lines)"
  - "7 V-19-13..V-19-19 assertions replace Plan 01 .todo stubs in MarkdownBody.test.tsx"
  - "Path A test strategy: vi.mock('../MarkdownBody', …) inside AssistantTextCard.test.tsx keeps shell tests focused"
affects:
  - phase-19-04 (chat store selector — Wave 2 peer, does not touch markdown surface)
  - future plans rendering assistant_text (all consumers inherit MarkdownBody typography + XSS mitigation)

tech-stack:
  added: []
  patterns:
    - "Pattern 4 (imperative shiki outside sanitizer tree) — CodeBlock emits dangerouslySetInnerHTML from highlightLines (HTML-escapes tokens per T-05-07 + safeCssColor validator), bypassing rehype-sanitize's default-schema inline-style strip. Rest of markdown AST sanitized normally."
    - "@user tokenizer co-located with markdown renderer — word-bounded regex (^|\\W)(@user)(?=\\W|$) migrated verbatim from AssistantTextCard; wired through components.p / components.li / components.td children-mapper"
    - "Test stub via vi.mock('../MarkdownBody', …) keeps parent-component shell tests decoupled from markdown pipeline; content/security assertions own their suite in MarkdownBody.test.tsx"

key-files:
  created:
    - path: src/components/chat/MarkdownBody.tsx
      lines: 165
      purpose: "Markdown renderer for assistant_text content — react-markdown + remark-gfm + rehype-sanitize pipeline + custom CodeBlock (shiki imperative) + @user text-node renderer + StreamingCursor trail. Pure presentational, no store/IPC access."
  modified:
    - path: src/components/chat/AssistantTextCard.tsx
      lines_changed: "105 → 68 (−37 lines net)"
      purpose: "Body delegates to <MarkdownBody content={content} streaming={streaming} />; AT_USER_RE + renderContent + StreamingCursor import removed. Shell (CLAUDE label, wrapperClass, bodyColor, STREAMING label, isContinuation) preserved."
    - path: src/components/chat/__tests__/MarkdownBody.test.tsx
      lines_changed: "49 → 110 (+61 lines; 7 .todo → 7 it(…))"
      purpose: "All 7 V-19-13..V-19-19 assertions wired. highlightLines mock upgraded from plain-function stub to vi.fn() spy so V-19-15 can assert call args via .mock.calls[*][2]."
    - path: src/components/chat/__tests__/AssistantTextCard.test.tsx
      lines_changed: "72 → 102 (+30 lines)"
      purpose: "Path A stub: vi.mock('../MarkdownBody', …) returns a minimal data-testid='markdown-body-stub' div. @user assertion migrated to MarkdownBody.test.tsx V-19-18. Added positive delegation assertion + isContinuation CLAUDE/border-t regression guard."
    - path: .planning/phases/19-polish-phase-10-chat-transcript-rendering-four-related-gaps-/deferred-items.md
      lines_changed: "+27"
      purpose: "Logged D-04 (pre-existing flake in src/hooks/__tests__/useGraphLayout.test.ts under full-suite load; passes 13/13 in isolation)."

key-decisions:
  - "Path A test strategy (vi.mock MarkdownBody inside AssistantTextCard.test.tsx) chosen over Path B (prune tests). Preserves every shell invariant test + adds delegation + isContinuation guards. @user test moves to V-19-18 rather than duplicates."
  - "Single useMemo in CodeBlock invoked unconditionally (isInline path ignores result) to satisfy Rules of Hooks. Avoids the alternative conditional-hook pattern that ESLint would flag."
  - "V-19-17 XSS test updates `<script>…</script>legit` → `<script>…</script>\\n\\nlegitimate paragraph`. react-markdown's allowDangerousHtml=false default treats an HTML block as a whole-block unit and discards inline-adjacent text; the two-newline separator promotes 'legitimate paragraph' to its own markdown paragraph so we can simultaneously assert XSS-strip AND content-preservation."
  - "Open Question 1 (RESEARCH.md L757-761) resolved inline: AT_USER_RE lives in MarkdownBody.tsx, not extracted to src/utils/. Single TS consumer; extraction adds indirection without benefit."

requirements-completed:
  - D-03.1
  - D-03.2
  - D-03.3
  - D-03.4
  - D-03.5
  - D-03.6
  - D-03.7
  - V-19-13
  - V-19-14
  - V-19-15
  - V-19-16
  - V-19-17
  - V-19-18
  - V-19-19

duration: 10min
completed: 2026-04-21
---

# Phase 19 Plan 03: Wave 2 Markdown Body Summary

**Assistant chat transcript renders `**bold**`, `- lists`, tables, and fenced code (shiki-highlighted) as real markdown — with `<script>` stripped by rehype-sanitize, partial fences tolerated during streaming, and Phase 10's `@user` `text-secondary font-bold` accent preserved.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-21T08:02:00Z
- **Completed:** 2026-04-21T08:12:00Z (approx)
- **Tasks:** 3
- **Files created:** 1
- **Files modified:** 3 (component + 2 test suites + deferred-items)
- **Commits:** 3

## Accomplishments

- Assistant body now renders the codey `prose prose-sm prose-neutral dark:prose-invert max-w-none font-mono` typography, not `whitespace-pre-wrap` plaintext.
- Shiki syntax highlighting flows through `highlightLines` + `dangerouslySetInnerHTML` OUTSIDE the `rehype-sanitize` tree (Pattern 4) — colored spans survive the sanitizer that otherwise strips inline `style`.
- XSS defense is belt-and-braces: react-markdown `allowDangerousHtml=false` default + `rehype-sanitize` plugin. `<script>` never reaches the DOM (V-19-17).
- Streaming tolerance preserved: partial fences don't throw (Pitfall 5 defender — `try/catch` falls back to plain `<pre><code>`). V-19-19 asserts.
- Phase 10 D-23 `@user` accent migrated verbatim: word-bounded regex now wrapped around `components.p` / `components.li` / `components.td` children so mentions render as `<span className="text-secondary font-bold">` inside markdown output.
- AssistantTextCard dropped from 105 → 68 lines; visual shell (CLAUDE label, STREAMING aria-live label, wrapperClass, bodyColor, isContinuation collapsing) fully preserved.
- All 7 `it.todo` scaffolds from Plan 19-01 flipped to real assertions (V-19-13..V-19-19 green).

## Task Commits

1. **Task 1: Create MarkdownBody.tsx** — `d6697b7` (feat) — react-markdown + remark-gfm + rehype-sanitize pipeline, imperative shiki CodeBlock, @user tokenizer, 165 lines.
2. **Task 2: Delegate AssistantTextCard body to MarkdownBody** — `dce6c43` (refactor) — body `<p>` replaced with `<MarkdownBody />`; AT_USER_RE + renderContent removed; test suite gets `vi.mock` Path A stub + new delegation + isContinuation guards.
3. **Task 3: Flip MarkdownBody.test.tsx .todos to assertions** — `a3c5975` (test) — all 7 V-19-13..V-19-19 wired; highlightLines mock upgraded to `vi.fn()` spy; V-19-17 tweak for react-markdown HTML-block semantics; D-04 deferred-items entry for pre-existing Phase-11 flake.

## Files Created/Modified

- `src/components/chat/MarkdownBody.tsx` (new, 165 lines) — the markdown pipeline.
- `src/components/chat/AssistantTextCard.tsx` (105 → 68 lines) — shell only; body delegated.
- `src/components/chat/__tests__/MarkdownBody.test.tsx` (49 → 110 lines, 7 it.todo → 7 it()) — V-19-13..V-19-19 assertions.
- `src/components/chat/__tests__/AssistantTextCard.test.tsx` (72 → 102 lines) — vi.mock stub for MarkdownBody + two new shell-invariant guards.
- `.planning/phases/19-polish-phase-10-chat-transcript-rendering-four-related-gaps-/deferred-items.md` (+27 lines) — D-04 entry.

## Line-count Delta (explicit, per plan <output> row)

| File | Before | After |
|------|-------:|------:|
| AssistantTextCard.tsx | 105 | 68 |
| MarkdownBody.tsx | (absent) | 165 |
| MarkdownBody.test.tsx | 49 (7 todo) | 110 (7 it) |
| AssistantTextCard.test.tsx | 72 | 102 |

## Decisions Made

- **Path A** (stub MarkdownBody inside AssistantTextCard.test.tsx) chosen for Task 2 Step 2. Rationale in plan <output>: Path A keeps AssistantTextCard tests focused on the shell (which is the component's single responsibility post-refactor) and preserves every existing shell-invariant assertion. Path B (prune) would have shed coverage. The `@user` test rightly migrates into MarkdownBody.test.tsx as V-19-18 because `@user` tokenization is now MarkdownBody's concern.
- **Mock shape upgrade** (Plan 01 scaffold delivered a plain-function `highlightLines` stub; Task 3 upgrades to `vi.fn()` spy so V-19-15 can assert call args via `.mock.calls[*][2] === 'typescript'`). The scaffold's `data-stub-lang` HTML emission is preserved — V-19-15 could also assert via DOM `querySelector('[data-stub-lang="typescript"]')` but the spy is stricter (it asserts the call, not just the emission, meaning the highlightLines invocation path in CodeBlock is what ran).
- **Single unconditional `useMemo` in CodeBlock** — invoked for both inline and fenced paths; the inline branch short-circuits on `isInline` flag inside the memo. This satisfies Rules of Hooks without the common anti-pattern "hook behind condition".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug in test fixture] V-19-17 input pattern revised to accommodate react-markdown HTML-block semantics**

- **Found during:** Task 3 (running MarkdownBody.test.tsx — 6/7 passed, V-19-17 failed on second assertion)
- **Issue:** The plan's example XSS string `'<script>window.xss=1</script>legitimate text'` passes the first assertion (`querySelector('script') === null`) but fails `container.textContent.toContain('legitimate text')`. react-markdown's default `allowDangerousHtml: false` + CommonMark HTML-block grammar consumes the entire line beginning with `<script>` as a raw HTML block and emits nothing (no `<script>`, no trailing text). The test as written conflated "strip script" with "preserve adjacent text" but the grammar swallows both.
- **Fix:** Input now uses `'<script>window.xss=1</script>\n\nlegitimate paragraph'`. The blank-line break ends the HTML block, so `legitimate paragraph` becomes its own markdown paragraph that react-markdown renders. Both assertions now hold: no `<script>` in DOM + `legitimate paragraph` present.
- **Files modified:** `src/components/chat/__tests__/MarkdownBody.test.tsx` (V-19-17 test body)
- **Verification:** `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` → 7/7 pass.
- **Committed in:** `a3c5975` (Task 3 commit).
- **Why this is Rule 1 (bug) not a plan deviation:** The plan instructed "container contains NO `<script>`" (primary) and suggested the secondary assertion "didn't nuke entire output"; my revision preserves both assertions with input that actually exercises them. The XSS mitigation itself is identical; only the test fixture's second assertion's preconditions changed.

---

**Total deviations:** 1 auto-fixed (1 test-fixture bug).
**Impact on plan:** V-19-17 still asserts exactly what the threat model (T-19-03-01) demands: `<script>` stripped. The second assertion is a sanity check on the sanitizer not being over-eager (content survives), and the revised input is the well-known way to exercise that through react-markdown's block-level HTML handling.

## Issues Encountered

- **Flaky pre-existing test under full-suite load.** `npm run test` whole-suite surfaced a 4th failure beyond the 3 documented in Plan 19-01's deferred-items D-02: `src/hooks/__tests__/useGraphLayout.test.ts > useGraphLayout — Phase 11 Worker client > posts pin/unpin when pinnedNodeIds Set diff changes`. Two-layer causation check:
  1. `git stash` + isolated run → 13/13 pass on commit `dce6c43` (Plan 19-03 Task 2 complete).
  2. Isolated run WITH Plan 19-03 Task 3 changes in place → 13/13 pass (`9.64s` total).
  Failure only reproduces inside the 65-file concurrent vitest pool — classic flake caused by resource contention on the D3 worker mock. Plan 19-03 touches zero files under `src/hooks/` or `src/views/Radar/`. Logged as **D-04** in `deferred-items.md`. Per `memory/MEMORY.md` rule "only fix own bugs," left alone.

## User Setup Required

None.

## Manual UAT (per RESEARCH.md manual-UAT pointer)

**Deferred.** Plan <output> row requests "Confirmation that a live Tauri smoke (per RESEARCH.md manual UAT row) was performed and captured observations." Tauri dev-launch manual UAT not performed during this automated executor run — the agent operates without a running Tauri window. The automated test suite covers all seven V-19-13..V-19-19 assertions (including the shiki highlight path via the stub spy), and `npm run build` exits 0 with `.prose` compiled into the production bundle. Human UAT pass recommended as a Phase-19 sign-off step alongside the Plan 19-04 follow-up, not as a Plan 19-03 blocker.

## Next Phase Readiness

- **Plan 19-04 (chat store selector — Wave 2 peer)** unaffected. Zero overlap in files: 19-03 owns `src/components/chat/MarkdownBody.tsx` + `AssistantTextCard.tsx`; 19-04 owns `src/stores/chatStore.ts` + `ToolUseCard.tsx`. Wave 2 parallelism contract preserved.
- **Follow-up sweep:** once Plan 19-04 lands, a joint Phase-19 UAT (manual Tauri smoke) is the natural sign-off moment for Phase 19 completion.

## Threat Flags

None introduced. Plan 19-03 is purely presentational — no new network endpoints, no new auth paths, no new filesystem access, no schema changes. The two mitigations (T-19-03-01 XSS + T-19-03-03 streaming-crash DoS) live inside the frontend markdown pipeline only.

## Self-Check: PASSED

**Files created (all present):**
- `src/components/chat/MarkdownBody.tsx` — FOUND (165 lines)

**Files modified (correct regions):**
- `src/components/chat/AssistantTextCard.tsx` — 105 → 68 lines, AT_USER_RE + renderContent removed
- `src/components/chat/__tests__/MarkdownBody.test.tsx` — 7 it.todo → 7 it(…), all V-19-13..V-19-19
- `src/components/chat/__tests__/AssistantTextCard.test.tsx` — vi.mock('../MarkdownBody', …) stub + new delegation/isContinuation guards
- `.planning/phases/19-polish-phase-10-chat-transcript-rendering-four-related-gaps-/deferred-items.md` — D-04 entry appended

**Commits (all in git log):**
- `d6697b7` — FOUND: `feat(19-03): add MarkdownBody component with react-markdown + shiki code renderer (D-03)`
- `dce6c43` — FOUND: `refactor(19-03): delegate AssistantTextCard body to MarkdownBody (D-03.5)`
- `a3c5975` — FOUND: `test(19-03): MarkdownBody V-19-13..19-19 assertions replace Plan 01 .todo stubs (D-03)`

**Verification runs:**
- `npx tsc --noEmit` → exit 0
- `npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx` → 7/7 pass
- `npm run test -- src/components/chat/__tests__/AssistantTextCard.test.tsx` → 6/6 pass
- `npm run test` full-suite → 545 pass + 7 todo + 5 skipped + 4 fail (all 4 pre-existing — 3 in D-02, 1 new flake in D-04; no Plan-19-03 causation)
- `npm run build` → exit 0 (15.74s; `.prose` + shiki chunks in dist/assets/)

**Plan-wide backend/shiki-hook invariants:**
- `git diff --stat src-tauri/` → empty ✓
- `git diff d6697b7^..HEAD -- src/hooks/useSyntaxHighlight.ts` → empty ✓

All plan acceptance criteria satisfied. Plan 19-03 complete.

---
*Phase: 19-polish-phase-10-chat-transcript-rendering-four-related-gaps-*
*Completed: 2026-04-21*
