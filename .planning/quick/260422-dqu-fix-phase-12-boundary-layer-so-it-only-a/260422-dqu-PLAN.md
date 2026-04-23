---
task_id: 260422-dqu
mode: quick
phase: 12
description: "Fix Phase 12 boundary layer so it only activates on repos with a Tauri IPC surface"
created: 2026-04-22
files_modified:
  - src/views/Radar/BridgeRenderer.ts
  - src/views/Radar/RadarCanvas.tsx
  - src/views/Radar/ForceConfigPanel.tsx
  - src/workers/forces/forceBoundary.ts
  - src/views/Radar/__tests__/BoundaryLine.test.ts
  - src/views/Radar/__tests__/forceBoundary.test.ts
  - src/views/Radar/__tests__/ForceConfigPanel.test.tsx
commit_scope: "fix(12)"
witnesses_touched:
  - V-12-17 (forceBoundary TS-nodes convergence — must still pass when bridges present)
  - V-12-18 (forceBoundary Rust-nodes convergence — must still pass when bridges present)
  - V-12-19 (bridge fy=0 pinned — must still pass when bridges present)
  - V-12-22 (boundary line + FRONTEND/BACKEND labels — gated on bridges-present; new no-bridges case added)
---

# Quick Task 260422-dqu — Gate the Phase 12 boundary layer on bridges-present

<objective>
On polyglot repos that have no `#[tauri::command]` surface (Python + TS-only, Go + TS-only, etc.) `get_ipc_bridges` returns an empty `Vec<IpcBridgeDto>` and `radarStore.graphNodes` contains zero `kind==='bridge'` nodes. Today the rest of the Phase 12 boundary layer — the world-space boundary line, the screen-space FRONTEND/BACKEND anchor labels, the `forceBoundary` vertical push on TS-classified files, and the BOUNDARY slider in `ForceConfigPanel` — still renders unconditionally. Result on the user's "2 TS frontends + Python backend" repo: Python files sit near y=0 (no `language` classification → no force), TS files get pushed up toward y=-300, there is no corresponding Rust cluster below, and the labels still say `FRONTEND` / `BACKEND · Rust` over a Python codebase. Confusing half-visualization that implies a structure that isn't there.

D-15/D-16 in `12-CONTEXT.md` locked a Tauri-binary layout assumption. This quick task adds the missing runtime guard without changing any of that locked behavior when a Tauri IPC surface IS present.

Output:
- 3 non-worker src edits + 1 worker src edit that collectively make the boundary layer a no-op on repos with zero bridges.
- 3 test extensions that lock the no-bridges behavior + a new test file for the slider-hidden path.
- Zero regression to V-12-15..V-12-24 on Tauri repos (bridges present → boundary line + labels + force + slider all behave exactly as today).
- Zero new dependencies.

Commit per task; every commit is `fix(12): …`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-quick.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md
@.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-CONTEXT.md
@.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-VALIDATION.md
@.planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-05-SUMMARY.md
@src/views/Radar/BridgeRenderer.ts
@src/views/Radar/RadarCanvas.tsx
@src/views/Radar/ForceConfigPanel.tsx
@src/workers/forces/forceBoundary.ts
@src/views/Radar/__tests__/BoundaryLine.test.ts
@src/views/Radar/__tests__/forceBoundary.test.ts

<interfaces>
<!-- Shapes the executor needs. All already present in the codebase — extracted here so no codebase spelunking is required. -->

From src/stores/radarStore.ts:
```typescript
export interface GraphNode {
  id: string;
  dirKey: string;
  dirDepth: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  kind?: 'file' | 'bridge';   // undefined treated as 'file'
  language?: 'ts' | 'rust';   // only populated on file nodes
  commandName?: string;
  // … bridge-only fields omitted for brevity
}
```

From src/workers/forces/forceBoundary.ts (current):
```typescript
export interface BoundaryNode extends SimulationNodeDatum {
  kind?: 'file' | 'bridge';
  language?: 'ts' | 'rust';
}

export interface BoundaryForce {
  (alpha: number): void;
  initialize: (nodes: BoundaryNode[]) => void;
  strength: ((v: number) => BoundaryForce) & (() => number);
}

export const BOUNDARY_TARGET_Y_MAGNITUDE = 300;
export const BOUNDARY_DEADBAND = 5;
export const FORCE_BOUNDARY_BASE_STRENGTH = 0.15;

export function forceBoundary(): BoundaryForce { /* … */ }
```

From src/views/Radar/BridgeRenderer.ts (current — the four relevant functions):
```typescript
export function drawBoundaryLine(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  canvasWidth: number,
  _canvasHeight: number,
  theme?: GraphTheme,
): void;

export function drawBridgeNodes(
  ctx, bridges: GraphNode[], selectedBridgeId, hoveredBridgeId,
  zoom, viewport, canvasWidth, canvasHeight, theme?,
): void;

export function drawBridgeLabels(
  ctx, bridges: GraphNode[], zoom, viewport, canvasWidth, canvasHeight, theme?,
): void;

export function drawBoundaryAnchorLabels(
  ctx, viewport, canvasWidth, canvasHeight, theme?,
): void;
```

