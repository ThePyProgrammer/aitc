---
phase: 19
plan: 01
subsystem: chat-transcript-polish
tags: [wave-0, dependencies, fixtures, scaffolds, tailwind-v4, vitest]
wave: 0
depends_on: []
requires:
  - node.npm-registry-reachable
  - tailwind-v4-plugin-directive-syntax
provides:
  - react-markdown@10.1.0
  - remark-gfm@4.0.1
  - rehype-sanitize@6.0.0
  - "@tailwindcss/typography@0.5.19 (dev)"
  - "@plugin \"@tailwindcss/typography\" wiring in theme.css"
  - "fixture: coalesced_turn.jsonl (V-19-01, V-19-03)"
  - "fixture: interrupted_turn.jsonl (V-19-02)"
  - "fixture: hook_pretool_use.jsonl (V-19-21)"
  - "vitest scaffold: MarkdownBody.test.tsx (7 .todo, V-19-13..V-19-19)"
  - "vitest scaffold: chatStore.test.ts selectToolUseWithResult (3 .todo, V-19-08)"
  - "factories: mkToolUse / mkToolResult (consumed by Plan 04)"
affects:
  - package.json
  - package-lock.json
  - src/styles/theme.css
  - "dist/assets/index-*.css (build artifact; .prose compiled in)"
tech-stack:
  added:
    - "react-markdown@10.1.0 — react-19-compatible markdown renderer"
    - "remark-gfm@4.0.1 — GitHub-flavored markdown (lists, tables, strikethrough)"
    - "rehype-sanitize@6.0.0 — XSS defense-in-depth on top of react-markdown HTML-off default"
    - "@tailwindcss/typography@0.5.19 — .prose-* utility families for assistant body typography"
  patterns:
    - "Tailwind v4 `@plugin \"<pkg>\";` directive on line 2 of CSS entry (immediately after `@import \"tailwindcss\";`)"
    - "vitest `.todo` placeholders with V-19-XX comment anchors (Plan 03/04 flip .todo→it(…) without restructuring)"
    - "factories-alongside-scaffold (mkToolUse / mkToolResult committed in Wave 0; Plan 04 imports the selector + consumes factories — zero new test infra in the consuming plan)"
    - "stream-json JSONL fixtures share session_id `0d836c4f-…` spine across scenarios so downstream assertions can reuse mk helpers"
key-files:
  created:
    - path: src-tauri/tests/fixtures/stream_json/coalesced_turn.jsonl
      lines: 11
      purpose: "init + 3 text_delta + whole-turn assistant envelope + result — feeds V-19-01 (3 deltas + envelope → 1 DB row) and V-19-03 (envelope replaces buffer)"
    - path: src-tauri/tests/fixtures/stream_json/interrupted_turn.jsonl
      lines: 5
      purpose: "init + 2 text_delta + EOF (no assistant envelope, no result) — feeds V-19-02 (StdoutClosed flushes interrupted turn with terminal_reason=\"interrupted\")"
    - path: src-tauri/tests/fixtures/stream_json/hook_pretool_use.jsonl
      lines: 1
      purpose: "PreToolUse:Edit hook_started — V-19-21 regression guard that D-04 SessionStart filter does NOT collateral-damage other hook lifecycle events"
    - path: src/components/chat/__tests__/MarkdownBody.test.tsx
      lines: 49
      purpose: "Wave-0 vitest scaffold for Plan 03's MarkdownBody component; 7 .todo entries keyed 1:1 to V-19-13..V-19-19 + vi.mock of useSyntaxHighlight pre-wired"
    - path: .planning/phases/19-polish-phase-10-chat-transcript-rendering-four-related-gaps-/deferred-items.md
      lines: 55
      purpose: "Log of two pre-existing issues surfaced during verification but NOT caused by this plan (end_to_end_smoke.rs / HeatMapOverlay + MasterDetailShell)"
  modified:
    - path: package.json
      lines_changed: 4
      purpose: "Four new markdown-rendering dependencies declared (3 runtime, 1 dev)"
    - path: package-lock.json
      lines_changed: ~1180
      purpose: "Lockfile regen locks 74 new transitive packages"
    - path: src/styles/theme.css
      lines_changed: 1
      purpose: "`@plugin \"@tailwindcss/typography\";` inserted on line 2 between tailwind import and app CSS imports"
    - path: src/stores/__tests__/chatStore.test.ts
      lines_changed: 63
      purpose: "Appended mkToolUse + mkToolResult factories, selectToolUseWithResult describe block with 3 it.todo, + `void` references to satisfy noUnusedLocals"
