---
phase: 07
plan: 04
subsystem: radar-rendering
tags: [radar, canvas2d, d3-polygon, d3-quadtree, graph-renderer, viewport-culling]
requires:
  - useGraphLayout (07-03)
  - graphNodes/graphEdges store slots (07-03)
  - get_dependency_graph Rust command (07-02)
provides:
  - GraphRenderer pure draw functions (drawFolderHulls, drawEdges, drawArrowHeads, drawNodes, drawSelectedNode, heatColor, isInViewport)
  - RadarCanvas graph-mode render loop (UI-SPEC z-order steps 1-7)
  - Performance banners (DEGRADED 5k, OVERLOAD 10k)
  - Viewport culling + progressive detail
affects:
  - src/views/Radar/RadarCanvas.tsx (rewrite)
  - src/views/Radar/RadarMinimap.tsx (migration)
  - src/views/Radar/AgentManifestRow.tsx (migration)
  - src/views/Radar/HeatMapOverlay.ts (deleted)
  - src/hooks/useTreemapLayout.ts (deleted)
  - package.json (squarify uninstalled)
tech-stack:
  added: []
  removed: [squarify]
  patterns:
    - "Pure render functions called from a single rAF loop (keeps render deterministic/testable)"
    - "State-via-ref pattern so rAF loop never re-subscribes on mount"
    - "Viewport culling at the draw-function boundary (no separate quadtree for visibility; the hit-test quadtree is owned by useGraphLayout)"
key-files:
  created:
    - src/views/Radar/GraphRenderer.ts
  modified:
    - src/views/Radar/RadarCanvas.tsx
    - src/views/Radar/RadarMinimap.tsx
    - src/views/Radar/AgentManifestRow.tsx
    - src/stores/radarStore.ts
    - src/stores/__tests__/radarStore.test.ts
    - src/views/Radar/__tests__/RadarCanvas.test.tsx
    - src/views/Radar/__tests__/RadarComponents.test.tsx
    - src/views/Radar/__tests__/GraphRenderer.test.ts
    - package.json
    - package-lock.json
  deleted:
    - src/hooks/useTreemapLayout.ts
    - src/views/Radar/HeatMapOverlay.ts
decisions:
  - "Deleted HeatMapOverlay.ts entirely — heat tint is now inline in drawNodes (D-19); Plan 06 can recreate if a separate overlay is needed for graph-node variants"
  - "Migrated RadarMinimap + AgentManifestRow off useTreemapLayout in this plan (rather than Plan 06) to keep the build green after the hook deletion"
  - "Collapsed chain stops at the immediate parent: 'src/views/Radar' under single-child wrappers produces 'views/Radar' (not 'Radar'), matching commit a8fe89b intent of preserving at least one ancestor segment for context"
  - "Used rec() wrapper for all canvas spy methods + Object.defineProperty getter/setter for style assignments — keeps the test harness framework-agnostic and reusable in Plan 05/06 tests"
  - "selectedNode resolver is a no-op placeholder in Plan 04 (no agent-position tracker yet). drawSelectedNode is only invoked with a defined node, so undefined = no glow = no visual regression. Plan 05 will wire this via the agent-dot tracker"
metrics:
  duration_minutes: 12
  completed_at: "2026-04-15"
  tasks_completed: 2
  files_changed: 12
---

# Phase 07 Plan 04: GraphRenderer + RadarCanvas rewrite summary

Replaced the Phase 4 squarified-treemap radar with a force-directed graph renderer driven by `useGraphLayout` and pure `GraphRenderer` draw functions; deleted `useTreemapLayout`, uninstalled `squarify`, and migrated the minimap and agent manifest row off the deprecated hook.

## Objective achieved

