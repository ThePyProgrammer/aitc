# Phase 22: Bridge Layer Visual Polish — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `22-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 22-bridge-layer-visual-polish-aura-hulls-labels-dangling-state
**Mode:** `--auto` (all gray areas auto-selected; recommended option picked per question)
**Areas discussed:** Fix 1 (aura), Fix 2 (hull membership), Fix 3 (anchor-label contrast), Fix 4 (dangling signal), Plan grouping, Testing strategy

---

## Fix 1 — Aura removal (RadarCanvas render sequence)

### Q1: Where should the `kind === 'bridge'` filter live?

| Option | Description | Selected |
|--------|-------------|----------|
| Upstream in `RadarCanvas.tsx` — introduce a `fileNodes` snapshot alongside `bridgeNodes` and thread it into `drawNodes` + `drawFileLabels` | Draw functions stay pure (render whatever given); kind-awareness lives in the orchestration layer | ✓ |
| Inside `drawNodes` / `drawFileLabels` — add a `if (n.kind === 'bridge') continue` guard per draw | Keeps caller contract simpler but leaks kind-awareness into pure draw primitives | |
| Filter at the store selector layer — `useRadarStore(s => s.graphNodes.filter(n => n.kind !== 'bridge'))` | Over-engineers the Zustand selector graph; adds a second subscription where one suffices | |

**Auto-selected:** Upstream in `RadarCanvas.tsx` — matches the existing `bridgeNodes` snapshot pattern at :705; zero new state; preserves draw-function purity per Phase 12's established convention.

### Q2: Memoize the filter with `useMemo`?

| Option | Description | Selected |
|--------|-------------|----------|
| No memoization — inline `.filter()` per frame | O(N) on ≤ few-thousand nodes; negligible cost vs render loop budget | ✓ |
| Memoize with `useMemo(() => liveNodes.filter(...), [liveNodes])` | Defensive but adds React dep-graph complexity for zero measurable win; `liveNodes` reference identity changes every Phase 11.1 positions writeback anyway | |

**Auto-selected:** No memoization — D-02 captures the rationale; planner may revisit if profiling shows a regression (unlikely).

### Q3: Should `drawFolderHulls` also receive `fileNodes`?

| Option | Description | Selected |
|--------|-------------|----------|
| No — Fix 2 (`hullCache.ts` kind-skip) is the authoritative single-source-of-truth fix for hull membership | Avoids two filters masking each other; keeps the hull-membership invariant in one place | ✓ |
| Yes — defense-in-depth filter both layers | Adds redundant work; if a future bug surfaces at `getHullCache`, the RadarCanvas-side filter would hide it | |

**Auto-selected:** No — D-03/D-05 enforce single source of truth.

---

## Fix 2 — Bridges excluded from folder hulls

### Q1: Which loop in `hullCache.ts` gets the kind-skip?

| Option | Description | Selected |
|--------|-------------|----------|
| The group-by-dirKey loop at `hullCache.ts:86` — add `if (n.kind === 'bridge') continue` alongside the existing `n.dirKey === ''` and `n.x === undefined` guards | Single line; matches the roadmap prescription; prevents bridges from ever entering `byDir` | ✓ |
| A post-group filter — drop bridges after `byDir` is assembled | Extra pass over the grouped map; same behavior, more code | |
| A pre-loop filter — `nodes = nodes.filter(n => n.kind !== 'bridge')` before the `for` loop | Creates an extra intermediate array; same behavior, more allocation per cache miss | |

**Auto-selected:** Inside the group-by-dirKey loop at :86 — D-04.

### Q2: Document the invariant where?

| Option | Description | Selected |
|--------|-------------|----------|
| One-line module doc-comment at top of `hullCache.ts` | Terse; discoverable by anyone touching the file; no phase-number annotation (per user memory rule) | ✓ |
| Inline comment at the new guard line only | Localized; easy to miss during a module-level refactor | |
| Separate `hullCache.md` doc file | Overkill for a single invariant | |

**Auto-selected:** Module doc-comment — D-06.

---

## Fix 3 — FRONTEND/BACKEND anchor label contrast

### Q1: Which `GraphTheme` token for the label color?

| Option | Description | Selected |
|--------|-------------|----------|
| `theme.fileLabelColor` — existing token used for high-zoom file-name labels; tuned for legibility across all 9 themes | Closest in-palette analog to roadmap's "onSurface"; zero new theme authoring | ✓ |
| `theme.onSurface` — roadmap's literal token name | `GraphTheme` does not expose this token (confirmed in `src/views/Radar/themes.ts:17`); would require adding a new field to every theme | |
| `theme.nodeStroke` — reused from the bridge diamond stroke | Wrong semantic weight; too thin; reads as edge chrome | |
| Hardcoded `#ffffff` or `#e0ffd4` | Breaks the theme contract; 9 themes would need per-theme tuning anyway | |

