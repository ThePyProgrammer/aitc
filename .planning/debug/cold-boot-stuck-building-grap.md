---
status: fix_applied_awaiting_natural_observation
trigger: "Cold-boot: app stuck on 'BUILDING GRAPH' loader indefinitely; pause+resume monitoring (app UI) triggers fetchGraph and unsticks"
created: 2026-04-21T16:05:00Z
updated: 2026-04-21T16:28:00Z
root_cause_candidate: "H1b — StrictMode double-invoke leaves useGraphLayout's lastIdsRef populated from pass-1, so pass-2's fresh worker fails both isFirst and rewarm checks and never receives init. Confirmed by code review; not empirically verified (bug is one-off, no DevTools capture)."
fix_commit: "03197f3 — fix(11.1): reset lastIdsRef in useGraphLayout worker cleanup"
fix_strategy: "Option A — defensive ref reset in worker-lifecycle cleanup. No accompanying regression test: jsdom+renderHook does not double-invoke effects under <StrictMode>, so the buggy state is not reproducible in unit tests. Fix guarded by inline comment + placement discipline."
next_observation: "Re-open and escalate to H1a (late-arriving M1 stomps M2) or H1c (backend built empty initial_tree) if the BUILDING GRAPH hang recurs on a future cold boot."
---

## Current Focus

hypothesis: |
  **Primary hypothesis (H1): Silent-empty cold-boot race — lost-wakeup pattern.**

  On cold boot there is a single backend call (`get_tree_index`) that
  returns `Ok(vec![])` when no watch is active (`src-tauri/src/pipeline/commands.rs:310`
  and `:374`), and the frontend `fetchGraph` swallows all errors
  (`src/stores/radarStore.ts:246-248`). Two mount-time `fetchGraph()` calls
  exist:

    - **M1**: `RadarView` mount effect at `src/views/RadarView.tsx:40`.
      Fires at React mount (t≈0). At this moment backend has NO active
      watch — `start_watch` has not been called yet because
      `RepoSessionProvider.resolveInitialRepo()` takes ~10–50ms for three
      sequential IPC round-trips before it even calls `register()`.
      M1 resolves with `([], [])`, writes `{graphNodes: [], graphEdges: [],
      settledAt: null, ...}` into the store.

    - **M2**: `RadarCanvas` mount/deps effect at `src/views/Radar/RadarCanvas.tsx:285-287`:
      `useEffect(() => { useRadarStore.getState().fetchGraph(); }, [isWatching])`.
      This is the deliberate retry — RadarCanvas only mounts once
      `showEmptyState = graphNodes.length === 0 && !isWatching` flips
      false, which happens when `setWatching(true)` fires in
      `usePipelineChannel.ts:43` (AFTER `start_watch` has populated
      `ActiveWatch.tree_index`).

  The intended recovery is M2 reading populated data and triggering
  `useGraphLayout`'s topology handler → init → worker settle → loader clear.

  **Why it can hang anyway:** the M2 retry is gated on RadarCanvas
  mounting. RadarCanvas mounts only when `isWatching` flips true. If at
  that transition, BOTH of the following hold:

    (a) M1 has already completed and written `graphNodes: []` (it will
        have, because M1 fires long before `start_watch` returns).
    (b) At the moment M2 reaches the Rust handler, `start_watch` is
        contending the `state.inner` mutex in
        `src-tauri/src/pipeline/commands.rs:86`. M2's `get_tree_index`
        awaits the same mutex. When M2 finally acquires it, backend
        IS populated → M2 returns non-empty.

  So in the *normal* race, M2 succeeds. The hang requires a subtler
  failure mode. The three plausible mechanisms, ranked:

    H1a (most likely, 60%): **M2 called before `start_watch` Mutex is
        taken, not during its hold.** If `start_watch` is slow to reach
        the Rust runtime (queued behind `resolveInitialRepo`'s three
        IPCs), the JS ordering can be:
          t=0    M1 invoke('get_tree_index') → Rust runs → empty
          t=5    M1 invoke('get_dependency_graph') → Rust runs → empty
          t=10   M1 resolves → store.set({graphNodes:[], settledAt:null})
          t=20   setWatching(true) only AFTER start_watch completes later
        But this doesn't explain the hang because setWatching is the
        thing that mounts RadarCanvas and fires M2. Unless M2 also hits
        the backend at a moment when `active = None` — which would
        only happen if setWatching(true) was fired spuriously without
        start_watch actually being called (audit `usePipelineChannel.register`:
        it sets `setWatching(true)` ONLY after `invoke('start_watch')`
        resolves; line 42-43 makes this atomic). So H1a is actually NOT
        possible in the current code. Downgrade confidence to 10%.

    H1b (likely, 50%): **M2's fetchGraph DOES see populated data, but
        useGraphLayout's topology handler short-circuits due to
        StrictMode double-mount corrupting `lastIdsRef`.** In React 18
        dev StrictMode, hooks mount→unmount→mount. `lastIdsRef` is a
        `useRef` — it persists across the double-invoke. If the first
        mount's subscribe fires the handler with populated nodes (e.g.
        because M2 resolved between pass-1-mount and pass-1-cleanup),
        it posts init to W1 AND sets `lastIdsRef.current = populatedIds`.
        Pass-1-cleanup terminates W1. Pass-2 mount creates W2 but
        `lastIdsRef.current.size > 0` already → `isFirst = false` and
        `rewarm = shouldRewarm(same, same) = false` → handler returns
        early. **W2 never gets init. Worker silent forever.**
        (`src/hooks/useGraphLayout.ts:280-281`)

        This precisely matches: first cold boot hangs; pause→resume
        unmounts+remounts RadarCanvas with a *fresh* useGraphLayout
        instance (fresh lastIdsRef) so the next fetchGraph's handler
        takes the isFirst branch.

    H1c (possible, 20%): **The backend `initial_tree` was empty for this
        specific repo state.** `spawn_watcher` unconditionally returns
        `Ok(WatcherOutput { initial_tree, .. })` even if `build_tree_index`
        produces zero entries. A filesystem hiccup, permission glitch,
        or unusual repo state could yield empty. Less likely given the
        repo renders fine after pause+resume.

  **H1b is the unified root cause candidate**: the M2 retry exists, but
  it is structurally defeated by `useGraphLayout`'s ref-based
  first-init guard when any earlier store write populated `lastIdsRef`
  during StrictMode's pre-cleanup interval.

