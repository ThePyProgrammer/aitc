---
phase: 07
plan: 05
subsystem: radar-visualization
tags: [comet-trails, agent-dots, drag-to-pin, canvas-render-loop, pipeline-subscription]
requirements: [VIZN-02]
dependency-graph:
  requires:
    - "src/stores/radarStore.ts activeTrails slot (Plan 03)"
    - "src/hooks/useGraphLayout.ts rewarm + quadtreeRef (Plan 04)"
    - "src/views/Radar/GraphRenderer.ts drawSelectedNode (Plan 04)"
    - "src/stores/pipelineStore.ts events stream (Phase 2)"
    - "src/stores/agentStore.ts agents list for PID→agentId mapping (Phase 3)"
  provides:
    - "src/views/Radar/CometTrail.ts: pure-function trail lifecycle + Canvas renderers"
    - "radarStore.pushTrail / pruneTrails actions (FIFO-capped)"
    - "RadarCanvas comet + dot + drag-to-pin integration"
  affects:
    - "RadarCanvas render loop (z-order steps 9-11 now populated)"
    - "radarStore.activeTrails (mutated by pipeline subscription)"
    - "Plan 06 will build conflict pulses + minimap on top of this surface"
tech-stack:
  added:
    - "d3-polygon@3, d3-force@3, d3-quadtree@3 + @types/* (Rule 3 deviation — pre-existing Plan 04 blocker)"
  patterns:
    - "Pure math in CometTrail.ts; side-effectful render functions write only to the passed ctx"
    - "Ref-driven per-agent state (lastAgentFileRef, agentDotsRef) + version tick so rAF loop sees updates without per-event React re-renders"
    - "Canvas pan gated on dragStateRef so native drag-pan and synthetic node-drag don't race"
key-files:
  created:
    - "src/views/Radar/CometTrail.ts"
    - ".planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-05-SUMMARY.md"
  modified:
    - "src/stores/radarStore.ts (added pushTrail + pruneTrails)"
    - "src/views/Radar/RadarCanvas.tsx (pipeline subscription, dot/trail render, drag-to-pin)"
    - "src/views/Radar/__tests__/RadarCanvas.test.tsx (+4 Plan 05 tests, Plan 05 mocks)"
decisions:
  - "D-14: head travel = 400ms ease-out-cubic (1 - (1-t)^3), clamped t"
  - "D-15: per-agent color via getAgentColor(agentId) — no color param plumbed through draw functions"
  - "D-16: opacity curve implemented as a branch (100% for <2000ms, linear fade for 2000-10000ms, 0 at ≥10000ms); trailOpacity(10_000) returns exact 0 (expired boundary)"
  - "D-17: agent dot snaps to most-recent path at Date.now(); pulse rings suppress when lastEventTs > 30s old; center dot always drawn so idle agents stay visible"
  - "D-18: FIFO cap implemented both in cullExpiredTrails (for prune sweeps) and in pushTrail (for immediate eviction on push-past-cap)"
  - "Used Date.now() as the shared clock between trail.startTs and the draw-loop `now`; performance.now() deliberately avoided to prevent epoch drift"
  - "Dedup pipeline events by timestampMs + lastProcessedTsRef to survive React.StrictMode double-invoke without double-spawning trails"
metrics:
  duration: "17 minutes (RED landed at 14:15, GREEN at 15:03, wire-up complete at 15:09)"
  completed: "2026-04-15"
  tasks-completed: 2
  tests-added: 41
---

# Phase 7 Plan 05: Agent Dynamics (Comet Trails, Dots, Drag-to-Pin) Summary

One-liner: Agents now leave colored comet trails (400ms ease-out head + 10s fading tail, 10-per-agent FIFO cap) across the graph from Plan 04, with pulsing current-position dots and drag-to-pin / shift+click-to-unpin interaction, all driven from the existing `pipelineStore` event stream.

## What was built

### `src/views/Radar/CometTrail.ts` (new, 277 lines)

Seven exports — five pure functions and two Canvas renderers:

| Export | Purpose | Key timings / values |
|---|---|---|
| `easeOutCubic(t)` | D-14 easing `1-(1-t)^3` | clamped [0,1]; 0.875 at t=0.5 |
| `interpolateHead(trail, now, from, to)` | Head world-position | `(now - startTs) / 400ms` through easing |
| `trailOpacity(ageMs)` | D-16 opacity curve | 1.0 for <2000ms, linear 1→0 over 2000-10000ms, 0 at ≥10000ms |
| `sampleTailSegments(trail, now, from, to, 6)` | 6-point gradient polyline samples with per-segment `{x, y, alpha, width}`; returns `[]` when expired | width tapers 0.5 (tail) → 2.0 (head); alpha scales 0 → baseAlpha |
| `cullExpiredTrails(trails, now, 10, 10_000)` | Age-cull + per-agent FIFO cap | sorted by startTs ascending |
| `drawCometTrails(ctx, trails, positions, now, zoom)` | UI-SPEC z-order steps 9-10 | gradient-stroked tail polyline + radial-gradient-glowed head while `ageMs ≤ 400` |
| `drawAgentDots(ctx, dots, now, zoom)` | UI-SPEC z-order step 11 | center dot + 2 pulse rings on a 2s cycle (ring 2 delayed 0.5s); suppresses rings when idle >30s |

Constants are exported and treated as the single source of truth (verified by `CometTrail.test.ts`): `COMET_TRAVEL_MS=400`, `TRAIL_FULL_OPACITY_MS=2000`, `TRAIL_FADE_DURATION_MS=8000`, `TRAIL_TOTAL_LIFESPAN_MS=10_000`, `MAX_TRAILS_PER_AGENT=10`, `COMET_HEAD_RADIUS=4`, `COMET_HEAD_GLOW_RADIUS=7`, `COMET_TAIL_WIDTH_HEAD=2`, `COMET_TAIL_WIDTH_OLDEST=0.5`, `COMET_TAIL_SEGMENTS=6`, `AGENT_DOT_RADIUS=6`, `AGENT_PULSE_RING_1_MAX=12`, `AGENT_PULSE_RING_2_MAX=20`, `AGENT_PULSE_CYCLE_MS=2000`, `AGENT_PULSE_RING_2_DELAY_MS=500`, `AGENT_IDLE_MS=30_000`.

### `radarStore` extension

Added two actions matching the D-18 semantics:

- `pushTrail(trail)` — Appends to `activeTrails`. When the incoming agent is already at `MAX_TRAILS_PER_AGENT`, evicts that agent's oldest trail by `startTs` (other agents untouched — cap is strictly per-agent).
- `pruneTrails(now = Date.now())` — Calls `cullExpiredTrails(state.activeTrails, now, 10, 10_000)`; runs each rAF frame in RadarCanvas.

Added `import { cullExpiredTrails, MAX_TRAILS_PER_AGENT, TRAIL_TOTAL_LIFESPAN_MS } from '../views/Radar/CometTrail'`.

### `RadarCanvas` extension

New behavior on top of Plan 04's static graph:

1. **Pipeline subscription** — `useEffect` over `pipelineEvents + graphNodes + pidToAgentId`. Iterates events oldest→newest, skips any whose `timestampMs ≤ lastProcessedTsRef` (StrictMode dedup), skips non-PID attributions, maps `Attribution.pid → agentId` via `useAgentStore.agents`. For each accepted event:
   - Updates `agentDotsRef.current.set(agentId, {x, y, lastEventTs})` when the touched path has a settled position.
   - Calls `pushTrail` when the agent's previous path differs from the new path.
   - Records the new path in `lastAgentFileRef`.
   - Bumps `agentFileVersion` so dependent `useMemo`s (selectedNode) re-evaluate.

2. **Render loop additions** (inside the rAF body, after `drawSelectedNode` and before the plan-06 conflict step):
   ```
   const now = Date.now();
   useRadarStore.getState().pruneTrails(now);
   drawCometTrails(ctx, s.activeTrails, s.positions, now, vp.zoom);
   drawAgentDots(ctx, Array.from(agentDotsRef.current.entries()).map(...), now, vp.zoom);
   ```
   A second `useEffect` keeps `dirtyRef.current = true` while `activeTrails.length > 0`, so heads and fades animate without state changes. This cancels on empty trails to stop draining frames when the airspace is idle.

3. **`selectedNode`** (closes the Plan 04 loop) — Resolves to `graphNodes.find(n => n.id === lastAgentFileRef.current.get(selectedAgentId))`. Dependency list includes `agentFileVersion` so the lookup refreshes when the ref map is mutated.

