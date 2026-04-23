# Phase 22: Bridge Layer Visual Polish — Research

**Researched:** 2026-04-23
**Domain:** Canvas 2D render-loop composition + theme-token plumbing in the radar view
**Confidence:** HIGH (every CONTEXT.md claim was verified against live code)

## Summary

CONTEXT.md is unusually complete — D-01..D-23 cover every decision with concrete file:line targets, tokens, and plan decomposition. This research does **not** re-derive those decisions. It verifies them against the live codebase at `src/views/Radar/{RadarCanvas.tsx, hullCache.ts, BridgeRenderer.ts, themes.ts}`. All four claim sites confirmed exactly as described. Theme token availability (`fileLabelColor`, `nodeFill`, `canvasBackground`) is confirmed across all 9 themes. Test harness patterns are identified from existing `BridgeRender.test.ts`, `BoundaryLine.test.ts`, and `hullCache.test.ts`; new witnesses can follow these patterns verbatim. One minor supplementation surfaced: the mock `setLineDash` pattern in existing tests records the **call** (not the resulting `getLineDash()` state), so W-22-06's "no `setLineDash` call" assertion is the correct form. No gap or discrepancy blocks planning.

**Primary recommendation:** Planner can proceed with CONTEXT.md's recommended 2-plan decomposition (D-17) unchanged. Two supplementation points below feed directly into Plan 22-02.

## User Constraints (from CONTEXT.md)

### Locked Decisions
D-01 through D-23 (see `22-CONTEXT.md`). Summary of what the planner MUST NOT re-litigate:

- **Fix 1 (Aura):** Filter `liveNodes` upstream in `RadarCanvas.tsx` via a new `fileNodes` const next to the existing `bridgeNodes` snapshot. Thread `fileNodes` into `drawNodes` (:724) and `drawFileLabels` (:737). Do NOT filter inside draw functions. Do NOT touch `drawFolderHulls`'s input — Fix 2 handles hull membership at the cache layer.
- **Fix 2 (Hulls):** Single `if (n.kind === 'bridge') continue;` inside `hullCache.ts:86`'s `for (const n of nodes)` loop, next to existing `n.dirKey === ''` and `n.x === undefined` guards. Cache epoch unchanged. One-line module doc-comment noting bridges are excluded from hull membership.
- **Fix 3 (Anchor labels):** In `drawBoundaryAnchorLabels` (`BridgeRenderer.ts:232`), swap `folderLabelColor` → `fileLabelColor`; raise globalAlpha: bold 0.8→1.0, thin 0.55→0.85; add zero-radius `fillRect` backdrop pill per stack (FRONTEND+TS pill, BACKEND+Rust pill) at `theme.canvasBackground` @ 80% alpha with 8px horizontal + 4px vertical padding.
- **Fix 4 (Dangling):** In `drawBridgeNodes` (`BridgeRenderer.ts:114-134`), dangling fill becomes `theme.nodeFill` (full alpha), populated keeps cyan fill. Stroke stays `theme.nodeStroke` for both. Drop the `setLineDash(BRIDGE_DASH_PATTERN)` call; retain the `BRIDGE_DASH_PATTERN` constant with an eslint-disable + one-line comment.
- **Plan grouping (D-17):** Two plans — 22-01 (RadarCanvas + hullCache) and 22-02 (BridgeRenderer only). Disjoint files, no execution-order dependency.
- **Witnesses (D-21):** W-22-01..W-22-07 as specified.
- **Phase 12 invariants preserved:** V-12-15..V-12-24 must stay green; D-09/D-10/D-17/D-31 unchanged; channel double-stroke on both dangling and populated states (D-17 Phase 12 preserved via D-15 Phase 22).

### Claude's Discretion
- Memoize `fileNodes` split via `useMemo`? Current guidance: no.
- Extract `drawLabelWithBackdrop` helper inside `BridgeRenderer.ts`? Either acceptable.
- Exact backdrop alpha (0.7–0.85) and pill padding (±2px).
- Delete `BRIDGE_DASH_PATTERN` outright vs. retain with eslint-disable. Recommended: retain.

### Deferred Ideas (OUT OF SCOPE)
- BOUNDARY slider responsiveness polish.
- Right-edge FRONTEND/BACKEND label mirror.
- First-class `theme.axisLabelColor` token.
- Dangling-on-dangling nesting.
- Per-theme backdrop opacity override.
- All Phase 12 `<deferred>` items (agent-driven invoke animation, editor deep-link, drag-to-pin, MCP bridges, etc.).