test: |
  **Instrumentation plan for next cold-boot repro (paste in DevTools
  console BEFORE launching `npm run tauri dev`):**

  ```js
  // 1. Attach a live store observer BEFORE the app boots (run in a
  //    persistent DevTools tab, or inject into AppShell for one dev
  //    cycle). If injecting is too invasive, poll after the hang:
  const r = window.__useRadarStore__ = useRadarStore.getState();
  console.log('radar @ hang:', {
    nodes: r.graphNodes.length,
    edges: r.graphEdges.length,
    settledAt: r.settledAt,
  });

  // 2. Force a replay call to see if backend returns data RIGHT NOW
  //    (rules in/out H1c — empty backend).
  Promise.all([
    window.__TAURI__.core.invoke('get_tree_index'),
    window.__TAURI__.core.invoke('get_dependency_graph'),
  ]).then(([t, d]) => console.log('BACKEND @ hang:', {
    tree: t.length, edges: d.length,
  }));

  // 3. If (2) shows non-zero but store.graphNodes is 0, call fetchGraph
  //    directly and observe whether the worker settles:
  await useRadarStore.getState().fetchGraph();
  setTimeout(() => console.log('after fetchGraph:', {
    nodes: useRadarStore.getState().graphNodes.length,
    settledAt: useRadarStore.getState().settledAt,
  }), 2000);
  ```

  **Reading the instrumentation:**

    - `nodes=0, settledAt=null, BACKEND.tree=0` → H1c (backend never
      built tree). Dig into spawn_watcher / build_tree_index logs.
    - `nodes=0, settledAt=null, BACKEND.tree>0` → the store is stuck
      with stale empty arrays while backend has data.  M2 either
      never fired or its write was overwritten. Check if a late-arriving
      M1 promise resolved after M2 and stomped populated→empty.
      (Possible if M1 was queued behind the mutex longer than M2.)
    - `nodes>0, settledAt=null, BACKEND.tree>0` → **H1b confirmed.**
      Backend is fine, store has data, but worker never settled.
      Topology handler short-circuited.
    - After manual fetchGraph, if settledAt flips non-null → worker
      was alive and just needed a trigger; confirms topology-handler
      `isFirst` guard is the blocker.
    - After manual fetchGraph, if settledAt stays null AND graphNodes
      are populated → worker is dead or handler is dead. Check for
      a `[graphSim.worker]` error earlier in the log.

