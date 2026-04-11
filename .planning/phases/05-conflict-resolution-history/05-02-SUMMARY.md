---
phase: 05-conflict-resolution-history
plan: 02
subsystem: frontend-libs
tags: [merge, contention, shiki, history, zustand]
dependency_graph:
  requires: [node-diff3, shiki, "@shikijs/engine-javascript"]
  provides: [merge-computation, contention-scoring, syntax-highlighting, history-store]
  affects: [merge-ui, heat-map-overlay, history-view]
tech_stack:
  added: [node-diff3, shiki, "@shikijs/engine-javascript"]
  patterns: [singleton-highlighter, tdd-red-green, zustand-store-per-domain]
key_files:
  created:
    - src/lib/merge.ts
    - src/lib/contention.ts
    - src/hooks/useSyntaxHighlight.ts
    - src/stores/historyStore.ts
    - src/lib/__tests__/merge.test.ts
    - src/lib/__tests__/contention.test.ts
  modified:
    - package.json
decisions:
  - "Used createJavaScriptRegexEngine instead of plan's createJavaScriptRegExpEngine (actual API name)"
  - "Clamped writeNorm to 0 minimum to handle writeAgentCount=0 edge case"
  - "Adapted test expectations for non-overlapping edits: diff3Merge auto-merges them into clean hunks"
metrics:
  duration: 13m
  completed: "2026-04-11T10:26:22Z"
  tasks: 2
  files: 7
---

# Phase 5 Plan 2: Frontend Libraries, Merge Logic, Contention Scoring Summary

3-way merge computation via node-diff3 with per-hunk resolution support, contention heat map scoring with Command Horizon color gradient, Shiki singleton highlighter for 7 languages, and Zustand history store for sessions/conflicts/approvals.

## Task Results

### Task 1: Install deps + create merge.ts and contention.ts with tests (TDD)

**Commits:** `9bcd2e2` (RED), `cb610ae` (GREEN)

- Installed node-diff3, shiki, @shikijs/engine-javascript
- `computeMerge`: wraps diff3Merge to produce MergeHunk[] with clean/conflict type, line positions
- `buildMergedContent`: applies per-hunk resolution choices (accept-A, accept-B, custom edit, fallback to base)
- `computeContentionScore`: 70% conflict weight + 30% write frequency weight, clamped to [0, 1]
- `contentionToColor`: green (0-0.3) / amber (0.3-0.7) / red (0.7-1.0) with Command Horizon rgba values
- 19 unit tests pass (9 merge + 10 contention)

### Task 2: Shiki highlighter hook + historyStore

**Commit:** `ac88fa8`

- `useSyntaxHighlight`: singleton Shiki init with github-dark theme, 7 language grammars (TS, JS, Rust, JSON, CSS, HTML, Python)
- `highlightLines`: per-line token-to-span conversion without pre/code wrapping (T-05-07 safe)
- `detectLanguage`: file extension mapping to Shiki language IDs
- `useHistoryStore`: Zustand store with fetchSessions, fetchConflicts, fetchApprovals via Tauri invoke
- Tab state, filter support (dateRange, agentId, status), loading state with error handling

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Clamped writeNorm to non-negative values**
- **Found during:** Task 1 GREEN phase
- **Issue:** `computeContentionScore(0, 0, 10, 5)` returned -0.075 because `(0-1)/(5-1) = -0.25`
- **Fix:** Added `Math.max(0, ...)` around writeNorm calculation
- **Files modified:** src/lib/contention.ts
- **Commit:** cb610ae

**2. [Rule 3 - Blocking] Fixed Shiki engine import name**
- **Found during:** Task 2 tsc verification
- **Issue:** Plan specified `createJavaScriptRegExpEngine` but actual export is `createJavaScriptRegexEngine`
- **Fix:** Corrected import and usage to match actual API
- **Files modified:** src/hooks/useSyntaxHighlight.ts
- **Commit:** ac88fa8

**3. [Rule 1 - Bug] Adjusted test for non-overlapping edits**
- **Found during:** Task 1 RED phase (API exploration)
- **Issue:** Plan expected 2 conflict hunks for non-overlapping edits, but diff3Merge auto-merges them into clean hunks
- **Fix:** Test asserts clean merge with both changes present instead of conflict hunks
- **Files modified:** src/lib/__tests__/merge.test.ts
- **Commit:** 9bcd2e2

## Verification Results

- All 19 unit tests pass (vitest)
- TypeScript compilation clean for all new files
- node-diff3, shiki, @shikijs/engine-javascript present in package.json dependencies

## Known Stubs

None. All modules export functional implementations with real library integrations.

## Self-Check: PASSED

- All 6 created files verified on disk
- All 3 commits verified in git log (9bcd2e2, cb610ae, ac88fa8)