From src/views/Radar/RadarCanvas.tsx — the render-loop bodies that call the above:
```typescript
// Step 3 — world-space boundary line (currently unconditional)
drawBoundaryLine(ctx, vp, w, h, s.theme);

// Steps 12-13 — bridge diamonds + labels (already naturally empty when bridgeNodes=[])
const bridgeNodes = liveNodes.filter((n) => n.kind === 'bridge');
drawBridgeNodes(ctx, bridgeNodes, /* … */);
drawBridgeLabels(ctx, bridgeNodes, /* … */);

// Steps 22-24 — screen-space anchor labels (currently unconditional)
ctx.save();
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
drawBoundaryAnchorLabels(ctx, vp, w, h, s.theme);
ctx.restore();
```

From src/views/Radar/ForceConfigPanel.tsx — the BOUNDARY slider JSX block is at ~lines 140-159 (see the current file). It must be wrapped in a conditional render.

Bridges-present predicate — derive wherever convenient:
```typescript
const hasBridges = graphNodes.some((n) => n.kind === 'bridge');
```
No new store slot, no new selector, no new prop threading.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Gate non-worker boundary rendering + slider on bridges-present</name>

  <read_first>
    - src/views/Radar/BridgeRenderer.ts (current signatures, jsdoc anchors — drawBoundaryLine early-return + drawBoundaryAnchorLabels early-return land here)
    - src/views/Radar/RadarCanvas.tsx (render loop — belt-and-braces guard mirrors the renderer checks + prevents the screen-space setTransform pass from running at all)
    - src/views/Radar/ForceConfigPanel.tsx (slider JSX block at lines ~140-159; hook up useRadarStore selector for hasBridges)
    - src/views/Radar/__tests__/BoundaryLine.test.ts (existing V-12-22 tests — extend with no-bridges cases)
    - .planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-CONTEXT.md §Decisions (D-15/D-16 locked the Tauri-binary assumption — this task adds the runtime guard without changing that assumption when bridges ARE present)
    - .planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-UI-SPEC.md §Layout (confirms boundary line + FRONTEND/BACKEND labels are the render surfaces being gated)
    - .planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-VALIDATION.md (V-12-22 is the witness being extended; V-12-15..V-12-24 must not regress)
  </read_first>

  <action>
Implement the `hasBridges` guard across the three non-worker src surfaces.

**1. `src/views/Radar/BridgeRenderer.ts` — early-return on `bridges.length === 0` in `drawBoundaryLine` + `drawBoundaryAnchorLabels`.**

Change `drawBoundaryLine` signature to accept the bridge list so the renderer itself owns the guard (source-of-truth principle):

```typescript
export function drawBoundaryLine(
  ctx: CanvasRenderingContext2D,
  bridges: GraphNode[],
  viewport: Viewport,
  canvasWidth: number,
  _canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  // Phase 12 fix (quick/260422-dqu) — gate on bridges-present. On repos
  // without a Tauri IPC surface (e.g. TS + Python) `get_ipc_bridges`
  // returns an empty Vec, so the boundary line is meaningless — would
  // imply a FE/BE divide that doesn't exist. D-15/D-16 locked the Tauri-
  // binary layout assumption; this guard adds the runtime check.
  if (bridges.length === 0) return;
  const zoom = viewport.zoom || 1;
  // … rest unchanged
}
```

Similarly for `drawBoundaryAnchorLabels`:

```typescript
export function drawBoundaryAnchorLabels(
  ctx: CanvasRenderingContext2D,
  bridges: GraphNode[],
  viewport: Viewport,
  _canvasWidth: number,
  canvasHeight: number,
  theme: GraphTheme = FALLBACK_THEME,
): void {
  // Phase 12 fix (quick/260422-dqu) — see drawBoundaryLine note.
  if (bridges.length === 0) return;
  let boundaryScreenY = viewport.panY;
  // … rest unchanged
}
```

Do NOT change `drawBridgeNodes` / `drawBridgeLabels` — they already loop over the bridges array and no-op naturally when it's empty. Do NOT change the exported sizing constants. Do NOT move the `bridges` arg into the middle of the arg list — append it right after `ctx` so it matches the existing `drawBridgeNodes(ctx, bridges, …)` convention; that keeps all four renderer entrypoints' signatures consistent.

**2. `src/views/Radar/RadarCanvas.tsx` — update the two call sites + add a belt-and-braces guard.**

Inside the rAF `render()` body, find the existing `bridgeNodes` computation and lift it up so the boundary line (step 3) can use it:

```typescript
// Compute bridgeNodes ONCE per frame, used by steps 3, 12, 13, and 22-24.
const bridgeNodes = liveNodes.filter((n) => n.kind === 'bridge');

// Step 3 — world-space boundary line. Renderer no-ops when bridges=[];
// skipping the call entirely when bridges.length===0 is a defensive
// belt-and-braces — prevents any ctx.save()/setTransform churn for the
// no-bridges case even though the function itself early-returns.
if (bridgeNodes.length > 0) {
  drawBoundaryLine(ctx, bridgeNodes, vp, w, h, s.theme);
}

// … steps 4-11 unchanged

// Steps 12-13 — bridge diamonds + labels (already naturally empty).
drawBridgeNodes(ctx, bridgeNodes, s.selectedBridgeId, s.hoveredBridgeId, vp.zoom, vp, w, h, s.theme);
drawBridgeLabels(ctx, bridgeNodes, vp.zoom, vp, w, h, s.theme);

// … steps 14-21 unchanged

// Steps 22-24 — screen-space FRONTEND/BACKEND anchor labels.
if (bridgeNodes.length > 0) {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBoundaryAnchorLabels(ctx, bridgeNodes, vp, w, h, s.theme);
  ctx.restore();
}
```

Also update the bridge hit-test path: `findBridgeAtWorld` already short-circuits per-node via the `n.kind !== 'bridge'` guard, so no additional change is needed there — when `graphNodes` has zero bridges, the for-loop completes without returning.

Do NOT add a new state variable for `hasBridges` at the component level; the rAF loop reads `liveNodes` each frame and derives `bridgeNodes` naturally. The stateRef already carries `graphNodes` so everything flows through the existing memoization plumbing.

**3. `src/views/Radar/ForceConfigPanel.tsx` — hide the BOUNDARY slider when zero bridges.**

Add a `useRadarStore` selector for the bridges-present predicate (colocated next to the existing `forceConfig` / `setForceConfig` selectors):

```typescript
const hasBridges = useRadarStore((s) =>
  s.graphNodes.some((n) => n.kind === 'bridge'),
);
```

Wrap the existing BOUNDARY slider JSX block (lines ~140-159 in the current file) in `{hasBridges && ( … )}`:

```tsx
{/* Phase 12 (D-29, D-30) — language-axis separation strength.
    Quick-fix 260422-dqu: only surface the slider on repos with a
    Tauri IPC surface. Non-Tauri repos see no boundary layer, so the
    slider would tune a force that isn't visibly doing anything. */}
{hasBridges && (
  <label className="block">
    <span className="flex justify-between text-on-surface-variant">
      BOUNDARY
      <span className="font-mono text-on-surface">
        {(forceConfig.boundaryStrength ?? 0.15).toFixed(2)}
      </span>
    </span>
    <input
      type="range"
      min={0}
      max={0.5}
      step={0.01}
      value={forceConfig.boundaryStrength ?? 0.15}
      onChange={(e) =>
        setForceConfig({ boundaryStrength: parseFloat(e.target.value) })
      }
      className="w-full mt-1 accent-primary"
    />
  </label>
)}
```

Do NOT reset `forceConfig.boundaryStrength` to 0 when hidden — the value persists in the store (harmless; the force itself is gated in Task 2) and the slider re-appears at its last value if the user opens a Tauri repo in a later session.

**4. `src/views/Radar/__tests__/BoundaryLine.test.ts` — extend with no-bridges cases.**

Every existing test passes `bridges` as an additional positional arg. Add a `const BRIDGES_FIXTURE = [{ id: 'bridge:foo', kind: 'bridge' as const, commandName: 'foo', dirKey: 'bridge', dirDepth: 0 }]` near the top (fixture cast to `GraphNode[]` — import GraphNode from `../../../stores/radarStore` or use `as unknown as any` if the type import is heavy).

For each of the 5 existing `drawBoundaryLine` / `drawBoundaryAnchorLabels` tests, update the call to pass `BRIDGES_FIXTURE` as the second arg (`ctx, BRIDGES_FIXTURE, { zoom: …, panX: …, panY: … }, 800, 600, theme?`). Existing assertions should all still pass.

Then add THREE new tests locking the no-bridges gate:

```typescript
describe('drawBoundaryLine — no-bridges gate (quick/260422-dqu)', () => {
  it('does not stroke when bridges array is empty', () => {
    const ctx = makeMockCtx();
    drawBoundaryLine(ctx, [], { zoom: 1, panX: 0, panY: 0 }, 800, 600);
    expect(ctx._calls.some((c: Call) => c.fn === 'moveTo')).toBe(false);
    expect(ctx._calls.some((c: Call) => c.fn === 'lineTo')).toBe(false);
    expect(ctx._calls.some((c: Call) => c.fn === 'stroke')).toBe(false);
  });
});

describe('drawBoundaryAnchorLabels — no-bridges gate (quick/260422-dqu)', () => {
  it('does not render FRONTEND/BACKEND labels when bridges array is empty', () => {
    const ctx = makeMockCtx();
    drawBoundaryAnchorLabels(ctx, [], { zoom: 1, panX: 0, panY: 300 }, 800, 600);
    const texts = ctx._calls
      .filter((c: Call) => c.fn === 'fillText')
      .map((c: Call) => c.args[0]);
    expect(texts).not.toContain('FRONTEND');
    expect(texts).not.toContain('BACKEND');
  });

  it('renders labels when at least one bridge is present (regression guard for V-12-22)', () => {
    const ctx = makeMockCtx();
    drawBoundaryAnchorLabels(
      ctx,
      BRIDGES_FIXTURE,
      { zoom: 1, panX: 0, panY: 300 },
      800,
      600,
    );
    const texts = ctx._calls
      .filter((c: Call) => c.fn === 'fillText')
      .map((c: Call) => c.args[0]);
    expect(texts).toContain('FRONTEND');
    expect(texts).toContain('BACKEND');
  });
});
```

