---
status: partial
phase: 06-pipeline-activation-integration-wiring
source:
  - 06-01-SUMMARY.md
  - 06-02-SUMMARY.md
  - 06-03-SUMMARY.md
  - 06-04-SUMMARY.md
  - 06-05-SUMMARY.md
  - 06-VALIDATION.md (Manual-Only Verifications)
started: 2026-04-13T00:00:00Z
updated: 2026-04-13T00:30:00Z
---

## Current Test

[session paused after Test 1 blocker — resume with /gsd-verify-work 6 after fixing squarify regression via /gsd-debug]

## Tests

### 1. Cold Start Smoke Test
expected: |
  Build/launch fresh: kill any running aitc process, delete the SQLite db file, run `npm run tauri dev`. App boots without errors, migrations apply, window opens, backend logs clean.
result: issue
reported: |
  "I go to the radar view, then tower view, then radar view, and then get this: Unexpected Application Error! squarify is not a function TypeError: squarify is not a function at layoutChildren (http://localhost:1420/src/hooks/useTreemapLayout.ts:85:17) at computeTreemapLayout (http://localhost:1420/src/hooks/useTreemapLayout.ts:116:2) ... at RadarCanvas (http://localhost:1420/src/views/Radar/RadarCanvas.tsx:66:17) ..."
severity: blocker
notes: |
  App boots successfully (cold start works), but navigating Radar -> Tower -> Radar crashes with `squarify is not a function` in src/hooks/useTreemapLayout.ts:85. Likely caused by Phase 6 WR-01 fix that changed `is_dir` population in tree_index entries, breaking the treemap layout path — or a stale-module / import shape issue in useTreemapLayout. Blocks all downstream radar-dependent tests (2, 3, 5, 7).

### 2. Folder Picker Fallback (FMON-01)
expected: |
  Launch the app from a directory that is NOT a git repository (e.g. your home folder). The native folder picker dialog appears asking you to select a repository. Select a folder that IS a git repository. The watcher starts (RepoStatusChip shows "Watching" + green pulse) and the radar populates with file tree data within ~1s.
result: pending

### 3. CWD Auto-Detect (FMON-01)
expected: |
  Launch the app from inside a git repository's working tree (e.g. `cd C:/some/git/repo && npm run tauri dev`). The app auto-detects the repo via CWD without prompting — no folder picker appears. RepoStatusChip shows the repo path and "Watching".
result: pending

### 4. Persisted Repo Auto-Open (FMON-01)
expected: |
  With a repo already opened, close the app (window close or tray exit). Re-launch the app from any CWD. The previously-opened repo opens automatically without prompting. The persisted repo path is loaded from app_settings in SQLite.
result: pending

### 5. Change Repo Action (FMON-01)
expected: |
  With a repo open, click the "Change repo" button in the TopBar. The folder picker appears. Select a different git repo. The current watch stops cleanly (no errors), the new watch starts on the selected repo, RepoStatusChip updates to the new path, and the radar treemap reflects the new repo's file tree.
result: pending

### 6. Pause/Resume Toggle (FMON-01)
expected: |
  With a watch active, click the PauseMonitoringToggle in the TopBar. The chip turns amber and shows "Paused". Modify a file in the watched repo from outside the app — pipelineStore.events does NOT receive the new event. Click the toggle again to resume — chip returns to green "Watching". Modify another file — events flow again. Events captured BEFORE pausing are preserved (not cleared).
result: pending

### 7. Live Radar Treemap Updates (FMON-01, FMON-03)
expected: |
  With a watch active and the Radar view open, externally modify several files in the watched repo (create, edit, delete). The radar treemap updates to reflect the new file tree state within ~1s (debounced refetch). Newly-touched files appear with the appropriate visual treatment.
result: pending

### 8. Passive Agent Detection + KAGENT Merge (AGNT-03)
expected: |
  Start AITC with a repo open. From a separate terminal, launch an allowlisted process inside the watched repo (e.g. `claude-code` or `codex`). Within ~2s, a PASSIVE-<pid> agent appears in Tower Control as "unidentified" / passive-scan protocol. Once the agent self-registers via HTTP (POST to localhost:AITC_PORT), the PASSIVE entry is removed and a KAGENT-<pid> entry takes its place — no duplicate rows in the manifest.
result: pending

### 9. Multi-Worktree Detection (FMON-04)
expected: |
  In a test repo, run `git worktree add ../repo-wt2 main` to create a second worktree. Open the main repo in AITC. Both worktrees appear in pipelineStore.worktrees (visible in TopBar or Tower Control). Modifying a file in either worktree generates events attributed to the correct worktree.
result: pending

## Summary

total: 9
passed: 0
issues: 1
pending: 8
skipped: 0

## Gaps

- truth: "App remains functional across view navigation — Radar -> Tower -> Radar does not crash."
  status: failed
  reason: "User reported: Unexpected Application Error! squarify is not a function TypeError at layoutChildren (useTreemapLayout.ts:85) when re-entering Radar view."
  severity: blocker
  test: 1
  artifacts:
    - src/hooks/useTreemapLayout.ts:85  # layoutChildren call site
    - src/views/Radar/RadarCanvas.tsx:66  # hook consumer
    - src-tauri/src/pipeline/tree_index.rs  # modified in WR-01 fix (8d66b17)
    - src-tauri/src/pipeline/commands.rs  # modified in WR-01 fix (8d66b17, 8032471)
  missing:
    - Defensive check on squarify import shape in useTreemapLayout
    - Regression test that renders RadarCanvas twice (unmount/remount) to catch stale-module issues
    - Verification that tree_index entries match the shape useTreemapLayout expects after WR-01 changed is_dir population
