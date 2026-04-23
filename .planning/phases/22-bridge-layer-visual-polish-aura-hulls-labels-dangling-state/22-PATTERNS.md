# Phase 22: Bridge Layer Visual Polish — Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 5 (3 production edits + 2 new tests + 2 test extensions)
**Analogs found:** 7 / 7 — every new/modified file has a concrete in-repo analog

## Scope recap (from 22-CONTEXT.md + 22-RESEARCH.md)

Phase 22 is polish-only — no new production files. Three existing production files receive surgical edits; two test files are new (Wave 0 gap closure); two existing test files are extended. All analogs are inside `src/views/Radar/` — this phase never leaves the radar folder.

## File Classification

| File | Status | Role | Data Flow | Closest Analog | Match Quality |
|------|--------|------|-----------|----------------|---------------|
| `src/views/Radar/RadarCanvas.tsx` | MODIFIED (Fix 1) | orchestrator (React component render loop) | per-frame transform | (self — pre-existing `bridgeNodes` snapshot at :697) | exact (self-analog) |
| `src/views/Radar/hullCache.ts` | MODIFIED (Fix 2) | cache / pure-fn | batch transform | (self — pre-existing guards at :87–88) | exact (self-analog) |
| `src/views/Radar/BridgeRenderer.ts` | MODIFIED (Fix 3 + 4) | pure draw function | per-frame render | (self — existing `theme.X ?? theme.Y ?? fallback` chain at :106–109) | exact (self-analog) |
| `src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts` | NEW | unit test (orchestration filter) | request-response | `src/views/Radar/__tests__/BridgeRender.test.ts` (makeMockCtx + fixtures) + `src/views/Radar/__tests__/hullCache.test.ts` (pure-helper preferred form) | role-match (pure-helper variant recommended) |
| `src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts` | NEW | unit test (cache-layer guard) | pure function | `src/views/Radar/__tests__/hullCache.test.ts` | exact |
| `src/views/Radar/__tests__/BridgeRender.test.ts` | EXTENDED | unit test (draw fn) | mock-recorder | (self — extend in place) | exact (self-analog) |
| `src/views/Radar/__tests__/BoundaryLine.test.ts` | EXTENDED | unit test (draw fn) | mock-recorder | (self — extend in place; must gain `fillRect` + `measureText` mock methods) | exact (self-analog) |

All analogs live under `src/views/Radar/` — no cross-module pattern lift required.

---

## Pattern Assignments

### `src/views/Radar/RadarCanvas.tsx` — Fix 1 (aura removal)

**Analog:** self — the existing `bridgeNodes` snapshot pattern at `src/views/Radar/RadarCanvas.tsx:697` is the exact shape to mirror.

**Note on line numbers (from 22-RESEARCH.md §6.1):** CONTEXT.md anchors at `:705`; the actual `bridgeNodes = liveNodes.filter(...)` declaration is at **:697**. Treat "the line declaring `const bridgeNodes = …`" as authoritative, not the literal number.

**Pre-existing pattern to mirror (verbatim from lines 693–697):**

```typescript
// Phase 12 fix (quick/260422-dqu) — derive bridgeNodes ONCE per frame
// up-front so the boundary line (step 3), bridge diamonds/labels
// (steps 12-13), and screen-space anchor labels (steps 22-24) can all
// share the same filter + gate on bridges-present.
const bridgeNodes = liveNodes.filter((n) => n.kind === 'bridge');
```

**Add one sibling line immediately after (D-01, D-02):**

```typescript
const fileNodes = liveNodes.filter((n) => n.kind !== 'bridge');
```

**Pre-existing call-site pattern (verbatim from lines 724–737):**

```typescript
// Step 6: Nodes (heat-tint fill on demand).
drawNodes(
  ctx,
  liveNodes,                  // <-- Fix 1: replace with fileNodes
  s.contentionScores,
  s.heatMapEnabled,
  s.hoveredNodeId,
  vp.zoom,
  vp,
  w,
  h,
  s.theme,
);
// Step 6b: File-name labels at high zoom (UI-SPEC §Progressive Detail ≥ 4×).
drawFileLabels(ctx, liveNodes, vp.zoom, vp, w, h, s.theme);
//                  ^^^^^^^^^ Fix 1: replace with fileNodes
```

