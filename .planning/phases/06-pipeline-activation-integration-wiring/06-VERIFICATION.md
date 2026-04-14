---
phase: 06-pipeline-activation-integration-wiring
verified: 2026-04-11T00:00:00Z
status: human_needed
score: 4/4 success criteria verified programmatically; 7 manual scenarios remain
overrides_applied: 0
human_verification:
  - test: "Native folder picker dialog appears when CWD is not a git repo"
    expected: "Launching the app from a non-git directory surfaces the native OS folder picker; choosing a git repo starts a watch"
    why_human: "Tauri dialog plugin requires a real OS window/dialog; cannot be asserted in CI"
  - test: "Persisted repo auto-opens on next launch"
    expected: "Repo A selected on launch 1 is active on launch 2 without prompting"
    why_human: "Requires two separate app launches with state persistence across process boundary"
  - test: "Change repo action switches watch targets"
    expected: "Clicking Change repo in the TopBar, picking repo B, stops watch on A and starts watch on B; radar reflects B"
    why_human: "Interactive UI navigation + two real watches required"
  - test: "Pause/resume toggle stops and resumes file events"
    expected: "After Pause, file modifications do not appear in pipelineStore.events; after Resume they do"
    why_human: "Requires live UI interaction plus filesystem observation"
  - test: "Radar treemap updates live when files change"
    expected: "Externally modifying a file updates the treemap within ~1s (debounce 500ms)"
    why_human: "Visual reactivity only verifiable by eye"
  - test: "Passive agent detection + merge on self-registration"
    expected: "Allowlisted external process appears as PASSIVE-<pid>; on self-register, PASSIVE entry is removed and a KAGENT entry takes its place"
    why_human: "Requires a real allowlisted process (claude-code/codex) running on the host"
  - test: "Worktree detection for git worktree add sub-trees"
    expected: "Both worktrees appear in pipelineStore.worktrees and TopBar"
    why_human: "Requires a multi-worktree git repo layout on disk"
---

# Phase 6: Pipeline Activation + Integration Wiring — Verification Report

**Phase Goal:** All cross-phase integration points are connected — pipeline activates from UI, passive agent detection works, and session file tracking populates data.
**Verified:** 2026-04-11
**Status:** human_needed (4/4 automated success criteria verified; 7 manual scenarios remain in 06-VALIDATION.md)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | File watcher starts automatically when a repository is opened via the UI | VERIFIED | `src/providers/RepoSessionProvider.tsx:10,35` — `usePipelineChannel().register(activeRepo)` is called from a `useEffect` gated on `[activeRepo, isPaused]`; provider mounted above `<Outlet/>` in `src/components/layout/AppShell.tsx:11,24` so the Channel outlives navigation. Repo resolved via `repoStore.resolveInitialRepo` (CWD → persisted → picker). |
| SC-2 | ProcessSnapshot candidates are periodically bridged to AgentRegistry for passive agent detection | VERIFIED | `src-tauri/src/pipeline/passive_bridge.rs` — `spawn_passive_bridge` + `bridge_tick` (reap first, then upsert PASSIVE-{pid}); spawned from `src-tauri/src/pipeline/commands.rs:112` inside `start_watch`, `BRIDGE_INTERVAL_MS = 2000`. Tracked by `ActiveWatch.bridge_task` (Drop aborts on stop_watch). |
| SC-3 | Session file write counts are populated via record_session_file during pipeline events | VERIFIED | `src-tauri/src/pipeline/commands.rs:144,278` — forwarder calls `persist_attributed_batch` which resolves PID via `AgentRegistry::find_agent_by_pid`, calls `db::session::ensure_open_session`, then `record_session_file_internal` (upserts `session_files`, recomputes `agent_sessions.file_count`). 4 forwarder tests green. |
| SC-4 | Radar treemap populates with live file tree data when a watch is active | VERIFIED | `src/stores/radarStore.ts` — `installRadarPipelineBridge()` subscribes to `pipelineStore.events` and triggers `fetchTreeIndex()` debounced to 500ms; installed from `src/providers/RepoSessionProvider.tsx:7,27` with unsubscribe returned as cleanup. Initial tree load happens via `fetchTreeIndex` IPC to `get_tree_index`. |