## Phase Requirements

Phase 22 is polish-only. `phase_req_ids = TBD` in `.planning/REQUIREMENTS.md`. The acceptance gate remains Phase 12's V-12-15..V-12-24 PLUS the new Phase 22 witnesses W-22-01..W-22-07 defined in CONTEXT.md D-21. No new REQ-IDs are introduced by this phase. Planner's VERIFICATION.md should cite witnesses by W-22-NN; no REQ mapping needed.

## Project Constraints (from CLAUDE.md)

- **Tauri v2 + React 19 + TypeScript** — no new dependency; no `src/bindings.ts` regen; no Tauri command added.
- **Canvas 2D + visx math** (CLAUDE.md §Data Visualization) — all four fixes are Canvas 2D draw-function surgery; stay on that surface.
- **Command Horizon zero-radius corners** — D-09 backdrop pill is a plain `fillRect`, never `arcTo` or rounded path.
- **Space Grotesk + JetBrains Mono** — already wired through `drawBoundaryAnchorLabels`; Fix 3 does not touch fonts.
- **Commit-after-each-change durable memory rule** — planner should encode per-diff commit cadence in each plan's task spec.
- **Only fix own-session bugs** — Phase 12's pre-existing `deferred-items.md` failures (HeatMapOverlay, 2× MasterDetailShell, useGraphLayout flake) stay deferred; Phase 22 MUST NOT attempt their repair.

---

## 1. File:line verification

### 1.1 Fix 1 — Aura (RadarCanvas.tsx) — **CONFIRMED**

| CONTEXT.md claim | Live code | Verdict |
|---|---|---|
| `bridgeNodes` snapshot at :705 | **Actually at :697.** Line 705 is the `if (bridgeNodes.length > 0)` gate for `drawBoundaryLine`. The snapshot is four lines earlier. | Minor line-number slip — claim is semantically correct; planner should treat "line of `const bridgeNodes = …`" as the authoritative anchor, not the literal 705. |
| `drawNodes` receives unfiltered `liveNodes` at :724 | Confirmed — `drawNodes(ctx, liveNodes, …)` at :724–735 | CONFIRMED |
| `drawFileLabels` receives unfiltered `liveNodes` at :737 | Confirmed — `drawFileLabels(ctx, liveNodes, …)` at :737 | CONFIRMED |
| `drawBridgeNodes` + `drawBridgeLabels` at :744 + :755 | Confirmed (`drawBridgeNodes` at :744, `drawBridgeLabels` at :755) | CONFIRMED |
| `liveNodes` is already derived from the positions writeback (Phase 11.1) | Confirmed — :642 `let liveNodes = s.graphNodes;` then :662–685 builds `simLiveNodes` and reassigns. Filter cost is negligible. | CONFIRMED |