**MUST NOT touch (D-03):**
- `drawFolderHulls(ctx, liveNodes, …)` at :710–718 — Fix 2 handles hull membership at the cache layer; adding a second filter would mask the bug per D-05.
- `drawEdges(ctx, s.graphEdges, livePositions, …)` at :720 — consumes edges by id, not node array.
- `drawBridgeNodes(ctx, bridgeNodes, …)` at :744 — continues to receive the bridge-only snapshot unchanged.
- `drawBoundaryAnchorLabels(ctx, bridgeNodes, …)` at :803 — already bridge-scoped (surfaced in RESEARCH §1.1 as a sanity check).

**Phase 11.1 D-05..D-08 invariants preserved:** no new Zustand write, no new effect, no new ref, no memoization (D-02 explicit). Filter runs inside the existing RAF closure.

---

### `src/views/Radar/hullCache.ts` — Fix 2 (bridge exclusion)

**Analog:** self — the existing guard pattern inside the `for (const n of nodes)` loop at `src/views/Radar/hullCache.ts:86–91`.

**Pre-existing guard pattern (verbatim from lines 84–92):**

```typescript
// Group nodes by dirKey. Skip empty-dirKey roots and uninitialized positions.
const byDir = new Map<string, GraphNode[]>();
for (const n of nodes) {
  if (n.x === undefined || n.y === undefined) continue;
  if (n.dirKey === '') continue;
  const arr = byDir.get(n.dirKey) ?? [];
  arr.push(n);
  byDir.set(n.dirKey, arr);
}
```

**Add one sibling guard (D-04, matches the existing one-line-continue idiom exactly):**

```typescript
if (n.kind === 'bridge') continue;
```

Insert between the `n.dirKey === ''` guard (:88) and the `byDir.get` lookup (:89).

**Module doc-comment addition (D-06):** Add a terse one-line invariant near the top of the file (before line 17 `import { polygonHull, polygonCentroid } from 'd3-polygon';`) stating that `kind === 'bridge'` nodes are excluded from hull membership because they are pinned on y=0 and would drag folder centroids. Do NOT annotate with phase numbers (durable memory rule).

**Cache epoch preservation (critical — D-04, RESEARCH §5.1):** Do NOT touch:
- Line 77: `const zoomBucket = Math.round(zoom * 10) / 10;`
- Line 78: `const epoch = \`${settledAt ?? 'null'}|${zoomBucket}\`;`
- Line 79: `if (epoch === cacheEpoch) return cache;`

The guard is strictly inside the loop body. Phase 11.1 D-08 cache-key invariant stays intact.

---

### `src/views/Radar/BridgeRenderer.ts` — Fix 3 (anchor label contrast)

**Analog:** self — `drawBoundaryAnchorLabels` at lines 218–256 is the function being modified. The `theme.X ?? theme.Y ?? fallback` idiom from `drawBridgeNodes` at :106–109 is the token-resolution pattern to reuse.

**Pre-existing token-resolution pattern (verbatim from lines 106–109):**

```typescript
const baseFill =
  (theme as unknown as { edgeGlow?: string }).edgeGlow ??
  (theme as unknown as { arrowFill?: string }).arrowFill ??
  '#00cffc';
```

**Pre-existing function to modify (verbatim from lines 218–256):**

```typescript
export function drawBoundaryAnchorLabels(
  ctx: CanvasRenderingContext2D,
  bridges: GraphNode[],
  viewport: Viewport,
  _canvasWidth: number,
  canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  if (bridges.length === 0) return;
  let boundaryScreenY = viewport.panY;
  if (boundaryScreenY < 24) boundaryScreenY = 24;
  if (boundaryScreenY > canvasHeight - 24) boundaryScreenY = canvasHeight - 24;
  const leftX = 12;
  const labelColor = theme.folderLabelColor ?? theme.nodeStroke;  // <-- Fix 3 D-07: swap to fileLabelColor

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = labelColor;

  // FRONTEND stack (above boundary).
  ctx.font = `700 10px "Space Grotesk", sans-serif`;
  ctx.globalAlpha = 0.8;                                     // <-- D-08: 0.8 → 1.0
  ctx.fillText('FRONTEND', leftX, boundaryScreenY - 18);
  ctx.font = `400 10px "JetBrains Mono", monospace`;
  ctx.globalAlpha = 0.55;                                    // <-- D-08: 0.55 → 0.85
  ctx.fillText('TypeScript', leftX, boundaryScreenY - 8);

  // BACKEND stack (below boundary).
  ctx.font = `700 10px "Space Grotesk", sans-serif`;
  ctx.globalAlpha = 0.8;                                     // <-- D-08: 0.8 → 1.0
  ctx.fillText('BACKEND', leftX, boundaryScreenY + 18);
  ctx.font = `400 10px "JetBrains Mono", monospace`;
  ctx.globalAlpha = 0.55;                                    // <-- D-08: 0.55 → 0.85
  ctx.fillText('Rust', leftX, boundaryScreenY + 8);

  ctx.restore();
}
```