4. **Drag-to-pin** — React synthetic handlers `onMouseDown / onMouseMove / onMouseUp` layered on top of `useCanvasZoomPan`:
   - `mousedown` on a node hit (no Shift) → `setDragState({ nodeId })`.
   - `mousedown + Shift` on a pinned node → `unpinNode(id) + rewarm(0.2)`.
   - `mousemove` while `dragState` is active → live-update the node's `x/y` in the store via `useRadarStore.setState`.
   - `mouseup` → `pinNode(id, world.x, world.y) + rewarm(0.3) + setDragState(null)`.
   - The native `useCanvasZoomPan` handlers are gated via `gatedMouseDown` / `gatedMouseMove` — if a quadtree hit exists the native pan is skipped, so click-drag on a node never also pans the viewport.

## Test coverage

| File | Tests | Behavior exercised |
|---|---|---|
| `src/views/Radar/__tests__/CometTrail.test.ts` | 22 | Constants, easeOutCubic (edge/clamp), interpolateHead (t=0/200/400/overshoot), sampleTailSegments (length, alpha ramp, expired → empty, width taper), trailOpacity (1000/2000/6000/10000/12000/-100ms), cullExpiredTrails (age cull, 12→10 FIFO, per-agent independence, age+cap combined) |
| `src/stores/__tests__/radarStore.test.ts` | +3 (total 19) | pushTrail appends, FIFO evicts oldest same-agent at cap=10, cross-agent independence; pruneTrails drops >10s |
| `src/views/Radar/__tests__/RadarCanvas.test.tsx` | +4 (total 8) | Trail spawn on consecutive different-path events; dot snaps to most-recent path (arc at world (100,0)); drag-to-pin (mousedown → mousemove → mouseup → pinNode + rewarm(0.3)); Shift+mousedown → unpinNode + rewarm(0.2) |

Total: 41 new passing tests covering the D-14..D-18 decisions end to end.

## Verification

