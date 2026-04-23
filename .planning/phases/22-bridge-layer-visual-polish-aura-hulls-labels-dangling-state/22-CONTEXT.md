# Phase 22: Bridge Layer Visual Polish — Context

**Gathered:** 2026-04-23
**Mode:** `--auto` (recommended defaults auto-selected; see 22-DISCUSSION-LOG.md for per-question log)
**Status:** Ready for planning

<domain>
## Phase Boundary

Polish-only follow-up to Phase 12 surfacing from the 2026-04-22 D-34 UAT smoke. Four discrete rendering/layering defects sit on top of a working bridge-layer deliverable. Phase 12's 24 automated witnesses (V-12-15..V-12-24) and the D-34 human checklist remain the acceptance gate — every fix here is additive, does not invalidate any Phase 12 witness, and carries no schema/worker-protocol/dependency change.

**In scope (four fixes):**

1. **Aura bug at `RadarCanvas.tsx:724-735`.** `drawNodes` + `drawFileLabels` receive the unfiltered `liveNodes`, so every bridge `GraphNode` is drawn as a 5px file-node circle underneath the diamond from `drawBridgeNodes`. The two render passes use different zoom-scaling math (`drawNodes` fixed world-space radius vs `drawBridgeNodes` `BRIDGE_HALF_DIAG / zoom`), producing a visible halo that inverts across zoom: aura > diamond at low zoom, aura < diamond at high zoom.
2. **Bridges pulled into folder hull computation at `hullCache.ts:86`.** `getHullCache` groups by `dirKey` without a `kind` filter. Bridges inherit their handler file's `dirKey` (Phase 12 D-10 stores them alongside file nodes in `graphNodes`), so each bridge tugs its folder's hull centroid toward `y=0`. Hulls visibly envelop or elongate toward the boundary line on any folder that owns at least one `#[tauri::command]`.
3. **FRONTEND/BACKEND anchor labels blend into chrome** (`BridgeRenderer.ts:232` + `drawBoundaryAnchorLabels`). Labels are drawn with `theme.folderLabelColor ?? theme.nodeStroke` — the same token as folder labels — at 0.8/0.55 alpha. They read as folder chrome, not as axis markers. On busy graph regions the bold "FRONTEND"/"BACKEND" glyphs lose against the background.
4. **Dangling-vs-populated bridge distinction too subtle** (`BridgeRenderer.ts:114-134`). D-09/D-17 locked "dashed stroke for dangling, solid for populated", but at `BRIDGE_HALF_DIAG = 8` world-space, the 1px `[4, 3]` dash pattern is genuinely hard to see on an 8-unit shape — especially at low zoom where the line thickness collapses. Both dangling and populated bridges share the same cyan fill, so colour carries zero signal.

**Out of scope (explicitly not this phase):**

- Any new bridge capability (telemetry, invoke animation, deep-link, drag-to-pin, event push, HTTP/MCP bridges — all deferred per Phase 12 `<deferred>`).
- Schema / DTO / worker-protocol changes (`IpcBridgeDto`, `EdgeKind.invokes|handles`, `ForceConfig.boundaryStrength`, `GraphNode.kind|language` all remain exactly as Phase 12 landed them).
- New dependencies, new Tauri commands, new tree-sitter queries.
- New force, new slider — existing `boundaryStrength` continues to own FE/BE bifurcation.
- DB migration, SQLite touch, `src/bindings.ts` regen (no new Rust command).
- Phase 17 UAT gap-closure (separate track; still awaiting 17-06-CHECKPOINT sign-off).

**Acceptance gate:** Phase 12's V-12-15..V-12-24 remain green. New Phase 22 witnesses cover the specific fixes (aura-absence on bridges, hull-membership exclusion, label-contrast backdrop presence, dangling-fill token). Roadmap guidance: planner should scope to ~2-3 plans grouped by file overlap.

</domain>

<decisions>
## Implementation Decisions

### Fix 1 — Aura removal (RadarCanvas render sequence)

