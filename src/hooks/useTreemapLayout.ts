// Phase 4 treemap layout hook.
//
// VIZN-01, VIZN-04: Squarified treemap computation with memoization.
// Converts flat TreeIndexEntry[] from backend into nested tree, then
// computes squarified rectangle layout for Canvas 2D rendering.
// Memoized via useMemo to prevent recomputation on every render (Pitfall 2).

import { useMemo } from 'react';
// squarify is a CJS package (main: lib/index.js) whose real layout function lives
// at `exports.default` (a 2-arg `(data, container)` fn). It also exports a named
// `exports.squarify` which is a 4-arg INTERNAL helper -- NOT the one we want.
//
// Vite pre-bundles CJS deps and emits `export default require_lib()` where the
// default IS the whole exports object. Neither a plain `import squarify from
// 'squarify'` nor `import * as squarifyMod from 'squarify'` reliably unwraps to
// the function on its own in Vite dev (the namespace wrapper even sets
// `.default` to the exports object itself, masking the real default).
//
// We therefore import the raw module object and walk down to the function,
// tolerating both wrapped shapes:
//   A) `mod.default` is the function (Node ESM / Vitest / prod Rollup interop)
//   B) `mod.default.default` is the function (Vite dev pre-bundle shape)
//   C) `mod` itself is the function (ES module default-export unwrap)
// See .planning/debug/resolved/squarify-not-a-function.md for full analysis.
import * as squarifyMod from 'squarify';

/**
 * Flat tree entry shape returned by the `get_tree_index` Tauri command.
 * Phase 7 moved this type out of `radarStore.ts` because the store no
 * longer caches the treemap baseline — the graph view derives its nodes
 * from the same command but under a different projection. Kept colocated
 * with `buildFileTree` since treemap code is the sole consumer.
 */
export interface TreeIndexEntry {
  path: string;
  size: number;
  isDir: boolean;
  depth: number;
}

/**
 * Phase 7 Plan 03 bridge: synthesize flat `TreeIndexEntry[]` rows from
 * the store's `GraphNode[]`. The treemap visuals survive on their own
 * from graph node ids until Plan 04 rewrites RadarCanvas/Minimap/
 * AgentManifestRow as graph renderers. Each graph node is a file, so
 * we emit an `isDir: false` row with a placeholder size (graph nodes
 * carry no size — the treemap uses equal-weighting as a fallback).
 */
export function graphNodesToTreeEntries(
  nodes: ReadonlyArray<{ id: string; dirDepth: number }>,
): TreeIndexEntry[] {
  return nodes.map((n) => ({
    path: n.id,
    size: 1,
    isDir: false,
    depth: n.dirDepth + 1,
  }));
}

type SquarifyFn = (
  data: Array<{ value: number } & Record<string, unknown>>,
  container: { x0: number; y0: number; x1: number; y1: number },
) => Array<{ x0: number; y0: number; x1: number; y1: number } & Record<string, unknown>>;

function resolveSquarify(mod: unknown): SquarifyFn {
  const candidates: unknown[] = [];
  if (mod && typeof mod === 'object') {
    const m = mod as { default?: unknown };
    candidates.push(m.default);
    if (m.default && typeof m.default === 'object') {
      candidates.push((m.default as { default?: unknown }).default);
    }
  }
  candidates.push(mod);
  for (const c of candidates) {
    if (typeof c === 'function') return c as SquarifyFn;
  }
  throw new Error('squarify: could not resolve default layout function from module');
}

const squarify: SquarifyFn = resolveSquarify(squarifyMod);

export interface FileTreeNode {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
  children: FileTreeNode[];
}

export interface TreemapRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  path: string;
  name: string;
  depth: number;
  isFile: boolean;
  size: number;
}

/**
 * Convert flat TreeIndexEntry[] into a nested FileTreeNode.
 * Groups entries by directory segments. Each directory's size is the sum
 * of its children's sizes.
 */
