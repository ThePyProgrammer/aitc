# Phase 13: Implement 4-level semantic zoom - Research

**Researched:** 2026-05-03 [VERIFIED: system currentDate]
**Domain:** Canvas 2D semantic zoom for the Radar graph view in a Tauri + React + TypeScript app [VERIFIED: /home/prannayag/pragnition/htx/aitc/CLAUDE.md]
**Confidence:** HIGH for frontend semantic-level/rendering architecture; MEDIUM for code-signature extraction because the existing backend has tree-sitter import extraction but not a verified exported-symbol scanner yet. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps/extract.rs]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

## Implementation Decisions

### Zoom levels

- **D-01:** Use the existing zoom anchors as semantic band boundaries: `0.6`, `2`, and `4`. These become the workspace/package/file/code transition anchors so Phase 13 changes representation without retuning navigation.
- **D-02:** Representation changes should crossfade over a small threshold band rather than hard-snap. The result should feel like a semantic morph during wheel zoom, not a sudden layer toggle.
- **D-03:** During crossfade bands, only the dominant representation handles hover/click. Dominance is based on the representation with higher opacity. This avoids duplicate targets during transitions.
- **D-04:** The existing numeric zoom indicator should gain a tiny semantic level label: `WORKSPACE`, `PACKAGE`, `FILE`, or `CODE`.

### Package blobs

- **D-05:** Workspace zoom shows **top-level package blobs only**. Fine file detail is hidden at this level. Existing always-on overlays that remain explicitly allowed by later decisions, such as bridges and agents, may still render.
- **D-06:** Package blobs encode both structure and activity: size reflects file count/package size; glow/heat reflects contention or recent agent activity.
- **D-07:** Package zoom shows sub-package blobs plus unlabeled file dots. This directly matches the roadmap phrase “sub-packages + file dots.”
- **D-08:** Blob labels are importance-filtered. Workspace zoom labels top-level blobs. Package zoom labels visible subpackages but suppresses tiny or low-importance labels to preserve glanceability.

### Code preview

- **D-09:** Code zoom first shows function/class signatures and exported symbols, not raw source blocks.
- **D-10:** Code previews render only for a focused subset: hovered files, selected files, or files near the current viewport focus. Do not render previews for every visible file at once.
- **D-11:** Signature data should come from existing graph/source-scan data where available, degrading to path metadata if absent. Do not introduce a full new language indexer unless research finds a cheap path already present in the codebase.
- **D-12:** Raw source is available through expandable signature cards. The default code-zoom surface starts with signatures; selected cards can expand into richer snippets.

### Overlay priority

- **D-13:** Preserve Phase 12 bridge visibility: bridge nodes stay visible at every semantic zoom level as the cross-language spine.
- **D-14:** When file nodes are collapsed into package blobs, agent dots attach to the relevant package blob centroid. At file/code levels, they snap or crossfade to exact file-node positions.
- **D-15:** Heat and conflict signals aggregate upward at workspace/package levels. Blob heat/conflict badges summarize child file contention, then resolve to file-level badges as users zoom in.
- **D-16:** When visual signals compete, conflicts win. Conflict state overrides heat/activity styling; agents remain visible; package labels may dim if necessary.
- **D-17:** Semantic zoom does not change wheel zoom, pan behavior, or minimap behavior. Only the rendered representation changes.

### Claude's Discretion

- Exact crossfade band width around `0.6`, `2`, and `4`.
- Exact formulas for package blob size, heat aggregation, and “important label” filtering.
- Whether semantic-level state is represented as a pure helper, a store selector, or a tiny module near the radar renderers.
- Whether code-preview signatures can be derived from existing dependency/source scans immediately or require a small best-effort backend extension. The constraint is no full language-indexer scope unless research proves it is already cheap.
- Exact visual styling for signature cards and expanded snippets, as long as it follows Command Horizon and does not become a built-in editor.

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

None — discussion stayed within phase scope.
</user_constraints>

## Summary

Phase 13 should be planned as a representation-system refactor, not as another visibility gate patch. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md] The current renderer has a three-tier `shouldRenderHullAtZoom` gate and a duplicated hull-cache build gate at the same anchors, while file labels still use `FILE_LABEL_ZOOM_THRESHOLD = 4`; Phase 13 must replace these with a semantic-level model that returns level, crossfade opacities, and dominant hit-test representation. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/GraphRenderer.ts] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts]

The safest architecture is a small pure semantic-zoom module plus adjacent package-blob/code-preview renderer helpers. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] Keep `RadarCanvas` as the orchestration point because it already derives `bridgeNodes`, `fileNodes`, live worker positions, viewport, hit tests, overlays, and the zoom HUD in one rAF-controlled render loop. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] Keep expensive package membership/aggregation out of the per-frame loop by memoizing/cache-keying from `graphNodes`, `parentChildMap`, `dirsWithOwnFiles`, `contentionScores`, conflict paths, and agent current-file state. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]