**Changes (D-07..D-11):**

1. **Line 232** token swap: `const labelColor = theme.fileLabelColor ?? theme.nodeStroke;` (not `folderLabelColor`).
2. **Alpha raise (D-08):** bold rows `0.8 → 1.0`, thin rows `0.55 → 0.85`.
3. **New pill backdrop (D-09, D-10, D-11):** drawn BEFORE each `fillText` pair. Two pills total:
   - FRONTEND+TypeScript pill (spans both bold+thin rows above boundary)
   - BACKEND+Rust pill (spans both bold+thin rows below boundary)
4. **Pill geometry (inside the existing save/restore envelope — D-10):** sharp-cornered `fillRect` (Command Horizon zero-radius — no `arcTo`). Width = `ctx.measureText(widest_label).width + 8` (8px horizontal padding). Height = line-height + 4 (4px vertical padding). Fill = `{canvasBackground}cc` (hex-alpha composition for 80% opacity — D-11). Every theme's `canvasBackground` is a 6-char hex string (RESEARCH §2 confirms 9/9), so `${hex}cc` works without rgba fallback; add a defensive regex guard.

**Recommended helper scaffold (D-11 helper lives adjacent to the pill-draw code; planner's discretion per CONTEXT `<decisions>` notes whether to extract `drawLabelWithBackdrop` shared by both pills):**

```typescript
function composeBackdropFill(canvasBg: string): string {
  // D-11: hex + alpha suffix for 80% opacity. All 9 THEMES ship 6-char hex;
  // rgba fallback kept defensive but is dead code today.
  return /^#[0-9a-f]{6}$/i.test(canvasBg) ? `${canvasBg}cc` : canvasBg;
}
```

**Post-edit, `fillStyle` is reset to `labelColor` before the `fillText` call** so the pill fill does not leak into glyph color.

---

### `src/views/Radar/BridgeRenderer.ts` — Fix 4 (dangling signal)

**Analog:** self — the existing per-bridge branching at `drawBridgeNodes` :110–135.

**Pre-existing dangling detection + render pattern (verbatim from lines 110–135):**

```typescript
for (const b of bridges) {
  if (b.x === undefined || b.y === undefined) continue;
  const isSelected =
    selectedBridgeId !== null && b.commandName === selectedBridgeId;
  const isDangling =
    b.callerCount === 0 ||
    b.callerCount === undefined ||
    !b.handlerFile;
  const hasChannel = b.hasChannelArg === true;

  // Inner diamond.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y - d);
  ctx.lineTo(b.x + d, b.y);
  ctx.lineTo(b.x, b.y + d);
  ctx.lineTo(b.x - d, b.y);
  ctx.closePath();
  ctx.fillStyle = isSelected ? theme.nodeFillHover ?? baseFill : baseFill;  // <-- D-13: split on isDangling
  ctx.fill();
  ctx.strokeStyle = theme.nodeStroke;                                       // <-- D-15: stays unchanged
  ctx.lineWidth = 1 / zoom;
  if (isDangling) ctx.setLineDash(BRIDGE_DASH_PATTERN);                     // <-- D-14: DELETE this line
  ctx.stroke();
  ctx.setLineDash([]);                                                       // keep (defensive reset)
  ctx.restore();
}
```

**Changes (D-12..D-15):**

1. **Fill ternary (D-13):** introduce three-way on `isDangling`:
   ```typescript
   ctx.fillStyle = isSelected
     ? theme.nodeFillHover ?? baseFill
     : isDangling
       ? theme.nodeFill
       : baseFill;
   ```
2. **Line 132 deletion (D-14):** remove `if (isDangling) ctx.setLineDash(BRIDGE_DASH_PATTERN);`. Leave line 134 (`ctx.setLineDash([])`) untouched.
3. **`BRIDGE_DASH_PATTERN` constant retention (D-14):** keep declaration at line 42. Add one-line comment + `eslint-disable-next-line @typescript-eslint/no-unused-vars` (or whatever ESLint rule the repo has configured for unused exports). Planner may delete outright instead; CONTEXT D-14 recommends retain-and-comment.
4. **Stroke stays `theme.nodeStroke` (D-15):** line 130 unchanged.
5. **Channel ring (:138–152) + selected ring (:155–168):** ZERO change — RESEARCH §5.4 confirms code-topology orthogonality. W-22-07 is the regression witness.

---

### `src/views/Radar/__tests__/RadarCanvas.auraFilter.test.ts` — NEW (W-22-01, W-22-02)

**Closest analogs:**
1. **Primary:** `src/views/Radar/__tests__/BridgeRender.test.ts` — for `makeMockCtx` recorder + `makeBridge`/`makeFileNode` fixture pattern.
2. **Preferred variant (RESEARCH §3.4):** refactor the filter into a pure helper `filterRenderableFileNodes(liveNodes)` co-located in `RadarCanvas.tsx` and unit-test the helper directly — cheaper than mounting React.
3. **Alternative:** `src/views/Radar/__tests__/RadarCanvas.test.tsx` for the full-mount + canvas-shim pattern if the planner decides not to extract a helper.

**Pure-helper unit test pattern to use (recommended — mirrors hullCache.test.ts's simple pure-function test shape):**

Harness to copy from `BridgeRender.test.ts:15–65` (the Path2D polyfill + `makeMockCtx`) is NOT required — the filter is a pure array operation and needs no canvas mock. Copy ONLY the fixture factories.

**Fixture factories to copy from `BridgeRender.test.ts:67–82`:**

```typescript
function makeBridge(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: `bridge:${overrides.commandName ?? 'ping'}`,
    dirKey: 'bridge',
    dirDepth: 0,
    kind: 'bridge',
    x: 0,
    y: 0,
    commandName: 'ping',
    handlerFile: 'src-tauri/src/handlers.rs',
    handlerLine: 1,
    hasChannelArg: false,
    callerCount: 1,
    ...overrides,
  };
}
```

**Add a companion file-node factory (per RESEARCH §3.2):**

```typescript
function makeFileNode(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: overrides.id ?? 'src/a.ts',
    dirKey: overrides.dirKey ?? 'src',
    dirDepth: overrides.dirDepth ?? 1,
    kind: 'file',
    x: 0,
    y: 0,
    ...overrides,
  } as GraphNode;
}
```

**Witness shapes (W-22-01 + W-22-02 — pure-helper form recommended):**

```typescript
describe('filterRenderableFileNodes (Fix 1, W-22-01 + W-22-02)', () => {
  it('W-22-01: excludes every kind==="bridge" node', () => {
    const live = [
      makeFileNode({ id: 'a' }),
      makeBridge({ commandName: 'ping' }),
      makeFileNode({ id: 'b' }),
      makeBridge({ commandName: 'startWatch' }),
    ];
    const filtered = filterRenderableFileNodes(live);
    expect(filtered.every((n) => n.kind !== 'bridge')).toBe(true);
    expect(filtered).toHaveLength(2);
  });

  it('W-22-02: passes through when zero bridges present (no-op identity)', () => {
    const live = [makeFileNode({ id: 'a' }), makeFileNode({ id: 'b' })];
    const filtered = filterRenderableFileNodes(live);
    expect(filtered).toHaveLength(2);
  });
});
```

**Alternative (full-mount form):** if the planner keeps the filter inline (no helper), use `vi.mock('../GraphRenderer', …)` to spy on `drawNodes` + `drawFileLabels`. `RadarCanvas.test.tsx:1–114` is the canvas-shim + ResizeObserver + rAF setup to copy verbatim. Recommended form: **extract the helper** — it avoids coupling W-22-01/02 to React render cadence.

---

### `src/views/Radar/__tests__/hullCache.bridgeExclusion.test.ts` — NEW (W-22-03)

**Closest analog:** `src/views/Radar/__tests__/hullCache.test.ts` — direct sibling, extended pattern.

**Verbatim harness to copy from `hullCache.test.ts:1–45`:**

```typescript
// Path2D polyfill for jsdom — MUST be at top, before any import that
// transitively loads hullCache.ts.
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as unknown as { Path2D: new (d?: string) => unknown }).Path2D =
    class Path2D {
      constructor(_d?: string) {}
    } as unknown as new (d?: string) => unknown;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

const hullSpy = vi.fn();
const centroidSpy = vi.fn();
vi.mock('d3-polygon', async () => {
  const actual = await vi.importActual<typeof import('d3-polygon')>('d3-polygon');
  return {
    ...actual,
    polygonHull: (...args: Parameters<typeof actual.polygonHull>) => {
      hullSpy(...args);
      return actual.polygonHull(...args);
    },
    polygonCentroid: (...args: Parameters<typeof actual.polygonCentroid>) => {
      centroidSpy(...args);
      return actual.polygonCentroid(...args);
    },
  };
});

import { getHullCache, _resetHullCacheForTest } from '../hullCache';
import type { GraphNode } from '../../../stores/radarStore';
```

**beforeEach pattern to copy verbatim from `hullCache.test.ts:48–52`:**

```typescript
beforeEach(() => {
  _resetHullCacheForTest();
  hullSpy.mockClear();
  centroidSpy.mockClear();
});
```

**W-22-03 witness shape (adapted from RESEARCH §3.3, grounded in the actual fixture shape at hullCache.test.ts:40–45):**

```typescript
describe('hullCache bridge exclusion (Fix 2, W-22-03)', () => {
  beforeEach(() => { _resetHullCacheForTest(); hullSpy.mockClear(); });

  it('W-22-03: getHullCache excludes kind==="bridge" nodes from hull membership', () => {
    const nodes: GraphNode[] = [
      { id: 'src/a.ts', dirKey: 'src', dirDepth: 1, kind: 'file', x: 0, y: 10 } as GraphNode,
      { id: 'src/b.ts', dirKey: 'src', dirDepth: 1, kind: 'file', x: 10, y: 10 } as GraphNode,
      { id: 'src/c.ts', dirKey: 'src', dirDepth: 1, kind: 'file', x: 5, y: 20 } as GraphNode,
      // Bridge pinned on boundary, same dirKey — would drag centroid toward y=0 if included.
      { id: 'bridge:ping', dirKey: 'src', dirDepth: 1, kind: 'bridge', x: 5, y: 0 } as GraphNode,
    ];
    const result = getHullCache(nodes, 1.0, 1000);
    const entry = result.get('src');
    expect(entry).toBeDefined();
    // Centroid of 3 file nodes: cy ≈ (10+10+20)/3 = 13.33. If bridge were
    // included: cy ≈ (10+10+20+0)/4 = 10. Assert cy > 11 to distinguish.
    expect(entry!.cy).toBeGreaterThan(11);
  });

  it('W-22-03: invariant holds across representative themes + zoom buckets', () => {
    // Themes don't affect hullCache (theme is not a getHullCache argument),
    // but zoom buckets do — parametrize across bucket boundaries.
    const nodes: GraphNode[] = [
      { id: 'src/a.ts', dirKey: 'src', dirDepth: 1, kind: 'file', x: 0, y: 10 } as GraphNode,
      { id: 'src/b.ts', dirKey: 'src', dirDepth: 1, kind: 'file', x: 10, y: 10 } as GraphNode,
      { id: 'src/c.ts', dirKey: 'src', dirDepth: 1, kind: 'file', x: 5, y: 20 } as GraphNode,
      { id: 'bridge:ping', dirKey: 'src', dirDepth: 1, kind: 'bridge', x: 5, y: 0 } as GraphNode,
    ];
    for (const zoom of [0.5, 1.0, 2.0, 5.0]) {
      _resetHullCacheForTest();
      const entry = getHullCache(nodes, zoom, 1000).get('src')!;
      expect(entry.cy).toBeGreaterThan(11);
    }
  });
});
```

**Note:** Theme is not a `getHullCache` argument; parametrizing over themes as RESEARCH §3.5 suggested is a no-op. Parametrize over zoom buckets only (as above), which DO drive cache-epoch invalidation (hullCache.test.ts:72–82 shows the bucket-change pattern).

---

### `src/views/Radar/__tests__/BridgeRender.test.ts` — EXTENDED (W-22-06, W-22-07)

**Analog:** self — the file is being extended in place.

**Existing test pattern to REPLACE (lines 188–226 — two "dangling applies BRIDGE_DASH_PATTERN" tests):**

Lines 188–206 (callerCount=0 dangling) and 208–226 (handlerFile="" dangling) both assert that `BRIDGE_DASH_PATTERN` IS applied. Fix 4 (D-14) removes that behavior, so these tests WILL legitimately fail (RESEARCH §5.3 documents this as expected test evolution, not regression).

**Replacement W-22-06 witness (asserts the NEW dangling signal contract):**

```typescript
it('W-22-06: dangling bridge (callerCount=0) uses theme.nodeFill and does NOT call setLineDash(BRIDGE_DASH_PATTERN)', () => {
  const ctx = makeMockCtx();
  const theme = THEMES['phosphor-classic'];
  drawBridgeNodes(
    ctx,
    [makeBridge({ callerCount: 0 })],
    null,
    null,
    1,
    { zoom: 1, panX: 0, panY: 0 },
    800,
    600,
    theme,
  );
  // D-13: dangling fill resolves to theme.nodeFill.
  expect(ctx._assignments.fillStyle).toContain(theme.nodeFill);
  // D-14: no setLineDash call with BRIDGE_DASH_PATTERN (call log assertion,
  // not getLineDash state — idiomatic form per RESEARCH §6.3).
  const dashCalls = ctx._calls.filter((c: Call) => c.fn === 'setLineDash');
  const dashedApplied = dashCalls.some(
    (c: Call) => JSON.stringify(c.args[0]) === JSON.stringify(BRIDGE_DASH_PATTERN),
  );
  expect(dashedApplied).toBe(false);
});

it('W-22-06: dangling bridge (handlerFile="") uses theme.nodeFill and does NOT call setLineDash(BRIDGE_DASH_PATTERN)', () => {
  const ctx = makeMockCtx();
  const theme = THEMES['phosphor-classic'];
  drawBridgeNodes(
    ctx,
    [makeBridge({ handlerFile: '', callerCount: 2 })],
    null, null, 1,
    { zoom: 1, panX: 0, panY: 0 }, 800, 600, theme,
  );
  expect(ctx._assignments.fillStyle).toContain(theme.nodeFill);
  const dashCalls = ctx._calls.filter((c: Call) => c.fn === 'setLineDash');
  expect(dashCalls.some((c: Call) =>
    JSON.stringify(c.args[0]) === JSON.stringify(BRIDGE_DASH_PATTERN)
  )).toBe(false);
});

it('W-22-06: populated bridge still uses edgeGlow/arrowFill/#00cffc fallback chain', () => {
  // Regression — Fix 4 does not touch the populated-fill path.
  const ctx = makeMockCtx();
  drawBridgeNodes(
    ctx,
    [makeBridge({ callerCount: 3 })],
    null, null, 1,
    { zoom: 1, panX: 0, panY: 0 }, 800, 600,
  );
  expect(ctx._assignments.fillStyle).toContain('#00cffc');
});
```

**W-22-07 witness (channel double-stroke geometry invariant across dangling + populated):**

```typescript
it('W-22-07: channel double-stroke geometry identical across dangling AND populated states', () => {
  // D-15 regression witness: Fix 4 must not perturb the channel-ring code path.
  const ctxDangling = makeMockCtx();
  drawBridgeNodes(
    ctxDangling,
    [makeBridge({ hasChannelArg: true, callerCount: 0 })],
    null, null, 1,
    { zoom: 1, panX: 0, panY: 0 }, 800, 600,
  );
  const ctxPopulated = makeMockCtx();
  drawBridgeNodes(
    ctxPopulated,
    [makeBridge({ hasChannelArg: true, callerCount: 3 })],
    null, null, 1,
    { zoom: 1, panX: 0, panY: 0 }, 800, 600,
  );
  // Inner diamond (1 moveTo) + outer channel ring (1 moveTo) = 2 moveTo per state.
  const movesDangling = ctxDangling._calls.filter((c: Call) => c.fn === 'moveTo').length;
  const movesPopulated = ctxPopulated._calls.filter((c: Call) => c.fn === 'moveTo').length;
  expect(movesDangling).toBe(movesPopulated);
  expect(movesDangling).toBe(2);
});
```

**Mock extensions required (from RESEARCH §3.1 + §6.2):** none for `BridgeRender.test.ts` — the existing mock at :24–65 already records `setLineDash` and all style assignments. The `fillRect` + `measureText` additions are only needed in `BoundaryLine.test.ts` (below).

---

### `src/views/Radar/__tests__/BoundaryLine.test.ts` — EXTENDED (W-22-04, W-22-05)

**Analog:** self — extend in place. Requires one mock extension.

**Existing test pattern to UPDATE (lines 171–183):**

```typescript
it('V-12-22: uses theme.folderLabelColor for fills', () => {  // <-- Fix 3 D-07: update to fileLabelColor
  const ctx = makeMockCtx();
  const theme = THEMES['phosphor-classic'];
  drawBoundaryAnchorLabels(
    ctx, BRIDGES_FIXTURE, { zoom: 1, panX: 0, panY: 300 }, 800, 600, theme,
  );
  expect(ctx._assignments.fillStyle).toContain(theme.folderLabelColor);  // <-- change to theme.fileLabelColor
});
```

**Replacement W-22-04 witness:**

```typescript
it('W-22-04: uses theme.fileLabelColor (not folderLabelColor) for label fills; bold rows at globalAlpha 1.0', () => {
  const ctx = makeMockCtx();
  const theme = THEMES['phosphor-classic'];
  drawBoundaryAnchorLabels(
    ctx, BRIDGES_FIXTURE, { zoom: 1, panX: 0, panY: 300 }, 800, 600, theme,
  );
  // D-07: token swap.
  expect(ctx._assignments.fillStyle).toContain(theme.fileLabelColor);
  // D-08: bold alpha 1.0, thin alpha 0.85.
  expect(ctx._assignments.globalAlpha).toContain(1.0);
  expect(ctx._assignments.globalAlpha).toContain(0.85);
});
```

**Mock extension REQUIRED (RESEARCH §6.2) — add `fillRect` and `measureText` to `makeMockCtx` at lines 36–74:**

Current mock (lines 42–50) lacks these two methods. Extend the `ctx` object literal:

```typescript
const ctx: any = {
  beginPath: record('beginPath'),
  moveTo: record('moveTo'),
  lineTo: record('lineTo'),
  stroke: record('stroke'),
  save: record('save'),
  restore: record('restore'),
  fillText: record('fillText'),
  fillRect: record('fillRect'),                              // <-- ADD for W-22-05
  measureText: (t: string) => ({ width: t.length * 6 }),     // <-- ADD for W-22-05 pill width
};
```

**W-22-05 witness (backdrop pill fillRect BEFORE fillText):**

```typescript
it('W-22-05: emits one zero-radius fillRect backdrop pill per label stack BEFORE each fillText', () => {
  const ctx = makeMockCtx();
  const theme = THEMES['phosphor-classic'];
  drawBoundaryAnchorLabels(
    ctx, BRIDGES_FIXTURE, { zoom: 1, panX: 0, panY: 300 }, 800, 600, theme,
  );
  // D-09: two pills (FRONTEND stack + BACKEND stack).
  const fillRects = ctx._calls.filter((c: Call) => c.fn === 'fillRect');
  expect(fillRects.length).toBeGreaterThanOrEqual(2);

  // D-10: each pill's fillRect must precede the first fillText of its stack.
  const firstFrontend = ctx._calls.findIndex(
    (c: Call) => c.fn === 'fillText' && c.args[0] === 'FRONTEND',
  );
  const firstBackend = ctx._calls.findIndex(
    (c: Call) => c.fn === 'fillText' && c.args[0] === 'BACKEND',
  );
  const fillRectIdxs = ctx._calls
    .map((c: Call, i: number) => (c.fn === 'fillRect' ? i : -1))
    .filter((i: number) => i >= 0);
  expect(fillRectIdxs.some((i: number) => i < firstFrontend)).toBe(true);
  expect(fillRectIdxs.some((i: number) => i < firstBackend && i > firstFrontend)).toBe(true);

  // D-11: pill fillStyle carries canvasBackground + 'cc' suffix (80% alpha).
  const expected = `${theme.canvasBackground}cc`;
  expect(ctx._assignments.fillStyle).toContain(expected);
});
```

**Discretionary refactor (RESEARCH §6.2):** the planner may extract `makeMockCtx` into a shared `src/views/Radar/__tests__/_canvasMock.ts` consumed by both `BridgeRender.test.ts` and `BoundaryLine.test.ts`. Small refactor; improves maintainability; not required.

---

## Shared Patterns

### Pure draw function signature (ALL BridgeRenderer functions — cross-file shared)

**Source:** `src/views/Radar/BridgeRenderer.ts:54–61, :94–104, :182–190, :218–225` — four existing draw functions share the same signature shape.

**Pattern (apply to both Fix 3 + Fix 4 edits — don't widen the signatures):**

```typescript
export function draw[X](
  ctx: CanvasRenderingContext2D,
  [...data]: …,
  [zoom OR viewport]: number | Viewport,
  [_viewport OR _canvasWidth]: …,
  _canvasWidth: number,
  _canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void
```

Fix 3 + Fix 4 MUST NOT change any signature — all edits are inside function bodies.

### Theme token fallback chain idiom

**Source:** `src/views/Radar/BridgeRenderer.ts:106–109` (edgeGlow → arrowFill → '#00cffc') and `:232` (folderLabelColor → nodeStroke).

**Apply to:** all token resolution in Fix 3 + Fix 4. For Fix 3 (D-07), the chain becomes `theme.fileLabelColor ?? theme.nodeStroke`. For Fix 4 (D-13), the chain is direct (`theme.nodeFill`) because `GraphTheme` declares `nodeFill` non-optional (RESEARCH §2 confirms 9/9 themes populate it). For the pill backdrop (D-11), compose `${theme.canvasBackground}cc` guarded by the hex regex.

### Mock canvas context recorder pattern (ALL test files — cross-test shared)

**Source:** `src/views/Radar/__tests__/BridgeRender.test.ts:24–65` is the canonical form; `BoundaryLine.test.ts:36–74` is a subset. `RadarCanvas.test.tsx:52–114` has a richer variant with `ResizeObserver` shim.

**Method coverage needed for Phase 22:**

| Method / Property | In BridgeRender.test.ts | In BoundaryLine.test.ts | Required by Phase 22 |
|---|---|---|---|
| `beginPath`, `moveTo`, `lineTo`, `closePath`, `stroke`, `fill`, `save`, `restore`, `fillText` | ✓ | ✓ | ✓ (unchanged) |
| `setLineDash` | ✓ | ✗ | W-22-06 (BridgeRender) |
| `fillRect` | ✗ | ✗ | **ADD to BoundaryLine** (W-22-05) |
| `measureText` | ✗ | ✗ | **ADD to BoundaryLine** (W-22-05 pill width) |
| `fillStyle`, `strokeStyle`, `lineWidth`, `font`, `textAlign`, `textBaseline`, `globalAlpha` (getter/setter) | ✓ | ✓ | ✓ (unchanged) |

**The `setLineDash` call-log assertion idiom (per RESEARCH §6.3)** — assert on `ctx._calls.filter(c => c.fn === 'setLineDash')` with a first-arg equality check (JSON.stringify compare). Do NOT try to model `getLineDash()` state.

### Fixture factory pattern (bridges + file nodes)

**Source:** `src/views/Radar/__tests__/BridgeRender.test.ts:67–82` (makeBridge).

**Apply to:** new `RadarCanvas.auraFilter.test.ts` and `hullCache.bridgeExclusion.test.ts`. Copy `makeBridge` verbatim; add a companion `makeFileNode` factory as specified in RESEARCH §3.2 (shape included above in the Pattern Assignments for RadarCanvas.auraFilter.test.ts).

### Commit-after-each-change

**Source:** user durable memory + CLAUDE.md GSD enforcement. Per-diff commit per plan task. Production-code change and its matching test edit MUST be committed in the same diff (RESEARCH §5.3 note): shipping production code and test update in separate commits momentarily breaks the suite.

---

## No Analog Found

**None.** Every file in Phase 22's scope has a concrete in-repo analog — either itself (for modifications) or a direct sibling in `src/views/Radar/` (for new tests). Zero pattern lift from outside the radar folder.

---

## Metadata

**Analog search scope:**
- `src/views/Radar/*.{ts,tsx}` (production code)
- `src/views/Radar/__tests__/*.{ts,tsx}` (existing tests)
- `src/views/Radar/themes.ts` (token availability)

**Files scanned:** 6 production files (RadarCanvas, hullCache, BridgeRenderer, themes, BridgeTooltip, BridgeDetailPanel) + 15 existing test files in `src/views/Radar/__tests__/`.

**Pattern extraction date:** 2026-04-23

**Anchored to live code, NOT line numbers:** Where CONTEXT.md's line numbers drifted (e.g. `:705` vs actual `:697` for the `bridgeNodes` snapshot), this PATTERNS.md anchors on syntactic shape ("the line declaring `const bridgeNodes = liveNodes.filter(...)`") so the guidance survives any pre-Phase-22 churn on these files.