- `src/views/Radar/GraphRenderer.ts` exposes `drawFolderHulls`, `drawEdges`, `drawArrowHeads`, `drawNodes`, `drawSelectedNode`, plus `heatColor`, `isInViewport`, `collapseSingleChildChain`, and `shouldRenderHullAtZoom`. Every UI-SPEC sizing and color token is copied verbatim (node 5px, arrow 5px inset, hull alphas 5%/40%, viewport pad 100px, heat ramp `#1a1919 → #ff7351`).
- `RadarCanvas.tsx` replaces the treemap body with the GraphRenderer call sequence in UI-SPEC z-order steps 1-7 (clear → hulls → edges → arrows → nodes → selected node). HiDPI scaling, `ResizeObserver`, the rAF dirty-flag loop, `useCanvasZoomPan`, the heat-map toggle button, and the zoom indicator are all preserved.
- Viewport culling via `isInViewport` runs at the per-draw-function boundary (D-23 5k/60fps target). Progressive detail tiers are honoured: hulls at depth 0 only below zoom 0.6, depth ≤ 2 below zoom 2, all depths at zoom ≥ 2. Arrow heads culled at zoom < 0.6.
- `GRAPH_OVERLOAD` (error, `role="alert"`, ≥ 10k) and `INFO_DEGRADED` (tertiary, `role="status"`, 5k ≤ N < 10k) banners render with the exact copy and dismissible button from UI-SPEC §Layout §Performance states; dismissals reset when node count falls back below the degraded threshold.
- Hit-testing uses `quadtreeRef.current?.find(x, y, NODE_HIT_RADIUS / zoom)` per RESEARCH §Pattern 4 (the quadtree is built and kept current by `useGraphLayout`).
- `useTreemapLayout.ts` deleted. `squarify` removed from `package.json` and `node_modules`. No `useTreemapLayout`, `TreemapRect`, `squarify`, or `graphNodesToTreeEntries` imports remain in `src/` (only historical comments referencing the removal).

## Tasks & commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 (RED)  | add failing tests for GraphRenderer pure functions | `bebfb16` | `src/views/Radar/__tests__/GraphRenderer.test.ts` |
| 1 (GREEN) | implement GraphRenderer pure render functions | `6c08524` | `src/views/Radar/GraphRenderer.ts` |
| 2 | rewrite RadarCanvas for graph mode + delete useTreemapLayout | `d68f42e` | RadarCanvas.tsx, RadarMinimap.tsx, AgentManifestRow.tsx, radarStore.ts, radarStore.test.ts, RadarCanvas.test.tsx, RadarComponents.test.tsx, package.json, package-lock.json, useTreemapLayout.ts (deleted), HeatMapOverlay.ts (deleted) |

## Verification

- `npm test -- --run src/views/Radar/__tests__/GraphRenderer.test.ts`: **32/32 passing** (heat ramp, viewport cull, progressive detail, single-child collapse, hull fallback vs polygonHull, 1/zoom stroke, arrow inset, hover grow, pinned badge, white outer stroke).
- `npm test -- --run src/views/Radar/__tests__/RadarCanvas.test.tsx`: **4 passing + 1 todo (D-17)**. Covers 100-node render arc count, banner rendering at both thresholds, and selected-node contract.
- Full suite: **166 passed, 11 skipped, 5 todo, 1 failed** — the single failure (`agentStore.test.ts > launchAgent`) is pre-existing and documented in `deferred-items.md`.
- `npm run build`: only pre-existing `src/bindings.ts` TS errors (documented in `deferred-items.md` as unrelated tauri-specta generator output). No new TS errors introduced by this plan.
- Grep audits: `grep -q "drawFolderHulls|drawEdges|drawArrowHeads|drawNodes|drawSelectedNode|heatColor|isInViewport|collapseSingleChildChain" src/views/Radar/GraphRenderer.ts` all match. `! ls src/hooks/useTreemapLayout.ts`, `! grep -q '"squarify"' package.json`, `! ls node_modules/squarify` all satisfied.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Migrated secondary consumers off `useTreemapLayout`**
- **Found during:** Task 2, after deleting `useTreemapLayout.ts`.
- **Issue:** `RadarMinimap.tsx`, `AgentManifestRow.tsx`, and `HeatMapOverlay.ts` all imported from the deleted hook, plus `radarStore.test.ts` and `RadarComponents.test.tsx` referenced `buildFileTree`/`computeTreemapLayout`/`useTreemapLayout` mocks. The plan assigned the Minimap/HeatMap rewrites to Plan 06 but required the hook deletion *now*; ignoring the consumers would have broken `npm run build` and the entire test suite.
- **Fix:** Migrated each consumer to use `graphNodes` x/y positions directly (Minimap: scaled scatter of settled nodes; AgentManifestRow: click-to-center uses node world position; HeatMapOverlay deleted because its function is now inline in `drawNodes`). Dropped the obsolete `buildFileTree`/`computeTreemapLayout` test suites from `radarStore.test.ts` and removed the `useTreemapLayout` vi.mock in `RadarComponents.test.tsx`.
- **Files modified:** `src/views/Radar/RadarMinimap.tsx`, `src/views/Radar/AgentManifestRow.tsx`, `src/views/Radar/HeatMapOverlay.ts` (deleted), `src/stores/__tests__/radarStore.test.ts`, `src/views/Radar/__tests__/RadarComponents.test.tsx`.
- **Commit:** `d68f42e`.