**Auto-selected:** `theme.fileLabelColor` — D-07. `GraphTheme` does not have `onSurface`; `fileLabelColor` is the legibility-tuned analog.

### Q2: Alpha levels for the bold and thin label rows?

| Option | Description | Selected |
|--------|-------------|----------|
| Bold 1.0 / Thin 0.85 (current 0.8 / 0.55) | Screen-space labels must survive theme + heat-map saturation; near-full on thin keeps hierarchy | ✓ |
| Bold 1.0 / Thin 1.0 | Eliminates the visual hierarchy between FRONTEND and TypeScript — bold label would no longer dominate | |
| Bold 0.9 / Thin 0.7 | Compromise; insufficient contrast in busy regions is the original complaint | |

**Auto-selected:** Bold 1.0 / Thin 0.85 — D-08.

### Q3: Backdrop shape + color?

| Option | Description | Selected |
|--------|-------------|----------|
| Zero-radius padded `fillRect` per label stack (FRONTEND+TypeScript one pill, BACKEND+Rust second pill); color `theme.canvasBackground` at 80% opacity | Matches Command Horizon zero-radius constraint; nearest GraphTheme analog to roadmap's "surface/80"; ~80% opacity guarantees legibility without obscuring underlying content | ✓ |
| Rounded pill (`arcTo` radius 4px) | Violates Command Horizon zero-radius corners | |
| Full-canvas-width bar across the label y-band | Too obtrusive; dominates the viewport | |
| No backdrop, rely on alpha raise alone | Already identified as insufficient — original D-34 finding | |

**Auto-selected:** Zero-radius padded `fillRect` with `canvasBackground@80%` — D-09/D-10/D-11.

### Q4: Apply backdrop per-label or per-stack?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-stack — one pill wrapping FRONTEND+TypeScript, one wrapping BACKEND+Rust | Two draw calls; visually cohesive as "one axis marker" | ✓ |
| Per-label — four pills (one per text line) | Four draw calls; visually fragmented | |

**Auto-selected:** Per-stack — D-09.

---

## Fix 4 — Dangling bridge visual signal

### Q1: What becomes the primary dangling signal?

| Option | Description | Selected |
|--------|-------------|----------|
| Colour (fill token swap); stroke pattern dropped | Roadmap prescription; colour carries signal reliably at every zoom; dashed 1px on 8-unit glyph fails contrast | ✓ |
| Keep dashed stroke, add colour on top | Double signal; more visual noise; doesn't address the root readability failure | |
| Stroke weight — thicker stroke for populated, thinner for dangling | Collides with channel-bearing double-stroke signal (D-17 Phase 12) | |

**Auto-selected:** Colour primary; stroke pattern dropped — D-12/D-14.

### Q2: Concrete dangling fill token?

| Option | Description | Selected |
|--------|-------------|----------|
| `theme.nodeFill` at full opacity — default surface-container color used by file nodes | "Exists but inert" reads consistent with empty/low-contention file node; does not bisect against boundary line | ✓ |
| Fully transparent fill (canvas shows through) | Boundary line passes through diamond interior and bisects the glyph — perceptual noise | |
| `theme.hullFill` — very low alpha | Too faint; bridge disappears at low zoom | |
| Custom grey hex `#3a3a3a` | Breaks the theme contract; requires per-theme tuning | |

**Auto-selected:** `theme.nodeFill` — D-13.

### Q3: Stroke color for both states?

| Option | Description | Selected |
|--------|-------------|----------|
| `theme.nodeStroke` uniformly (current) | Silhouette stays pixel-identical; hit-test / selection-ring / channel double-stroke alignment preserved | ✓ |
| Different stroke per state (e.g. dimmer for dangling) | Adds a third signal for zero contrast win; risks collision with channel double-stroke | |

**Auto-selected:** `theme.nodeStroke` for both — D-15.

### Q4: `BRIDGE_DASH_PATTERN` constant — delete or retain?

| Option | Description | Selected |
|--------|-------------|----------|
| Retain with eslint-disable comment; delete in later housekeeping pass | Preserves optionality for future secondary signals (e.g. dangling-on-dangling); trivial cost | ✓ |
| Delete outright in Plan 22-02 | Clean; forecloses on a future use of the constant | |

**Auto-selected:** Retain with comment — D-14.

---

## Plan grouping

### Q1: How many plans should Phase 22 decompose into?