expecting: |
  Most likely evidence pattern: `nodes > 0, settledAt=null, backend>0`
  → confirms H1b (lastIdsRef corrupted across StrictMode remount, or
  an M1-after-M2 late store write set lastIdsRef before the "real" ids
  change arrived).

next_action: |
  Return this report to the orchestrator. Do NOT apply a fix this round
  without a live repro — the failure is intermittent and a defensive
  patch risks masking a simpler underlying bug.

  **Fix options (for future application, ranked by confidence + safety):**

    Option A (safest, addresses H1b directly): **Reset `lastIdsRef` in
    the worker-lifecycle effect cleanup.** In `src/hooks/useGraphLayout.ts:251-263`,
    before `worker.terminate()`, add `lastIdsRef.current = new Set();`.
    This guarantees that any subsequent topology-handler invocation on
    a fresh worker takes the `isFirst` branch. Small, local, no
    behavioral change outside the corrupted-ref edge case. **Does NOT
    modify `src/workers/` (Phase 11 D-18 honored).**

    Option B (defensive, addresses H1a/H1c): **Gate mount-time
    fetchGraph on `isWatching=true`.** Remove the unconditional
    `fetchGraph()` from `RadarView.tsx:40`. Keep the RadarCanvas
    `useEffect(() => fetchGraph(), [isWatching])` as the only
    mount-time caller, so no fetchGraph is issued while backend lacks
    an active watch. Eliminates the empty-write-then-overwrite class
    entirely. Risk: if a render path mounts RadarCanvas while
    isWatching=false for another reason (unlikely per current code),
    the retry is lost.

    Option C (instrumentation + retry, belt-and-suspenders): **Make
    fetchGraph return a discriminated result and retry with backoff on
    empty.** Keep the silent-swallow for errors, but when both
    `tree_index.length === 0` AND `edges.length === 0` AND we have no
    previous graphNodes, schedule a retry in 500ms up to 3 attempts.
    Riskier — can mask a legitimate empty repo.

    Option D (deepest, rearchitect): **Add a `worker-ready` handshake.**
    Worker sends `{type: 'ready'}` on module load; main-side waits for
    ready before posting init. Pairs with Option A to be doubly safe.
    Heavier change; defer until H1b is confirmed.

  **Recommendation: apply Option A only, after a live repro confirms
  `nodes>0, settledAt=null` at hang time.** It is a 2-line defensive
  fix with obvious correctness and no impact on the happy path. If the
  live repro shows backend emptiness (H1c) or late M1 stomp, widen to
  Option B.

## Symptoms

expected: |
  Cold boot shows BUILDING GRAPH briefly (<1s on a cached repo, a few
  seconds on a fresh clone while the dependency graph builds), then the
  loader clears and the force-directed graph renders. Subsequent boots
  are consistently fast.

actual: |
  On first cold boot today, BUILDING GRAPH banner stayed indefinitely.
  No auto-clear observed. User clicked the in-app pause → resume
  monitoring buttons; the pipeline-event burst from that action triggered
  fetchGraph (via installRadarPipelineBridge debounce), the worker
  settled, the loader cleared, the graph rendered. First time seen — one
  data point only.

errors: |
  User didn't have DevTools open at the time. Console errors (if any)
  not captured. Need: user to open DevTools BEFORE the next cold boot
  and capture if this repeats.

reproduction: |
  1. Clean `npm run tauri dev` from scratch (ensure no stale dev-server
     lingering — check `ps aux | grep tauri`).
  2. Open Radar view immediately when app window appears.
  3. Observe: BUILDING GRAPH banner. If it clears within ~5s, this
     repro is negative (one-off on the original sighting).
  4. If stuck: click pause then resume monitoring in the header.
     Loader should clear.
  5. Frequency is unknown — user reports 1 occurrence today out of N
     cold boots.

