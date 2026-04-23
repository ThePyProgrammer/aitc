// Phase 12 Plan 05 (Wave 4) — BridgeRenderer draw-function unit tests.
// Witnesses: V-12-21 (diamond geometry, fill/stroke, channel double-stroke,
// dangling dash, selected ring, label zoom threshold).

import { describe, it, expect } from 'vitest';
import {
  drawBridgeNodes,
  drawBridgeLabels,
  BRIDGE_DASH_PATTERN,
  BRIDGE_LABEL_ZOOM_THRESHOLD,
} from '../BridgeRenderer';
import type { GraphNode } from '../../../stores/radarStore';
import { THEMES } from '../themes';

// Path2D polyfill for jsdom (Canvas 2D constructors not available in test env).
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
    closePath: record('closePath'),
    stroke: record('stroke'),
    fill: record('fill'),
    save: record('save'),
    restore: record('restore'),
    fillText: record('fillText'),
    setLineDash: record('setLineDash'),
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

describe('drawBridgeNodes', () => {
  it('V-12-21: renders diamond geometry (moveTo + 3 lineTo + closePath) per bridge', () => {
    const ctx = makeMockCtx();
    drawBridgeNodes(
      ctx,
      [makeBridge({})],
      null,
      null,
      1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
    );
    const lineToCalls = ctx._calls.filter((c: Call) => c.fn === 'lineTo');
    const moveToCalls = ctx._calls.filter((c: Call) => c.fn === 'moveTo');
    const closePathCalls = ctx._calls.filter((c: Call) => c.fn === 'closePath');
    // Diamond = 1 moveTo + 3 lineTo + closePath.
    expect(moveToCalls.length).toBeGreaterThanOrEqual(1);
    expect(lineToCalls.length).toBeGreaterThanOrEqual(3);
    expect(closePathCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('V-12-21: diamond fill uses theme.edgeGlow fallback chain (edgeGlow → arrowFill → #00cffc)', () => {
    const ctx = makeMockCtx();
    // Theme with only arrowFill (no edgeGlow) — fallback to arrowFill.
    const bareTheme: any = {
      nodeStroke: 'rgba(0,0,0,0.5)',
      arrowFill: '#deadbe',
      hullStroke: '#111',
      folderLabelColor: '#222',
      fileLabelColor: '#333',
      canvasBackground: '#000',
      nodeFill: '#000',
      nodeFillHover: '#000',
      nodeFillHighest: '#000',
      edgeStroke: '#000',
      hullFill: '#000',
      heatRampStart: '#000',
      id: 'bare',
      name: 'bare',
    };
    drawBridgeNodes(
      ctx,
      [makeBridge({})],
      null,
      null,
      1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
      bareTheme,
    );
    expect(ctx._assignments.fillStyle).toContain('#deadbe');

    // Theme WITH edgeGlow — prefer edgeGlow.
    const ctx2 = makeMockCtx();
    const glowTheme: any = { ...bareTheme, edgeGlow: '#00cffc' };
    drawBridgeNodes(
      ctx2,
      [makeBridge({})],
      null,
      null,
      1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
      glowTheme,
    );
    expect(ctx2._assignments.fillStyle).toContain('#00cffc');
  });

  it('V-12-21: channel-bearing bridge draws outer ring (2× moveTo count vs non-channel)', () => {
    const ctxNoChannel = makeMockCtx();
    drawBridgeNodes(
      ctxNoChannel,
      [makeBridge({ hasChannelArg: false })],
      null,
      null,
      1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
    );
    const ctxChannel = makeMockCtx();
    drawBridgeNodes(
      ctxChannel,
      [makeBridge({ hasChannelArg: true })],
      null,
      null,
      1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
    );
    const moveNoChannel = ctxNoChannel._calls.filter(
      (c: Call) => c.fn === 'moveTo',
    ).length;
    const moveChannel = ctxChannel._calls.filter(
      (c: Call) => c.fn === 'moveTo',
    ).length;
    // Channel bridge draws an additional outer diamond → exactly 1 more moveTo.
    expect(moveChannel).toBe(moveNoChannel + 1);
  });

  it('W-22-06: dangling (callerCount=0) uses theme.nodeFill and does NOT call setLineDash(BRIDGE_DASH_PATTERN)', () => {
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
    // D-14: no setLineDash call with BRIDGE_DASH_PATTERN as first arg (call-log assertion
    // per RESEARCH §6.3 — simpler than modelling getLineDash state).
    const dashCalls = ctx._calls.filter((c: Call) => c.fn === 'setLineDash');
    const appliedDashed = dashCalls.some(
      (c: Call) => JSON.stringify(c.args[0]) === JSON.stringify(BRIDGE_DASH_PATTERN),
    );
    expect(appliedDashed).toBe(false);
  });

  it('W-22-06: dangling (handlerFile="") uses theme.nodeFill and does NOT call setLineDash(BRIDGE_DASH_PATTERN)', () => {
    const ctx = makeMockCtx();
    const theme = THEMES['phosphor-classic'];
    drawBridgeNodes(
      ctx,
      [makeBridge({ handlerFile: '', callerCount: 2 })],
      null,
      null,
      1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
      theme,
    );
    expect(ctx._assignments.fillStyle).toContain(theme.nodeFill);
    const dashCalls = ctx._calls.filter((c: Call) => c.fn === 'setLineDash');
    expect(
      dashCalls.some(
        (c: Call) => JSON.stringify(c.args[0]) === JSON.stringify(BRIDGE_DASH_PATTERN),
      ),
    ).toBe(false);
  });

  it('W-22-06: populated bridge retains edgeGlow/arrowFill/#00cffc fallback chain (regression)', () => {
    // Fix 4 does NOT touch the populated-fill path. Mirrors the Phase 12 V-12-21
    // bare-theme pattern: the chain `theme.edgeGlow ?? theme.arrowFill ?? '#00cffc'`
    // is exercised across all three rungs.

    // Rung 1: edgeGlow present → wins.
    const ctx1 = makeMockCtx();
    const themeWithEdgeGlow: any = {
      id: 't1', name: 't1',
      nodeStroke: '#000', arrowFill: '#deadbe', edgeGlow: '#00cffc',
      hullStroke: '#000', folderLabelColor: '#000', fileLabelColor: '#000',
      canvasBackground: '#000', nodeFill: '#0f1a0e',
      nodeFillHover: '#000', nodeFillHighest: '#000',
      edgeStroke: '#000', hullFill: '#000', heatRampStart: '#000',
    };
    drawBridgeNodes(
      ctx1,
      [makeBridge({ callerCount: 3 })],
      null, null, 1,
      { zoom: 1, panX: 0, panY: 0 }, 800, 600,
      themeWithEdgeGlow,
    );
    expect(ctx1._assignments.fillStyle).toContain('#00cffc');

    // Rung 3: neither edgeGlow nor arrowFill → hardcoded '#00cffc' literal.
    const ctx2 = makeMockCtx();
    const themeBare: any = {
      id: 't2', name: 't2',
      nodeStroke: '#000',
      hullStroke: '#000', folderLabelColor: '#000', fileLabelColor: '#000',
      canvasBackground: '#000', nodeFill: '#0f1a0e',
      nodeFillHover: '#000', nodeFillHighest: '#000',
      edgeStroke: '#000', hullFill: '#000', heatRampStart: '#000',
    };
    drawBridgeNodes(
      ctx2,
      [makeBridge({ callerCount: 3 })],
      null, null, 1,
      { zoom: 1, panX: 0, panY: 0 }, 800, 600,
      themeBare,
    );
    expect(ctx2._assignments.fillStyle).toContain('#00cffc');
  });

  it('W-22-07: channel double-stroke geometry identical across dangling AND populated (Phase 12 D-17 regression)', () => {
    // D-15 regression witness: Fix 4 must not perturb the channel-ring code path.
    // Inner diamond contributes 1 moveTo + 3 lineTo; channel ring adds 1 moveTo + 3 lineTo.
    // Total moveTo: 2. Total lineTo: 6.
    const ctxDangling = makeMockCtx();
    drawBridgeNodes(
      ctxDangling,
      [makeBridge({ hasChannelArg: true, callerCount: 0 })],
      null,
      null,
      1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
    );
    const ctxPopulated = makeMockCtx();
    drawBridgeNodes(
      ctxPopulated,
      [makeBridge({ hasChannelArg: true, callerCount: 3 })],
      null,
      null,
      1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
    );
    const movesDangling = ctxDangling._calls.filter((c: Call) => c.fn === 'moveTo').length;
    const movesPopulated = ctxPopulated._calls.filter((c: Call) => c.fn === 'moveTo').length;
    const linesDangling = ctxDangling._calls.filter((c: Call) => c.fn === 'lineTo').length;
    const linesPopulated = ctxPopulated._calls.filter((c: Call) => c.fn === 'lineTo').length;
    expect(movesDangling).toBe(movesPopulated);
    expect(linesDangling).toBe(linesPopulated);
    expect(movesDangling).toBe(2);
    expect(linesDangling).toBe(6);
  });

  it('V-12-21: selected bridge draws white 80%-alpha outer ring', () => {
    const ctx = makeMockCtx();
    drawBridgeNodes(
      ctx,
      [makeBridge({ commandName: 'ping' })],
      'ping',
      null,
      1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
    );
    expect(ctx._assignments.strokeStyle).toContain('rgba(255,255,255,0.8)');
  });

  it('V-12-21: non-selected bridge does NOT draw the white selection ring', () => {
    const ctx = makeMockCtx();
    drawBridgeNodes(
      ctx,
      [makeBridge({ commandName: 'ping' })],
      null,
      null,
      1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
    );
    expect(ctx._assignments.strokeStyle).not.toContain('rgba(255,255,255,0.8)');
  });

  it('V-12-21: skips bridges missing x/y (no moveTo emitted)', () => {
    const ctx = makeMockCtx();
    drawBridgeNodes(
      ctx,
      [{ ...makeBridge({}), x: undefined, y: undefined }],
      null,
      null,
      1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
    );
    const moveTos = ctx._calls.filter((c: Call) => c.fn === 'moveTo');
    expect(moveTos.length).toBe(0);
  });
});

describe('drawBridgeLabels', () => {
  it('V-12-21: labels render only at zoom >= BRIDGE_LABEL_ZOOM_THRESHOLD', () => {
    const lowZoomCtx = makeMockCtx();
    drawBridgeLabels(
      lowZoomCtx,
      [makeBridge({})],
      BRIDGE_LABEL_ZOOM_THRESHOLD - 0.1,
      { zoom: 1, panX: 0, panY: 0 },
      800,
      600,
    );
    expect(
      lowZoomCtx._calls.filter((c: Call) => c.fn === 'fillText').length,
    ).toBe(0);

    const highZoomCtx = makeMockCtx();
    drawBridgeLabels(
      highZoomCtx,
      [makeBridge({})],
      BRIDGE_LABEL_ZOOM_THRESHOLD,
      { zoom: BRIDGE_LABEL_ZOOM_THRESHOLD, panX: 0, panY: 0 },
      800,
      600,
    );
    expect(
      highZoomCtx._calls.filter((c: Call) => c.fn === 'fillText').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('V-12-21: renders commandName text at each bridge position', () => {
    const ctx = makeMockCtx();
    drawBridgeLabels(
      ctx,
      [
        makeBridge({ commandName: 'ping' }),
        makeBridge({ commandName: 'startWatch' }),
      ],
      BRIDGE_LABEL_ZOOM_THRESHOLD,
      { zoom: BRIDGE_LABEL_ZOOM_THRESHOLD, panX: 0, panY: 0 },
      800,
      600,
    );
    const texts = ctx._calls
      .filter((c: Call) => c.fn === 'fillText')
      .map((c: Call) => c.args[0]);
    expect(texts).toContain('ping');
    expect(texts).toContain('startWatch');
  });

  it('V-12-21: uses theme.fileLabelColor when theme provided', () => {
    const ctx = makeMockCtx();
    const theme = THEMES['phosphor-classic'];
    drawBridgeLabels(
      ctx,
      [makeBridge({ commandName: 'ping' })],
      BRIDGE_LABEL_ZOOM_THRESHOLD,
      { zoom: BRIDGE_LABEL_ZOOM_THRESHOLD, panX: 0, panY: 0 },
      800,
      600,
      theme,
    );
    expect(ctx._assignments.fillStyle).toContain(theme.fileLabelColor);
  });
});