**2. [Rule 3 — Blocking] ResizeObserver + rAF polyfills in `RadarCanvas.test.tsx`**
- **Found during:** Task 2, first test run.
- **Issue:** jsdom does not define `ResizeObserver` or `requestAnimationFrame`, causing `ReferenceError` inside RadarCanvas effects under `@testing-library/react`.
- **Fix:** Installed no-op shims at the top of the test file (guarded by `typeof globalThis.ResizeObserver === 'undefined'`).
- **Files modified:** `src/views/Radar/__tests__/RadarCanvas.test.tsx`.
- **Commit:** `d68f42e`.

**3. [Rule 1 — Bug] `collapseSingleChildChain` over-stripping the immediate parent**
- **Found during:** Task 1, RED→GREEN iteration.
- **Issue:** Initial implementation iterated `i < parts.length - 1` and returned `'Radar'` for `src/views/Radar` under a single-child chain. Commit `a8fe89b` intent (and the plan's Test 3) is `'views/Radar'` — we must always keep at least the immediate parent segment.
- **Fix:** Changed loop bound to `i < parts.length - 2` so only strict ancestors above the parent are stripped.
- **Files modified:** `src/views/Radar/GraphRenderer.ts`.
- **Commit:** `6c08524`.

### No user-facing decisions needed

No Rule 4 architectural checkpoints were triggered. The decision to also delete `HeatMapOverlay.ts` (rather than keep a stub) is documented above under `decisions`.

## Threat surface scan

No security-relevant surfaces touched. Pure frontend rendering of validated graph data. No new network endpoints, auth paths, file access patterns, or schema changes.

## Deferred Issues

None inside the plan's scope. One pre-existing failure (`agentStore.test.ts > launchAgent`) is tracked in `deferred-items.md` (out of scope — unrelated to radar rendering).

## Known Stubs

- `RadarCanvas.tsx` `selectedNode` resolver is a placeholder (always returns `undefined`). This is intentional — `drawSelectedNode` is guarded against undefined input and renders nothing when the agent tracker is absent. **Plan 05** will wire the real resolver via the agent-dot/FileEvent bridge. No user-facing regression: Phase 4 used the agent's latest file event to locate the highlight, and in Plan 05 we re-enable this path on graph nodes.
- `RadarMinimap.tsx` uses a tiny-dot scatter with a placeholder viewport indicator border — this is an interim UI contract. **Plan 06** replaces it with the proper graph-extents minimap + live viewport rectangle per UI-SPEC §Component Inventory.
- `onHoveredAgentChange` is called with `null` for now (node hit works, but mapping a node to the agent currently on it needs Plan 05's agent tracker). The tooltip chrome still renders correctly against this contract because `RadarView.tsx` checks `hoveredAgent` nullability before mounting `AgentTooltip`.

Each stub has a named follow-up plan and does not block Plan 04's success criteria (which is a static graph render).

## Self-Check: PASSED

- `src/views/Radar/GraphRenderer.ts` — FOUND
- `src/views/Radar/RadarCanvas.tsx` — FOUND (modified)
- `src/views/Radar/RadarMinimap.tsx` — FOUND (modified)
- `src/views/Radar/AgentManifestRow.tsx` — FOUND (modified)
- `src/hooks/useTreemapLayout.ts` — ABSENT (deleted as required)
- `src/views/Radar/HeatMapOverlay.ts` — ABSENT (deleted)
- `package.json` `"squarify"` — ABSENT (uninstalled as required)
- `node_modules/squarify` — ABSENT
- Commits present: `bebfb16`, `6c08524`, `d68f42e` — all found via `git log --oneline`.
- Tests green: `GraphRenderer.test.ts` 32/32, `RadarCanvas.test.tsx` 4/4 (+1 todo).
- No new `npm run build` errors beyond pre-existing bindings.ts (documented).
