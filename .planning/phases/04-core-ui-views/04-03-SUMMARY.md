---
phase: 04-core-ui-views
plan: 03
subsystem: airspace-radar
tags: [radar, treemap, canvas2d, visualization, zoom-pan]
dependency_graph:
  requires: [04-01]
  provides: [radar-view, treemap-layout, canvas-zoom-pan, agent-dots]
  affects: [05-radar-manifest, 05-radar-tooltip]
tech_stack:
  added: [squarify]
  patterns: [canvas-2d-render-loop, dirty-flag-animation, squarified-treemap, zoom-toward-cursor, progressive-detail-rendering]
key_files:
  created:
    - src/stores/radarStore.ts
    - src/stores/__tests__/radarStore.test.ts
    - src/hooks/useTreemapLayout.ts
    - src/hooks/useCanvasZoomPan.ts
    - src/views/Radar/RadarCanvas.tsx
  modified:
    - src/views/RadarView.tsx
    - package.json
decisions:
  - Used squarify npm package for treemap algorithm rather than hand-rolling
  - Canvas 2D with requestAnimationFrame + dirty flag for render loop
  - Agent-to-file mapping via PID attribution from pipeline events
  - Progressive detail at 3 zoom thresholds (1x, 3x, 8x)
metrics:
  duration_seconds: 556
  completed: "2026-04-10T17:29:31Z"
  tasks_completed: 2
  tasks_total: 2
  tests_added: 11
  tests_total_passing: 49
---

# Phase 4 Plan 3: Airspace Radar Core Summary

Canvas 2D squarified treemap visualization with zoom-toward-cursor, progressive detail at 3 zoom levels, agent dots with pulse animation via PID-attributed file events, and dirty-flag rAF render loop for 10k+ file performance.

## Task Results

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | radarStore + useTreemapLayout + useCanvasZoomPan | 3c9780f (test), d571411 (feat) | radarStore.ts, useTreemapLayout.ts, useCanvasZoomPan.ts, radarStore.test.ts |
| 2 | RadarCanvas with treemap rendering and agent dots | 5a39f01 | RadarCanvas.tsx, RadarView.tsx |

## Implementation Details

### radarStore (src/stores/radarStore.ts)
- Viewport state (zoom, panX, panY), tree data, selected agent, manifest toggle
- `fetchTreeIndex()` calls `invoke('get_tree_index')` from backend
- 8-color agent dot palette with hash-based color assignment via `getAgentColor()`
- Default viewport: zoom=1, panX=0, panY=0

### useTreemapLayout (src/hooks/useTreemapLayout.ts)
- `buildFileTree()`: converts flat TreeIndexEntry[] to nested FileTreeNode with cumulative sizes
- `computeTreemapLayout()`: squarified layout via `squarify` npm package with recursive directory nesting
- `useTreemapLayout()` hook: memoized via useMemo keyed on [treeData, width, height]
- Directory padding: 2px sides, 14px top (label space)

### useCanvasZoomPan (src/hooks/useCanvasZoomPan.ts)
- Zoom toward cursor: factor 0.9/1.1, clamped [0.5, 20]
- Click-drag pan with left button
- `screenToWorld()` coordinate transform
- Returns viewport state + native event handlers

### RadarCanvas (src/views/Radar/RadarCanvas.tsx)
- HiDPI: canvas dimensions * devicePixelRatio, CSS logical size, ctx.scale(dpr)
- Dirty-flag render loop: only redraws when viewport/agents/layout change
- Progressive detail: directory labels at 1x (>60px), file names at 3x (>40px), file sizes at 8x (>60px)
- Sub-pixel culling: skips rects < 1px screen space
- Agent dots: 8px diameter, pulse animation (2 rings, 2s cycle), color from getAgentColor()
- Agent positioning: maps agent PID to recent file events from pipelineStore
- Hit testing: mousemove -> screenToWorld -> 8px radius check on agent dots
- ResizeObserver for responsive canvas sizing

### RadarView (src/views/RadarView.tsx)
- Empty state: AWAITING_SIGNAL with radar aesthetics when no watch session active
- Active state: RadarCanvas fills viewport, RadarManifest panel slot for Plan 05
- Mounts: fetchTreeIndex, fetchAgents, startPolling with cleanup

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- All 49 tests passing across 8 test files (11 new tests added)
- All acceptance criteria verified for both tasks
- RadarView shows AWAITING_SIGNAL empty state when no watch active
- RadarCanvas contains all required Canvas 2D rendering patterns

## Self-Check: PASSED