export function buildFileTree(entries: TreeIndexEntry[]): FileTreeNode {
  const root: FileTreeNode = {
    path: '',
    name: 'root',
    size: 0,
    isDir: true,
    children: [],
  };

  if (entries.length === 0) return root;

  for (const entry of entries) {
    if (entry.isDir) continue; // We'll build dirs from file paths

    // WR-06: Normalize backslash separators from Windows paths before splitting
    const normalized = entry.path.replace(/\\/g, '/');
    const segments = normalized.split('/');
    let current = root;

    // Traverse/create directory nodes
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      let child = current.children.find((c) => c.name === seg && c.isDir);
      if (!child) {
        child = {
          path: segments.slice(0, i + 1).join('/'),
          name: seg,
          size: 0,
          isDir: true,
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }

    // Add file node
    const fileName = segments[segments.length - 1];
    current.children.push({
      path: normalized,
      name: fileName,
      size: entry.size || 1,
      isDir: false,
      children: [],
    });
  }

  // Compute cumulative sizes bottom-up
  function computeSize(node: FileTreeNode): number {
    if (!node.isDir || node.children.length === 0) {
      return node.size || 1;
    }
    node.size = node.children.reduce((sum, c) => sum + computeSize(c), 0);
    return node.size;
  }
  computeSize(root);

  // Collapse single-child directory chains from the root so the treemap
  // doesn't waste real estate on empty wrapper boxes. Hits two cases:
  //   (a) Leading "" segment from a path beginning with "/" (defensive —
  //       the backend now strips repo_root, but this stays a no-op safety
  //       net if a future caller passes absolute paths).
  //   (b) Monorepo subtrees where every file lives under one intermediate
  //       directory (e.g. `packages/only-app/src/...`), collapsing them
  //       into a single visible root.
  // Stop at the first directory with >1 child, or at a file leaf. The
  // collapsed root inherits the deepest wrapper's children so the visible
  // layout starts at actual branching structure. Size stays correct
  // because computeSize already ran.
  while (root.isDir && root.children.length === 1 && root.children[0].isDir) {
    const only = root.children[0];
    root.children = only.children;
    root.name = only.name || root.name;
    root.path = only.path;
    root.size = only.size;
  }

  return root;
}

/**
 * Compute squarified treemap layout from nested FileTreeNode.
 * Returns a flat array of TreemapRect with coordinates relative to
 * the given width/height container.
 */
// Visible breathing room between adjacent sibling rects. Each rect is inset
// by SIBLING_GAP / 2 on every edge, so two neighbors end up SIBLING_GAP
// world-units apart. Kept small so deeper levels don't crush content; at
// zoom=1 this is 2 screen px, at zoom=5 it becomes 10 px, which is still
// readable. Sub-pixel culling in drawTreemap clamps tiny rects away.
const SIBLING_GAP = 2;
// Padding inside a directory before laying out its children (on top of
// the sibling inset). Leaves space for the directory label banner.
const DIR_PAD = 2;
const DIR_LABEL_HEIGHT = 12;

export function computeTreemapLayout(
  root: FileTreeNode,
  width: number,
  height: number,
): TreemapRect[] {
  const result: TreemapRect[] = [];

  if (root.children.length === 0) return result;

  function layoutChildren(
    node: FileTreeNode,
    container: { x0: number; y0: number; x1: number; y1: number },
    depth: number,
  ) {
    const children = node.children.filter((c) => c.size > 0);
    if (children.length === 0) return;

    const inputData = children.map((c) => ({
      value: c.size,
      _node: c,
    }));

    const rects = squarify(inputData, container);
    const half = SIBLING_GAP / 2;

    for (const rect of rects) {
      const childNode = (rect as unknown as { _node: FileTreeNode })._node;
      // Inset the raw squarify rect to create visible separation between
      // adjacent siblings. Clamp so tiny cells stay non-degenerate — the
      // sub-pixel cull in drawTreemap discards anything under 1 screen px.
      const ix0 = rect.x0 + half;
      const iy0 = rect.y0 + half;
      const ix1 = Math.max(rect.x1 - half, ix0 + 1);
      const iy1 = Math.max(rect.y1 - half, iy0 + 1);

      const tmRect: TreemapRect = {
        x0: ix0,
        y0: iy0,
        x1: ix1,
        y1: iy1,
        path: childNode.path,
        name: childNode.name,
        depth,
        isFile: !childNode.isDir,
        size: childNode.size,
      };
      result.push(tmRect);

      // Recurse into directories. Use the inset rect as the basis so
      // nested content stays within the visible parent bounds (otherwise
      // children would overlap the sibling gap).
      if (childNode.isDir && childNode.children.length > 0) {
        const innerContainer = {
          x0: ix0 + DIR_PAD,
          y0: iy0 + DIR_PAD + DIR_LABEL_HEIGHT,
          x1: Math.max(ix1 - DIR_PAD, ix0 + DIR_PAD + 1),
          y1: Math.max(iy1 - DIR_PAD, iy0 + DIR_PAD + DIR_LABEL_HEIGHT + 1),
        };
        if (innerContainer.x1 > innerContainer.x0 && innerContainer.y1 > innerContainer.y0) {
          layoutChildren(childNode, innerContainer, depth + 1);
        }
      }
    }
  }

  layoutChildren(root, { x0: 0, y0: 0, x1: width, y1: height }, 0);
  return result;
}

/**
 * React hook: memoized treemap layout computation.
 * Keyed on [entries, width, height] to prevent recomputation on re-renders.
 */
export function useTreemapLayout(
  entries: TreeIndexEntry[],
  width: number,
  height: number,
): TreemapRect[] {
  return useMemo(() => {
    if (entries.length === 0 || width <= 0 || height <= 0) return [];
    const tree = buildFileTree(entries);
    return computeTreemapLayout(tree, width, height);
  }, [entries, width, height]);
}
