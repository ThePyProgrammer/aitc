## Phase 6 Plan 04 deferred items

- Pre-existing failures (out of scope for this plan):
  - `conflict::engine::tests::test_conflict_detected_different_pids_within_window`
  - `conflict::engine::tests::test_custom_window_duration`
  Confirmed to fail on Wave 2 base (commit fff9d23) before any Plan 04 edits. Not introduced or aggravated by passive_bridge or forwarder persist changes. Deferred for a dedicated Phase 6 fix plan or Phase 5 regression sweep.
