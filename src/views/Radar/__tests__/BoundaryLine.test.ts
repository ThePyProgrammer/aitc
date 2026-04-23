// Phase 12 Plan 05 (Wave 4) — drawBoundaryLine + drawBoundaryAnchorLabels
// unit tests. Witnesses: V-12-22 (world y=0 horizontal line + FRONTEND/BACKEND
// screen-space labels).

import { describe, it, expect } from 'vitest';
import {
  drawBoundaryLine,
  drawBoundaryAnchorLabels,
  BOUNDARY_LINE_OPACITY,
} from '../BridgeRenderer';
import { THEMES } from '../themes';
import type { GraphNode } from '../../../stores/radarStore';

// quick/260422-dqu — shared fixture representing a Tauri repo with at least
// one bridge. Every drawBoundaryLine / drawBoundaryAnchorLabels call that
// previously relied on the unconditional render path must now pass a non-
// empty bridges array to activate the renderer.
const BRIDGES_FIXTURE: GraphNode[] = [
  {
    id: 'bridge:foo',
    kind: 'bridge',
    commandName: 'foo',
    dirKey: 'bridge',
    dirDepth: 0,
  },
];

if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as any).Path2D = class Path2D {
    constructor(_d?: string) {}
  };
}

type Call = { fn: string; args: unknown[] };

function makeMockCtx() {
  const calls: Call[] = [];
  const assignments: Record<string, unknown[]> = {};
  const record = (fn: string) => (...args: unknown[]) => {
    calls.push({ fn, args });
  };
  const ctx: any = {
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    save: record('save'),
    restore: record('restore'),
    fillText: record('fillText'),
    fillRect: record('fillRect'),                                // Phase 22 Fix 3 (W-22-05) — backdrop pill
    measureText: (t: string) => ({ width: t.length * 6 }),       // Phase 22 Fix 3 — pill width stub
  };
  for (const prop of [
    'fillStyle',
    'strokeStyle',
    'lineWidth',
    'font',
    'textAlign',
    'textBaseline',
    'globalAlpha',
  ]) {
    assignments[prop] = [];
    Object.defineProperty(ctx, prop, {
      get: () =>
        assignments[prop].length > 0
          ? assignments[prop][assignments[prop].length - 1]
          : undefined,
      set: (v) => {
        assignments[prop].push(v);
      },
    });
  }
  ctx._calls = calls;
  ctx._assignments = assignments;
  return ctx;
}

describe('drawBoundaryLine', () => {
  it('V-12-22: strokes horizontal line across viewport at world y=0', () => {
    const ctx = makeMockCtx();
    drawBoundaryLine(ctx, BRIDGES_FIXTURE, { zoom: 1, panX: 0, panY: 0 }, 800, 600);
    const move = ctx._calls.find((c: Call) => c.fn === 'moveTo');
    const line = ctx._calls.find((c: Call) => c.fn === 'lineTo');
    expect(move).toBeDefined();
    expect(line).toBeDefined();
    // Both endpoints on y=0 in world space.
    expect(move!.args[1]).toBe(0);
    expect(line!.args[1]).toBe(0);
    expect(ctx._calls.some((c: Call) => c.fn === 'stroke')).toBe(true);
  });

  it('V-12-22: stroke uses theme.hullStroke at BOUNDARY_LINE_OPACITY', () => {
    const ctx = makeMockCtx();
    const theme = THEMES['phosphor-classic'];
    drawBoundaryLine(ctx, BRIDGES_FIXTURE, { zoom: 1, panX: 0, panY: 0 }, 800, 600, theme);
    expect(ctx._assignments.strokeStyle).toContain(theme.hullStroke);
    expect(ctx._assignments.globalAlpha).toContain(BOUNDARY_LINE_OPACITY);
  });

  it('V-12-22: stroke width is 1/viewport.zoom (world-space thickness)', () => {
    const ctxA = makeMockCtx();
    drawBoundaryLine(ctxA, BRIDGES_FIXTURE, { zoom: 2, panX: 0, panY: 0 }, 800, 600);
    expect(ctxA._assignments.lineWidth).toContain(1 / 2);

    const ctxB = makeMockCtx();
    drawBoundaryLine(ctxB, BRIDGES_FIXTURE, { zoom: 0.5, panX: 0, panY: 0 }, 800, 600);
    expect(ctxB._assignments.lineWidth).toContain(1 / 0.5);
  });

  it('V-12-22: line extents cover full viewport width projected back to world', () => {
    const ctx = makeMockCtx();
    // panX=100, zoom=2 → leftWorld = -100/2 = -50; rightWorld = (800-100)/2 = 350.
    drawBoundaryLine(ctx, BRIDGES_FIXTURE, { zoom: 2, panX: 100, panY: 0 }, 800, 600);
    const move = ctx._calls.find((c: Call) => c.fn === 'moveTo');
    const line = ctx._calls.find((c: Call) => c.fn === 'lineTo');
    expect(move!.args[0]).toBe(-50);
    expect(line!.args[0]).toBe(350);
  });
});

describe('drawBoundaryLine — no-bridges gate (quick/260422-dqu)', () => {
  it('does not stroke when bridges array is empty', () => {
    const ctx = makeMockCtx();
    drawBoundaryLine(ctx, [], { zoom: 1, panX: 0, panY: 0 }, 800, 600);
    expect(ctx._calls.some((c: Call) => c.fn === 'moveTo')).toBe(false);
    expect(ctx._calls.some((c: Call) => c.fn === 'lineTo')).toBe(false);
    expect(ctx._calls.some((c: Call) => c.fn === 'stroke')).toBe(false);
  });
});