**5. `src/views/Radar/__tests__/ForceConfigPanel.test.tsx` — NEW test file.**

Create a new test file that verifies the BOUNDARY slider's conditional render. Use `@testing-library/react` (already in the project per vitest.config + neighbor test files like `BridgeSelection.test.tsx` for the pattern). Mock `useRadarStore` via `vi.mock` following the `BridgeSelection.test.tsx` idiom shown in `12-05-SUMMARY.md §key-decisions`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ForceConfigPanel } from '../ForceConfigPanel';

// Mutable state object so each test can override `graphNodes` + forceConfig
// without rebuilding the mock.
const mockRadarState: any = {
  graphNodes: [] as any[],
  forceConfig: {
    centerStrength: 0.05,
    clusterStrength: 0.08,
    linkStrength: 0.3,
    chargeStrength: -80,
    boundaryStrength: 0.15,
  },
  setForceConfig: vi.fn(),
  themeId: 'phosphor-classic',
  setThemeId: vi.fn(),
};

vi.mock('../../../stores/radarStore', () => ({
  useRadarStore: (selector: (s: any) => any) => selector(mockRadarState),
  DEFAULT_FORCE_CONFIG: {
    centerStrength: 0.05,
    clusterStrength: 0.08,
    linkStrength: 0.3,
    chargeStrength: -80,
    boundaryStrength: 0.15,
  },
}));

// ThemePicker reads from useRadarStore too; the mock above covers it.

beforeEach(() => {
  mockRadarState.graphNodes = [];
});

describe('ForceConfigPanel BOUNDARY slider (quick/260422-dqu)', () => {
  it('hides the BOUNDARY label when no bridges are in graphNodes', () => {
    mockRadarState.graphNodes = [
      { id: 'src/foo.ts', kind: 'file', dirKey: 'src', dirDepth: 1 },
    ];
    render(<ForceConfigPanel />);
    // Open the panel so sliders are rendered.
    screen.getByRole('button', { name: /force configuration/i }).click();
    expect(screen.queryByText('BOUNDARY')).toBeNull();
  });

  it('shows the BOUNDARY label when at least one bridge is present', () => {
    mockRadarState.graphNodes = [
      { id: 'src/foo.ts', kind: 'file', dirKey: 'src', dirDepth: 1 },
      {
        id: 'bridge:launchAgent',
        kind: 'bridge',
        commandName: 'launchAgent',
        dirKey: 'bridge',
        dirDepth: 0,
      },
    ];
    render(<ForceConfigPanel />);
    screen.getByRole('button', { name: /force configuration/i }).click();
    expect(screen.getByText('BOUNDARY')).toBeInTheDocument();
  });

  it('still renders the LINKS/PROXIMITY/REPULSION/CENTER sliders on no-bridges repos', () => {
    mockRadarState.graphNodes = [];
    render(<ForceConfigPanel />);
    screen.getByRole('button', { name: /force configuration/i }).click();
    expect(screen.getByText('LINKS')).toBeInTheDocument();
    expect(screen.getByText('PROXIMITY')).toBeInTheDocument();
    expect(screen.getByText('REPULSION')).toBeInTheDocument();
    expect(screen.getByText('CENTER')).toBeInTheDocument();
  });
});
```

Note: if `@testing-library/react` is not installed, check `package.json` and fall back to a shallow JSX render via `renderToString` from `react-dom/server` + a regex on the output to check for `BOUNDARY` presence/absence. The `vi.mock` pattern for `useRadarStore` is the authoritative reference from `BridgeSelection.test.tsx` per 12-05-SUMMARY §key-decisions bullet 6.

**6. Commit.**

```
git add -A src/views/Radar/BridgeRenderer.ts src/views/Radar/RadarCanvas.tsx \
  src/views/Radar/ForceConfigPanel.tsx \
  src/views/Radar/__tests__/BoundaryLine.test.ts \
  src/views/Radar/__tests__/ForceConfigPanel.test.tsx