Code zoom should ship signature-first with graceful fallback rather than blocking on a full symbol index. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md] The backend already uses tree-sitter parsers for TypeScript/TSX/JS/JSX/Rust/Python import extraction with cached parser/query slots and file-size/parse-time guards, so a cheap best-effort exported-symbol extension is plausible; however, no existing verified exported-symbol DTO or command was found in the searched code. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps/extract.rs] [VERIFIED: rg search saved output /home/prannayag/.claude/projects/-home-prannayag-pragnition-htx-aitc/765a2549-47fd-4d7f-b7d0-0a75aee29427/tool-results/brbh97yrn.txt]

**Primary recommendation:** Implement a pure `semanticZoom` module, a memoized `packageBlobs` derivation layer, Canvas renderers for blob/dot/file representations, and a capped DOM `SignatureCard` overlay; do not retune pan/zoom, worker physics, minimap, bridge rendering, or Phase 14 offscreen-canvas architecture. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md]

## Project Constraints (from CLAUDE.md)

- Use Tauri v2 + React + TypeScript for this desktop app. [VERIFIED: /home/prannayag/pragnition/htx/aitc/CLAUDE.md]
- Preserve desktop-first scope, with Windows primary and macOS/Linux stretch goals. [VERIFIED: /home/prannayag/pragnition/htx/aitc/CLAUDE.md]
- Follow the Command Horizon design system from wireframes. [VERIFIED: /home/prannayag/pragnition/htx/aitc/CLAUDE.md]
- Keep agent integration extensible through adapter patterns rather than hardcoding per-agent behavior. [VERIFIED: /home/prannayag/pragnition/htx/aitc/CLAUDE.md]
- Maintain large-codebase performance expectations for 10k+ files without excessive CPU/memory. [VERIFIED: /home/prannayag/pragnition/htx/aitc/CLAUDE.md]
- Use Canvas 2D for the radar; no generic charting library or WebGL rewrite is recommended for this phase. [VERIFIED: /home/prannayag/pragnition/htx/aitc/CLAUDE.md]
- Before file-changing implementation work, use a GSD workflow entry point; this research write is part of the requested GSD research workflow. [VERIFIED: /home/prannayag/pragnition/htx/aitc/CLAUDE.md]
- No project skills were found under `.claude/skills/` or `.agents/skills/`; `.claude/` exists but contains MCP/settings/worktree files rather than a skills index. [VERIFIED: Bash ls /home/prannayag/pragnition/htx/aitc/.claude /home/prannayag/pragnition/htx/aitc/.agents]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Semantic level calculation and crossfade dominance | Browser / Client | — | Zoom state is already a client-side viewport concern in `useCanvasZoomPan` and `RadarCanvas`; changing representation without changing navigation belongs in the Canvas orchestration layer. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] |
| Package blob derivation and aggregation | Browser / Client | API / Backend only if existing data proves insufficient | `radarStore.fetchGraph` already supplies file nodes, directory keys, parent-child maps, contention scores, and graph edges needed for blob membership; no new persistence boundary is required for package summaries. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/stores/radarStore.ts] |
| Bridge visibility and hit precedence | Browser / Client | API / Backend for bridge DTO source | Bridge nodes already arrive as graph nodes and are rendered/hit-tested separately; Phase 13 must preserve that split. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] |
| Agent dot attachment/crossfade | Browser / Client | API / Backend for agent/process events | Agent current-file dots are currently derived from pipeline events and graph node positions in `RadarCanvas`; package-centroid attachment is a renderer-level position transform over the same data. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] |
| Code signatures/exported symbols | API / Backend | Browser / Client fallback display | Source parsing belongs near the existing tree-sitter dependency scanner; the frontend should display signatures if available and fall back to path metadata if not. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps/extract.rs] |
| Signature cards and expanded snippets | Browser / Client | API / Backend for optional snippet read command | The default card surface is presentation/local UI state; raw snippet expansion may need an existing or new read-only command but must not become an editor. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md] |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | installed `^19.2.0`; registry latest `19.2.5`, modified 2026-04-30 | DOM overlays, HUD label, signature cards, local expand/collapse state | Current app already uses React; official `useMemo` caches pure calculations between renders and compares dependencies with `Object.is`, which matches derived semantic data needs. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] [VERIFIED: npm registry] [CITED: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useMemo.md] |
| Zustand | installed `^5.0.0`; registry latest `5.0.12`, modified 2026-03-16 | Existing radar store and viewport/debug state | Current app already uses Zustand stores; React's external-store contract requires repeated unchanged snapshots to return the same value to avoid re-render churn, so selectors must preserve stable references. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] [VERIFIED: npm registry] [CITED: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useSyncExternalStore.md] |
| Canvas 2D API | native | Radar rendering, package blobs, file dots, edges, labels | The project stack locks Canvas 2D for the ATC radar, and MDN recommends batching canvas calls and avoiding unnecessary state changes for performance. [VERIFIED: /home/prannayag/pragnition/htx/aitc/CLAUDE.md] [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas] |
| d3-polygon | installed `^3.0.1`; registry latest `3.0.1`, modified 2022-06-14 | Convex hull and centroid geometry for existing hull/package-blob backing data | Official docs state `polygonHull(points)` returns the convex hull using Andrew's monotone chain and `polygonCentroid(polygon)` returns a polygon centroid; these are already in use in `hullCache`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] [VERIFIED: npm registry] [CITED: https://d3js.org/d3-polygon] |
| d3-shape | installed `^3.2.0`; registry latest `3.2.0`, modified 2023-04-12 | Existing Catmull-Rom hull paths and possible direct Canvas path generation | Official docs state `line.context(context)` renders to Canvas path calls and null context returns SVG path data; current `hullCache` uses `line().curve(curveCatmullRomClosed.alpha(0.5))` and `Path2D`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] [VERIFIED: npm registry] [CITED: https://d3js.org/d3-shape/line] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts] |
| d3-quadtree | installed `^3.0.1`; registry latest `3.0.1`, modified 2022-06-14 | File-node nearest-neighbor hit testing | Official docs state `quadtree.find(x, y, radius)` returns the closest datum within radius or `undefined`; current `RadarCanvas` uses quadtree hit testing for file hover. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] [VERIFIED: npm registry] [CITED: https://observablehq.com/@d3/d3-quadtree#quadtree_find] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] |
| tree-sitter Rust crates | installed pinned versions in Cargo.toml (`tree-sitter =0.26.8`, TS `0.23.2`, JS `0.25.0`, Rust `0.24.2`, Python `0.25.0`) | Best-effort backend signature/export extraction if needed | The existing dependency scanner already parses TS/TSX/JS/JSX/Rust/Python with cached parser/query slots, a 1 MiB file cap, and a 500 ms parse budget. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/Cargo.toml] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps/extract.rs] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Shiki | installed `^4.0.2` | Optional expanded snippet highlighting | Use only after `EXPAND_SNIPPET`; the existing `highlightLines` API returns per-line HTML strings and maps extensions to Shiki language IDs. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/hooks/useSyntaxHighlight.ts] |
| Vitest | installed `^3.0.0`; registry latest `4.1.5`, modified 2026-04-23 | Frontend unit/component tests | Existing config runs jsdom tests under `src/**/*.test.{ts,tsx}`; keep semantic-zoom tests in `src/views/Radar/__tests__/`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] [VERIFIED: npm registry] [VERIFIED: /home/prannayag/pragnition/htx/aitc/vitest.config.ts] |
| TypeScript | installed `~5.8.3`; registry latest `6.0.3`, modified 2026-04-16 | Type-safe semantic model and renderer contracts | The project uses TypeScript through `npm run build` (`tsc && vite build`), so new semantic helpers should be typed and testable. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] [VERIFIED: npm registry] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure helper module for semantic level math | Store field for current semantic level | Store field would add write churn on every wheel zoom; pure arithmetic over viewport zoom is enough and avoids extra Zustand updates. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] |
| Canvas blob renderers | DOM/SVG package blobs | DOM/SVG would create extra nodes at radar scale and split hit-testing from the existing canvas/quadtree path; Canvas keeps the radar render model coherent. [VERIFIED: /home/prannayag/pragnition/htx/aitc/CLAUDE.md] |
| Capped DOM signature cards | Canvas text for code cards | DOM cards are easier to clamp, scroll, expand, and test; the UI spec caps cards at 6, so DOM cost is bounded. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md] |
| Full language indexer | Best-effort tree-sitter extension + fallback metadata | A full indexer violates D-11 unless proven cheap; existing tree-sitter parsing makes a small exported-symbol pass plausible without broad indexing. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps/extract.rs] |

