// Phase 7 Plan 04 -- GraphRenderer pure functions test suite.
//
// Covers D-12 (folder hulls + progressive detail), D-13 (uniform edge stroke),
// D-19 (heat-tinted nodes), viewport culling (UI-SPEC §Sizing), and single-
// child directory chain collapse (commit a8fe89b ported to hull labels).

// Path2D polyfill for jsdom (Canvas 2D constructors not available in test env).
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as any).Path2D = class Path2D { constructor(_d?: string) {} };
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  drawFolderHulls,
  drawFolderLabels,
  drawEdges,
  drawArrowHeads,
  drawNodes,
  drawFileLabels,
  drawSelectedNode,
  filterEdgesForSemanticLevel,
  heatColor,
  isInViewport,
  collapseSingleChildChain,
  shouldRenderHullAtZoom,
  NODE_RADIUS_DEFAULT,
  NODE_RADIUS_HOVERED,
  ARROW_LENGTH,
  ARROW_INSET,
  VIEWPORT_CULL_PADDING,
} from '../GraphRenderer';
import type { GraphNode, GraphEdge } from '../../../stores/radarStore';
import { THEMES } from '../themes';

// Minimal mock CanvasRenderingContext2D with vitest spies on every method the
// renderer calls. We track lineWidth / fillStyle / strokeStyle assignments so
// the tests can assert intermediate state.
function createMockCtx() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const assignments: Record<string, unknown[]> = {
    fillStyle: [],
    strokeStyle: [],
    lineWidth: [],
    font: [],
    textAlign: [],
    textBaseline: [],
    globalAlpha: [],
  };
  const record = (fn: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ fn, args });
    });
  const gradient = {
    addColorStop: vi.fn(),
  };
  const ctx = {
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    fillText: record('fillText'),
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    scale: record('scale'),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    _calls: calls,
    _assignments: assignments,
  } as unknown as CanvasRenderingContext2D & {
    _calls: Array<{ fn: string; args: unknown[] }>;
    _assignments: Record<string, unknown[]>;
  };
  // Intercept style assignments so tests can audit the color at each stroke.
  for (const prop of Object.keys(assignments)) {
    let cur: unknown;
    Object.defineProperty(ctx, prop, {
      get: () => cur,
      set: (v: unknown) => {
        cur = v;
        assignments[prop].push(v);
      },
    });
  }
  return ctx;
}

const VIEWPORT = { zoom: 1, panX: 0, panY: 0 };
const CANVAS_W = 800;
const CANVAS_H = 600;

