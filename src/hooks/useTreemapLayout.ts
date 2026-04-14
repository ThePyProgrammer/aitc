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
import type { TreeIndexEntry } from '../stores/radarStore';

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

  return root;
}

/**
 * Compute squarified treemap layout from nested FileTreeNode.
 * Returns a flat array of TreemapRect with coordinates relative to
 * the given width/height container.
 */
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

    for (const rect of rects) {
      const childNode = (rect as unknown as { _node: FileTreeNode })._node;
      const tmRect: TreemapRect = {
        x0: rect.x0,
        y0: rect.y0,
        x1: rect.x1,
        y1: rect.y1,
        path: childNode.path,
        name: childNode.name,
        depth,
        isFile: !childNode.isDir,
        size: childNode.size,
      };
      result.push(tmRect);

      // Recurse into directories
      if (childNode.isDir && childNode.children.length > 0) {
        // Pad slightly for nested directories
        const pad = 2;
        const innerContainer = {
          x0: rect.x0 + pad,
          y0: rect.y0 + pad + 12, // extra space for directory label
          x1: Math.max(rect.x1 - pad, rect.x0 + pad + 1),
          y1: Math.max(rect.y1 - pad, rect.y0 + pad + 13),
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
 * Keyed on [treeData, width, height] to prevent recomputation on re-renders.
 */
export function useTreemapLayout(
  treeData: TreeIndexEntry[],
  width: number,
  height: number,
): TreemapRect[] {
  return useMemo(() => {
    if (treeData.length === 0 || width <= 0 || height <= 0) return [];
    const tree = buildFileTree(treeData);
    return computeTreemapLayout(tree, width, height);
  }, [treeData, width, height]);
}
