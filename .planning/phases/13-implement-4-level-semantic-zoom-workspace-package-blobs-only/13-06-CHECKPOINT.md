# Phase 13-06 Human UAT Checkpoint — Semantic Zoom

## Status

Automated validation is green. This checkpoint blocks Phase 13 closure until manual visual/interaction UAT is approved.

## What to run

1. Run `npm run tauri dev`.
2. Open the Radar view.

## Manual verification checklist

1. Wheel through zoom anchors `0.6`, `2`, and `4`.
2. Verify the HUD label changes exactly in this order as zoom increases:
   - `WORKSPACE`
   - `PACKAGE`
   - `FILE`
   - `CODE`
3. Verify the semantic transition feels like a smooth morph/crossfade rather than a hard snap.
4. At `WORKSPACE` zoom, verify top-level package blobs are shown while file dots, file labels, and non-IPC file edges are hidden.
5. At `WORKSPACE` zoom, verify bridges, agents, and conflicts remain visible.
6. At `PACKAGE` zoom, verify sub-package blobs and unlabeled file dots are shown.
7. At `PACKAGE` zoom, verify package blobs encode size and activity/heat, with conflicts overriding heat/activity styling.
8. At `FILE` zoom, verify file dots, file names, non-IPC edges, IPC bridge edges, agents, and conflicts are visible.
9. During crossfade bands, verify only the dominant representation handles hover/click even while the adjacent representation is still fading visually.
10. At `CODE` zoom, verify code preview cards show for a focused subset only, not every visible file.
11. At `CODE` zoom, verify at most `6` code preview cards are visible.
12. In code preview cards, verify signatures/exported symbols are shown when available.
13. For files without signature data, verify fallback copy appears exactly:
    - `PATH_METADATA`
    - `SIGNATURES_UNAVAILABLE — No signature data for this file yet. Showing path metadata instead.`
    - `No exported symbols detected.`
14. Click `EXPAND_SNIPPET` and verify a read-only raw source snippet appears, capped to 12 lines.
15. Click `COLLAPSE_SNIPPET` and verify the snippet collapses without editing repository files.
16. Click a package blob and verify the viewport focuses toward the package centroid without pinning nodes or mutating graph layout.
17. Press Escape with an expanded snippet/card visible and verify expanded snippets/cards close first.
18. Press Escape after card state is clear and verify existing bridge deselection behavior is preserved.
19. Verify wheel zoom, pan, minimap behavior, viewport clamp, and fit-to-graph behavior are unchanged.
20. Verify bridge nodes stay visible at every semantic zoom level.
21. Verify agent dots attach to package centroids at collapsed levels and exact file positions at file/code levels.

## Resume signal

Type `approved` to approve Phase 13 UAT, or describe the exact visual/interaction issue to fix.