describe('drawBoundaryAnchorLabels', () => {
  it('V-12-22: renders FRONTEND/TypeScript (above) + BACKEND/Rust (below) labels', () => {
    const ctx = makeMockCtx();
    drawBoundaryAnchorLabels(ctx, BRIDGES_FIXTURE, { zoom: 1, panX: 0, panY: 300 }, 800, 600);
    const texts = ctx._calls
      .filter((c: Call) => c.fn === 'fillText')
      .map((c: Call) => c.args[0]);
    expect(texts).toContain('FRONTEND');
    expect(texts).toContain('TypeScript');
    expect(texts).toContain('BACKEND');
    expect(texts).toContain('Rust');
  });

  it('V-12-22: labels anchored at leftX=12 (screen-space inset)', () => {
    const ctx = makeMockCtx();
    drawBoundaryAnchorLabels(ctx, BRIDGES_FIXTURE, { zoom: 1, panX: 0, panY: 300 }, 800, 600);
    const texts = ctx._calls.filter((c: Call) => c.fn === 'fillText');
    for (const t of texts) {
      expect(t.args[1]).toBe(12);
    }
  });

  it('V-12-22: clamps boundaryScreenY to 24 when panY < 24', () => {
    const ctx = makeMockCtx();
    drawBoundaryAnchorLabels(ctx, BRIDGES_FIXTURE, { zoom: 1, panX: 0, panY: -100 }, 800, 600);
    // FRONTEND y = clamped(24) - 18 = 6.
    const frontend = ctx._calls.find(
      (c: Call) => c.fn === 'fillText' && c.args[0] === 'FRONTEND',
    );
    expect(frontend!.args[2]).toBe(24 - 18);
  });

  it('V-12-22: clamps boundaryScreenY to canvasHeight-24 when panY > canvasHeight-24', () => {
    const ctx = makeMockCtx();
    drawBoundaryAnchorLabels(ctx, BRIDGES_FIXTURE, { zoom: 1, panX: 0, panY: 10000 }, 800, 600);
    // BACKEND y = clamped(canvasHeight - 24) + 18 = 576 + 18 = 594.
    const backend = ctx._calls.find(
      (c: Call) => c.fn === 'fillText' && c.args[0] === 'BACKEND',
    );
    expect(backend!.args[2]).toBe(600 - 24 + 18);
  });

  it('W-22-04: uses theme.fileLabelColor (not folderLabelColor) for label fills; bold alpha 1.0, thin alpha 0.85', () => {
    const ctx = makeMockCtx();
    const theme = THEMES['phosphor-classic'];
    drawBoundaryAnchorLabels(
      ctx,
      BRIDGES_FIXTURE,
      { zoom: 1, panX: 0, panY: 300 },
      800,
      600,
      theme,
    );
    // D-07: token swap folderLabelColor → fileLabelColor.
    expect(ctx._assignments.fillStyle).toContain(theme.fileLabelColor);
    expect(ctx._assignments.fillStyle).not.toContain(theme.folderLabelColor);
    // D-08: bold globalAlpha raised 0.8 → 1.0; thin raised 0.55 → 0.85.
    expect(ctx._assignments.globalAlpha).toContain(1.0);
    expect(ctx._assignments.globalAlpha).toContain(0.85);
    expect(ctx._assignments.globalAlpha).not.toContain(0.55);
  });

  it('W-22-05: emits one zero-radius fillRect backdrop pill per label stack BEFORE each fillText; pill fill = canvasBackground@80%', () => {
    const ctx = makeMockCtx();
    const theme = THEMES['phosphor-classic'];
    drawBoundaryAnchorLabels(
      ctx,
      BRIDGES_FIXTURE,
      { zoom: 1, panX: 0, panY: 300 },
      800,
      600,
      theme,
    );
    // D-09: two pills — one for FRONTEND+TypeScript stack, one for BACKEND+Rust stack.
    const fillRects = ctx._calls.filter((c: Call) => c.fn === 'fillRect');
    expect(fillRects.length).toBeGreaterThanOrEqual(2);

    // D-10: each pill's fillRect must precede the first fillText of its stack.
    const firstFrontend = ctx._calls.findIndex(
      (c: Call) => c.fn === 'fillText' && c.args[0] === 'FRONTEND',
    );
    const firstBackend = ctx._calls.findIndex(
      (c: Call) => c.fn === 'fillText' && c.args[0] === 'BACKEND',
    );
    expect(firstFrontend).toBeGreaterThan(-1);
    expect(firstBackend).toBeGreaterThan(-1);
    const fillRectIdxs = ctx._calls
      .map((c: Call, i: number) => (c.fn === 'fillRect' ? i : -1))
      .filter((i: number) => i >= 0);
    // At least one fillRect before FRONTEND text.
    expect(fillRectIdxs.some((i: number) => i < firstFrontend)).toBe(true);
    // At least one fillRect between FRONTEND and BACKEND (the BACKEND stack pill).
    expect(fillRectIdxs.some((i: number) => i > firstFrontend && i < firstBackend)).toBe(true);

    // D-11: pill fillStyle = canvasBackground + 'cc' (hex+80% alpha suffix).
    const expectedPillFill = `${theme.canvasBackground}cc`;
    expect(ctx._assignments.fillStyle).toContain(expectedPillFill);
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
