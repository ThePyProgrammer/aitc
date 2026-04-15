// Phase 7 Plan 04 -- GraphRenderer pure functions test suite.
//
// Covers D-12 (folder hulls + progressive detail), D-13 (uniform edge stroke),
// D-19 (heat-tinted nodes), viewport culling (UI-SPEC §Sizing), and single-
// child directory chain collapse (commit a8fe89b ported to hull labels).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  drawFolderHulls,
  drawEdges,
  drawArrowHeads,
  drawNodes,
  drawSelectedNode,
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
    it('returns surface-container #1a1919 at score=0', () => {
      expect(heatColor(0)).toBe('#1a1919');
    });
    it('returns error #ff7351 at score=1', () => {
      expect(heatColor(1)).toBe('#ff7351');
    });
    it('returns interpolated blend at score=0.5 (Test 6)', () => {
      // mixRgb(#1a1919, #ff7351, 0.5) — each channel averaged.
      // R: 0x1a + (0xff - 0x1a) * 0.5 = 26 + 229 * 0.5 = 140.5 → 141 = 0x8d
      // Our clamp uses Math.round so (26+229)/2 = 255/2 + 26 = 127.5 + 26 = 140.5 ≈ 141 ... actually:
      // round(0x1a + (0xff-0x1a)*0.5) = round(26 + 229/2) = round(26 + 114.5) = round(140.5) = 141 = 0x8d
      // G: round(0x19 + (0x73-0x19)*0.5) = round(25 + 90/2) = round(25+45) = 70 = 0x46
      // B: round(0x19 + (0x51-0x19)*0.5) = round(25 + 56/2) = round(25+28) = 53 = 0x35
      expect(heatColor(0.5)).toBe('#8d4635');
    });
    it('clamps negative scores to 0', () => {
      expect(heatColor(-0.5)).toBe('#1a1919');
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

    it('renders a circle fallback for a dirKey with 2 nodes (Test 1)', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [
        { id: 'a', dirKey: 'src', dirDepth: 1, x: 10, y: 10 },
        { id: 'b', dirKey: 'src', dirDepth: 1, x: 20, y: 20 },
      ];
      const parentChildMap = new Map<string, Set<string>>([['src', new Set(['src'])]]);
      const dirsWithOwnFiles = new Set<string>(['src']);
      drawFolderHulls(ctx, nodes, 1, parentChildMap, dirsWithOwnFiles);
      const arcCalls = (ctx as any)._calls.filter((c: any) => c.fn === 'arc');
      expect(arcCalls.length).toBeGreaterThanOrEqual(1);
      // Circle at mean position (15, 15)
      expect(arcCalls[0].args[0]).toBeCloseTo(15);
      expect(arcCalls[0].args[1]).toBeCloseTo(15);
    });

    it('renders a polygon hull for a dirKey with ≥3 nodes (Test 2)', () => {
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
      drawFolderHulls(ctx, nodes, 1, parentChildMap, dirsWithOwnFiles);
      const moveTo = (ctx as any)._calls.filter((c: any) => c.fn === 'moveTo');
      const lineTo = (ctx as any)._calls.filter((c: any) => c.fn === 'lineTo');
      // Hull should be traced with moveTo + multiple lineTo calls
      expect(moveTo.length).toBeGreaterThanOrEqual(1);
      expect(lineTo.length).toBeGreaterThanOrEqual(2);
      // Fill + stroke for the hull
      expect((ctx as any)._calls.some((c: any) => c.fn === 'fill')).toBe(true);
      expect((ctx as any)._calls.some((c: any) => c.fn === 'stroke')).toBe(true);
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
      drawFolderHulls(ctx, nodes, 0.5, parentChildMap, dirsWithOwnFiles);
      // No arc calls because depth-3 hulls are skipped at zoom < 0.6
      const arcs = (ctx as any)._calls.filter((c: any) => c.fn === 'arc');
      expect(arcs.length).toBe(0);
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

    it('uses default fill #1a1919 when heat-map disabled (Test 7)', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'a', dirKey: 'src', dirDepth: 1, x: 10, y: 10 }];
      const scores = new Map<string, number>([['a', 0.7]]);
      drawNodes(ctx, nodes, scores, /*heatMapEnabled=*/ false, null, new Set(), 1, VIEWPORT, CANVAS_W, CANVAS_H);
      const fills = (ctx as any)._assignments.fillStyle;
      expect(fills).toContain('#1a1919');
    });

    it('uses heat-tinted fill when heat-map enabled (Test 6 integration)', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'a', dirKey: 'src', dirDepth: 1, x: 10, y: 10 }];
      const scores = new Map<string, number>([['a', 0.5]]);
      drawNodes(ctx, nodes, scores, /*heatMapEnabled=*/ true, null, new Set(), 1, VIEWPORT, CANVAS_W, CANVAS_H);
      const fills = (ctx as any)._assignments.fillStyle;
      expect(fills).toContain(heatColor(0.5));
    });

    it('grows hover radius from 5 → 6 world px (Test 8)', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'a', dirKey: 'src', dirDepth: 1, x: 10, y: 10 }];
      drawNodes(ctx, nodes, new Map(), false, 'a', new Set(), 1, VIEWPORT, CANVAS_W, CANVAS_H);
      const arcs = (ctx as any)._calls.filter((c: any) => c.fn === 'arc');
      expect(arcs[0].args[2]).toBe(NODE_RADIUS_HOVERED);
      expect(NODE_RADIUS_DEFAULT).toBe(5);
      expect(NODE_RADIUS_HOVERED).toBe(6);
    });

    it('culls nodes outside viewport + 100px padding', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'a', dirKey: 'src', dirDepth: 1, x: -5000, y: -5000 }];
      drawNodes(ctx, nodes, new Map(), false, null, new Set(), 1, VIEWPORT, CANVAS_W, CANVAS_H);
      const arcs = (ctx as any)._calls.filter((c: any) => c.fn === 'arc');
      expect(arcs.length).toBe(0);
    });

    it('renders pinned-node lock badge using secondary #00cffc', () => {
      const ctx = createMockCtx();
      const nodes: GraphNode[] = [{ id: 'a', dirKey: 'src', dirDepth: 1, x: 10, y: 10 }];
      drawNodes(ctx, nodes, new Map(), false, null, new Set(['a']), 1, VIEWPORT, CANVAS_W, CANVAS_H);
      const fills = (ctx as any)._assignments.fillStyle;
      expect(fills).toContain('#00cffc');
      const rects = (ctx as any)._calls.filter((c: any) => c.fn === 'fillRect');
      expect(rects.length).toBeGreaterThanOrEqual(1);
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

  describe('sizing tokens (UI-SPEC §Sizing verbatim)', () => {
    it('uses 5px world-space for default node radius', () => {
      expect(NODE_RADIUS_DEFAULT).toBe(5);
    });
    it('uses 5px world-space for arrow length', () => {
      expect(ARROW_LENGTH).toBe(5);
    });
  });
});