**Installation:**
```bash
# No new npm package is required for the core semantic zoom renderer.
# Optional backend signature extraction should reuse existing tree-sitter crates.
```
[VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/Cargo.toml]

**Version verification:** Package versions above were checked with `npm view ... version time.modified` on 2026-05-03. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
Wheel / fit / minimap viewport input
        |
        v
useCanvasZoomPan viewport.zoom (unchanged navigation)
        |
        v
semanticZoom.resolve(zoom)
  -> current level: WORKSPACE | PACKAGE | FILE | CODE
  -> opacities per representation
  -> dominant hit-test representation
        |
        +-------------------------+
        |                         |
        v                         v
Memoized package model       Live graph model
(graphNodes + dirs +         (worker Float32Array positions,
contention + conflicts)       bridge/file split, edges)
        |                         |
        +-----------+-------------+
                    v
RadarCanvas rAF orchestration
  1. background
  2. active package/blob representations with opacity
  3. file edges/arrows only at FILE/CODE opacity
  4. file dots/labels according to active representation
  5. bridge spine always visible
  6. agents/conflicts over semantic representation
  7. capped code cards when CODE level is active
                    |
                    v
Canvas + DOM HUD/signature overlays
```
[VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]

### Recommended Project Structure
```text
src/views/Radar/
├── semanticZoom.ts          # pure level/opacities/dominance helpers
├── packageBlobs.ts          # memoized derivation: membership, centroid, heat/conflict/label importance
├── PackageBlobRenderer.ts   # Canvas draw + hit-test helpers for workspace/package blobs
├── CodePreviewOverlay.tsx   # capped DOM signature cards + expand/collapse local state
├── GraphRenderer.ts         # file-level primitives; threshold constants updated to semantic model
├── hullCache.ts             # either reused by packageBlobs or stripped of obsolete 3-tier gate duplication
└── __tests__/               # semanticZoom, packageBlobs, package renderer, code-preview, RadarCanvas integration tests
```
[VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar directory tests discovered by find]

### Pattern 1: Pure semantic-level resolver
**What:** A pure helper maps zoom to four levels, opacities, and dominant hit-target level. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**When to use:** Use on every frame because it is constant-time arithmetic and safe per the UI spec. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**Example:**
```typescript
// Source: 13-UI-SPEC.md §Semantic Zoom Contract
export const SEMANTIC_ANCHORS = [0.6, 2, 4] as const;
export const CROSSFADE_HALF_BAND = 0.10;

