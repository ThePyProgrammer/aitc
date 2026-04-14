// Phase 4 treemap layout hook.
//
// VIZN-01, VIZN-04: Squarified treemap computation with memoization.
// Converts flat TreeIndexEntry[] from backend into nested tree, then
// computes squarified rectangle layout for Canvas 2D rendering.
// Memoized via useMemo to prevent recomputation on every render (Pitfall 2).

import { useMemo } from 'react';
import * as squarifyMod from 'squarify';
// squarify ships CJS with both `exports.default` (the layout fn we want) and
// a lower-arity `exports.squarify` helper. Vite's interop can surface the
// module namespace instead of unwrapping default, so resolve it defensively.
const squarify = ((squarifyMod as { default?: typeof squarifyMod.default })
  .default ?? (squarifyMod as unknown as typeof squarifyMod.default));
import type { TreeIndexEntry } from '../stores/radarStore';

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
      const childNode = (rect as { _node: FileTreeNode })._node;
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