**Score:** 4/4 success criteria verified programmatically.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src-tauri/src/repo_session.rs` | capture_launch_cwd, get_launch_cwd, detect_git_root, persist_last_repo, get_last_repo | VERIFIED | Commands registered in `lib.rs collect_commands!`; 5 unit tests pass |
| `src-tauri/src/db/session.rs` | ensure_open_session, close_session, record_session_file_internal | VERIFIED | Transactional read-or-insert; 5 session_lifecycle tests pass |
| `src-tauri/src/agents/registry.rs` | find_agent_by_pid, reap_passive_agents | VERIFIED | 5 merge_by_pid tests; never touches KAGENT/launched entries |
| `src-tauri/src/agents/self_register.rs` | PASSIVE removal before KAGENT upsert + ensure_open_session | VERIFIED | `self_register.rs:149` removes PASSIVE-{pid}; `:160` opens session row |
| `src-tauri/src/pipeline/passive_bridge.rs` | spawn_passive_bridge, bridge_tick | VERIFIED | 3 tests; sentinel adapter built from `passive_sentinel_adapter()` |
| `src-tauri/src/pipeline/commands.rs` | persist_attributed_batch + bridge_task wiring in start_watch | VERIFIED | Forwarder fan-out: broadcast → persist → Channel send (persistence never blocks delivery) |
| `src/stores/repoStore.ts` | Zustand store with resolveInitialRepo/changeRepo/togglePause | VERIFIED | 8 Vitest cases pass |
| `src/providers/RepoSessionProvider.tsx` | Mounts usePipelineChannel + installRadarPipelineBridge | VERIFIED | useRef gate prevents StrictMode double-resolve; cleanup unregisters watch and unsubscribes bridge |
| `src/components/layout/AppShell.tsx` | Wraps Outlet in RepoSessionProvider | VERIFIED | Provider above `<Outlet/>` → Channel persists across navigation |
| `src/components/repo/*.tsx` | RepoStatusChip, PauseMonitoringToggle, ChangeRepoButton | VERIFIED | All three present, wired to `repoStore` + `pipelineStore`; integrated in `TopBar.tsx:24-26` |
| `src/stores/radarStore.ts` | installRadarPipelineBridge with debounce | VERIFIED | 500ms settle window; 14 radar tests pass |
| `src-tauri/tests/end_to_end_smoke.rs` | e2e chain bridge → reconcile → forwarder persist | VERIFIED | `cargo test --test end_to_end_smoke -- --ignored` passes |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| AppShell | RepoSessionProvider | JSX wrap above Outlet | WIRED | `AppShell.tsx:11,24` |
| RepoSessionProvider | pipeline Channel | usePipelineChannel().register(activeRepo) | WIRED | Gated on `[activeRepo, isPaused]` |
| RepoSessionProvider | radarStore | installRadarPipelineBridge() in useEffect | WIRED | Cleanup unsubscribes |
| repoStore | Tauri commands | invoke('detect_git_root' / 'persist_last_repo' / 'get_last_repo') | WIRED | Chain: CWD → persisted → picker |
| start_watch | passive_bridge | spawn_passive_bridge(registry, snapshot, 2000ms) | WIRED | `commands.rs:112`; abort in Drop |
| Forwarder loop | persist_attributed_batch | called between broadcast fan-out and Channel send | WIRED | `commands.rs:144` |
| persist_attributed_batch | DB session row | ensure_open_session → record_session_file_internal | WIRED | Skips unattributed/ambiguous/unmatched |
| Self-register handler | registry reconcile | remove_agent(PASSIVE-{pid}) before KAGENT upsert | WIRED | `self_register.rs:149` + ensure_open_session `:160` |
| pipelineStore.events | radarStore.fetchTreeIndex | subscribe + 500ms debounce | WIRED | Verified by `unsubscribe_stops_further_fetches` test |
| TopBar | repo cluster components | right-aligned ml-auto gap-2 | WIRED | `TopBar.tsx:24-26` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| RepoStatusChip | `activeRepo`, `isPaused`, `isWatching` | repoStore + pipelineStore (live Zustand) | Yes | FLOWING |
| Radar treemap | tree index | `fetchTreeIndex` → `get_tree_index` Tauri command driven by real `notify` events | Yes | FLOWING |
| Tower Control agent list | AgentRegistry (PASSIVE + KAGENT) | bridge_tick populates from ProcessSnapshot; self-register adds KAGENT | Yes | FLOWING |
| session_files rows | forwarder Attribution::Pid events | real `notify` file events, only `Pid(p)` persisted | Yes | FLOWING |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| FMON-01 | 06-01, 06-02, 06-05 | Repository detection and watch activation from UI | SATISFIED | repo_session commands + repoStore + RepoSessionProvider + TopBar controls |
| FMON-02 | 06-03, 06-04 | Passive agent detection via ProcessSnapshot bridge | SATISFIED | passive_bridge module + find_agent_by_pid/reap_passive_agents |
| FMON-03 | 06-05 | Live radar tree updates | SATISFIED | installRadarPipelineBridge (debounced 500ms) |
| FMON-04 | 06-02, 06-05 | Worktree awareness | SATISFIED (partial, human) | pipelineStore.worktrees list populated by start_watch; multi-worktree layout requires manual verification (Manual Scenario 7) |
| AGNT-03 | 06-03, 06-04 | PASSIVE/KAGENT reconciliation on self-register | SATISFIED | self_register.rs PASSIVE removal + KAGENT upsert |
| HIST-01 | 06-01, 06-03, 06-04 | Session lifecycle + session_files population | SATISFIED | ensure_open_session/close_session/record_session_file_internal + forwarder persist |

No orphaned requirements found — all 6 IDs in REQUIREMENTS.md are claimed by at least one plan.

### User Decision Verification (D-01 → D-09)

| Decision | Status | Evidence |
|----------|--------|----------|
| D-01 Auto-detect git repo from CWD; picker fallback | IMPLEMENTED | `repoStore.resolveInitialRepo` CWD → detect_git_root; openDialog fallback |
| D-02 Persist last-opened repo | IMPLEMENTED | `persist_last_repo` + `get_last_repo` on app_settings table |
| D-03 Change-repo option | IMPLEMENTED | `ChangeRepoButton` component in TopBar; `repoStore.changeRepo` stops watch and restarts |
| D-04 Auto-start watcher with pause/resume | IMPLEMENTED | `PauseMonitoringToggle`; `repoStore.isPaused` gates register/unregister effect |
| D-05 Provider mount point (Claude's discretion) | IMPLEMENTED | RepoSessionProvider placed above `<Outlet/>` in AppShell — Channel persists across navigation |
| D-06 Passive PIDs appear as "unidentified" (not auto-named) | IMPLEMENTED | `passive_sentinel_adapter()` with never-matching pattern; entries keyed `PASSIVE-{pid}` with agent_type "unknown" |
| D-07 Merge PASSIVE into KAGENT on self-register | IMPLEMENTED | `self_register.rs:149` removes PASSIVE-{pid} before KAGENT upsert; test `removes_prior_passive_on_kagent_register` enforces |
| D-08 Event-driven radar refresh (no polling) | IMPLEMENTED | `installRadarPipelineBridge` uses Zustand `subscribe()` on pipelineStore.events; debounced 500ms |
| D-09 Backend-driven session_files (no frontend IPC) | IMPLEMENTED | `persist_attributed_batch` runs inside the Rust forwarder loop between broadcast and Channel send |

All 9 user decisions reflected in code.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Frontend suite (Phase 6 scope) | `npm run test -- --run src/stores/__tests__/repoStore.test.ts src/stores/__tests__/radarStore.test.ts src/providers/__tests__/` | 27/27 pass | PASS (per prompt test_evidence) |
| Rust suite (lib) | `cd src-tauri && cargo test --lib` | 131/133 pass; 2 pre-existing conflict::engine failures documented in deferred-items.md | PASS (no Phase 6 regressions) |
| E2E smoke | `cd src-tauri && cargo test --test end_to_end_smoke -- --ignored` | 1/1 pass (end_to_end_pipeline_activation) | PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/stores/conflictStore.ts, src/views/CommsHub/InlineDiff.tsx, src/views/Radar/* | — | 15 pre-existing TypeScript errors blocking `npm run build` | Info | Pre-existing at base commit 4d8adc3; NOT Phase 6 work. Logged in `deferred-items.md` for gap-closure plan. |
| src-tauri conflict::engine::tests | — | 2 pre-existing test failures (test_conflict_detected_different_pids_within_window, test_custom_window_duration) | Info | Pre-existing at Wave 2 base commit fff9d23; unrelated to Phase 6 pipeline activation. |

No blocker anti-patterns. No new stubs introduced by this phase. All Wave 0 `TODO(plan-NN)` markers resolved in Waves 1-4 per summaries.

### Human Verification Required

Seven manual scenarios listed in `06-VALIDATION.md` (Manual-Only Verifications table) require interactive desktop testing with `npm run tauri dev`:

1. Native folder picker when CWD is non-git (FMON-01)
2. Persisted repo auto-open across launches (FMON-01)
3. Change-repo action switches watch (FMON-01)
4. Pause/resume toggles event flow (FMON-01)
5. Radar treemap live updates (FMON-01, FMON-03)
6. Passive → self-register merge with a real allowlisted process (AGNT-03)
7. Multi-worktree detection (FMON-04)

Automated verification has exhausted what CI can prove. The pipeline is wired end-to-end, unit + integration tests are green, and the e2e smoke exercises the bridge → reconcile → forwarder persist chain against a real tempdir git repo. The remaining scenarios are visual/interactive and are the intended acceptance surface for the user.

### Gaps Summary

No blocking gaps found. The phase goal — "All cross-phase integration points are connected — pipeline activates from UI, passive agent detection works, and session file tracking populates data" — is programmatically satisfied:

- **Pipeline activates from UI:** AppShell mounts RepoSessionProvider → resolveInitialRepo → usePipelineChannel.register → start_watch
- **Passive agent detection works:** start_watch spawns passive_bridge with 2s tick; bridge reaps stale PIDs then upserts PASSIVE-{pid}; self-register reconciles PASSIVE → KAGENT
- **Session file tracking populates:** forwarder calls persist_attributed_batch for each Attribution::Pid event → ensure_open_session → record_session_file_internal

Two pre-existing failure classes (15 TS errors in unrelated files; 2 conflict::engine test failures) are documented in `deferred-items.md` as out-of-scope for Phase 6 and awaiting a dedicated gap-closure plan. These were present at the phase's base commits and are not regressions introduced by this phase.

Status is `human_needed` (not `passed`) because per the verification decision tree, the presence of human verification items in Step 8 takes priority over a clean automated score.

---

*Verified: 2026-04-11*
*Verifier: Claude (gsd-verifier)*
