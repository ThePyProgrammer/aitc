## Phase 6 Plan 04 deferred items

- Pre-existing failures (out of scope for this plan):
  - `conflict::engine::tests::test_conflict_detected_different_pids_within_window`
  - `conflict::engine::tests::test_custom_window_duration`
  Confirmed to fail on Wave 2 base (commit fff9d23) before any Plan 04 edits. Not introduced or aggravated by passive_bridge or forwarder persist changes. Deferred for a dedicated Phase 6 fix plan or Phase 5 regression sweep.

## 06-05: Pre-existing TypeScript errors blocking `npm run build`

Discovered during Task 2 verify. These errors exist at base commit 4d8adc3 and are NOT caused by Plan 06-05 work.

**Files with errors:**
- `src/stores/conflictStore.ts` (5 errors) — `_resolveTimeoutId` not declared on ConflictStore type (commit e77e447)
- `src/views/CommsHub/InlineDiff.tsx` (1 error) — unused `lineIndex`
- `src/views/Radar/__tests__/RadarComponents.test.tsx` (3 errors) — test fixture type narrowing
- `src/views/Radar/RadarCanvas.tsx` (1 error) — unused `setViewport`
- Additional: 5 more errors in unrelated files

**Verification:** `npx tsc --noEmit` on Plan 06-05 touched files only → 0 errors.
**Impact on this plan:** None. `npm run build` (which runs tsc) fails on the same errors it would fail at base.
**Owner:** Open a gap-closure plan after phase completion.