**Additional call site surfaced (NOT in CONTEXT.md's file:line list):** `drawBoundaryAnchorLabels` at :803 already receives `bridgeNodes` (correct — no change needed). Noting for completeness so the planner does not wonder if a third filter is required.

**Fix 1 recommended patch shape:**
```ts
const bridgeNodes = liveNodes.filter((n) => n.kind === 'bridge');
const fileNodes = liveNodes.filter((n) => n.kind !== 'bridge');   // NEW
// …
drawNodes(ctx, fileNodes, …);        // was liveNodes
drawFileLabels(ctx, fileNodes, …);   // was liveNodes
// drawFolderHulls(ctx, liveNodes, …) stays — Fix 2 handles membership upstream.
```

### 1.2 Fix 2 — Hulls (hullCache.ts) — **CONFIRMED**

| CONTEXT.md claim | Live code | Verdict |
|---|---|---|
| `getHullCache` at `hullCache.ts:86` is the group-by-dirKey loop | Confirmed — `for (const n of nodes)` starts at :86, existing guards `n.x === undefined` (:87), `n.dirKey === ''` (:88), `byDir.set(...)` at :91 | CONFIRMED |
| Cache epoch (`settledAt | zoomBucket`) is unchanged by the fix | Confirmed — `cacheEpoch` is the string `${settledAt ?? 'null'}|${zoomBucket}` at :78; adding a `kind === 'bridge'` skip inside the loop does not touch epoch computation at :77–79 | CONFIRMED — Phase 11.1 D-08 cache-key invariant preserved |
| Existing guards show the idiomatic one-line-continue pattern | Confirmed — `if (n.x === undefined || n.y === undefined) continue;` and `if (n.dirKey === '') continue;` at :87–88 | CONFIRMED — new guard fits the same idiom |

**Fix 2 recommended patch shape:**
```ts
for (const n of nodes) {
  if (n.x === undefined || n.y === undefined) continue;
  if (n.dirKey === '') continue;
  if (n.kind === 'bridge') continue;   // NEW — D-04
  const arr = byDir.get(n.dirKey) ?? [];
  // …
}
```

### 1.3 Fix 3 — Anchor labels (BridgeRenderer.ts) — **CONFIRMED**

| CONTEXT.md claim | Live code | Verdict |
|---|---|---|
| `drawBoundaryAnchorLabels` at `:218–256`, color token resolution at `:232` | Confirmed — function at :218, `const labelColor = theme.folderLabelColor ?? theme.nodeStroke;` at :232 | CONFIRMED |
| Bold row @ globalAlpha 0.8 (FRONTEND :241, BACKEND :249), thin row @ 0.55 (TypeScript :244, Rust :252) | Confirmed exactly | CONFIRMED |
| Labels drawn in screen-space via `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` in caller | Confirmed — wrapped at `RadarCanvas.tsx:801–804` | CONFIRMED |
| `GraphTheme` does NOT expose an `onSurface` token | Confirmed by reading `themes.ts:17–56` — no `onSurface` field | CONFIRMED — `fileLabelColor` is the correct in-palette analog |

**Stacking for the backdrop pill:**
- FRONTEND row baseline y = `boundaryScreenY - 18`, font 700 10px Space Grotesk
- TypeScript row baseline y = `boundaryScreenY - 8`, font 400 10px JetBrains Mono
- One pill per stack. Pill rect = `{ x: leftX - 4, y: (boundaryScreenY - 18) - 10, w: measured + 8, h: 18 + 4 }` (indicative — planner tunes).
- Text baseline is `alphabetic`, so pill top must account for ascent; planner should `ctx.measureText` each line + use `ctx.font` ascent metrics if available (or hardcode ~10px ascent since font sizes are fixed at 10px).

### 1.4 Fix 4 — Dangling signal (BridgeRenderer.ts) — **CONFIRMED**

| CONTEXT.md claim | Live code | Verdict |
|---|---|---|
| `drawBridgeNodes` at `:94`, isDangling branch at `:114–117`, `setLineDash(BRIDGE_DASH_PATTERN)` at `:132` | Confirmed — function at :94, `isDangling` computed at :114–117, `if (isDangling) ctx.setLineDash(BRIDGE_DASH_PATTERN);` at :132, followed by `ctx.setLineDash([])` reset at :134 | CONFIRMED |
| Both dangling and populated currently share cyan fill (`theme.edgeGlow ?? theme.arrowFill ?? '#00cffc'`) | Confirmed — `baseFill` at :106–109 and `ctx.fillStyle = isSelected ? theme.nodeFillHover ?? baseFill : baseFill;` at :128 (no dangling branch on fill today) | CONFIRMED — Fix 4's diagnosis is exact |
| Channel double-stroke at `:138–152`, selected ring at `:155–168` — both unchanged under Fix 4 | Confirmed — both live outside the dangling branch, operate on stroke geometry derived from `d`, and do not consult `isDangling` | CONFIRMED — D-15 Phase 22 regression invariant is mechanically obvious from the code shape |

**Fix 4 recommended patch shape:**
```ts
// :128 — split fill on dangling state
ctx.fillStyle = isSelected
  ? theme.nodeFillHover ?? baseFill
  : isDangling
    ? theme.nodeFill               // NEW — D-13
    : baseFill;
ctx.fill();
ctx.strokeStyle = theme.nodeStroke;
ctx.lineWidth = 1 / zoom;
// DROP: if (isDangling) ctx.setLineDash(BRIDGE_DASH_PATTERN);   — D-14
ctx.stroke();
// Keep :134 ctx.setLineDash([]) — cheap defensive reset; costs nothing.
```

---

## 2. Theme token availability matrix (9 themes × 3 tokens)

All three tokens required by Fix 3 + Fix 4 (`fileLabelColor`, `nodeFill`, `canvasBackground`) are declared on the `GraphTheme` interface (`themes.ts:17–56`) as **non-optional**, meaning the type system guarantees every theme populates them. Verified for all 9 themes:

| Theme | `fileLabelColor` | `nodeFill` | `canvasBackground` |
|---|---|---|---|
| phosphor-classic | `#adaaaa` | `#0f1a0e` | `#000000` |
| phosphor-vivid | `#5ecc4a` | `#0a200a` | `#050d04` |
| phosphor-cyan | `#4db8cc` | `#0a1a1f` | `#040d12` |
| amber-terminal | `#b8943a` | `#1a1408` | `#0a0804` |
| cool-slate | `#7888a8` | `#141820` | `#080a10` |
| synthwave-nebula | `#ffb0dd` | `#1a0f28` | `#0a0515` |
| plasma | `#ffb0c0` | `#201018` | `#0a0510` |
| electric-ice | `#c0f0ff` | `#ffffff` | `#020814` |
| stellar-forge | `#c0ffa0` | `#0a2010` | `#020600` |

**Every value is a hex string** (no rgba/hsl/gradient anywhere). The D-11 helper that composes `{canvasBackground}cc` (hex + alpha suffix for 80%) works for every theme — no rgba fallback branch is ever hit. Planner can simplify the helper to a pure `${hex}cc` concatenation guarded by `/^#[0-9a-f]{6}$/i` if desired; rgba fallback can be kept for robustness but will be dead code today.

**One ergonomic note for electric-ice:** `nodeFill` is `#ffffff`, i.e. pure white. Applied to a dangling bridge diamond on a `#020814` background, this produces a bright white diamond with a thin theme.nodeStroke silhouette. Populated bridges on electric-ice still use the cyan base fill. The contrast between "bright white fill" (dangling) and "cyan fill" (populated) is **stronger** on electric-ice than on any other theme — Fix 4 will render most dramatically here. Worth a 30-second human smoke eyeball during Plan 22-02 verification; not a gap.

**GAP check:** None. No theme is missing any of the three tokens.

---

## 3. Test harness patterns

Phase 22's new witnesses can reuse the established `__tests__/` conventions verbatim. Key patterns:

### 3.1 Mock canvas context (shared across BridgeRender.test.ts, BoundaryLine.test.ts, GraphRenderer.test.ts)

```ts
// Path2D polyfill (required — jsdom lacks Canvas 2D constructors).
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as any).Path2D = class Path2D { constructor(_d?: string) {} };
}

function makeMockCtx() {
  const calls: Call[] = [];
  const assignments: Record<string, unknown[]> = {};
  const record = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); };
  const ctx: any = {
    beginPath: record('beginPath'), moveTo: record('moveTo'),
    lineTo: record('lineTo'), closePath: record('closePath'),
    stroke: record('stroke'), fill: record('fill'),
    save: record('save'), restore: record('restore'),
    fillText: record('fillText'), setLineDash: record('setLineDash'),
    fillRect: record('fillRect'),          // ADD for Fix 3 backdrop pill assertions
    measureText: (t: string) => ({ width: t.length * 6 }),   // ADD for pill geometry
  };
  for (const prop of ['fillStyle','strokeStyle','lineWidth','font','textAlign','textBaseline','globalAlpha']) {
    assignments[prop] = [];
    Object.defineProperty(ctx, prop, {
      get: () => assignments[prop].at(-1),
      set: (v) => { assignments[prop].push(v); },
    });
  }
  ctx._calls = calls; ctx._assignments = assignments;
  return ctx;
}
```

Notes:
- `measureText` is NOT currently in the mock — **add it** for W-22-05 (backdrop pill width from `measureText(label).width + 8px`). A stub returning `{ width: text.length * 6 }` is sufficient.
- `fillRect` is in `RadarMinimap.test.tsx`'s mock but not `BridgeRender.test.ts`'s — **add it** for the backdrop pill assertion.
- `getLineDash` is NOT in the mock. The existing test idiom (W-22-06) asserts on the `setLineDash` **call log** (`ctx._calls.filter(c => c.fn === 'setLineDash')`), not on the resulting dash-state. This is the correct and idiomatic form — see `BridgeRender.test.ts:200` and :220 for prior art. Assertion for Fix 4: "no `setLineDash` call whose first arg equals `BRIDGE_DASH_PATTERN`".

### 3.2 Bridge + file GraphNode fixtures (Phase 12 pattern)

```ts
function makeBridge(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: `bridge:${overrides.commandName ?? 'ping'}`,
    dirKey: 'bridge', dirDepth: 0, kind: 'bridge',
    x: 0, y: 0,
    commandName: 'ping',
    handlerFile: 'src-tauri/src/handlers.rs', handlerLine: 1,
    hasChannelArg: false, callerCount: 1,
    ...overrides,
  };
}
// For Plan 22-01 W-22-03 (hullCache bridge exclusion), also need:
function makeFileNode(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: overrides.id ?? 'src/a.ts',
    dirKey: overrides.dirKey ?? 'src',
    dirDepth: overrides.dirDepth ?? 1,
    kind: 'file',       // explicit non-bridge kind
    x: 0, y: 0,
    ...overrides,
  } as GraphNode;
}
```

### 3.3 hullCache test pattern (reuse from hullCache.test.ts)

`_resetHullCacheForTest()` in `beforeEach` is required — cache is module-level state. `vi.mock('d3-polygon', …)` with `hullSpy` counts real `polygonHull` invocations; W-22-03 can assert either "`polygonHull` received zero points where `[x, y]` matches a bridge position" OR the simpler "cache entries contain no `dirKey` that is present only on bridges". The simpler form is preferred.

**Recommended W-22-03 shape:**
```ts
it('W-22-03: getHullCache excludes kind==="bridge" nodes from hull membership', () => {
  const nodes: GraphNode[] = [
    makeFileNode({ id: 'src/a.ts', dirKey: 'src', x: 0, y: 10 }),
    makeFileNode({ id: 'src/b.ts', dirKey: 'src', x: 10, y: 10 }),
    makeFileNode({ id: 'src/c.ts', dirKey: 'src', x: 5, y: 20 }),
    makeBridge({ dirKey: 'src', x: 5, y: 0 }),   // bridge pinned on boundary, same dirKey
  ];
  const result = getHullCache(nodes, 1.0, 1000);
  const entry = result.get('src');
  expect(entry).toBeDefined();
  // Centroid should reflect only the 3 file nodes' positions, not the bridge at y=0.
  expect(entry!.cy).toBeGreaterThan(5);   // cy for 3 file nodes averages to ~13.33; including bridge drops it to ~10.
});
```

### 3.4 RadarCanvas render-loop witness pattern (NEW for W-22-01, W-22-02)

RadarCanvas.tsx calls `drawNodes` and `drawFileLabels` inside a closure that runs on every frame. The test does NOT need to spin up the full React component — it can directly assert on the render-loop orchestration by **spying on the imported draw functions** via `vi.mock('../GraphRenderer', …)` and asserting that the array passed as the second argument contains zero `kind === 'bridge'` nodes when a mixed node set is present. `GraphRenderer.test.ts` already pulls this import surface; follow its mock shape.

**Alternative:** Extract the filter into a named helper `filterRenderableFileNodes(liveNodes)` co-located in `RadarCanvas.tsx` and unit-test that helper directly (pure function, no component mount). Planner's discretion — the helper extraction is cheaper to test and reduces the test's coupling to React's render cadence.

### 3.5 New file skeletons

**`src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts`** (Plan 22-01, W-22-01 + W-22-02):
- Mock `../GraphRenderer` to capture `drawNodes` + `drawFileLabels` call args.
- Mount `<RadarCanvas>` with a Zustand store primed with a mixed `graphNodes` array (files + bridges).
- Await one RAF tick.
- Assert: `drawNodes.mock.calls[0][1].every(n => n.kind !== 'bridge')` and same for `drawFileLabels`.
- OR (preferred, simpler): refactor the filter into a pure helper and unit-test the helper.

**`src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts`** (Plan 22-01, W-22-03):
- Reuse `beforeEach(() => _resetHullCacheForTest())` pattern.
- Fixture: 3 file nodes at `dirKey='src'` + 1 bridge at `dirKey='src'` pinned at y=0.
- Assert centroid / cache entries exclude the bridge contribution.
- Parametrize over a sample of themes (phosphor-classic, synthwave-nebula, electric-ice) and zoom buckets (0.5, 1.0, 2.0, 5.0) — keeps runtime low, covers cache-epoch invariants.

**Extensions to `BridgeRender.test.ts`** (Plan 22-02, W-22-06 + W-22-07):
- Drop the existing "dangling applies BRIDGE_DASH_PATTERN" tests (`:188–206` and `:208–226`) — they become false. Replace with "dangling does NOT call `setLineDash(BRIDGE_DASH_PATTERN)`" assertions.
- Add "dangling fill resolves to `theme.nodeFill`" — `expect(ctx._assignments.fillStyle).toContain(theme.nodeFill)`.
- Add "populated fill still resolves to edgeGlow/arrowFill/#00cffc fallback chain" (regression).
- Add W-22-07: run `drawBridgeNodes` with `{ hasChannelArg: true, callerCount: 0 }` and with `{ hasChannelArg: true, callerCount: 3 }` — assert the outer-ring geometry (moveTo count delta) is identical across both.

**Extensions to `BoundaryLine.test.ts`** (Plan 22-02, W-22-04 + W-22-05):
- Update `:171–183` ("uses theme.folderLabelColor for fills") to assert `theme.fileLabelColor` instead.
- Add W-22-04 globalAlpha assertion: `expect(ctx._assignments.globalAlpha).toContain(1.0)` and `…toContain(0.85)`.
- Add W-22-05: `ctx._calls.filter(c => c.fn === 'fillRect').length >= 2` (one pill per stack); assert the `fillStyle` immediately preceding each `fillRect` carries the `canvasBackground` hex + `cc` suffix (or the rgba 0.8 fallback).

---

## 4. Validation Architecture

> workflow.nyquist_validation = true (confirmed in .planning/config.json). VALIDATION.md scaffolding required.

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest (jsdom environment) — already installed, already used by all Phase 12 radar tests |
| Config file | Inherited from existing Vitest config at repo root (no Wave 0 change) |
| Quick run command | `npm run test -- --run src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts src/views/Radar/__tests__/BridgeRender.test.ts src/views/Radar/__tests__/BoundaryLine.test.ts` |
| Full suite command | `npm run test -- --run` |

### Phase Requirements → Test Map

Phase 22 has no REQ-IDs; the table maps witnesses instead:

| Witness | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| W-22-01 | `drawNodes` receives bridge-free array | unit | `npm run test -- --run RadarCanvas.auraFilter` | ❌ Wave 0 |
| W-22-02 | `drawFileLabels` receives bridge-free array | unit | `npm run test -- --run RadarCanvas.auraFilter` | ❌ Wave 0 |
| W-22-03 | `getHullCache` excludes bridge points across themes + zoom buckets | unit | `npm run test -- --run hullCache.bridgeExclusion` | ❌ Wave 0 |
| W-22-04 | Anchor labels use `fileLabelColor`, bold alpha = 1.0 | unit | `npm run test -- --run BoundaryLine` | ✅ (extend) |
| W-22-05 | Anchor label backdrop pill `fillRect` emitted before `fillText` | unit | `npm run test -- --run BoundaryLine` | ✅ (extend) |
| W-22-06 | Dangling fill = `theme.nodeFill`, no `setLineDash(BRIDGE_DASH_PATTERN)` call | unit | `npm run test -- --run BridgeRender` | ✅ (extend) |
| W-22-07 | Channel double-stroke geometry identical across dangling + populated | unit | `npm run test -- --run BridgeRender` | ✅ (extend) |
| V-12-15..V-12-24 | Phase 12 witnesses remain green | regression | `npm run test -- --run src/views/Radar/__tests__/` | ✅ |

### Sampling Rate
- **Per task commit:** Quick run (4 radar test files, ~2s).
- **Per wave merge:** `npm run test -- --run src/views/Radar/__tests__/` — full radar test surface.
- **Phase gate:** `npm run test -- --run` full suite green, excepting the 4 pre-existing failures logged in Phase 12 `deferred-items.md` (HeatMapOverlay expectation drift, 2× MasterDetailShell Tailwind v4 arbitrary-value drift, useGraphLayout worker flake). These are NOT Phase 22's scope per the "only fix own-session bugs" rule.

### Wave 0 Gaps
- [ ] Create `src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts` — covers W-22-01, W-22-02.
- [ ] Create `src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts` — covers W-22-03.
- [ ] Extend `BridgeRender.test.ts` mock to add `fillRect` + `measureText` recorders (for W-22-05 backdrop pill assertions in BoundaryLine.test.ts extensions — the mock is currently duplicated across both test files; planner may choose to extract `makeMockCtx` into a shared `__tests__/_canvasMock.ts`). Small refactor; planner's discretion.
- [ ] No framework install required — Vitest already in place.

### D-34-style human smoke (D-23 — OPTIONAL)

Automated witnesses cover the change surface. A single-pass human eyeball across all 9 themes is a cheap insurance policy on Fix 3 (pill readability) and Fix 4 (dangling-vs-populated distinction) where "looks right" is the acceptance criterion. Recommended but not gating. If the planner adds it, pattern after `12-05-CHECKPOINT.md`: a named file `22-NN-CHECKPOINT.md` with the 9-theme × 2-fix readability checklist.

---

## 5. Risk / regression surface

### 5.1 Phase 11.1 wheel + hull-cache invariants — **NO REGRESSION**

- **Wheel-event writeback (Phase 11.1 D-05..D-07):** Fix 1 adds `liveNodes.filter(n => n.kind !== 'bridge')` on the render-loop hot path. This is O(N) over an array Phase 11.1 already derives and reads. **No new Zustand writebacks, no new effect, no new ref.** The filter runs inside the existing RAF closure that Phase 11.1 already owns. Cost: ≤1 allocation per frame of ~300–3000 element array; measured equivalent is the existing `bridgeNodes` filter on :697 which has shipped and passed the Phase 11.1 perf bracket (`radarPerfDebug='1'` ring-buffer sampling at :810–814). Zero risk to Phase 11.1 p95/max frame-time budgets.
- **Hull cache epoch (Phase 11.1 D-08):** Fix 2's `if (n.kind === 'bridge') continue;` sits **inside** the loop body at `:86`. The cache key `${settledAt ?? 'null'}|${zoomBucket}` at `:78` is unchanged. The cache hit/miss decision at `:79` (`if (epoch === cacheEpoch) return cache;`) is unchanged. Only the set of points entering `paddedHullPoints → polygonHull → polygonCentroid` shrinks — and by a count of ≤52 bridges in a typical repo. Cache hit rate is **unchanged**; cache rebuild cost strictly **decreases** (fewer points → cheaper convex hull). Zero risk to Phase 11.1 hull-cache semantics.
- **`_resetHullCacheForTest()`** continues to be the only eviction path for tests; Fix 2 adds no new eviction vector.

### 5.2 Worker protocol, IPC, schema, DTOs — **ALL UNCHANGED**

- `src/workers/graphSimCore.ts` / `graphSimProtocol.ts` / `forces/forceBoundary.ts`: not touched.
- `src-tauri/src/pipeline/ipc_bridges/**`: not touched.
- `src/bindings.ts`: no regen.
- `GraphNode`, `ForceConfig`, `IpcBridgeDto`, `EdgeKind`: schemas stable.

### 5.3 Phase 12 witness compatibility (V-12-15..V-12-24)

**Breaking tests to update (expected and planned, not regressions):**
- `BridgeRender.test.ts:188–226` — the two "dangling applies BRIDGE_DASH_PATTERN" cases will **legitimately** fail post-Fix-4. Plan 22-02 explicitly replaces them with negative assertions. This is test evolution, not witness invalidation — the underlying Phase 12 invariant "dangling bridges are visually distinct from populated" is **strengthened** by Fix 4.
- `BoundaryLine.test.ts:171–183` — the "uses theme.folderLabelColor for fills" case will fail post-Fix-3. Replace with `theme.fileLabelColor` assertion per D-07.

**Planner task-spec note:** these test edits are part of the same plan that introduces the production-code change, committed in the same diff (per the commit-after-each-change rule). Do NOT ship production code and test update in separate commits — that momentarily breaks the suite.

### 5.4 Channel double-stroke geometry (Phase 12 D-17 invariant)

`drawBridgeNodes` channel ring at `:138–152` reads `hasChannel = b.hasChannelArg === true` and computes `d2 = d + BRIDGE_CHANNEL_STROKE_OFFSET / zoom`. This branch is **orthogonal** to `isDangling` — it consults `hasChannelArg` only. Fix 4's changes (fill swap, setLineDash removal) live inside the inner-diamond block (`:121–135`) and the channel-ring block is `:137–152`. Zero code overlap, zero risk. W-22-07 is a regression witness, not a repair.

---

## 6. Gaps or supplementation to CONTEXT.md

Three supplementation points surfaced from verification — each small, none blocking.

### 6.1 `bridgeNodes` snapshot line number

CONTEXT.md says "already computed for the boundary-line gate, `RadarCanvas.tsx:705`". Live code: the snapshot is at **:697**; `:705` is the `if (bridgeNodes.length > 0)` gate that guards `drawBoundaryLine`. Planner should anchor to "the line declaring `const bridgeNodes = liveNodes.filter(…)`" rather than the literal line number — line numbers drift across commits, and `:697` today may be different tomorrow. The intent is unambiguous in the live code.

### 6.2 `measureText` + `fillRect` mock extension

Existing `makeMockCtx` helpers in `BridgeRender.test.ts` and `BoundaryLine.test.ts` do not record `fillRect` (required for W-22-05 pill backdrop) or `measureText` (required for pill-width computation). Planner should thread a 2-line extension into each mock. Optionally, extract `makeMockCtx` into a shared `__tests__/_canvasMock.ts` — small refactor, improves maintainability; not required. Discretionary.

### 6.3 `getLineDash` vs `setLineDash` call log

CONTEXT.md D-21 W-22-06 describes the assertion as "`getLineDash()` returns `[]` at stroke time for both". The existing mock does not implement `getLineDash()` and would need to model the dash-state. The idiomatic and simpler assertion — already used in `BridgeRender.test.ts:200` and :220 — is on the `setLineDash` **call log**: assert no `setLineDash` call has a first arg equal to `BRIDGE_DASH_PATTERN`. Functionally equivalent, zero new mock plumbing. Recommend the planner follow this form.

**No other gaps.** The four fixes, the plan decomposition (D-17 two plans), the witness list (D-21 W-22-01..W-22-07), the theme-token plumbing (D-07, D-13), the cache-epoch preservation (D-04), the Phase 11.1 invariants, and the Phase 12 regression surface are all consistent with the live code. CONTEXT.md is execute-ready.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| — | (none) | — | — |

Every claim in this research was verified against live code at `src/views/Radar/{RadarCanvas.tsx, hullCache.ts, BridgeRenderer.ts, themes.ts}` or against existing test files at `src/views/Radar/__tests__/`. No `[ASSUMED]` claims.

## Sources

### Primary (HIGH confidence — live code read)
- `src/views/Radar/RadarCanvas.tsx:690–805` — render-loop orchestration; all Fix 1 claim sites verified
- `src/views/Radar/hullCache.ts:68–122` — `getHullCache`, cache epoch, group-by-dirKey loop
- `src/views/Radar/BridgeRenderer.ts:82–256` — `drawBridgeNodes`, `drawBoundaryAnchorLabels`, `BRIDGE_DASH_PATTERN`
- `src/views/Radar/themes.ts:17–287` — `GraphTheme` interface + 9-theme catalog
- `src/views/Radar/__tests__/BridgeRender.test.ts` — mock harness, bridge fixtures, setLineDash assertion pattern
- `src/views/Radar/__tests__/BoundaryLine.test.ts` — anchor-label test pattern, BRIDGES_FIXTURE pattern
- `src/views/Radar/__tests__/hullCache.test.ts` — hullCache test pattern, `vi.mock('d3-polygon', …)` spy pattern
- `.planning/phases/22-bridge-layer-visual-polish-aura-hulls-labels-dangling-state/22-CONTEXT.md` — D-01..D-23 decisions

### Primary (HIGH confidence — project config)
- `.planning/config.json` — `workflow.nyquist_validation: true` (validation section included)
- `CLAUDE.md` §"Data Visualization", §"Constraints" — Tauri v2 + React 19 + Canvas 2D constraints, commit-per-change rule

---

## Metadata

**Confidence breakdown:**
- File:line verification: HIGH — all four claim sites read directly
- Theme token availability: HIGH — all 9 themes enumerated, type system enforces non-optional fields
- Test harness patterns: HIGH — existing test files provide complete reference implementations
- Phase 11.1 invariant preservation: HIGH — cache epoch math + RAF hot-path composition verified
- Phase 12 invariant preservation: HIGH — channel double-stroke branch is orthogonal to Fix 4's changes by code topology

**Research date:** 2026-04-23
**Valid until:** Until first code change to any of `RadarCanvas.tsx:690–805`, `hullCache.ts:68–122`, `BridgeRenderer.ts:82–256`, `themes.ts` (line numbers), or the addition of a 10th theme.

## RESEARCH COMPLETE