export type SemanticLevel = 'workspace' | 'package' | 'file' | 'code';

export function resolveSemanticZoom(zoom: number) {
  // Returns { dominantLevel, hitLevel, opacityByLevel }.
  // Linear crossfade over [anchor - 0.10, anchor + 0.10].
}
```
[VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]

### Pattern 2: Memoized package blob model
**What:** Build package summaries from file nodes once per graph/contention/conflict generation, not during every rAF paint. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**When to use:** Workspace and package levels need file-count sizing, centroid attachment, label filtering, and upward aggregation. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**Example:**
```typescript
// Source: 13-UI-SPEC.md §Workspace level / §Package level
export interface PackageBlob {
  id: string;
  dirKey: string;
  depth: number;
  fileCount: number;
  centroid: { x: number; y: number };
  diameterPx: number;
  contentionScore: number;
  conflictCount: number;
  activeAgentCount: number;
  label: string;
  importance: number;
}
```
[VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]

### Pattern 3: Representation opacity gating with dominant hit testing
**What:** Draw adjacent semantic representations during crossfade, but route hover/click only to the representation whose opacity is `>= 0.5`; if both are exactly `0.5`, higher-detail wins. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**When to use:** Mouse move and click handlers must avoid duplicate package/file targets during transition bands. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**Example:**
```typescript
// Source: 13-UI-SPEC.md §Levels, bands, and labels
const semantic = resolveSemanticZoom(viewport.zoom);
if (semantic.hitLevel === 'workspace' || semantic.hitLevel === 'package') {
  const blob = findPackageBlobAtWorld(world.x, world.y, semantic.hitLevel);
  // bridge hit-test still runs first.
}
```
[VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]

### Pattern 4: Signature-card cap and fallback
**What:** At code zoom, render at most 6 signature cards for hovered, selected, active-agent, and viewport-center-near files; if signatures are unavailable, show `PATH_METADATA` / `SIGNATURES_UNAVAILABLE`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**When to use:** Code level is an inspection layer, not an editor or all-files code view. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**Example:**
```typescript
// Source: 13-UI-SPEC.md §Code level
const focused = selectFocusedCodePreviewFiles({
  hoveredFileId,
  selectedFileId,
  activeAgentFiles,
  viewportCenterPxRadius: 160,
  maxCards: 6,
});
```
[VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]

### Anti-Patterns to Avoid
- **Patching `shouldRenderHullAtZoom` into four cases:** This preserves the old visibility-gate model and misses the phase requirement to change representation. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/ROADMAP.md]
- **Recomputing package hierarchy in the rAF loop:** The UI spec forbids recomputing package hierarchy, blob membership, label importance, or aggregate heat per frame. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
- **Rendering code previews for every visible file:** The UI spec caps code cards at 6 and only for focused subsets. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
- **Folding bridges into package blobs:** Phase 12/22 established bridges as separate bridge nodes excluded from file rendering and hull membership. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts]
- **Changing wheel zoom, pan, minimap, worker physics, or moving to OffscreenCanvas:** These are explicitly out of scope for Phase 13. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Convex/centroid geometry | Custom convex hull or centroid math | Existing `d3-polygon` `polygonHull` / `polygonCentroid` | Official APIs already supply convex hull and centroid operations; current `hullCache` already uses them. [CITED: https://d3js.org/d3-polygon] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts] |
| Smooth hull/path generation | Custom spline/path serializer | Existing `d3-shape` line generator / current `Path2D` path flow | Official line generators can return SVG path data or draw to Canvas context; current hull cache already uses Catmull-Rom line generation. [CITED: https://d3js.org/d3-shape/line] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts] |
| File-node hit testing | Linear scan over 10k file nodes | Existing d3-quadtree file-node hit test | `quadtree.find` is the official nearest-point query and `RadarCanvas` already uses it. [CITED: https://observablehq.com/@d3/d3-quadtree#quadtree_find] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] |
| Syntax/code highlighting for expanded snippets | New sanitizer/highlighter | Existing `useSyntaxHighlight`, `detectLanguage`, `highlightLines` | The app already has a Shiki singleton and safe per-line highlighting helpers. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/hooks/useSyntaxHighlight.ts] |
| Full language indexing | New full indexer | Existing tree-sitter parser/query infrastructure plus path fallback | D-11 forbids a full indexer unless proven cheap; existing parser infrastructure is the cheap path to inspect first. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps/extract.rs] |

**Key insight:** This phase's hard part is not drawing circles; it is keeping representation derivation cache-coherent while preserving the post-Phase-11/11.1 performance discipline and Phase-12 bridge z-order/hit-test rules. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/11.1-fix-zoom-scroll-lag-in-radarcanvas-wheel-event-raf-coalescin/11.1-CONTEXT.md] [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: Leaving duplicated zoom gates in `GraphRenderer` and `hullCache`
**What goes wrong:** Renderer and cache disagree about which representation exists at a zoom, causing missing labels, stale blobs, or paid-for geometry that is not drawn. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/GraphRenderer.ts] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts]
**Why it happens:** Current code duplicates `shouldRenderHullAtZoom` logic inside `hullCache` to avoid circular imports. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts]
**How to avoid:** Move semantic decisions into a standalone pure module imported by both renderer/cache derivation code. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts]
**Warning signs:** Tests still import `shouldRenderHullAtZoom` as the acceptance surface rather than semantic level/opacities. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/__tests__/GraphRenderer.test.ts]

### Pitfall 2: Accidentally moving file labels to code level only
**What goes wrong:** File zoom becomes unlabeled, violating the Phase 13 UI contract. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**Why it happens:** Existing `FILE_LABEL_ZOOM_THRESHOLD` is `4`, but Phase 13 shifts labels to file zoom at `>= 2` and code cards to `>= 4`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/GraphRenderer.ts] [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**How to avoid:** Replace `FILE_LABEL_ZOOM_THRESHOLD = 4` with semantic-level-driven file-label rendering for FILE and CODE representations. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**Warning signs:** Tests still expect `drawFileLabels` to no-op at zoom `2`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/GraphRenderer.ts]

### Pitfall 3: Crossfade draws duplicate targets and both respond to hover
**What goes wrong:** During transition bands, package blob and file dot both latch hover/click. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md]
**Why it happens:** Drawing opacity is often implemented separately from hit-testing logic. [ASSUMED]
**How to avoid:** Return `hitLevel` from the same pure resolver that returns opacities. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**Warning signs:** Mouse handlers branch directly on raw `viewport.zoom` instead of semantic dominance. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx]

### Pitfall 4: Aggregating bridge nodes into package blobs
**What goes wrong:** Bridge diamonds get folded into package centroids or blob file counts, corrupting the boundary spine. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts]
**Why it happens:** Graph nodes include both file and bridge kinds after Phase 12. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/stores/radarStore.ts]
**How to avoid:** Run all package/blob membership over `kind !== 'bridge'` file nodes only, mirroring `filterRenderableFileNodes` and `hullCache` bridge exclusion. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts]
**Warning signs:** Package blob count includes `bridge:<commandName>` ids. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/stores/radarStore.ts]

### Pitfall 5: Per-frame text and shadow churn
**What goes wrong:** Canvas frame time spikes during wheel zoom or code level because labels/cards/shadows are recomputed or drawn too broadly. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas]
**Why it happens:** Canvas text, shadowBlur, and unnecessary state changes are performance-sensitive; MDN recommends avoiding unnecessary canvas state changes and avoiding `shadowBlur`/text where possible. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas]
**How to avoid:** Cull labels/cards, cap signature cards, batch draw calls, and preserve existing two-pass node rendering that reduces shadow state churn. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/GraphRenderer.ts] [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**Warning signs:** Code zoom loops over all visible nodes to measure text or render cards. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]

### Pitfall 6: Backend signature extraction scope creep
**What goes wrong:** Phase 13 turns into a language server/indexer project. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md]
**Why it happens:** Function/class/export extraction invites deeper semantic parsing than the UI needs. [ASSUMED]
**How to avoid:** Implement best-effort exported-symbol scans only for languages already parsed by tree-sitter, keep file-size/time guards, and ship path-metadata fallback. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps/extract.rs] [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
**Warning signs:** New dependencies for LSP servers, language-specific analyzers, or persistent symbol DBs appear in the plan. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md]

## Code Examples

### Semantic crossfade resolver contract
```typescript
// Source: 13-UI-SPEC.md §Levels, bands, and labels
// The exact implementation belongs in src/views/Radar/semanticZoom.ts.
// Required behavior: anchors 0.6, 2, 4; crossfade band [anchor - 0.10, anchor + 0.10];
// linear opacity; dominant hit level uses opacity >= 0.5 and higher-detail tie break.
```
[VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]

### Existing file/bridge split to preserve
```typescript
// Source: src/views/Radar/RadarCanvas.tsx
const bridgeNodes = liveNodes.filter((n) => n.kind === 'bridge');
const fileNodes = filterRenderableFileNodes(liveNodes);
```
[VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx]

### Existing tree-sitter guard pattern to reuse for signatures
```rust
// Source: src-tauri/src/pipeline/deps/extract.rs
pub const MAX_FILE_SIZE_BYTES: u64 = 1_048_576;
pub const MAX_PARSE_DURATION: Duration = Duration::from_millis(500);
```
[VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps/extract.rs]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Three-tier folder hull visibility gate | Four-level semantic representation system | Phase 13 planning, 2026-05-03 | Planning must create semantic model, package blobs, file-level labels, and code inspection cards rather than extending `shouldRenderHullAtZoom`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/ROADMAP.md] |
| File labels only at zoom `>= 4` | File labels at FILE level `>= 2`; CODE level adds signature cards | Phase 13 UI spec, 2026-05-03 | `FILE_LABEL_ZOOM_THRESHOLD` must be updated or bypassed by semantic-level rendering. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/GraphRenderer.ts] [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md] |
| Folder hulls/labels as overview representation | Package blobs with file-count sizing, heat/conflict aggregation, and importance-filtered labels | Phase 13 context/UI spec, 2026-05-03 | Existing hull cache can inform geometry, but package blobs need aggregation semantics and hit targets. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md] |
| Main-thread d3-force simulation | Worker-hosted graph positions via transferable `Float32Array` | Phase 11 completed 2026-04-21 | Semantic zoom must read existing live positions and not move physics back to main thread. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/ROADMAP.md] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx] |
| Bridges mixed into graph data | Bridge nodes are separate kind, rendered above file nodes and excluded from hulls | Phase 12/22 | Semantic zoom must keep bridges visible at all levels and excluded from package blob membership. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/stores/radarStore.ts] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts] |

**Deprecated/outdated:**
- `shouldRenderHullAtZoom` as the core zoom abstraction is outdated for Phase 13 because it only controls folder hull visibility. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/GraphRenderer.ts] [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/ROADMAP.md]
- `FILE_LABEL_ZOOM_THRESHOLD = 4` is outdated for Phase 13 because the UI spec moves file labels to `>= 2`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/GraphRenderer.ts] [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Drawing opacity and hit-testing are often implemented separately, causing duplicate target bugs unless unified. | Common Pitfalls | Planner may under-test crossfade hit dominance. |
| A2 | Function/class/export extraction invites deeper semantic parsing than the UI needs. | Common Pitfalls | Planner may over-scope backend work if not constrained by D-11. |

## Open Questions (RESOLVED)

1. **Should signature extraction be in Phase 13 or should Phase 13 ship path metadata first?**
   - **Resolution:** Include a tightly-scoped backend signature/snippet path in Phase 13. Signature extraction remains best-effort and guarded by the existing tree-sitter file-size and parse-time protections, while `PATH_METADATA` / `SIGNATURES_UNAVAILABLE` remains the fallback when signatures are absent. D-12 additionally requires raw source snippets, so Phase 13 must include a repo-root guarded, read-only raw snippet command capped at 12 lines for `EXPAND_SNIPPET`; path metadata alone is not sufficient for expanded cards.
   - **Constraints:** No full language indexer, no LSP dependency, no persistent symbol DB, no repository edit/write action. Snippet reads must canonicalize under the watched repo root and reject arbitrary absolute paths/`..` traversal per T-13-01.

2. **Should package blobs reuse `hullCache` entries or derive a separate blob model?**
   - **Resolution:** Derive a separate `packageBlobs` model. It may share low-level geometry/cache discipline from `hullCache` and must preserve bridge exclusion, but it must not reuse obsolete three-tier hull visibility gates as the semantic representation source of truth. Package blobs need their own file-count sizing, heat/activity aggregation, conflict badges, active-agent counts, label importance, member file ids, and centroid data.
   - **Constraints:** Keep package hierarchy, blob membership, label importance, and aggregate heat out of the rAF loop; cache or memoize from graph/topology/contention/conflict/agent inputs.

3. **How should package-click focus/zoom be implemented without mutating layout?**
   - **Resolution:** Package click focuses the selected blob through a viewport target transition using existing pan/zoom state (`setViewport` or equivalent). It must not mutate graph layout, pin nodes, alter worker physics, change minimap semantics, or write back package positions. The target is computed from the selected blob centroid and current canvas dimensions, with existing wheel/pan/minimap controls preserved.
   - **Constraints:** Tests should assert package-click does not call `pinNode` or any layout mutation path.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | npm build/test and frontend tooling | ✓ | `v24.14.0` | None needed. [VERIFIED: Bash node --version] |
| npm | package scripts and version checks | ✓ | `11.9.0` | None needed. [VERIFIED: Bash npm --version] |
| Rust cargo | Optional backend signature extension and existing Tauri backend | ✓ | `cargo 1.94.0` | If backend extension is deferred, frontend fallback still works. [VERIFIED: Bash cargo --version] |
| rustc | Optional backend signature extension | ✓ | `rustc 1.94.0` | If backend extension is deferred, frontend fallback still works. [VERIFIED: Bash rustc --version] |
| Vitest | Frontend validation | ✓ | installed `^3.0.0` | Use existing `npm run test`; no new test runner. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] |

**Missing dependencies with no fallback:** None found for the core frontend semantic zoom work. [VERIFIED: Bash node/npm/cargo/rustc probes]

**Missing dependencies with fallback:** No missing local runtime dependency was found; backend signature extraction can fall back to path metadata if not implemented. [VERIFIED: Bash node/npm/cargo/rustc probes] [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest with jsdom environment. [VERIFIED: /home/prannayag/pragnition/htx/aitc/vitest.config.ts] |
| Config file | `/home/prannayag/pragnition/htx/aitc/vitest.config.ts`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/vitest.config.ts] |
| Quick run command | `npm run test -- src/views/Radar/__tests__/semanticZoom.test.ts src/views/Radar/__tests__/packageBlobs.test.ts src/views/Radar/__tests__/CodePreviewOverlay.test.tsx` [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] |
| Full suite command | `npm run test` and `npm run build`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VIZN-01 | Radar changes representation across workspace/package/file/code while preserving spatial graph. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/REQUIREMENTS.md] | unit + component | `npm run test -- src/views/Radar/__tests__/semanticZoom.test.ts src/views/Radar/__tests__/RadarCanvas.test.tsx` | ❌ Wave 0 for semantic tests; RadarCanvas test exists. [VERIFIED: find output] |
| VIZN-04 | Radar remains performant for 10k+ files through memoized derivation, culling, and capped cards. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/REQUIREMENTS.md] | unit + build/perf smoke | `npm run test -- src/views/Radar/__tests__/packageBlobs.test.ts` | ❌ Wave 0. [VERIFIED: find output] |
| VIZN-05 | Package/file/code representations derive from file-tree structure. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/REQUIREMENTS.md] | unit | `npm run test -- src/views/Radar/__tests__/packageBlobs.test.ts` | ❌ Wave 0. [VERIFIED: find output] |
| DSGN-01/04 | Command Horizon labels, colors, conflict priority, and glanceability are preserved. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/REQUIREMENTS.md] | component | `npm run test -- src/views/Radar/__tests__/CodePreviewOverlay.test.tsx` | ❌ Wave 0. [VERIFIED: find output] |

### Sampling Rate
- **Per task commit:** `npm run test -- src/views/Radar/__tests__/{semanticZoom,packageBlobs,GraphRenderer,RadarCanvas}.test.ts*` for affected renderer/helper work. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json]
- **Per wave merge:** `npm run test` plus `npm run build`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json]
- **Phase gate:** Full frontend test suite and build green before `/gsd-verify-work`. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/config.json]

### Wave 0 Gaps
- [ ] `/home/prannayag/pragnition/htx/aitc/src/views/Radar/__tests__/semanticZoom.test.ts` — anchors, opacities, dominance, higher-detail tie break. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
- [ ] `/home/prannayag/pragnition/htx/aitc/src/views/Radar/__tests__/packageBlobs.test.ts` — file-count scaling, top-level/subpackage selection, heat/conflict aggregation, bridge exclusion. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
- [ ] `/home/prannayag/pragnition/htx/aitc/src/views/Radar/__tests__/CodePreviewOverlay.test.tsx` — capped 6 cards, fallback copy, expand/collapse local state, bounds clamp. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md]
- [ ] Extend `/home/prannayag/pragnition/htx/aitc/src/views/Radar/__tests__/GraphRenderer.test.ts` — file labels at zoom `>= 2`, obsolete hull-gate expectations replaced. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/__tests__/GraphRenderer.test.ts]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase 13 adds no auth surface. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md] |
| V3 Session Management | no | Phase 13 adds no session/token surface. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md] |
| V4 Access Control | no for core renderer; yes if raw source snippets require a backend read command | Keep snippet expansion read-only and scoped to watched repo paths; do not add edit/write actions. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md] |
| V5 Input Validation | yes | Validate/canonicalize any backend file path accepted for signature/snippet reads; frontend must treat code text as text or pre-sanitized highlighter output. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/hooks/useSyntaxHighlight.ts] |
| V6 Cryptography | no | No cryptographic feature is introduced. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md] |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in raw snippet/signature command | Tampering / Information Disclosure | If a backend command is added, require repo-root scoped paths and reuse existing source-file filters; do not accept arbitrary absolute paths. [ASSUMED] |
| XSS through code preview HTML | Tampering | Render raw source as text; if highlighting expanded snippets, use the existing `highlightLines` helper that escapes token content and validates CSS colors. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/hooks/useSyntaxHighlight.ts] |
| Parser denial of service | Denial of Service | Reuse the existing 1 MiB file-size cap and 500 ms parse budget for any tree-sitter signature extraction. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps/extract.rs] |
| UI denial of service through unbounded cards/labels | Denial of Service | Cap signature cards at 6, viewport-cull labels, and avoid per-frame hierarchy recomputation. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md] |

## Sources

### Primary (HIGH confidence)
- `/home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md` — locked phase decisions D-01..D-17, scope exclusions, integration points. [VERIFIED: file read]
- `/home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-UI-SPEC.md` — exact semantic bands, crossfade width, render order, copy, typography, performance contract. [VERIFIED: file read]
- `/home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx` — current render orchestration, bridge/file split, hit-test flow, zoom HUD. [VERIFIED: file read]
- `/home/prannayag/pragnition/htx/aitc/src/views/Radar/GraphRenderer.ts` — current `shouldRenderHullAtZoom`, file-label threshold, render primitives. [VERIFIED: file read]
- `/home/prannayag/pragnition/htx/aitc/src/views/Radar/hullCache.ts` — cache keying, duplicate zoom gate, bridge exclusion, centroid/hull data. [VERIFIED: file read]
- `/home/prannayag/pragnition/htx/aitc/src/stores/radarStore.ts` — graph node shape, parent/own-file maps, bridge DTO fields, contention scores. [VERIFIED: file read]
- `/home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps/extract.rs` — existing tree-sitter parser/cache/guard pattern. [VERIFIED: file read]
- D3 official docs for `d3-polygon`, `d3-shape`, and `d3-quadtree`. [CITED: https://d3js.org/d3-polygon] [CITED: https://d3js.org/d3-shape/line] [CITED: https://observablehq.com/@d3/d3-quadtree#quadtree_find]
- React official docs for `useMemo` and `useSyncExternalStore`. [CITED: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useMemo.md] [CITED: https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useSyncExternalStore.md]
- MDN Canvas optimization guide. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas]

### Secondary (MEDIUM confidence)
- npm registry version checks for React, Zustand, D3 packages, Vitest, and TypeScript. [VERIFIED: npm registry]
- Context7 CLI fallback for React official docs returned current API excerpts; D3 subpackage lookups resolved to general D3 but subpackage docs were fetched through official WebFetch. [VERIFIED: Context7 CLI / WebFetch]

### Tertiary (LOW confidence)
- None used as an implementation driver; all `[ASSUMED]` claims are listed in Assumptions Log or Security Domain. [VERIFIED: this file]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified from `package.json`, `Cargo.toml`, and npm registry; no new core dependency recommended. [VERIFIED: /home/prannayag/pragnition/htx/aitc/package.json] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/Cargo.toml] [VERIFIED: npm registry]
- Architecture: HIGH — constrained by locked context/UI spec and current Radar code. [VERIFIED: /home/prannayag/pragnition/htx/aitc/.planning/phases/13-implement-4-level-semantic-zoom-workspace-package-blobs-only/13-CONTEXT.md] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/RadarCanvas.tsx]
- Pitfalls: HIGH for renderer/cache/performance pitfalls; MEDIUM for signature-extraction scope because exported-symbol support was not found. [VERIFIED: /home/prannayag/pragnition/htx/aitc/src/views/Radar/GraphRenderer.ts] [VERIFIED: /home/prannayag/pragnition/htx/aitc/src-tauri/src/pipeline/deps/extract.rs]

**Research date:** 2026-05-03 [VERIFIED: system currentDate]
**Valid until:** 2026-06-02 for renderer architecture; re-check npm/React/tool versions after 30 days. [ASSUMED]
