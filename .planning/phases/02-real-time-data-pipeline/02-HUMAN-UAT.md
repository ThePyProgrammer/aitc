---
status: partial
phase: 02-real-time-data-pipeline
source: [02-VERIFICATION.md]
started: 2026-04-09T17:00:00.000Z
updated: 2026-04-09T17:00:00.000Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end pipeline smoke test
expected: Invoke `start_watch` from the frontend (via Phase 3 Tower Control UI or a dev REPL), create/modify/delete files in the watched repo, and verify that `pipelineStore.events` updates in real time via React DevTools. Events should appear within 500ms of file write. No data loss under normal write rates.
result: [pending]

### 2. stop_watch idempotency (HR-03)
expected: Call `stop_watch` when no watch is active (e.g., call it twice). The app should NOT show an unhandled promise rejection or visible error. Currently `stop_watch` returns `Err("no active watch")` and `usePipelineChannel.unregister()` has no `.catch()` handler.
result: [pending]

### 3. Path traversal guard false-positive (HR-01)
expected: Create a directory named `{repo}-backup` alongside the watched repo. Write a file to `{repo}-backup/test.txt`. Verify that the event does NOT appear in `pipelineStore.events`. Currently `path_is_under_root` uses byte-prefix matching which would incorrectly accept events from sibling directories with matching prefixes.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