- **D-01:** **Filter `liveNodes` upstream in `RadarCanvas.tsx` before `drawNodes` + `drawFileLabels`.** Introduce one `fileNodes` snapshot alongside the existing `bridgeNodes` snapshot (already computed for the boundary-line gate, `RadarCanvas.tsx:705`). Both `drawNodes` (:724) and `drawFileLabels` (:737) receive `fileNodes` instead of `liveNodes`. `drawBridgeNodes` and `drawBridgeLabels` continue to receive `bridgeNodes`. Rationale over alternative (filter inside `drawNodes`/`drawFileLabels`): draw functions stay pure — they render whatever they're given; kind-awareness belongs in the orchestration layer. Also gives `drawFolderHulls` and `drawEdges` the option to receive the same filtered snapshot if later decisions surface similar bleed (not needed today — edges reference nodes by id not by draw loop, hulls are fixed by D-02 below).
- **D-02:** **Keep the filter cheap.** `liveNodes` is already a filtered array (Phase 11.1 wired the positions writeback through `livePositions` + `liveNodes`). Bridge count is ≤ ~52 out of typical 300-3000 file nodes; a single `.filter(n => n.kind !== 'bridge')` on each frame is O(N) and already absorbed by the draw loop. Do not memoize — memoization here complicates the React dep graph for zero measurable win. Phase 11.1 D-05..D-11 (wheel-event + hull-cache invariants) must not regress.
- **D-03:** **`drawFolderHulls` is NOT in the filter chain.** It consumes `liveNodes` via `getHullCache`, and D-04 below fixes the bridge contamination at the cache level — that is the single authoritative source for hull membership. Adding a second filter on the caller side would mask the real bug and invite drift.

### Fix 2 — Bridges excluded from folder hulls