decisions:
  - "Tailwind v4 @plugin directive placement: line 2 (immediately after `@import \"tailwindcss\";`). Verified with full `npm run build` — compiles clean in 6.42s, `.prose` emitted into production bundle. Resolves RESEARCH.md Open Question #3 with zero deviation from the planned placement."
  - "Pre-existing failing tests logged rather than fixed per memory rule 'only fix own bugs in this session'. Three failures (`HeatMapOverlay.heatTintForNode(0)`, `MasterDetailShell` rail + detail width classes) reproduced on commit 2c5b54d (BEFORE Task 1's typography install), proving causation is unrelated to Plan 19-01. Triaged into deferred-items.md D-02 with two-layer evidence."
  - "Integration-test compile error in `tests/end_to_end_smoke.rs` (missing LaunchOptions.agent_id + aitc_port fields) NOT fixed here: same scope rule; the error predates Phase 19 and Lib tests (the surface Wave 1 will exercise) compile cleanly. Logged as deferred D-01."
  - "`void mkToolUse; void mkToolResult;` added at bottom of chatStore.test.ts so the factories don't trigger `noUnusedLocals` / `noUnusedParameters` while the Plan-04 consumer is not yet present. Plan 04 removes the voids when it imports the selector."
metrics:
  duration: 9m
  tasks: 3
  files_changed: 7
  files_created: 5
  files_modified: 2
  commits: 3
  completed: 2026-04-21
---

# Phase 19 Plan 01: Wave 0 Foundation Summary

Install the four markdown-rendering npm dependencies, wire `@tailwindcss/typography` as a Tailwind v4 `@plugin` directive, create three new stream-json JSONL fixtures used by Wave 1 Rust tests, and scaffold two vitest suites that Wave 2 flips `.todo` → real assertions. Purely infrastructural — no logic touched.

## Tasks

| # | Task | Status | Commit | Files |
|---|------|--------|--------|-------|
| 1 | Install markdown deps + wire typography plugin | done | `1c9ac0e` | package.json, package-lock.json, src/styles/theme.css |
| 2 | Three stream-json JSONL fixtures | done | `566c247` | 3 × `*.jsonl` + deferred-items.md |
| 3 | MarkdownBody + chatStore vitest scaffolds | done | `a1a0c0a` | MarkdownBody.test.tsx, chatStore.test.ts, deferred-items.md |

## Installed Versions

Output of `npm ls react-markdown remark-gfm rehype-sanitize @tailwindcss/typography`:

```
aitc@0.1.0 /home/prannayag/pragnition/htx/aitc
├── @tailwindcss/typography@0.5.19
├── react-markdown@10.1.0
├── rehype-sanitize@6.0.0
└── remark-gfm@4.0.1
```

All four landed at the exact caret-range specified in plan frontmatter. 70 new transitive packages, 0 vulnerabilities reported by npm audit.

## RESEARCH.md Open Question #3 Resolution

**Q:** Does Tailwind v4 accept `@plugin "@tailwindcss/typography";` as a top-level directive alongside `@import`s, and where must it be placed?

**A (verified):** **YES**, line 2 (immediately after `@import "tailwindcss";`, before any `@import "./…"` app CSS imports). First-try success — no adjustment, no fallback syntax, no config-file workaround. `npm run build` completes in 6.42s, `.prose` appears in the production CSS bundle (`grep -c "prose" dist/assets/index-*.css` returns ≥ 1), and no Tailwind warnings or plugin errors emit.

Final top-of-file of `src/styles/theme.css`:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
@import "./fonts.css";
@import "./animations.css";
```

Plan 03's MarkdownBody can consume `.prose prose-sm prose-neutral dark:prose-invert max-w-none` with zero additional wiring.

## Fixtures Shape Invariants

All three new JSONL fixtures validated with per-line `JSON.parse` (17 lines total, 0 parse errors) and targeted grep invariants:

| Fixture | Lines | Invariants asserted |
|---|---|---|
| `coalesced_turn.jsonl` | 11 | 3× `content_block_delta` / 1× `"type":"assistant"` with `"Hello world"` / 1× `"terminal_reason":"completed"` |
| `interrupted_turn.jsonl` | 5 | 2× `content_block_delta` / 0× `"type":"result"` / 0× `"type":"assistant"` (EOF-truncated as designed) |
| `hook_pretool_use.jsonl` | 1 | `"hook_name":"PreToolUse:Edit"` present — confirms shape twin of `hook_started_response.jsonl` but with a non-SessionStart hook_name (the V-19-21 regression guard) |

Session_id reuses the spine `0d836c4f-8546-4aeb-a994-6fb94ba800b7` from `single_turn_text.jsonl` so Wave 1 assertions can share `mk` helpers. UUID tails `…0001` / `…0002` disambiguate fixtures when replayed in sequence.

## Scaffold Confirmation

`npm run test -- src/components/chat/__tests__/MarkdownBody.test.tsx src/stores/__tests__/chatStore.test.ts`:

```
 ↓ src/components/chat/__tests__/MarkdownBody.test.tsx (7 tests | 7 skipped)
 ✓ src/stores/__tests__/chatStore.test.ts (24 tests | 3 skipped) 40ms

 Test Files  1 passed | 1 skipped (2)
      Tests  21 passed | 10 todo (31)