git commit -m "fix(12): gate boundary line + FRONTEND/BACKEND labels + BOUNDARY slider on bridges-present"
```
  </action>

  <acceptance_criteria>
    - `grep -n "if (bridges.length === 0) return" src/views/Radar/BridgeRenderer.ts | wc -l` — exactly 2 (one per gated function).
    - `grep -n "bridges: GraphNode\[\]" src/views/Radar/BridgeRenderer.ts | wc -l` — at least 2 new additions (drawBoundaryLine + drawBoundaryAnchorLabels now take bridges).
    - `grep -n "if (bridgeNodes.length > 0)" src/views/Radar/RadarCanvas.tsx | wc -l` — exactly 2 (boundary line guard + screen-space pass guard).
    - `grep -n "{hasBridges &&" src/views/Radar/ForceConfigPanel.tsx | wc -l` — exactly 1.
    - `grep -n "const hasBridges" src/views/Radar/ForceConfigPanel.tsx | wc -l` — exactly 1.
    - `npm run test -- --run src/views/Radar/__tests__/BoundaryLine.test.ts` — all existing tests plus 3 new tests pass (green).
    - `npm run test -- --run src/views/Radar/__tests__/ForceConfigPanel.test.tsx` — 3 new tests pass (green).
    - `npm run build` — exits 0 (TS clean; no type errors from the new positional `bridges` parameter).
    - One commit with message starting `fix(12): gate boundary line + FRONTEND/BACKEND labels + BOUNDARY slider on bridges-present`.
    - No changes to the bridge hit-test path or to `drawBridgeNodes` / `drawBridgeLabels` — they are already naturally no-op on empty bridge arrays.
    - No new imports in ForceConfigPanel.tsx other than what's needed for the selector.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Gate forceBoundary on classifiable-nodes + run full-phase regression</name>

  <read_first>
    - src/workers/forces/forceBoundary.ts (the `force(alpha)` body + `initialize(nodes)` — both touched)
    - src/views/Radar/__tests__/forceBoundary.test.ts (existing V-12-17..V-12-19 tests + auxiliary assertions — extend with the inactive-path case)
    - .planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-CONTEXT.md §D-13/D-16/D-37 (boundary force contract + worker protocol — confirms per-node `kind` + `language` payload)
    - .planning/phases/12-add-ipc-bridge-nodes-and-cross-language-boundary-visualizati/12-VALIDATION.md (V-12-17/V-12-18/V-12-19 must still pass on the classifiable-nodes path; the new inactive-path test is additive)
    - The commit from Task 1 (git log -1) — confirms the non-worker gate is in place; this task is the worker mirror.
  </read_first>

  <action>
Gate `forceBoundary` so that when no classifiable nodes are in the node set (bridges-only, or TS/Rust-classified files absent), the force becomes a pure no-op — zero vy writes, zero per-tick cost beyond a single boolean read.

**1. `src/workers/forces/forceBoundary.ts` — add `inactive` flag computed in `initialize` + early-return in `force(alpha)`.**

Inside the closure, add an `inactive: boolean` flag alongside `nodes` and `strength`:

```typescript
export function forceBoundary(): BoundaryForce {
  let nodes: BoundaryNode[] = [];
  let strength = FORCE_BOUNDARY_BASE_STRENGTH;
  // Phase 12 fix (quick/260422-dqu) — gate the force on presence of at
  // least one classifiable node. When the node set contains only bridges
  // (repo has no Tauri IPC surface → zero bridges AND no TS/Rust split in
  // the first place), OR the node set has no language-tagged files (pure
  // polyglot repo where D-16 classifier returned undefined for all files,
  // e.g. Python-only), the force must not pull anything — otherwise TS-
  // classified files on a repo with no Rust counterpart would float up
  // toward y=-300 while Python files (no classification) stayed near y=0,
  // producing the confusing half-visualization reported in 12-05 UAT.
  let inactive = false;

  const force = ((alpha: number) => {
    if (inactive) return;
    const k = strength * alpha;
    if (k === 0) return;
    // … rest of the existing per-node loop unchanged
  }) as BoundaryForce;

  force.initialize = (n: BoundaryNode[]) => {
    nodes = n;
    // Count classifiable file nodes. A node is classifiable iff it has
    // `language === 'ts' || language === 'rust'`. If the count is zero,
    // the force has nothing to pull — mark inactive so force(alpha) is a
    // single boolean-read no-op.
    let classifiable = 0;
    for (const x of n) {
      if (x.kind === 'bridge') continue;
      if (x.language === 'ts' || x.language === 'rust') {
        classifiable++;
        break; // one is enough — we only need presence, not count
      }
    }
    inactive = classifiable === 0;
  };

  force.strength = ((v?: number) => {
    if (v === undefined) return strength;
    strength = v;
    return force;
  }) as BoundaryForce['strength'];

  return force;
}
```

Rationale for classifying on `language` presence rather than `kind === 'bridge' ? 0 : files.length > 0`: the real problem from UAT is repos where `language` classification returns `undefined` for every file (D-16 only assigns `ts` / `rust`, nothing else). On a TS + Python repo, TS files ARE classifiable so the force would still activate — but that's actually fine, because the Task 1 gates mean the boundary line + labels + slider won't render, so the vertical push on TS files has no visual context. To prevent that silent force-with-no-visual, we need a stricter gate: require classifiable nodes of BOTH languages to be present, OR require bridges to be present.

Update the classifiable check to require EITHER bridges present OR BOTH `ts` and `rust` files present. This mirrors what the visualization implies:

```typescript
force.initialize = (n: BoundaryNode[]) => {
  nodes = n;
  // Three activation modes, all equivalent to "a frontend/backend divide
  // is meaningful here":
  //   (a) at least one bridge is present (Tauri IPC surface → boundary
  //       line + labels + slider all rendered per Task 1's gate);
  //   (b) at least one ts-classified AND one rust-classified file are
  //       present (pure polyglot Rust+TS repo with no Tauri binding,
  //       e.g. a standalone Rust crate + web frontend).
  // If only one side is classifiable (TS+Python, or Rust+Go), the force
  // would push one cluster and leave the other floating — the exact
  // half-visualization reported in 12-05 UAT.
  let hasBridge = false;
  let hasTs = false;
  let hasRust = false;
  for (const x of n) {
    if (x.kind === 'bridge') { hasBridge = true; continue; }
    if (x.language === 'ts') hasTs = true;
    if (x.language === 'rust') hasRust = true;
    if (hasBridge || (hasTs && hasRust)) break;
  }
  inactive = !(hasBridge || (hasTs && hasRust));
};
```

Do NOT touch `BOUNDARY_TARGET_Y_MAGNITUDE`, `BOUNDARY_DEADBAND`, `FORCE_BOUNDARY_BASE_STRENGTH`, or the spring-math body inside `force(alpha)`. Do NOT change the `BoundaryForce` interface or the `BoundaryNode` shape.

**2. `src/views/Radar/__tests__/forceBoundary.test.ts` — extend with inactive-path tests.**

Append a new `describe` block AFTER the existing tests (keep V-12-17/V-12-18/V-12-19 + the 4 auxiliary tests untouched — they all feed `kind: 'file', language: 'ts'|'rust'` nodes which hit the `hasTs && hasRust` path on the single-language V-17/V-18 tests… wait, V-12-17 passes only TS nodes; the new gate would make the force inactive there).

**IMPORTANT** — V-12-17 and V-12-18 each seed only one language. To keep those witnesses passing without weakening the gate, those fixtures need to add a single counter-language node. Inspect the existing V-12-17 test (lines ~43-63): it builds 10 nodes all `language: 'ts'`. Amend to prepend one rust anchor + one bridge (belt-and-braces):

```typescript
// V-12-17 test amendment — add a rust anchor so the force activates.
// The test asserts the 10 TS nodes converge to y < -50; the anchor node
// is asserted-untouched (or just ignored) because it's not in the
// `for (const n of nodes)` result check.
const nodes: BoundaryNode[] = [
  { kind: 'file', language: 'rust', x: 0, y: 100, vx: 0, vy: 0 }, // anchor
  ...Array.from({ length: 10 }, () => ({
    kind: 'file' as const,
    language: 'ts' as const,
    x: (rng() - 0.5) * 200,
    y: (rng() - 0.5) * 200,
    vx: 0,
    vy: 0,
  })),
];
// Then update the for-loop to skip the anchor when asserting:
for (const n of nodes) {
  if (n.language !== 'ts') continue;  // skip the rust anchor
  expect(n.y).toBeLessThan(-50);
}
```

Do the same for V-12-18 (add a single `language: 'ts'` anchor, assert only rust nodes).

For V-12-19 (bridge fy=0 pinned test): the node set is one bridge with no files, so under the new gate the force is inactive (`!hasBridge || hasTs && hasRust` → `!(true || false && false)` → `!true` → `false` → active — wait: `hasBridge || (hasTs && hasRust)` = `true || false` = `true` → inactive=false, force active). Re-read: if `hasBridge` is true, the force IS active. So V-12-19 continues to pass (bridges present → active, but bridges have `kind === 'bridge'` so the inner loop skips them → vy stays 0). No amendment needed.

For the "language=undefined files receive no force" test (line ~121-135): this test creates one file node with undefined language. Under the new gate, `hasBridge=false, hasTs=false, hasRust=false` → inactive=true → force early-returns. The assertion `expect(n.vy).toBe(0)` still holds (vy starts at 0, force doesn't touch it). No amendment needed.

For the "early-returns when strength === 0" test: one TS file, no bridge, no rust → inactive=true. The assertion `expect(n.vy).toBe(0)` still holds via the inactive gate rather than the k===0 gate, but the semantic intent (zero per-tick cost) is preserved. No amendment needed, though you may wish to add an inline comment noting the dual-gate path.

For the "deadband" test: one TS file, no rust, no bridge → inactive=true. The `expect(n.vy).toBe(0)` assertion still holds (inactive blocks vy writes). Amendment: add a rust anchor so the deadband path is exercised:

```typescript
const nodes: BoundaryNode[] = [
  { kind: 'file', language: 'rust', x: 0, y: 100, vx: 0, vy: 0 }, // anchor — activates the force
  {
    kind: 'file',
    language: 'ts',
    x: 0,
    y: -BOUNDARY_TARGET_Y_MAGNITUDE + (BOUNDARY_DEADBAND - 1),
    vx: 0,
    vy: 0,
  },
];
f.initialize(nodes);
f.strength(0.15);
f(1);
expect(nodes[1].vy).toBe(0);  // the TS node is in the deadband
```

Now add the new `describe` block at the bottom for the gate itself:

```typescript
describe('forceBoundary — classifiable-nodes gate (quick/260422-dqu)', () => {
  it('is a no-op when node set contains only bridges (bridges-only pathological case)', () => {
    // Bridges without files — vy must never be written because there's
    // nothing to pull on either side of the boundary. Bridges themselves
    // are skipped by the per-node `kind === bridge` short-circuit (V-12-19)
    // but the activation gate also fires first so even the loop entry
    // is skipped.
    const nodes: BoundaryNode[] = [
      { kind: 'bridge', x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0 },
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    f(1);
    expect(nodes[0].vy).toBe(0);
  });

  it('is a no-op when only TS files are present (no bridges, no rust counterpart)', () => {
    // The UAT scenario: TS + Python repo. Python files have language=undefined
    // and TS files have language=ts. Without a rust counterpart OR a bridge,
    // pulling TS files to y=-300 would create a confusing half-visualization.
    const nodes: BoundaryNode[] = [
      { kind: 'file', language: 'ts', x: 0, y: 100, vx: 0, vy: 0 },
      { kind: 'file', language: 'ts', x: 0, y: 100, vx: 0, vy: 0 },
      { kind: 'file', x: 0, y: 100, vx: 0, vy: 0 }, // simulates a Python file (undefined language)
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    f(1);
    for (const n of nodes) {
      expect(n.vy).toBe(0);
    }
  });

  it('is a no-op when only Rust files are present (inverse of above)', () => {
    const nodes: BoundaryNode[] = [
      { kind: 'file', language: 'rust', x: 0, y: 100, vx: 0, vy: 0 },
      { kind: 'file', language: 'rust', x: 0, y: -100, vx: 0, vy: 0 },
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    f(1);
    for (const n of nodes) {
      expect(n.vy).toBe(0);
    }
  });

  it('activates when at least one bridge is present (Tauri repo — V-12-17..V-12-19 regression guard)', () => {
    const nodes: BoundaryNode[] = [
      { kind: 'bridge', x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0 },
      { kind: 'file', language: 'ts', x: 0, y: 100, vx: 0, vy: 0 },
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    f(1);
    // Bridge stays untouched (V-12-19 contract); TS file is pulled.
    expect(nodes[0].vy).toBe(0);
    expect(nodes[1].vy).not.toBe(0);
    expect(nodes[1].vy!).toBeLessThan(0); // pulled toward y=-300
  });

  it('activates when both TS and Rust files are present (polyglot Rust+TS, no Tauri)', () => {
    const nodes: BoundaryNode[] = [
      { kind: 'file', language: 'ts', x: 0, y: 100, vx: 0, vy: 0 },
      { kind: 'file', language: 'rust', x: 0, y: -100, vx: 0, vy: 0 },
    ];
    const f = forceBoundary();
    f.initialize(nodes);
    f.strength(0.15);
    f(1);
    expect(nodes[0].vy).not.toBe(0);
    expect(nodes[0].vy!).toBeLessThan(0);
    expect(nodes[1].vy).not.toBe(0);
    expect(nodes[1].vy!).toBeGreaterThan(0);
  });
});
```

**3. Run the full Phase 12 regression sweep.**

Run each of the four Phase 12 frontend test files individually (scoped) + the radarStore test to confirm no V-12-15..V-12-24 regressions:

```bash
npm run test -- --run \
  src/views/Radar/__tests__/BridgeRender.test.ts \
  src/views/Radar/__tests__/BoundaryLine.test.ts \
  src/views/Radar/__tests__/BridgeSelection.test.tsx \
  src/views/Radar/__tests__/BridgeTooltip.test.tsx \
  src/views/Radar/__tests__/forceBoundary.test.ts \
  src/views/Radar/__tests__/ForceConfigPanel.test.tsx \
  src/hooks/__tests__/useGraphLayout.test.ts \
  src/stores/__tests__/radarStore.test.ts \
  src/views/Radar/__tests__/forceCluster.test.ts
```

All must pass. If `useGraphLayout.test.ts` has a pre-existing flake per STATE.md Phase 19-03 D-04 note, that's a known pre-existing issue — run it in isolation twice to confirm it's not a new regression caused by this task. `forceCluster.test.ts` is included as a Phase 11 regression guard (memory rule: don't break unrelated phases).

Also run `npm run build` to confirm TS compiles cleanly.

**4. Commit.**

```
git add -A src/workers/forces/forceBoundary.ts \
  src/views/Radar/__tests__/forceBoundary.test.ts
git commit -m "fix(12): gate forceBoundary on classifiable-nodes presence + regression tests"
```
  </action>

  <acceptance_criteria>
    - `grep -n "inactive" src/workers/forces/forceBoundary.ts | wc -l` — at least 3 (declaration + set + read).
    - `grep -n "hasBridge\|hasTs\|hasRust" src/workers/forces/forceBoundary.ts | wc -l` — at least 3 (the three local flags in initialize).
    - `grep -n "if (inactive) return" src/workers/forces/forceBoundary.ts | wc -l` — exactly 1.
    - `npm run test -- --run src/views/Radar/__tests__/forceBoundary.test.ts` — all existing tests (V-12-17/V-12-18/V-12-19 + 4 aux) PLUS 5 new gate tests pass. At least 12 passing tests total.
    - `npm run test -- --run src/views/Radar/__tests__/BridgeRender.test.ts src/views/Radar/__tests__/BoundaryLine.test.ts src/views/Radar/__tests__/BridgeSelection.test.tsx src/views/Radar/__tests__/BridgeTooltip.test.tsx src/views/Radar/__tests__/ForceConfigPanel.test.tsx` — all Phase 12 frontend test files green.
    - `npm run test -- --run src/views/Radar/__tests__/forceCluster.test.ts src/hooks/__tests__/useGraphLayout.test.ts src/stores/__tests__/radarStore.test.ts` — no new failures vs. pre-task-1 state (pre-existing `useGraphLayout` flake per STATE.md Phase 19 D-04 is acceptable if it reproduces in isolation on HEAD; any NEW failure here is a blocker).
    - `npm run build` — exits 0.
    - One commit with message starting `fix(12): gate forceBoundary on classifiable-nodes presence`.
    - V-12-17/V-12-18 fixture amendments (single anchor node of opposite language) are minimal — do NOT rewrite the test bodies, only prepend the anchor and adjust the assertion loop to skip it.
    - V-12-19, V-12-20 (if present), the deadband test, and the "language=undefined" test continue to assert the same observable outcomes (vy==0 on the relevant nodes), even if the code path reaching vy==0 changes from "k===0 gate" or "per-node kind/language skip" to "inactive gate".
  </acceptance_criteria>
</task>

</tasks>

<verification>
Post-task quick regression (run from repo root):

```bash
# 1. Phase 12 frontend test sweep — all 6 test files green.
npm run test -- --run \
  src/views/Radar/__tests__/BridgeRender.test.ts \
  src/views/Radar/__tests__/BoundaryLine.test.ts \
  src/views/Radar/__tests__/BridgeSelection.test.tsx \
  src/views/Radar/__tests__/BridgeTooltip.test.tsx \
  src/views/Radar/__tests__/forceBoundary.test.ts \
  src/views/Radar/__tests__/ForceConfigPanel.test.tsx

# 2. Phase 11 regression guard — forceCluster + useGraphLayout unchanged.
npm run test -- --run \
  src/views/Radar/__tests__/forceCluster.test.ts \
  src/hooks/__tests__/useGraphLayout.test.ts \
  src/stores/__tests__/radarStore.test.ts

# 3. TS build clean.
npm run build

# 4. Commit log — exactly 2 new commits, both `fix(12):`.
git log --oneline -5
```

Expected result:
- Tauri repo path (this repo): boundary line, FRONTEND/BACKEND labels, `forceBoundary` TS/Rust push, and BOUNDARY slider all render and behave as before (V-12-22 + V-12-17/V-12-18/V-12-19 still pass on the existing fixtures; Tauri UAT smoke in 12-05-CHECKPOINT.md still applies).
- No-bridges repo path (user's "2 TS frontends + Python backend"): no boundary line, no anchor labels, no vertical push on TS files, no BOUNDARY slider. The radar renders as a pure Phase 7 dep graph.
</verification>

<success_criteria>
  - Both tasks commit cleanly as `fix(12): …` (two commits total).
  - `grep -rn "bridges.length === 0\|inactive\|hasBridges" src/views/Radar/BridgeRenderer.ts src/views/Radar/RadarCanvas.tsx src/views/Radar/ForceConfigPanel.tsx src/workers/forces/forceBoundary.ts | wc -l` — non-zero hits in each of the 4 src files.
  - All V-12-15..V-12-24 witnesses still pass on fixtures that exercise the bridges-present path.
  - New tests lock the no-bridges/inactive path: 3 in BoundaryLine.test.ts + 3 in ForceConfigPanel.test.tsx + 5 in forceBoundary.test.ts = 11 new assertions minimum.
  - `npm run build` exits 0 — no TS type errors from the new positional `bridges: GraphNode[]` arg on `drawBoundaryLine` / `drawBoundaryAnchorLabels`.
  - Phase 11 tests (forceCluster, useGraphLayout, radarStore) are not newly-regressed (pre-existing flakes per STATE.md D-04 are acceptable if they reproduce on HEAD in isolation).
  - No new npm or cargo dependencies.
  - No changes to CONTEXT.md, RESEARCH.md, VALIDATION.md, UI-SPEC.md, or 12-05-SUMMARY.md — this is a post-ship defect fix, not a Phase 12 re-plan.
</success_criteria>

<output>
After both tasks complete, write a brief completion note at:
`.planning/quick/260422-dqu-fix-phase-12-boundary-layer-so-it-only-a/260422-dqu-SUMMARY.md`

The note should include:
- The two commit SHAs with their `fix(12): …` titles.
- Green test counts per file (e.g. `BoundaryLine.test.ts: 11 passed — 8 existing + 3 new`).
- `npm run build` exit code.
- A one-line note that Phase 12's 12-05-CHECKPOINT.md UAT scenarios are UNAFFECTED (Tauri-repo path unchanged) and that the user should additionally smoke-test the fix on their "2 TS frontends + Python backend" repo to confirm: no boundary line, no FRONTEND/BACKEND labels, no TS-file vertical push, no BOUNDARY slider.
</output>