| Option | Description | Selected |
|--------|-------------|----------|
| 2 plans — 22-01 render-layer composition (Fix 1 + Fix 2); 22-02 BridgeRenderer visual tokens (Fix 3 + Fix 4) | Grouped by file overlap (RadarCanvas+hullCache vs BridgeRenderer); matches roadmap "~2-3 plans" guidance; disjoint files allow parallel or sequential execution | ✓ |
| 1 plan monolith — all four fixes in one plan | Over-stretches verification matrix; commit-after-each-change ceremony gets noisy | |
| 4 plans — one per fix | Over-fragments; each plan is ~30 lines of diff; ceremony dominates the work | |
| 3 plans — 22-01 RadarCanvas composition; 22-02 hullCache membership; 22-03 BridgeRenderer tokens | Splits Fix 1 and Fix 2 even though they share the composition theme; adds a third plan with minimal new review surface | |

**Auto-selected:** 2 plans — D-17.

### Q2: Execution order dependency between plans?

| Option | Description | Selected |
|--------|-------------|----------|
| No dependency — plans touch disjoint files and can run in parallel worktrees or sequentially | RadarCanvas.tsx + hullCache.ts (22-01) vs BridgeRenderer.ts (22-02) have zero overlap | ✓ |
| 22-01 before 22-02 | Artificial ordering; no technical dependency | |
| 22-02 before 22-01 | Same — artificial | |

**Auto-selected:** No dependency — D-19; planner picks wave layout during `/gsd-plan-phase`.

---

## Testing strategy

### Q1: Where do new witnesses live?

| Option | Description | Selected |
|--------|-------------|----------|
| Co-located under `src/views/Radar/__tests__/` with `{component}.{concern}.test.ts` naming | Matches Phase 12 convention; existing test harness + Vitest config | ✓ |
| Separate Phase 22 test directory `src/views/Radar/__tests__/phase22/` | Breaks the co-location convention; adds indirection | |
| Extend only existing Phase 12 test files | Loses the "new witness per new invariant" granularity; W-22-01..W-22-07 span multiple file concerns | |

**Auto-selected:** Co-located with existing convention — D-20.

### Q2: D-34-style human smoke checkpoint?

| Option | Description | Selected |
|--------|-------------|----------|
| Optional — planner adds a `22-NN-CHECKPOINT.md` only if automated witnesses can't cover a subjective concern (e.g. 9-theme readability) | Polish-only scope; automated witnesses cover the change surface; avoids D-34-scale ceremony for smaller fixes | ✓ |
| Mandatory — require human sign-off analogous to Phase 12 D-34 | Over-weights ceremony for a polish phase | |
| Skip entirely — automated only | Loses the eyeball pass across 9 themes for Fix 3 backdrop alpha tuning | |

**Auto-selected:** Optional — D-23.

### Q3: Phase 12 witness regression policy?

| Option | Description | Selected |
|--------|-------------|----------|
| V-12-15..V-12-24 remain green; pre-existing failures logged in Phase 12 `deferred-items.md` continue as-is | Zero tolerance for new regressions; zero obligation to fix pre-existing failures that predate Phase 22 (user memory rule: "only fix own bugs") | ✓ |
| Also fix the pre-existing HeatMapOverlay + MasterDetailShell + useGraphLayout flakes | Out of scope; those originate in Phase 06/07/11 and violate the only-fix-own-bugs rule | |

**Auto-selected:** V-12-15..V-12-24 green; pre-existing failures untouched — D-22.

---

## Claude's Discretion (areas left flexible for the planner)

- Whether to memoize `fileNodes = liveNodes.filter(...)` — current guidance: don't.
- Whether to extract `drawLabelWithBackdrop` helper in BridgeRenderer — either is fine; helper is cleaner if the right-edge mirror (deferred) ever lands.
- Exact backdrop alpha (0.8 recommended; 0.7–0.85 acceptable after theme smoke).
- Exact pill padding (8px horizontal, 4px vertical recommended; tune ±2px per theme).
- Whether to delete `BRIDGE_DASH_PATTERN` immediately or retain with a comment — recommended retain-with-comment.
- Whether to promote `fileLabelColor` to a dedicated `axisLabelColor` GraphTheme field — not today.
- Zoom-aware pill padding — not needed (screen-space labels).

## Deferred Ideas

- BOUNDARY slider responsiveness polish (Phase 12 D-34 5th finding) — filed as potential quick-task post-Phase-22 smoke, not pulled into Phase 22 scope.
- Right-edge FRONTEND/BACKEND label mirror — Phase 12 `<deferred>` item; follow-up when user surfaces.
- First-class `theme.axisLabelColor` token — when a second axis-label surface lands.
- Per-theme backdrop opacity override — extend `GraphTheme` if a specific theme clashes at 0.8.
- All other Phase 12 `<deferred>` items — untouched by Phase 22.
