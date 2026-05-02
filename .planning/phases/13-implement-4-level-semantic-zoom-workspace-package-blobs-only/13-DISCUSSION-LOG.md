# Phase 13: Implement 4-level semantic zoom - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-03
**Phase:** 13-implement-4-level-semantic-zoom-workspace-package-blobs-only
**Areas discussed:** Zoom levels, Package blobs, Code preview, Overlay priority

---

## Zoom levels

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| What should determine the four semantic zoom bands? | Existing anchors | Use current 0.6 / 2 / 4 zoom anchors. | ✓ |
| What should determine the four semantic zoom bands? | Tuned anchors | Adjust numeric thresholds now. | |
| What should determine the four semantic zoom bands? | Adaptive bands | Thresholds vary by density/node count. | |
| How should representation changes behave when crossing a zoom threshold? | Crossfade | Fade one representation out while the next fades in. | ✓ |
| How should representation changes behave when crossing a zoom threshold? | Hard snap | Switch immediately at each threshold. | |
| How should representation changes behave when crossing a zoom threshold? | Hysteresis | Use enter/exit thresholds to prevent flicker. | |
| During crossfade bands, what should be interactive? | Dominant level | Only the higher-opacity representation handles hover/click. | ✓ |
| During crossfade bands, what should be interactive? | Both levels | Allow either representation to be hit. | |
| During crossfade bands, what should be interactive? | Fine-grain only | Deeper-detail targets win during transitions. | |
| Should zoom level be shown explicitly in the UI? | Level label | Show WORKSPACE / PACKAGE / FILE / CODE near zoom indicator. | ✓ |
| Should zoom level be shown explicitly in the UI? | Numeric only | Keep only current numeric zoom display. | |
| Should zoom level be shown explicitly in the UI? | No chrome | Rely entirely on visual representation shifts. | |
| Should zoom level be shown explicitly in the UI? | You decide | Planner chooses smallest Command Horizon treatment. | |

**User's choices:** Existing anchors; Crossfade; Dominant level; Level label.
**Notes:** Current 0.6 / 2 / 4 anchors become semantic thresholds. Crossfade is visual, with dominant-level hit-testing to avoid duplicate targets.

---

## Package blobs

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| At workspace zoom, what should be visible? | Top packages only | Show top-level package blobs plus allowed overlays. | ✓ |
| At workspace zoom, what should be visible? | Top + hot files | Add a few active/hot files. | |
| At workspace zoom, what should be visible? | All hull labels | Keep current hull-label-heavy overview. | |
| What data should package blobs encode visually? | Size + activity | Size reflects file count; glow/heat reflects activity. | ✓ |
| What data should package blobs encode visually? | Size only | Keep blobs stable; activity stays in overlays. | |
| What data should package blobs encode visually? | Activity only | Uniform sizes; color/glow carries activity. | |
| What data should package blobs encode visually? | You decide | Planner chooses least-noisy encoding. | |
| At package zoom, how much nested structure should appear? | Subpackages + dots | Show sub-package blobs and unlabeled file dots. | ✓ |
| At package zoom, how much nested structure should appear? | Subpackages only | Cleaner package-level view, no file distribution. | |
| At package zoom, how much nested structure should appear? | Dots + labels | Show file dots and some labels earlier. | |
| How should package blob labels behave? | Important only | Label major blobs; suppress tiny/low-importance labels. | ✓ |
| How should package blob labels behave? | All labels | Show every visible blob label. | |
| How should package blob labels behave? | Hover labels | Persistent labels only on hover. | |

**User's choices:** Top packages only; Size + activity; Subpackages + dots; Important only.
**Notes:** Workspace/package levels are blob-first, with aggregate heat/activity and importance-filtered labeling.

---

## Code preview

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| At code zoom, what should the first preview layer show? | Signatures first | Show function/class signatures and exports before snippets. | ✓ |
| At code zoom, what should the first preview layer show? | Code snippets | Show first lines or nearby snippets immediately. | |
| At code zoom, what should the first preview layer show? | Metadata only | Path, size, edges, and agent status only. | |
| Which files should get code previews at once? | Focused nearby | Hovered/selected/near-focus files only. | ✓ |
| Which files should get code previews at once? | All visible | Every visible file dot gets a preview. | |
| Which files should get code previews at once? | Selected only | Only selected/hovered file shows preview. | |
| Where should signature data come from? | Existing graph data | Reuse existing dependency/source scans where available. | ✓ |
| Where should signature data come from? | New extractor | Build a dedicated multi-language signature extractor. | |
| Where should signature data come from? | Frontend only | Parse/precompute in TypeScript. | |
| Where should signature data come from? | You decide | Planner chooses after code inspection. | |
| How much raw source text should code zoom show? | Minimal snippet | One or two signature-adjacent lines. | |
| How much raw source text should code zoom show? | Expandable card | Signature card can expand into richer snippet. | ✓ |
| How much raw source text should code zoom show? | No raw code | Only signatures/symbol names. | |

**User's choices:** Signatures first; Focused nearby; Existing graph data; Expandable card.
**Notes:** Code zoom is an inspection layer, not a built-in editor. Existing scan data is preferred over a full new indexer.

---

## Overlay priority

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| What should happen to Phase 12 bridge nodes? | Always visible | Preserve Phase 12 carve-out; bridges visible at every zoom. | ✓ |
| What should happen to Phase 12 bridge nodes? | Fade by level | Subdue bridges at lower zooms. | |
| What should happen to Phase 12 bridge nodes? | Hide low zoom | Hide bridges at workspace zoom. | |
| How should agent dots and trails behave when files collapse? | Attach to blobs | Agents attach to package blob centroid at low zoom. | ✓ |
| How should agent dots and trails behave when files collapse? | Exact positions | Keep exact file-node positions. | |
| How should agent dots and trails behave when files collapse? | Summarize counts | Hide dots and show per-blob counts. | |
| How should conflict/heat aggregate? | Aggregate upward | Blob heat/conflict summarizes child files. | ✓ |
| How should conflict/heat aggregate? | File-only | Show only once files are visible. | |
| How should conflict/heat aggregate? | Separate overlay | Use global rail/legend independent of blobs. | |
| When overlays compete, which wins? | Conflict wins | Conflicts override heat/activity. | ✓ |
| When overlays compete, which wins? | Agents win | Live agent positions strongest. | |
| When overlays compete, which wins? | Heat wins | Heat remains dominant overview signal. | |
| Should semantic zoom change pan/zoom/minimap behavior? | No behavior change | Keep existing wheel, pan, and minimap behavior. | ✓ |
| Should semantic zoom change pan/zoom/minimap behavior? | Minimap levels | Add semantic-level awareness to minimap. | |
| Should semantic zoom change pan/zoom/minimap behavior? | Snap controls | Add jump controls for levels. | |
| Should semantic zoom change pan/zoom/minimap behavior? | You decide | Planner adds only tiny affordance if cheap. | |

**User's choices:** Always visible; Attach to blobs; Aggregate upward; Conflict wins; No behavior change.
**Notes:** Bridges stay visible across levels. Agents and heat/conflict aggregate to blobs at low zoom. Conflicts are the strongest visual signal.

---

## Claude's Discretion

- Exact crossfade band width.
- Exact blob size/activity formulas.
- Exact label importance heuristics.
- Exact implementation shape for semantic-level helpers/modules.
- Exact code-preview derivation path from existing graph/source-scan data.

## Deferred Ideas

None — discussion stayed within phase scope.