```

- **MarkdownBody**: 7 `.todo` entries reported (satisfies acceptance "≥ 7 it.todo entries, each naming a distinct V-19 assertion").
- **chatStore**: 21 existing tests still pass + 3 new `selectToolUseWithResult` `.todo` entries. Zero regressions.
- **Grand total**: 10 new `.todo`s across the two scaffolds, exit 0.

## Deviations from Plan

### None auto-fixed in scope.

Plan 19-01 executed precisely as written. No bugs surfaced in the code the plan touches. No Rule-1/2/3 auto-fixes applied.

### Out-of-scope discoveries (logged to deferred-items.md)

**D-01** — `src-tauri/tests/end_to_end_smoke.rs` compile errors (`E0063` missing `LaunchOptions.agent_id` + `aitc_port`; `E0061` arg-count) surfaced when running `cargo check --tests`. Verified these are **pre-existing** from Phase 10 Plan 04's `LaunchOptions` widening — my Task 2 only added JSONL files under `tests/fixtures/`, no Rust source. `cargo test --lib --no-run chat_runtime::parser` (Wave 1's actual target) compiles clean. Per `memory/MEMORY.md` rule "only fix own bugs," logged and left.

**D-02** — Three pre-existing vitest failures (`HeatMapOverlay.heatTintForNode(0)` + `MasterDetailShell` rail/detail width classes) in the full-suite `npm run test` run. Two-layer reproduction evidence: (a) stashed Task 3 → same failures on post-Task-2 commit `566c247`; (b) checked out commit `2c5b54d` (BEFORE Task 1's typography install) → same failures. Rules out any Phase 19 cause. Both look like expectation drift after upstream work in other phases. Logged.

## Known Stubs

The Plan 19-01 scaffolds are stubs **by design** — all acceptance criteria require `.todo` placeholders (not wired assertions) because the components / selectors they target do not exist yet:

1. `src/components/chat/__tests__/MarkdownBody.test.tsx` — 7 `it.todo` entries. MarkdownBody.tsx lands in Plan 19-03, which flips `.todo` → real `it(…)`.
2. `src/stores/__tests__/chatStore.test.ts` — 3 `it.todo` entries in `selectToolUseWithResult` describe. Selector lands in Plan 19-04, which adds the import + flips `.todo` → real `it(…)` + removes the `void mkToolUse; void mkToolResult;` markers.

Both stubs are explicitly mandated by the plan frontmatter and gate the Wave 2 flip — not escape hatches, deliberate Wave 0 / Wave 2 hand-offs.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: npm-supply-chain | package.json / package-lock.json | 70 new transitive packages added via `react-markdown` + `remark-gfm` + `rehype-sanitize` install (+ 4 more for `@tailwindcss/typography`). Caret-pinned at plan-specified version ranges; `npm audit` reports 0 vulnerabilities. Acceptance from T-19-00-01: reviewed, no new HIGH/CRITICAL. |

## Self-Check: PASSED

**Files created (all present):**
- `src-tauri/tests/fixtures/stream_json/coalesced_turn.jsonl` — FOUND (11 lines)
- `src-tauri/tests/fixtures/stream_json/interrupted_turn.jsonl` — FOUND (5 lines)
- `src-tauri/tests/fixtures/stream_json/hook_pretool_use.jsonl` — FOUND (1 line)
- `src/components/chat/__tests__/MarkdownBody.test.tsx` — FOUND (49 lines, 7 it.todo)
- `.planning/phases/19-polish-phase-10-chat-transcript-rendering-four-related-gaps-/deferred-items.md` — FOUND

**Files modified (correct regions):**
- `package.json` — 4 new deps
- `package-lock.json` — regenerated
- `src/styles/theme.css` — line 2 `@plugin` inserted
- `src/stores/__tests__/chatStore.test.ts` — 63-line append (factories + describe)

**Commits (all in git log):**
- `1c9ac0e` — FOUND: `feat(19-01): install markdown rendering dependencies`
- `566c247` — FOUND: `test(19-01): add stream-json fixtures for Phase 19 validation`
- `a1a0c0a` — FOUND: `test(19-01): scaffold MarkdownBody + chatStore selector test suites`

**Verification runs:**
- `npm run build` → exit 0 (6.42s, `.prose` in dist CSS)
- `npm run test -- <plan-targeted files>` → exit 0 (21 passed | 10 todo | 0 failed)
- `cargo check --lib` → exit 0 (warnings only, pre-existing)
- `cargo test --lib --no-run chat_runtime::parser` → exit 0

All plan acceptance criteria satisfied. Plan 19-01 complete.