describe('GraphRenderer pure functions — Plan 04', () => {
  describe('heatColor (D-19, UI-SPEC §Color heat-map ramp)', () => {
    it('returns surface-container #0f1a0e at score=0', () => {
      expect(heatColor(0)).toBe('#0f1a0e');
    });
    it('returns error #ff7351 at score=1', () => {
      expect(heatColor(1)).toBe('#ff7351');
    });
    it('returns interpolated blend at score=0.5 (Test 6)', () => {
      // mixRgb(#0f1a0e, #ff7351, 0.5):
      // R: round(0x0f + (0xff-0x0f)*0.5) = round(15 + 120) = 135 = 0x87
      // G: round(0x1a + (0x73-0x1a)*0.5) = round(26 + 44.5) = 71 = 0x47
      // B: round(0x0e + (0x51-0x0e)*0.5) = round(14 + 33.5) = 48 = 0x30
      expect(heatColor(0.5)).toBe('#874730');
    });
    it('clamps negative scores to 0', () => {
      expect(heatColor(-0.5)).toBe('#0f1a0e');
    });
    it('clamps scores >1 to 1', () => {
      expect(heatColor(2)).toBe('#ff7351');
    });
  });

  describe('isInViewport (Test 11)', () => {
    it('classifies a node at (0, 0) as in-viewport for an 800x600 canvas at identity viewport', () => {
      expect(isInViewport({ x: 0, y: 0 }, VIEWPORT, CANVAS_W, CANVAS_H)).toBe(true);
    });
    it('classifies a node at (-500, -500) with 100px padding as OUT-of-viewport', () => {
      expect(isInViewport({ x: -500, y: -500 }, VIEWPORT, CANVAS_W, CANVAS_H)).toBe(false);
    });
    it('respects 100px padding around the canvas edges', () => {
      // Node at (-50, -50) is within the 100px padding → in-viewport.
      expect(isInViewport({ x: -50, y: -50 }, VIEWPORT, CANVAS_W, CANVAS_H)).toBe(true);
      // Node at (-200, 0) is beyond 100px padding → out.
      expect(isInViewport({ x: -200, y: 0 }, VIEWPORT, CANVAS_W, CANVAS_H)).toBe(false);
    });
    it('accounts for zoom and pan when mapping world → screen', () => {
      // World (0,0) with pan (400, 300) and zoom 1 lands at screen (400,300) — in.
      expect(isInViewport({ x: 0, y: 0 }, { zoom: 1, panX: 400, panY: 300 }, CANVAS_W, CANVAS_H)).toBe(true);
      // World (0,0) with pan (-2000, 0) lands at screen (-2000, 0) — out.
      expect(isInViewport({ x: 0, y: 0 }, { zoom: 1, panX: -2000, panY: 0 }, CANVAS_W, CANVAS_H)).toBe(false);
    });
    it('exports default padding of 100 per UI-SPEC §Sizing', () => {
      expect(VIEWPORT_CULL_PADDING).toBe(100);
    });
  });

  describe('shouldRenderHullAtZoom (progressive detail, D-12)', () => {
    it('shows only depth-0 folders at zoom < 0.6 (Test 9)', () => {
      expect(shouldRenderHullAtZoom(0, 0.5)).toBe(true);
      expect(shouldRenderHullAtZoom(1, 0.5)).toBe(false);
      expect(shouldRenderHullAtZoom(2, 0.5)).toBe(false);
    });
    it('shows depth ≤ 2 at 0.6 ≤ zoom < 2 (Test 10)', () => {
      expect(shouldRenderHullAtZoom(0, 1)).toBe(true);
      expect(shouldRenderHullAtZoom(2, 1)).toBe(true);
      expect(shouldRenderHullAtZoom(3, 1)).toBe(false);
    });
    it('shows all depths at zoom ≥ 2', () => {
      expect(shouldRenderHullAtZoom(5, 2)).toBe(true);
      expect(shouldRenderHullAtZoom(10, 5)).toBe(true);
    });
  });

  describe('collapseSingleChildChain (Test 3, commit a8fe89b port)', () => {
    it('collapses single-child wrapper dirs into the label', () => {
      // src/views has only one child dir (Radar) and no own files. Should
      // collapse so label is "views/Radar" (starting from views — src is
      // the outermost single-child wrapper and gets stripped).
      const parentChildMap = new Map<string, Set<string>>([
        ['src', new Set(['src/views'])],
        ['src/views', new Set(['src/views/Radar'])],
        ['src/views/Radar', new Set()],
      ]);
      const dirsWithOwnFiles = new Set<string>(['src/views/Radar']);
      const label = collapseSingleChildChain('src/views/Radar', dirsWithOwnFiles, parentChildMap);
      expect(label).toBe('views/Radar');
    });
    it('stops collapsing at a branching directory', () => {
      // src has 2 children: views and lib — stop collapse at src.
      const parentChildMap = new Map<string, Set<string>>([
        ['src', new Set(['src/views', 'src/lib'])],
        ['src/views', new Set(['src/views/Radar'])],
      ]);
      const dirsWithOwnFiles = new Set<string>(['src/views/Radar']);
      const label = collapseSingleChildChain('src/views/Radar', dirsWithOwnFiles, parentChildMap);
      // "src" has 2 children, so we stop collapsing at "src" — keep "src/views/Radar" intact.
      expect(label).toBe('src/views/Radar');
    });
    it('stops collapsing at an ancestor that has its own files', () => {
      const parentChildMap = new Map<string, Set<string>>([
        ['src', new Set(['src/views'])],
        ['src/views', new Set(['src/views/Radar'])],
      ]);
      const dirsWithOwnFiles = new Set<string>(['src', 'src/views/Radar']);
      const label = collapseSingleChildChain('src/views/Radar', dirsWithOwnFiles, parentChildMap);
      // src has its own files, so the chain should NOT strip src.
      expect(label).toBe('src/views/Radar');
    });
  });

  describe('drawFolderHulls (D-12)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('renders a padded smooth hull for a dirKey with 2 nodes (Test 1)', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [
        { id: 'a', dirKey: 'src', dirDepth: 1, x: 10, y: 10 },
        { id: 'b', dirKey: 'src', dirDepth: 1, x: 20, y: 20 },
      ];
      const parentChildMap = new Map<string, Set<string>>([['src', new Set(['src'])]]);
      const dirsWithOwnFiles = new Set<string>(['src']);
      drawFolderHulls(ctx, nodes, 1, null, parentChildMap, dirsWithOwnFiles);
      // Padded hull technique generates enough points for a convex hull
      // even with 2 nodes. Rendered via Path2D + ctx.fill(path2d).
      const fills = (ctx as any)._calls.filter((c: any) => c.fn === 'fill');
      expect(fills.length).toBeGreaterThanOrEqual(1);
      // Should also have a label (fillText)
      const texts = (ctx as any)._calls.filter((c: any) => c.fn === 'fillText');
      expect(texts.length).toBeGreaterThanOrEqual(1);
    });

    it('renders a padded smooth hull for a dirKey with ≥3 nodes (Test 2)', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [
        { id: 'a', dirKey: 'src', dirDepth: 1, x: 0, y: 0 },
        { id: 'b', dirKey: 'src', dirDepth: 1, x: 10, y: 0 },
        { id: 'c', dirKey: 'src', dirDepth: 1, x: 5, y: 10 },
        { id: 'd', dirKey: 'src', dirDepth: 1, x: 5, y: 5 },
        { id: 'e', dirKey: 'src', dirDepth: 1, x: 2, y: 8 },
      ];
      const parentChildMap = new Map<string, Set<string>>([['src', new Set(['src'])]]);
      const dirsWithOwnFiles = new Set<string>(['src']);
      drawFolderHulls(ctx, nodes, 1, null, parentChildMap, dirsWithOwnFiles);
      // Rendered via Path2D + Catmull-Rom spline — fill + stroke called
      const fills = (ctx as any)._calls.filter((c: any) => c.fn === 'fill');
      const strokes = (ctx as any)._calls.filter((c: any) => c.fn === 'stroke');
      expect(fills.length).toBeGreaterThanOrEqual(1);
      expect(strokes.length).toBeGreaterThanOrEqual(1);
    });

    it('skips hulls at low zoom for deep dirs (progressive detail)', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [
        // dirDepth=3 → should be skipped at zoom 0.5
        { id: 'a', dirKey: 'src/a/b/c', dirDepth: 3, x: 0, y: 0 },
        { id: 'b', dirKey: 'src/a/b/c', dirDepth: 3, x: 5, y: 5 },
      ];
      const parentChildMap = new Map<string, Set<string>>();
      const dirsWithOwnFiles = new Set<string>();
      drawFolderHulls(ctx, nodes, 0.5, null, parentChildMap, dirsWithOwnFiles);
      // No arc calls because depth-3 hulls are skipped at zoom < 0.6
      const arcs = (ctx as any)._calls.filter((c: any) => c.fn === 'arc');
      expect(arcs.length).toBe(0);
    });
  });

  describe('drawFolderLabels (Phase 13 semantic pass alpha)', () => {
    it('dims non-top labels without overwriting caller semantic pass alpha', () => {
      const ctx = createMockCtx();
      ctx.globalAlpha = 0.25;
      const nodes: GraphNode[] = [
        { id: 'src/views/Radar/RadarCanvas.tsx', dirKey: 'src/views/Radar', dirDepth: 3, x: 10, y: 10 },
        { id: 'src/views/Radar/GraphRenderer.ts', dirKey: 'src/views/Radar', dirDepth: 3, x: 20, y: 20 },
      ];
      const parentChildMap = new Map<string, Set<string>>([['src/views/Radar', new Set(['src/views/Radar'])]]);
      const dirsWithOwnFiles = new Set<string>(['src/views/Radar']);

      drawFolderLabels(ctx, nodes, 2, null, parentChildMap, dirsWithOwnFiles);

      expect(ctx._assignments.globalAlpha).toContain(0.1675);
      expect(ctx.globalAlpha).toBe(0.25);
    });
  });

  describe('drawEdges (D-13)', () => {
    beforeEach(() => vi.clearAllMocks());
    it('uses 1 / zoom uniform stroke for every edge (Test 4)', () => {
      const ctx = createMockCtx();
      const edges: GraphEdge[] = [
        { source: 'a', target: 'b', kind: 'import' },
        { source: 'b', target: 'c', kind: 'import' },
      ];
      const positions = new Map<string, { x: number; y: number }>([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 100, y: 0 }],
        ['c', { x: 200, y: 0 }],
      ]);
      drawEdges(ctx, edges, positions, 2, VIEWPORT, CANVAS_W, CANVAS_H);
      const widths = (ctx as any)._assignments.lineWidth;
      // lineWidth was set to 1 / 2 = 0.5 before stroking
      expect(widths).toContain(0.5);
    });

    it('skips edges where both endpoints are out-of-viewport', () => {
      const ctx = createMockCtx();
      const edges: GraphEdge[] = [{ source: 'a', target: 'b', kind: 'import' }];
      const positions = new Map<string, { x: number; y: number }>([
        ['a', { x: -5000, y: -5000 }],
        ['b', { x: -5000, y: -5000 }],
      ]);
      drawEdges(ctx, edges, positions, 1, VIEWPORT, CANVAS_W, CANVAS_H);
      const strokes = (ctx as any)._calls.filter((c: any) => c.fn === 'stroke');
      expect(strokes.length).toBe(0);
    });

    it('restores caller semantic pass alpha after boosting IPC edges', () => {
      const ctx = createMockCtx();
      ctx.globalAlpha = 0.25;
      const edges: GraphEdge[] = [
        { source: 'web', target: 'bridge:ping', kind: 'invokes' },
        { source: 'a', target: 'b', kind: 'import' },
      ];
      const positions = new Map<string, { x: number; y: number }>([
        ['web', { x: 0, y: 0 }],
        ['bridge:ping', { x: 100, y: 0 }],
        ['a', { x: 0, y: 10 }],
        ['b', { x: 100, y: 10 }],
      ]);

      drawEdges(ctx, edges, positions, 1, VIEWPORT, CANVAS_W, CANVAS_H);

      expect(ctx._assignments.globalAlpha).toContain(0.3175);
      expect(ctx.globalAlpha).toBe(0.25);
    });
  });

  describe('filterEdgesForSemanticLevel (Phase 13 semantic edge visibility)', () => {
    it('keeps only IPC bridge edges at workspace/package levels', () => {
      const edges: GraphEdge[] = [
        { source: 'a', target: 'b', kind: 'import' },
        { source: 'web', target: 'bridge:ping', kind: 'invokes' },
        { source: 'bridge:ping', target: 'src-tauri/ping.rs', kind: 'handles' },
      ];

      expect(filterEdgesForSemanticLevel(edges, 'workspace')).toEqual([edges[1], edges[2]]);
      expect(filterEdgesForSemanticLevel(edges, 'package')).toEqual([edges[1], edges[2]]);
    });

    it('keeps all edges at file/code levels', () => {
      const edges: GraphEdge[] = [
        { source: 'a', target: 'b', kind: 'import' },
        { source: 'web', target: 'bridge:ping', kind: 'invokes' },
        { source: 'bridge:ping', target: 'src-tauri/ping.rs', kind: 'handles' },
      ];

      expect(filterEdgesForSemanticLevel(edges, 'file')).toEqual(edges);
      expect(filterEdgesForSemanticLevel(edges, 'code')).toEqual(edges);
    });
  });

  describe('drawArrowHeads (UI-SPEC §Sizing)', () => {
    beforeEach(() => vi.clearAllMocks());
    it('places the apex 5px (world) inset from the target center (Test 5)', () => {
      const ctx = createMockCtx();
      const edges: GraphEdge[] = [{ source: 'a', target: 'b', kind: 'import' }];
      const positions = new Map<string, { x: number; y: number }>([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 100, y: 0 }],
      ]);
      drawArrowHeads(ctx, edges, positions, 1, VIEWPORT, CANVAS_W, CANVAS_H);
      // First moveTo is the apex. Target at (100,0), inset 5px along edge → apex (95, 0).
      const moveTos = (ctx as any)._calls.filter((c: any) => c.fn === 'moveTo');
      expect(moveTos.length).toBeGreaterThanOrEqual(1);
      expect(moveTos[0].args[0]).toBeCloseTo(100 - ARROW_INSET);
      expect(moveTos[0].args[1]).toBeCloseTo(0);
    });
    it('culls arrows at low zoom (< 0.6)', () => {
      const ctx = createMockCtx();
      const edges: GraphEdge[] = [{ source: 'a', target: 'b', kind: 'import' }];
      const positions = new Map<string, { x: number; y: number }>([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 100, y: 0 }],
      ]);
      drawArrowHeads(ctx, edges, positions, 0.4, VIEWPORT, CANVAS_W, CANVAS_H);
      const fills = (ctx as any)._calls.filter((c: any) => c.fn === 'fill');
      expect(fills.length).toBe(0);
    });
  });

  describe('drawNodes (UI-SPEC z-order step 6)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('uses default fill #0f1a0e when heat-map disabled (Test 7)', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'a', dirKey: 'src', dirDepth: 1, x: 10, y: 10 }];
      const scores = new Map<string, number>([['a', 0.7]]);
      drawNodes(ctx, nodes, scores, /*heatMapEnabled=*/ false, null, 1, VIEWPORT, CANVAS_W, CANVAS_H);
      const fills = (ctx as any)._assignments.fillStyle;
      expect(fills).toContain('#0f1a0e');
    });

    it('uses heat-tinted fill when heat-map enabled (Test 6 integration)', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'a', dirKey: 'src', dirDepth: 1, x: 10, y: 10 }];
      const scores = new Map<string, number>([['a', 0.5]]);
      drawNodes(ctx, nodes, scores, /*heatMapEnabled=*/ true, null, 1, VIEWPORT, CANVAS_W, CANVAS_H);
      const fills = (ctx as any)._assignments.fillStyle;
      expect(fills).toContain(heatColor(0.5));
    });

    it('grows hover radius from 5 → 6 world px (Test 8)', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'a', dirKey: 'src', dirDepth: 1, x: 10, y: 10 }];
      drawNodes(ctx, nodes, new Map(), false, 'a', 1, VIEWPORT, CANVAS_W, CANVAS_H);
      const arcs = (ctx as any)._calls.filter((c: any) => c.fn === 'arc');
      expect(arcs[0].args[2]).toBe(NODE_RADIUS_HOVERED);
      expect(NODE_RADIUS_DEFAULT).toBe(5);
      expect(NODE_RADIUS_HOVERED).toBe(6);
    });

    it('culls nodes outside viewport + 100px padding', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'a', dirKey: 'src', dirDepth: 1, x: -5000, y: -5000 }];
      drawNodes(ctx, nodes, new Map(), false, null, 1, VIEWPORT, CANVAS_W, CANVAS_H);
      const arcs = (ctx as any)._calls.filter((c: any) => c.fn === 'arc');
      expect(arcs.length).toBe(0);
    });
  });

  describe('drawFileLabels (Phase 13 FILE level)', () => {
    it('renders file labels at zoom 2', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'src/views/Radar/GraphRenderer.ts', dirKey: 'src/views/Radar', dirDepth: 3, x: 10, y: 10 }];
      drawFileLabels(ctx, nodes, 2, { ...VIEWPORT, zoom: 2 }, CANVAS_W, CANVAS_H);
      const texts = (ctx as any)._calls.filter((c: any) => c.fn === 'fillText');
      expect(texts[0].args[0]).toBe('GraphRenderer.ts');
    });

    it('dims labels without overwriting caller semantic pass alpha', () => {
      const ctx = createMockCtx();
      ctx.globalAlpha = 0.25;
      const nodes: GraphNode[] = [{ id: 'src/views/Radar/GraphRenderer.ts', dirKey: 'src/views/Radar', dirDepth: 3, x: 10, y: 10 }];

      drawFileLabels(ctx, nodes, 2, { ...VIEWPORT, zoom: 2 }, CANVAS_W, CANVAS_H);

      expect(ctx._assignments.globalAlpha).toContain(0.2);
      expect(ctx.globalAlpha).toBe(0.25);
    });
  });

  describe('drawSelectedNode (UI-SPEC §Color)', () => {
    beforeEach(() => vi.clearAllMocks());
    it('draws a 1px white outer stroke at 80% opacity', () => {
      const ctx = createMockCtx();
      const node: GraphNode = { id: 'a', dirKey: 'src', dirDepth: 1, x: 10, y: 10 };
      drawSelectedNode(ctx, node, '#8eff71', 1);
      const strokes = (ctx as any)._assignments.strokeStyle;
      expect(strokes).toContain('rgba(255,255,255,0.8)');
    });

    it('is a no-op when node is undefined (no glow when nothing selected)', () => {
      const ctx = createMockCtx();
      drawSelectedNode(ctx, undefined, '#8eff71', 1);
      expect((ctx as any)._calls.length).toBe(0);
    });
  });

  describe('Phase 13 semantic file-level renderer contracts', () => {
    beforeEach(() => vi.clearAllMocks());

    it('drawFileLabels renders file labels at zoom 2 instead of waiting for code zoom 4', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [
        { id: 'src/views/Radar/RadarCanvas.tsx', dirKey: 'src/views/Radar', dirDepth: 3, x: 10, y: 10 },
      ];
      drawFileLabels(ctx, nodes, 2, { zoom: 2, panX: 0, panY: 0 }, CANVAS_W, CANVAS_H);
      const texts = (ctx as any)._calls.filter((c: any) => c.fn === 'fillText');
      expect(texts.map((c: any) => c.args[0])).toContain('RadarCanvas.tsx');
    });

    it('filterEdgesForSemanticLevel keeps only IPC invokes/handles at workspace and package levels', () => {
      const edges: GraphEdge[] = [
        { source: 'src/App.tsx', target: 'src/main.tsx', kind: 'import' },
        { source: 'src/App.tsx', target: 'bridge:get_tree_index', kind: 'invokes' },
        { source: 'bridge:get_tree_index', target: 'src-tauri/src/lib.rs', kind: 'handles' },
      ];
      expect(filterEdgesForSemanticLevel(edges, 'workspace')).toEqual([edges[1], edges[2]]);
      expect(filterEdgesForSemanticLevel(edges, 'package')).toEqual([edges[1], edges[2]]);
    });

    it('filterEdgesForSemanticLevel preserves import edges at file and code levels', () => {
      const edges: GraphEdge[] = [
        { source: 'src/App.tsx', target: 'src/main.tsx', kind: 'import' },
        { source: 'src/App.tsx', target: 'bridge:get_tree_index', kind: 'invokes' },
        { source: 'bridge:get_tree_index', target: 'src-tauri/src/lib.rs', kind: 'handles' },
      ];
      expect(filterEdgesForSemanticLevel(edges, 'file')).toEqual(edges);
      expect(filterEdgesForSemanticLevel(edges, 'code')).toEqual(edges);
    });
  });

  describe('sizing tokens (UI-SPEC §Sizing verbatim)', () => {
    it('uses 5px world-space for default node radius', () => {
      expect(NODE_RADIUS_DEFAULT).toBe(5);
    });
    it('uses 5px world-space for arrow length', () => {
      expect(ARROW_LENGTH).toBe(5);
    });
  });

  // ───── Theme arg integration (2026-04-16 color theme spec §3) ─────
  describe('theme arg threading', () => {
    beforeEach(() => vi.clearAllMocks());

    it('drawNodes honours theme.nodeFill for non-hover, non-heat nodes', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'a', dirKey: 'src', dirDepth: 1, x: 10, y: 10 }];
      drawNodes(
        ctx,
        nodes,
        new Map(),
        false,
        null,
        1,
        VIEWPORT,
        CANVAS_W,
        CANVAS_H,
        THEMES['phosphor-cyan'],
      );
      const fills = (ctx as any)._assignments.fillStyle;
      expect(fills).toContain(THEMES['phosphor-cyan'].nodeFill);
    });

    it('drawNodes uses clusterAccents for the stroke when the theme ships them', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'a', dirKey: 'src/foo', dirDepth: 2, x: 10, y: 10 }];
      drawNodes(
        ctx,
        nodes,
        new Map(),
        false,
        null,
        1,
        VIEWPORT,
        CANVAS_W,
        CANVAS_H,
        THEMES.plasma,
      );
      const strokes = (ctx as any)._assignments.strokeStyle;
      // One of the plasma accents must have been picked for this dirKey.
      const accents = THEMES.plasma.clusterAccents!;
      expect(accents.some((a) => strokes.includes(a))).toBe(true);
    });

    it('drawEdges honours theme.edgeStroke', () => {
      const ctx = createMockCtx();
      const edges: GraphEdge[] = [{ source: 'a', target: 'b', kind: 'import' }];
      const positions = new Map<string, { x: number; y: number }>([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 100, y: 0 }],
      ]);
      drawEdges(
        ctx,
        edges,
        positions,
        1,
        VIEWPORT,
        CANVAS_W,
        CANVAS_H,
        THEMES['amber-terminal'],
      );
      const strokes = (ctx as any)._assignments.strokeStyle;
      expect(strokes).toContain(THEMES['amber-terminal'].edgeStroke);
    });

    it('drawArrowHeads honours theme.arrowFill', () => {
      const ctx = createMockCtx();
      const edges: GraphEdge[] = [{ source: 'a', target: 'b', kind: 'import' }];
      const positions = new Map<string, { x: number; y: number }>([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 100, y: 0 }],
      ]);
      drawArrowHeads(
        ctx,
        edges,
        positions,
        1,
        VIEWPORT,
        CANVAS_W,
        CANVAS_H,
        THEMES['cool-slate'],
      );
      const fills = (ctx as any)._assignments.fillStyle;
      expect(fills).toContain(THEMES['cool-slate'].arrowFill);
    });

    it('drawFolderHulls honours theme.hullStroke + hullFill', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [
        { id: 'a', dirKey: 'src', dirDepth: 1, x: 0, y: 0 },
        { id: 'b', dirKey: 'src', dirDepth: 1, x: 10, y: 0 },
        { id: 'c', dirKey: 'src', dirDepth: 1, x: 5, y: 10 },
      ];
      const parentChildMap = new Map<string, Set<string>>([['src', new Set(['src'])]]);
      const dirsWithOwnFiles = new Set<string>(['src']);
      drawFolderHulls(
        ctx,
        nodes,
        1,
        null,
        parentChildMap,
        dirsWithOwnFiles,
        THEMES['stellar-forge'],
      );
      const strokes = (ctx as any)._assignments.strokeStyle;
      const fills = (ctx as any)._assignments.fillStyle;
      expect(strokes).toContain(THEMES['stellar-forge'].hullStroke);
      expect(fills).toContain(THEMES['stellar-forge'].hullFill);
    });

    it('heatColor ramps from theme.heatRampStart to #ff7351', () => {
      // At score=0 we expect exactly the theme.heatRampStart.
      expect(heatColor(0, THEMES['amber-terminal'])).toBe('#1a1408');
      // At score=1 every theme lands on error red.
      expect(heatColor(1, THEMES['amber-terminal'])).toBe('#ff7351');
    });
  });
});