- **D-04:** **Skip `n.kind === 'bridge'` in the group-by-dirKey loop in `hullCache.ts:86`.** Single line inside the `for (const n of nodes)` block, next to the existing `n.dirKey === ''` and `n.x === undefined` guards. Bridges drop out of `byDir` entirely; they never enter `paddedHullPoints` / `polygonHull` / centroid math. Cache epoch (`settledAt|zoomBucket`) is unchanged — the fix is a membership correction inside an existing cache, not a new cache. Witness: after fix, `getHullCache` output contains zero bridge-node points across all themes and zoom buckets.
- **D-05:** **Do NOT add a second kind filter at `drawFolderHulls`.** The renderer consumes whatever the cache gives it. One source of truth for hull membership — `getHullCache`. Mirrors the D-02 rationale: purity downstream, authority upstream.
- **D-06:** **Invariant to document in the hullCache module doc-comment.** Add a one-line note at the top of `hullCache.ts` stating "Bridges (`kind === 'bridge'`) are excluded from hull membership — they are pinned on the y=0 boundary line and would drag folder centroids toward it." Prevents future reintroduction during refactors. Keep the comment terse; no phase reference (memory rule: don't annotate code with phase numbers).

### Fix 3 — FRONTEND/BACKEND anchor label contrast

- **D-07:** **Swap label color token from `theme.folderLabelColor` to `theme.fileLabelColor`** in `drawBoundaryAnchorLabels` (`BridgeRenderer.ts:232`). `GraphTheme` does not expose an `onSurface` token (confirmed by inspecting `src/views/Radar/themes.ts`); `fileLabelColor` is the nearest in-palette analog — it is the token used for high-zoom file-name labels and is tuned for legibility against busy graph regions in every theme variant. `folderLabelColor` is deliberately low-alpha "chrome" for folder labels; reusing it for axis markers was the root cause.
- **D-08:** **Raise alpha to full opacity on the bold row, near-full on the thin row.** Current: FRONTEND/BACKEND bold rows at `globalAlpha = 0.8`, TypeScript/Rust thin rows at `0.55`. New: bold rows at `1.0`, thin rows at `0.85`. These are screen-space labels that must survive whatever theme + heat-map saturation happens behind them.
- **D-09:** **Add a padded backdrop pill behind each label stack** (FRONTEND+TypeScript as one pill, BACKEND+Rust as a second pill). Backdrop color: `theme.canvasBackground` at 80% opacity — the closest GraphTheme analog to the roadmap's "surface/80". Pill geometry: `measureText` width + 8px horizontal padding; height = label line-height + 4px top/bottom padding; 0-radius rounded rect (Command Horizon "zero-radius corners" per PROJECT.md constraint). Drawn once per pill immediately before the `fillText` call. Remains screen-space (identity transform); never scales with zoom.
- **D-10:** **Apply backdrop BEFORE text, inside the same `ctx.save()/ctx.restore()` envelope.** Single new `ctx.fillRect` per pill with `ctx.fillStyle = <canvasBackground@80%>`. Reset `fillStyle` to label color before the `fillText` call. Do not introduce `ctx.globalCompositeOperation` tricks — plain fillRect + fillText is sufficient and cheapest.
- **D-11:** **Backdrop is opt-in per-theme via `theme.canvasBackground` hex + alpha override.** Every theme in `THEMES` already has a `canvasBackground`. Compose with `80` hex alpha suffix (`{canvasBackground}cc` if hex; if the theme's canvasBackground is already rgba/hsl the helper falls back to `rgba(...)` with 0.8 alpha). A one-line helper lives next to the new pill-draw code. No new theme token.

### Fix 4 — Dangling bridge visual signal

- **D-12:** **Colour becomes the primary dangling signal; stroke pattern becomes secondary (dropped).** Dangling bridges render with a **muted/transparent fill** and a **solid** stroke. Populated bridges render with the existing cyan fill (`theme.edgeGlow ?? theme.arrowFill ?? '#00cffc'`) and a solid stroke. Channel-bearing double-stroke (`hasChannelArg === true`) continues to work unchanged on BOTH states (D-17 Phase 12 invariant preserved).
- **D-13:** **Concrete dangling fill: `theme.nodeFill` at full opacity.** `nodeFill` is the default surface-container color used by all file nodes when no heat tint applies; reusing it gives dangling bridges a "this exists but is inert" surface treatment consistent with empty/low-contention file nodes. Alternative considered (fully transparent fill showing canvas through): rejected — the boundary line passes through the diamond interior and would bisect the glyph, causing perceptual noise.
- **D-14:** **Drop the `setLineDash(BRIDGE_DASH_PATTERN)` call for dangling bridges** (`BridgeRenderer.ts:132`). Leave `BRIDGE_DASH_PATTERN` constant in place for a release — explicitly un-export it and add an eslint-disable-next-line "unused" plus a one-line comment "retained for optional future stroke-pattern decoration; dangling now carries colour as primary signal". Remove fully in the next cleanup pass (deferred).
- **D-15:** **Stroke colour stays `theme.nodeStroke` for both states.** The stroke carries "this is a bridge" — fill carries populated-vs-dangling. Uniform stroke keeps the diamond silhouette identical so hit-testing / selection ring / channel double-stroke alignment is pixel-stable.
- **D-16:** **Tooltip + detail panel signals are unchanged.** `BridgeTooltip` already shows `DANGLING — NO CALLERS` / `DANGLING — NO HANDLER` rows (Phase 12 Plan 05); the D-12..D-15 changes complement that text signal without replacing it.

### Fix grouping into plans (planner guidance)

- **D-17:** **Recommended plan decomposition: 2 plans**, grouped by file overlap.
  - **Plan 22-01 — Render-layer composition fixes** (Fix 1 + Fix 2): touches `src/views/Radar/RadarCanvas.tsx` (bridge-filter upstream) and `src/views/Radar/hullCache.ts` (kind-skip in group-by-dirKey). Two files, one conceptual theme ("kind-aware draw-loop composition"). New witness files: `src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts` (asserts `drawNodes` receives zero `kind === 'bridge'` nodes) + `src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts` (asserts cache output excludes bridge points across themes + zoom buckets).
  - **Plan 22-02 — BridgeRenderer visual tokens** (Fix 3 + Fix 4): touches `src/views/Radar/BridgeRenderer.ts` only (anchor label color + backdrop pill; dangling fill + stroke simplification). Existing `src/views/Radar/__tests__/BridgeRender.test.ts` extends to cover the new dangling fill token and stroke-pattern absence; existing `src/views/Radar/__tests__/BoundaryLine.test.ts` extends to cover the anchor-label backdrop pill + `fileLabelColor` token swap.
- **D-18:** **Alternative grouping rejected:** one-plan-per-fix (4 plans) — over-fragments for the file overlap and multiplies commit ceremony. Single-plan monolith — stretches the verification matrix and makes the commit-after-each-change invariant noisier. Two plans with the grouping above is the balance point.
- **D-19:** **No execution-order dependency between plans.** Plan 22-01 and Plan 22-02 touch disjoint files (RadarCanvas/hullCache vs BridgeRenderer). They can execute in parallel worktrees or sequentially — planner picks wave layout during `/gsd-plan-phase`.

### Testing (witness strategy)

- **D-20:** **New Phase 22 witnesses are co-located with existing Phase 12 radar tests** under `src/views/Radar/__tests__/`. Naming convention: `{component}.{concern}.test.ts` (e.g. `hullCache.bridgeExclusion.test.ts`). Mirrors Phase 12 `BridgeRender.test.ts` / `BoundaryLine.test.ts` pattern.
- **D-21:** **Concrete witness list (planner expands into plan manifests):**
  - `W-22-01` (Plan 22-01): `drawNodes` call in RadarCanvas render loop receives an array with `every(n => n.kind !== 'bridge')` when `bridgeNodes.length > 0`.
  - `W-22-02` (Plan 22-01): `drawFileLabels` call in the same render loop receives the same filtered array.
  - `W-22-03` (Plan 22-01): `getHullCache` returns zero bridge points across all cache entries for a mixed file+bridge node set; invariant documented in the module doc-comment.
  - `W-22-04` (Plan 22-02): `drawBoundaryAnchorLabels` resolves label color from `theme.fileLabelColor` (not `folderLabelColor`); bold glyphs render at globalAlpha 1.0.
  - `W-22-05` (Plan 22-02): `drawBoundaryAnchorLabels` emits a zero-radius `fillRect` per label stack before the `fillText` call; rect fill is `theme.canvasBackground` at 80% alpha.
  - `W-22-06` (Plan 22-02): `drawBridgeNodes` resolves dangling fill to `theme.nodeFill`; populated fill remains `theme.edgeGlow ?? theme.arrowFill ?? '#00cffc'`; neither state calls `setLineDash` (`getLineDash()` returns `[]` at stroke time for both).
  - `W-22-07` (Plan 22-02): channel-bearing double-stroke geometry is unchanged across dangling AND populated states (regression witness for D-17 Phase 12 invariant).
- **D-22:** **Phase 12 witnesses V-12-15..V-12-24 must remain green.** CI gate: run `npm run test -- --run` full-suite post-merge; the four pre-existing failures already logged in Phase 12 `deferred-items.md` (HeatMapOverlay, 2× MasterDetailShell, useGraphLayout flake) continue as-is — they are not Phase 22's scope.
- **D-23:** **D-34-style human smoke checkpoint is OPTIONAL for Phase 22.** Automated witnesses + a single cargo-free `npm run build` green cover the change surface. If the planner sees a concern the automated pass can't surface (e.g. subjective readability across the 9 themes), they can add a `22-NN-CHECKPOINT.md` to match Phase 12 Plan 05's pattern — planner's discretion.

### Claude's Discretion

- Whether to memoize the `fileNodes = liveNodes.filter(n => n.kind !== 'bridge')` split via `useMemo` keyed on `liveNodes` reference identity. Current guidance: don't memoize; cost is negligible. Planner may add memoization if profiling shows render-loop impact (unlikely).
- Whether to extract a small `drawLabelWithBackdrop` helper inside `BridgeRenderer.ts` shared by the FRONTEND and BACKEND pills, or inline each pill. Either is acceptable; helper is cleaner if the Phase 12 `<deferred>` right-edge label mirror ever lands.
- Exact backdrop alpha (0.8 is a recommendation; 0.7–0.85 is reasonable if a specific theme reads better). Pick one per full theme-cycle eyeball test.
- Exact pill padding (recommendation: 8px horizontal, 4px vertical). May be tuned ±2px per theme smoke.
- Whether the `BRIDGE_DASH_PATTERN` constant is deleted outright in Plan 22-02 or retained with an eslint-disable. Recommended: retain-and-comment. Small cost; preserves optionality if a future dangling-on-dangling nesting needs a secondary signal.
- Whether to backfill a `theme.axisLabelColor` token across all 9 themes as a first-class GraphTheme field. Over-engineering for a single use-site today; `fileLabelColor` reuse covers the contract. If a second axis-label surface is introduced later (e.g. right-edge mirror labels), promote to a dedicated token in that phase.
- Whether to add a zoom-aware pill padding (pill grows with effective text width as zoom scales screen-space font remains fixed — it doesn't). Irrelevant; labels are screen-space and always pixel-fixed per D-09.
- Whether the dangling-fill swap justifies touching the Phase 12 `<deferred>` item "dangling-on-dangling commands" note. It does not — dangling commands are a count-zero edge case in this repo; revisit if count grows.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + State
- `.planning/ROADMAP.md` §"Phase 22" — full phase scope statement with the four fix specifications, the ~2-3 plans grouping hint, and the deferred BOUNDARY-slider 5th item
- `.planning/STATE.md` — current milestone progress (15/22 phases done, Phase 12 shipped 2026-04-22, Phase 22 filed as follow-up polish)
- `.planning/PROJECT.md` §"Constraints" — Tauri v2 + React + TS; Command Horizon design system; zero-radius corners governs D-09 backdrop geometry

### Phase 12 (the deliverable being polished)
- `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-CONTEXT.md` — **full Phase 12 decisions**; D-09 (dangling render), D-10 (bridges stored in graphNodes with kind discriminator), D-15 (boundary line draw), D-17 (bridge diamond geometry + channel double-stroke), D-31 (z-order render sequence), D-33 (frontend test pattern) are the invariants Phase 22 must preserve
- `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-UI-SPEC.md` — **UI-SPEC deltas** for bridge layer; §Component Inventory (diamond geometry constants), §Layout screen-space labels (FRONTEND/BACKEND anchor spec), §Progressive Detail ≥ 4× (bridge label threshold)
- `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-05-CHECKPOINT.md` — **D-34 UAT report**; enumerates the four fixes as "visual-polish findings that do not invalidate the Phase 12 deliverable" — the originating document for this phase
- `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-VERIFICATION.md` — Phase 12 witness ledger (V-12-15..V-12-24); these remain green through Phase 22
- `.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/deferred-items.md` — pre-existing test failures Phase 22 does NOT attempt to fix (HeatMapOverlay expectation drift, MasterDetailShell Tailwind v4 arbitrary-value drift, useGraphLayout worker flake)

### Phase 11 / 11.1 (invariants to preserve during the filter change)
- `.planning/phases/11-move-d3-force-simulation-to-a-webworker-with-transferable-fl/11-CONTEXT.md` — worker protocol + `ForceConfig` shape; Phase 22 must NOT widen either
- `.planning/phases/11.1-fix-zoom-scroll-lag-in-radarcanvas-wheel-event-raf-coalescin/11.1-CONTEXT.md` — D-05..D-11 (wheel RAF coalescing + hull cache key); Phase 22's `liveNodes.filter(...)` must not regress the cache hit-rate or introduce per-frame Zustand writes

### Design System
- `wireframes/vector_terminal/DESIGN.md` — Command Horizon: zero-radius corners (governs D-09 backdrop pill), phosphor palette, JetBrains Mono / Space Grotesk typography scale
- `CLAUDE.md` §"Data Visualization" — Canvas 2D + visx math; Phase 22 touches only Canvas 2D draw functions

### Existing Frontend Code (files Phase 22 modifies)
- `src/views/Radar/RadarCanvas.tsx:705-755` — render-loop; `bridgeNodes` computed at :705 already, Fix 1 mirrors the split for `liveNodes` and threads `fileNodes` into `drawNodes` + `drawFileLabels`
- `src/views/Radar/hullCache.ts:72-115` — `getHullCache` function; Fix 2 adds a kind-skip inside the `for (const n of nodes)` loop at :86
- `src/views/Radar/BridgeRenderer.ts:94-256` — bridge + boundary render functions; `drawBridgeNodes` (Fix 4) at :94, `drawBoundaryAnchorLabels` (Fix 3) at :218
- `src/views/Radar/themes.ts` — `GraphTheme` interface (§export interface GraphTheme at :17); all 9 themes have `fileLabelColor` + `nodeFill` + `canvasBackground` — Fix 3 + Fix 4 consume these; no new token added

### Existing Tests (patterns to follow + extend)
- `src/views/Radar/__tests__/BridgeRender.test.ts` — bridge diamond geometry + dangling dash tests; extend for Fix 4 (new dangling fill token, absence of `setLineDash`)
- `src/views/Radar/__tests__/BoundaryLine.test.ts` — boundary-line + anchor-label tests; extend for Fix 3 (`fileLabelColor` token swap + backdrop rect presence)
- `src/views/Radar/__tests__/forceBoundary.test.ts` — force-convergence pattern; not modified by Phase 22 but must remain green

### Files to Create (planner discretion)
- `src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts` (Plan 22-01) — asserts `drawNodes` + `drawFileLabels` receive bridge-free array snapshot
- `src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts` (Plan 22-01) — asserts `getHullCache` excludes `kind === 'bridge'` across themes + zoom buckets

### Rust-side (explicitly untouched)
- `src-tauri/src/pipeline/ipc_bridges/**` — zero change. No new command, no DTO change, no bindings regen.
- `src-tauri/src/lib.rs` — `collect_commands![…]` block untouched.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`liveNodes` + `bridgeNodes` snapshot pattern already exists** in `RadarCanvas.tsx` — `bridgeNodes` is computed inline at :705 for the boundary-line gate; adding a `fileNodes` sibling follows the same shape. Zero new state, zero new `useMemo`, zero ref.
- **`getHullCache` cache epoch + guard pattern** (`hullCache.ts:77-88`) — adding a `n.kind === 'bridge'` continue at :86 mirrors the existing `n.dirKey === ''` and `n.x === undefined` guards. One-line addition.
- **`drawBoundaryAnchorLabels`** (`BridgeRenderer.ts:218-256`) — single `ctx.save()/ctx.restore()` envelope; adding `ctx.fillRect` for pill backdrop stays inside that envelope.
- **`drawBridgeNodes`** (`BridgeRenderer.ts:94-174`) — per-bridge fill/stroke branching on `isSelected`/`isDangling`/`hasChannel` is already in place; Fix 4 swaps the dangling branch's `fillStyle` + removes the `setLineDash` call.
- **`theme.fileLabelColor`, `theme.nodeFill`, `theme.canvasBackground`** present on every `GraphTheme` in `THEMES` catalog — no theme authoring required.
- **Existing Vitest radar tests** (`BridgeRender.test.ts`, `BoundaryLine.test.ts`) — extend with new `describe()` blocks; no new test harness.

### Established Patterns

- **Pure draw functions** — `drawNodes`, `drawBridgeNodes`, `drawFolderHulls` etc. all render whatever they're given. Kind-awareness lives in the orchestration layer (`RadarCanvas.tsx`) or the cache layer (`hullCache.ts`), never inside a draw function. D-01..D-05 preserve this.
- **Single source of truth for hull membership** — `getHullCache` is the only place that decides which nodes enter a folder's hull. D-04/D-05 reinforce; no downstream kind-filter.
- **Command Horizon zero-radius corners** — backdrop pill in D-09 is a sharp-cornered `fillRect`; no `arcTo` / rounded path.
- **Screen-space labels draw after world-space content** (Phase 12 D-31 z-order step 11); pill backdrop sits inside the same save/restore so identity-transform is preserved.
- **`theme.X ?? theme.Y ?? hardcoded-fallback`** chain idiom used throughout BridgeRenderer; D-07 (label color) and D-13 (dangling fill) extend the same pattern.
- **Co-located `__tests__/` with `{component}.{concern}.test.ts` naming** — Phase 12 set the convention; Phase 22 follows.
- **Commit after each change** (user's durable memory rule) — each plan's tasks commit per-change; planner task spec should encode this.

### Integration Points

- `src/views/Radar/RadarCanvas.tsx` — one local const add + two call-site parameter swaps (`drawNodes`, `drawFileLabels`). No hook changes, no Zustand changes, no new effect.
- `src/views/Radar/hullCache.ts` — one-line guard add inside the `for (const n of nodes)` loop. Cache epoch unchanged.
- `src/views/Radar/BridgeRenderer.ts` — `drawBoundaryAnchorLabels`: token swap + new pill draw; `drawBridgeNodes`: swap dangling `fillStyle` + remove `setLineDash`. Two functions, two diffs.
- `src/views/Radar/__tests__/*` — 2 new files (Plan 22-01) + extensions to 2 existing files (Plan 22-02).
- **No DB migration. No new Tauri command. No `src/bindings.ts` regen. No worker protocol change. No new dependency.**

### What Phase 22 Does NOT Touch

- `src/stores/radarStore.ts` — unchanged.
- `src/workers/graphSimCore.ts` / `src/workers/forces/forceBoundary.ts` / `src/workers/graphSimProtocol.ts` — unchanged.
- `src/views/Radar/ForceConfigPanel.tsx` — unchanged (BOUNDARY slider stays exactly as Phase 12 landed it; responsiveness polish is deferred — see `<deferred>`).
- `src/views/Radar/BridgeTooltip.tsx` / `BridgeDetailPanel.tsx` — unchanged.
- `src-tauri/**` — unchanged.
- All Phase 12 witnesses — must remain green post-Phase-22.

</code_context>

<specifics>
## Specific Ideas

- **The aura bug is the loudest of the four at default zoom.** Users see a phantom green circle under every cyan diamond that grows and shrinks *inversely* to the diamond as they zoom — the visual cognition breaks the "bridge is a diamond" affordance first hit after launch. Fix 1 is the priority within Phase 22's polish scope even though all four are polish-only.
- **Hulls-envelop-bridges is the sneakiest.** It doesn't visibly "break" anything in isolation; it just makes every folder hull shape gently wrong, pulled toward `y=0`. Users don't realize what's off until Fix 2 lands and the hulls snap back to their "correct" centroids. That delta is the most compelling single demonstration of what went wrong.
- **"Colour first, stroke pattern second" is a design principle, not just a fix.** Dashed strokes on 8-unit glyphs fail visual contrast at every zoom because the dash-to-shape size ratio is wrong. Colour carries signal reliably. Every future bridge-state distinction (dangling, channel, selected) should lead with colour/token; stroke patterns are accent-only.
- **Backdrop pills over alpha-raise alone.** Pure alpha raise to 1.0 still loses against heat-tinted folder hulls in busy regions. The pill is what guarantees the axis labels read as axis markers at every theme + zoom combination.
- **Plan 22-01 is mechanical, Plan 22-02 is taste.** 22-01 is "pass the right array to the right function" and "add one guard". 22-02 is "pick the token that reads best across 9 themes". Worth splitting so the taste calls don't block the mechanical fixes.
- **Two plans, no third.** Don't be tempted to extract a "test-only" plan or a "theme-smoke" plan. The existing test-co-location convention covers the first; the 9-theme smoke is a cheap eyeball pass inside Plan 22-02's verification.
- **No schema / protocol change keeps the review diff small.** The review surface for Phase 22 is Canvas-2D pixel math + a hull-cache guard. Keeping it scoped this tightly makes the whole phase reviewable in a single pass.

</specifics>

<deferred>
## Deferred Ideas

- **BOUNDARY slider responsiveness polish** (Phase 12 D-34 5th finding — "relatively responsive, could have been better"). Not a blocker; not a visual defect. If smoke during Phase 22 plan execution still finds the slider feel off, log a discrete `quick-task` against the `alphaRestart`/force-decay tuning — separate from the 4 visual fixes. Touches `src/workers/graphSimCore.ts` + `src/workers/forces/forceBoundary.ts`; planner should NOT pull this into Phase 22 scope without a fresh UAT.
- **Right-edge FRONTEND/BACKEND label mirror** (Phase 12 `<deferred>` item) — saves scanning for a user panned far right; trivially a follow-up when a user surfaces it. If Plan 22-02 extracts a `drawLabelWithBackdrop` helper, the follow-up becomes a 3-line call at the right edge.
- **`BRIDGE_DASH_PATTERN` constant retention-vs-removal** — D-14 keeps it with an eslint-disable comment. A cleanup pass can delete the constant outright in a later housekeeping plan; not worth its own commit in Phase 22.
- **First-class `theme.axisLabelColor` token** — today `fileLabelColor` serves both file labels and axis labels. If a second axis-label surface lands (e.g. right-edge mirror, depth-axis labels for a future 3D mode), promote in that phase. Not Phase 22 scope.
- **Dangling-on-dangling nesting** — if a future phase ever introduces "bridge-of-bridges" (e.g. an MCP-over-tauri-command proxy layer), the secondary stroke-pattern signal (dash) is available to reinstate. D-12..D-15 keep that door open.
- **Per-theme backdrop opacity override** — 0.8 is recommended; if a specific theme's `canvasBackground` clashes at 0.8, extend `GraphTheme` with an optional `axisLabelBackdropAlpha` override. Not needed today.
- **Zoom-dependent label pill enlargement** — labels are screen-space and fixed-font; no zoom awareness needed. Noting here so a future reviewer doesn't re-raise it.
- **Phase 12 `<deferred>` items** (agent-driven invoke animation, editor deep-link, drag-to-pin, event push bridges, MCP-as-bridges, aliased imports, variable invokes, grouped-by-subsystem x-spread, bridge heat signal, multi-line signature preview, custom invoke wrappers, bridge persistence, focus mode) — all still deferred; Phase 22 polish does not touch any of them.

</deferred>

---

*Phase: 22-bridge-layer-visual-polish-aura-hulls-labels-dangling-state*
*Context gathered: 2026-04-23*
*Auto-selected defaults; see 22-DISCUSSION-LOG.md for per-question log.*