- `npx vitest --run src/views/Radar/__tests__/CometTrail.test.ts src/stores/__tests__/radarStore.test.ts` — 41/41 pass.
- `npx vitest --run src/views/Radar/__tests__/RadarCanvas.test.tsx` — 8/8 pass.
- `npx vitest --run src/` — 196/208 pass; 1 pre-existing failure in `agentStore.test.ts` (unrelated: `launch_agent` assertion vs pre-existing `options: null` field added in commit `d561b76`); 7 skipped + 4 todo carried from earlier plans. **No regressions from Plan 05.**
- All acceptance-criteria greps pass (`drawCometTrails`, `drawAgentDots`, `pushTrail`, `pruneTrails`, `lastAgentFileRef`, `agentDotsRef`, `pinNode`/`unpinNode`, `rewarm`, `shiftKey` all present in `RadarCanvas.tsx`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Installed missing d3-* dependencies**
- **Found during:** Task 2 verification (running `RadarCanvas.test.tsx`).
- **Issue:** Vite failed with `Failed to resolve import "d3-polygon" from "src/views/Radar/GraphRenderer.ts"`. Reproduced on a clean stash → pre-existing from Plan 04's GraphRenderer rewrite (commit `1e53c67`). The worktree had no `node_modules/`, and neither the worktree nor the main repo had `d3-polygon`/`d3-force`/`d3-quadtree` installed despite all three being declared in `package.json`.
- **Fix:** `npm install --no-save d3-polygon@3 d3-force@3 d3-quadtree@3 @types/d3-polygon @types/d3-force @types/d3-quadtree`.
- **Files modified:** node_modules only (not committed).
- **Rationale:** Blocking verification (Rule 3). Declared-but-not-installed is not a Plan 05 regression — it is a pre-existing env-setup gap left by Plan 04 that would have blocked anyone running the suite.

**2. [Rule 2 - Critical functionality] Added `agentFileVersion` tick state**
- **Found during:** Task 2 wire-up.
- **Issue:** The plan's recommended `selectedNode = useMemo(() => { ... lastAgentFileRef.current.get(selectedAgentId) ... }, [selectedAgentId, graphNodes, events])` would re-evaluate on every pipelineEvents array change — but the more subtle issue is that React does not observe ref mutations, so a memo with `lastAgentFileRef.current` in its body without any reactive trigger would not refresh when the ref's map is mutated. Having `events` in the deps is a partial workaround but couples the selectedNode lookup to the full events array even when nothing relevant to this agent changed.
- **Fix:** Added `const [agentFileVersion, setAgentFileVersion] = useState(0)` and `setAgentFileVersion(v => v + 1)` inside the pipeline subscription effect exactly when `lastAgentFileRef` or `agentDotsRef` is mutated; the `selectedNode` useMemo depends on `agentFileVersion` instead of `events`.
- **Rationale:** Correctness — without this the glow would be stuck on the first touched file, not the most-recent.

**3. [Rule 2 - Critical functionality] StrictMode-safe event dedup**
- **Found during:** Task 2 wire-up.
- **Issue:** The plan's wire-up effect iterates `events` and spawns trails — but React 19 StrictMode double-invokes effects on mount, which would double-spawn the initial event's trail.
- **Fix:** Added `lastProcessedTsRef: useRef<number>(0)` that tracks the highest event `timestampMs` we've processed. Events with `ev.timestampMs <= lastProcessedTsRef.current` are skipped.
- **Rationale:** Correctness — without this we'd see duplicate trails in dev and potentially also in prod if the events array is ever reassigned to an identical reference by mistake.

**4. [Rule 2 - Critical functionality] Gated pan handler on drag state**
- **Found during:** Task 2 wire-up — noticing the plan's drag handlers run alongside the `useCanvasZoomPan` native handlers.
- **Issue:** With both active, a click-drag on a node would both drag the node AND pan the viewport, yielding nonsense world coordinates on mouseup.
- **Fix:** Wrapped the native `onMouseDown` in a `gatedMouseDown` that runs a quadtree hit first and skips the native handler on node hits; wrapped `onMouseMove` in a `gatedMouseMove` that skips during drag.
- **Rationale:** The plan didn't specify this gating but UI-SPEC §Interaction implicitly requires it (drag-to-pin must not also pan).

**5. [Rule 2 - Correctness] Keep-dirty loop while trails animate**
- **Found during:** Task 2 wire-up.
- **Issue:** The plan's render loop writes `dirtyRef.current = false` at the end of each frame; without a refresher the loop idles. But comet heads travel for 400ms, tails fade for 10s, and agent dots pulse continuously — all are time-driven, not state-driven.
- **Fix:** Added a second `useEffect` gated on `activeTrails.length > 0` that rAFs `dirtyRef.current = true` each tick, cancelled when trails drain.
- **Rationale:** Otherwise animations would freeze after the first frame.

### Auth gates

None.

## Threat Flags

None — pure frontend animation + interaction. No new network endpoints, auth paths, file access patterns, or schema changes.

## Known Stubs

None in this plan's surface. The Plan 04 placeholder `selectedNode = undefined` is now resolved via `lastAgentFileRef`. The Plan 06 z-order steps 12-13 (conflict pulses, pinned badges) remain intentionally unimplemented and are tracked by Plan 06.

## Self-Check: PASSED

Files created:
- FOUND: /home/prannayag/pragnition/htx/aitc/.claude/worktrees/agent-a58263ec/src/views/Radar/CometTrail.ts
- FOUND: /home/prannayag/pragnition/htx/aitc/.claude/worktrees/agent-a58263ec/.planning/phases/07-replace-current-blocked-codebase-map-with-a-graph-based-code/07-05-SUMMARY.md

Files modified:
- FOUND: src/stores/radarStore.ts (pushTrail + pruneTrails)
- FOUND: src/views/Radar/RadarCanvas.tsx (drawCometTrails/drawAgentDots wiring + drag-to-pin)
- FOUND: src/views/Radar/__tests__/RadarCanvas.test.tsx (+4 Plan 05 tests)

Commits:
- FOUND: eb746ed (CometTrail + radarStore actions)
- FOUND: c5eefab (RadarCanvas wire-up)
- FOUND: fb5d5a9 (RED — pre-existing, not created in this run)

Tests:
- 22 CometTrail + 19 radarStore + 8 RadarCanvas = 49 pass in Plan 05 scope.
- Full `src/` suite: 196 pass / 1 pre-existing failure / 7 skipped / 4 todo (no regressions).
