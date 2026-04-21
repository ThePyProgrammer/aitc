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
    drawBoundaryLine(ctx, { zoom: 1, panX: 0, panY: 0 }, 800, 600);
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
    drawBoundaryLine(ctx, { zoom: 1, panX: 0, panY: 0 }, 800, 600, theme);
    expect(ctx._assignments.strokeStyle).toContain(theme.hullStroke);
    expect(ctx._assignments.globalAlpha).toContain(BOUNDARY_LINE_OPACITY);
  });

  it('V-12-22: stroke width is 1/viewport.zoom (world-space thickness)', () => {
    const ctxA = makeMockCtx();
    drawBoundaryLine(ctxA, { zoom: 2, panX: 0, panY: 0 }, 800, 600);
    expect(ctxA._assignments.lineWidth).toContain(1 / 2);

    const ctxB = makeMockCtx();
    drawBoundaryLine(ctxB, { zoom: 0.5, panX: 0, panY: 0 }, 800, 600);
    expect(ctxB._assignments.lineWidth).toContain(1 / 0.5);
  });

  it('V-12-22: line extents cover full viewport width projected back to world', () => {
    const ctx = makeMockCtx();
    // panX=100, zoom=2 → leftWorld = -100/2 = -50; rightWorld = (800-100)/2 = 350.
    drawBoundaryLine(ctx, { zoom: 2, panX: 100, panY: 0 }, 800, 600);
    const move = ctx._calls.find((c: Call) => c.fn === 'moveTo');
    const line = ctx._calls.find((c: Call) => c.fn === 'lineTo');
    expect(move!.args[0]).toBe(-50);
    expect(line!.args[0]).toBe(350);
  });
});

describe('drawBoundaryAnchorLabels', () => {
  it('V-12-22: renders FRONTEND/TypeScript (above) + BACKEND/Rust (below) labels', () => {
    const ctx = makeMockCtx();
    drawBoundaryAnchorLabels(ctx, { zoom: 1, panX: 0, panY: 300 }, 800, 600);
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
    drawBoundaryAnchorLabels(ctx, { zoom: 1, panX: 0, panY: 300 }, 800, 600);
    const texts = ctx._calls.filter((c: Call) => c.fn === 'fillText');
    for (const t of texts) {
      expect(t.args[1]).toBe(12);
    }
  });

  it('V-12-22: clamps boundaryScreenY to 24 when panY < 24', () => {
    const ctx = makeMockCtx();
    drawBoundaryAnchorLabels(ctx, { zoom: 1, panX: 0, panY: -100 }, 800, 600);
    // FRONTEND y = clamped(24) - 18 = 6.
    const frontend = ctx._calls.find(
      (c: Call) => c.fn === 'fillText' && c.args[0] === 'FRONTEND',
    );
    expect(frontend!.args[2]).toBe(24 - 18);
  });

  it('V-12-22: clamps boundaryScreenY to canvasHeight-24 when panY > canvasHeight-24', () => {
    const ctx = makeMockCtx();
    drawBoundaryAnchorLabels(ctx, { zoom: 1, panX: 0, panY: 10000 }, 800, 600);
    // BACKEND y = clamped(canvasHeight - 24) + 18 = 576 + 18 = 594.
    const backend = ctx._calls.find(
      (c: Call) => c.fn === 'fillText' && c.args[0] === 'BACKEND',
    );
    expect(backend!.args[2]).toBe(600 - 24 + 18);
  });

  it('V-12-22: uses theme.folderLabelColor for fills', () => {
    const ctx = makeMockCtx();
    const theme = THEMES['phosphor-classic'];
    drawBoundaryAnchorLabels(
      ctx,
      { zoom: 1, panX: 0, panY: 300 },
      800,
      600,
      theme,
    );
    expect(ctx._assignments.fillStyle).toContain(theme.folderLabelColor);
  });
});