started: |
  Surfaced today (2026-04-21) during user's manual smoke-test of the
  Phase 11.1 defensive-guard fix. One data point. This bug is NOT caused
  by the Phase 11.1 defensive guards (those only touch setViewport; they
  can't cause fetchGraph or worker-settle to hang).

  Related prior work:
    - Phase 7: introduced fetchGraph (replacing treemap path). Silent-
      swallow catch (`radarStore.ts:246-248`) inherited from fetchTreeIndex.
    - Phase 11: moved force simulation to WebWorker (Float32Array
      transferables). **Introduced `lastIdsRef` isFirst/rewarm guard
      at `useGraphLayout.ts:279-281` — this is the primary suspect for
      H1b: the ref persists across StrictMode double-mount and can
      claim "first init already done" when a new worker has received
      nothing.**
    - 0721102: preserved x/y/fx/fy across fetchGraph re-runs (fixed a
      different stray-file-watcher wipe symptom). Not the cause here.

## Eliminated

- **Phase 11.1 setViewport defensive guards** — these only sanitize
  non-finite viewport values; cannot cause graphNodes or settledAt to
  hang. Confirmed by reading `radarStore.ts:343-355`.

- **Worker never loads (chunk emission failure)** — would produce a
  persistent, deterministic failure on EVERY boot, not a one-off.
  Also would fire `worker.onerror` → console log; user didn't see
  (but DevTools was closed so weak signal).

- **fetchGraph threw exception** — both Tauri commands return
  `Ok(Vec::new())` when no watch active (commands.rs:310, :374). No
  exception path on the cold-boot race. The silent catch at
  radarStore.ts:246 is a latent issue for other scenarios but not
  the trigger here.

- **Pipeline bridge debounce miswired** — if it were, pause→resume
  wouldn't recover it either. The fact that pause→resume DOES recover
  proves the bridge works; the bug is upstream of the bridge.

- **Missing initial pipelineStore event** — a cold-booted quiet repo
  produces no file events until an agent or user touches files. The
  bridge only fires on events. This is WHY the bug manifests — there
  is no safety-net retry after the initial race.

## Evidence

- timestamp: 2026-04-21T16:05:00Z
  kind: user_report
  source: user conversation after Phase 11.1 defensive fix smoke
  finding: |
    "When I first opened up the app, it got stuck on building graph...
    then when I paused and resumed monitoring then the graph opened up."
    Symptom AskUserQuestion clarifications:
      - Visual state: "BUILDING GRAPH" loader banner was the stuck UI
      - Recovery action: in-app pause → resume monitoring buttons
      - Frequency: first time seen today
      - Console: not captured (DevTools closed)
  implication: |
    settledAt never transitioned to non-null on the initial boot path.
    Pause→resume unmounts/remounts RadarCanvas (isWatching flips
    false→true around the toggle), creating a fresh useGraphLayout
    instance with a fresh `lastIdsRef` — which is the differentiator
    on the retry path. This strongly implicates H1b.

- timestamp: 2026-04-21T16:40:00Z
  kind: static_analysis
  source: |
    src-tauri/src/pipeline/commands.rs:275-312 (get_tree_index)
    src-tauri/src/pipeline/commands.rs:323-376 (get_dependency_graph)
    src/stores/radarStore.ts:188-249 (fetchGraph silent-swallow)
    src/views/RadarView.tsx:39-44 (mount fetchGraph M1)
    src/views/Radar/RadarCanvas.tsx:284-287 (isWatching fetchGraph M2)
    src/hooks/usePipelineChannel.ts:34-45 (setWatching(true) ordering)
    src/hooks/useGraphLayout.ts:270-342 (topology handler + lastIdsRef)
    src/providers/RepoSessionProvider.tsx:46-57 (register effect)
  finding: |
    Both backend commands return `Ok(vec![])` when `PipelineState.inner`
    guard is None (no active watch). Frontend `fetchGraph` writes those
    empties into the store as `{graphNodes: [], graphEdges: [],
    settledAt: null, ...}`. The M2 retry in RadarCanvas exists
    specifically to cover this race, but its effectiveness depends on
    `useGraphLayout`'s topology handler treating the new store write
    as "first init" — which it only does when `lastIdsRef.current.size
    === 0`. If any earlier handler invocation populated `lastIdsRef`
    (plausible under StrictMode mount/cleanup/remount), the retry
    posts nothing to the new worker. Pause→resume recovers because it
    unmounts+remounts RadarCanvas, yielding a fresh ref.

  implication: |
    The root cause is a lost-wakeup between the mount-time empty
    fetchGraph and the useGraphLayout worker-init path, crystallized
    at `useGraphLayout.ts:280-281` where `!isFirst && !rewarm`
    short-circuits without distinguishing "same topology, already
    inited" from "new worker, never inited."

## Resolution

(pending — awaiting either user-driven live repro to confirm H1b
 instrumentation readings, OR user decision to apply Option A
 defensively without waiting for repro.)
