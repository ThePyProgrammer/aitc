import { useEffect, useMemo, useState } from 'react';
import type { GraphNode, Viewport } from '../../stores/radarStore';

export const MAX_CODE_PREVIEW_CARDS = 6;
const CARD_WIDTH = 320;
const CARD_MAX_HEIGHT = 240;
const CARD_INSET = 8;
const LEADER_OFFSET = 16;
const CENTER_FOCUS_RADIUS_PX = 160;
const MAX_SNIPPET_LINES = 12;

export interface SourceSnippetPreview {
  lines: string[];
  startLine: number;
}

export interface CodePreviewOverlayProps {
  nodes: GraphNode[];
  viewport: Viewport;
  canvasWidth: number;
  canvasHeight: number;
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  activeAgentFileIds: string[];
  expandedNodeIds?: Set<string>;
  onExpandedChange?: (ids: Set<string>) => void;
  onRequestSnippet?: (repoRelativePath: string) => Promise<SourceSnippetPreview>;
}

export interface SelectFocusedCodePreviewNodesInput {
  nodes: GraphNode[];
  viewport: Viewport;
  canvasWidth: number;
  canvasHeight: number;
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  activeAgentFileIds: string[];
}

interface CardPosition {
  anchorX: number;
  anchorY: number;
  left: number;
  top: number;
}

function toScreen(node: GraphNode, viewport: Viewport): { x: number; y: number } | null {
  if (node.x === undefined || node.y === undefined) return null;
  return {
    x: node.x * viewport.zoom + viewport.panX,
    y: node.y * viewport.zoom + viewport.panY,
  };
}

function isFileNode(node: GraphNode): boolean {
  return node.kind !== 'bridge' && node.x !== undefined && node.y !== undefined;
}

function addUnique(target: GraphNode[], seen: Set<string>, node: GraphNode | undefined): void {
  if (!node || seen.has(node.id) || !isFileNode(node)) return;
  seen.add(node.id);
  target.push(node);
}

export function selectFocusedCodePreviewNodes({
  nodes,
  viewport,
  canvasWidth,
  canvasHeight,
  hoveredNodeId,
  selectedNodeId,
  activeAgentFileIds,
}: SelectFocusedCodePreviewNodesInput): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const selected: GraphNode[] = [];
  const seen = new Set<string>();

  addUnique(selected, seen, hoveredNodeId ? byId.get(hoveredNodeId) : undefined);
  addUnique(selected, seen, selectedNodeId ? byId.get(selectedNodeId) : undefined);
  for (const id of activeAgentFileIds) {
    addUnique(selected, seen, byId.get(id));
  }

  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const nearCenter = nodes
    .filter((n) => isFileNode(n) && !seen.has(n.id))
    .map((n) => {
      const screen = toScreen(n, viewport);
      if (!screen) return null;
      const dist = Math.hypot(screen.x - centerX, screen.y - centerY);
      return { node: n, dist };
    })
    .filter((entry): entry is { node: GraphNode; dist: number } =>
      entry !== null && entry.dist <= CENTER_FOCUS_RADIUS_PX,
    )
    .sort((a, b) => a.dist - b.dist);

  for (const entry of nearCenter) {
    addUnique(selected, seen, entry.node);
    if (selected.length >= MAX_CODE_PREVIEW_CARDS) break;
  }

  return selected.slice(0, MAX_CODE_PREVIEW_CARDS);
}

function cardPosition(node: GraphNode, viewport: Viewport, canvasWidth: number, canvasHeight: number): CardPosition | null {
  const screen = toScreen(node, viewport);
  if (!screen) return null;
  const maxLeft = Math.max(CARD_INSET, canvasWidth - CARD_WIDTH - CARD_INSET);
  const maxTop = Math.max(CARD_INSET, canvasHeight - CARD_MAX_HEIGHT - CARD_INSET);
  const preferredLeft = screen.x + LEADER_OFFSET;
  const preferredTop = screen.y - LEADER_OFFSET;
  const left = Math.max(CARD_INSET, Math.min(maxLeft, preferredLeft));
  const top = Math.max(CARD_INSET, Math.min(maxTop, preferredTop));
  return { anchorX: screen.x, anchorY: screen.y, left, top };
}

function basename(path: string): string {
  return path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
}

function signatureRows(node: GraphNode): string[] {
  return Array.isArray(node.signatures)
    ? node.signatures.filter((s) => s.trim().length > 0)
    : [];
}

export function CodePreviewOverlay({
  nodes,
  viewport,
  canvasWidth,
  canvasHeight,
  hoveredNodeId,
  selectedNodeId,
  activeAgentFileIds,
  expandedNodeIds,
  onExpandedChange,
  onRequestSnippet,
}: CodePreviewOverlayProps) {
  const [localExpandedIds, setLocalExpandedIds] = useState<Set<string>>(new Set());
  const [snippets, setSnippets] = useState<Map<string, SourceSnippetPreview>>(new Map());
  const [snippetErrors, setSnippetErrors] = useState<Set<string>>(new Set());
  const expandedIds = expandedNodeIds ?? localExpandedIds;

  const focusedNodes = useMemo(
    () =>
      selectFocusedCodePreviewNodes({
        nodes,
        viewport,
        canvasWidth,
        canvasHeight,
        hoveredNodeId,
        selectedNodeId,
        activeAgentFileIds,
      }),
    [nodes, viewport, canvasWidth, canvasHeight, hoveredNodeId, selectedNodeId, activeAgentFileIds],
  );

  const updateExpanded = (updater: (current: Set<string>) => Set<string>) => {
    const next = updater(expandedIds);
    if (onExpandedChange) onExpandedChange(next);
    if (!expandedNodeIds) setLocalExpandedIds(next);
  };

  const collapse = (id: string) => {
    updateExpanded((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const expand = (id: string) => {
    updateExpanded((current) => new Set(current).add(id));
  };

  useEffect(() => {
    let cancelled = false;
    for (const id of expandedIds) {
      if (!onRequestSnippet || snippets.has(id) || snippetErrors.has(id)) continue;
      onRequestSnippet(id)
        .then((snippet) => {
          if (cancelled) return;
          setSnippets((current) => new Map(current).set(id, snippet));
        })
        .catch(() => {
          if (cancelled) return;
          setSnippetErrors((current) => new Set(current).add(id));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [expandedIds, onRequestSnippet, snippets, snippetErrors]);

  if (focusedNodes.length === 0) return null;

  return (
    <div className="absolute inset-0 z-40 pointer-events-none" data-testid="code-preview-overlay">
      {focusedNodes.map((node) => {
        const pos = cardPosition(node, viewport, canvasWidth, canvasHeight);
        if (!pos) return null;
        const rows = signatureRows(node);
        const hasSignatures = rows.length > 0;
        const isExpanded = expandedIds.has(node.id);
        const snippet = snippets.get(node.id);
        const snippetFailed = snippetErrors.has(node.id);
        const shownLines = snippet?.lines.slice(0, MAX_SNIPPET_LINES) ?? [];

        return (
          <div key={node.id}>
            <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
              <line
                x1={pos.anchorX}
                y1={pos.anchorY}
                x2={pos.left}
                y2={pos.top + 16}
                stroke="rgba(0, 207, 252, 0.45)"
                strokeWidth="1"
              />
            </svg>
            <section
              data-testid="code-preview-card"
              className="absolute pointer-events-auto overflow-auto border border-outline-variant/15 bg-surface-container-high/90 p-4 font-mono text-[10px] text-on-surface-variant shadow-lg"
              style={{
                left: `${pos.left}px`,
                top: `${pos.top}px`,
                width: `${CARD_WIDTH}px`,
                maxHeight: `${CARD_MAX_HEIGHT}px`,
                backgroundColor: 'rgba(38, 38, 38, 0.9)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
              }}
            >
              <div className="text-[14px] font-semibold leading-[1.2] text-on-surface truncate">
                {hasSignatures ? basename(node.id) : 'PATH_METADATA'}
              </div>
              <div className="mt-1 truncate text-[10px] leading-[1.2]" style={{ color: '#00cffc' }}>
                {node.id}
              </div>
              {!hasSignatures && (
                <div className="mt-2 text-[10px] leading-[1.2] text-error">
                  SIGNATURES_UNAVAILABLE — No signature data for this file yet. Showing path metadata instead.
                </div>
              )}
              <div className="mt-2 space-y-1">
                {hasSignatures ? (
                  rows.map((signature, index) => (
                    <div key={`${node.id}-sig-${index}`} className="break-words text-[10px] leading-[1.2] text-on-surface">
                      {signature}
                    </div>
                  ))
                ) : (
                  <div className="text-[10px] leading-[1.2] text-on-surface">
                    No exported symbols detected.
                  </div>
                )}
              </div>
              {snippetFailed && (
                <div className="mt-2 text-[10px] leading-[1.2] text-error">
                  SIGNATURES_UNAVAILABLE — No signature data for this file yet. Showing path metadata instead.
                </div>
              )}
              {isExpanded && shownLines.length > 0 && (
                <pre className="mt-3 overflow-x-auto border-t border-outline-variant/15 pt-2 text-[14px] leading-[1.5] text-on-surface">
                  {shownLines.map((line, index) => (
                    <div key={`${node.id}-line-${index}`} className="flex gap-3">
                      <span className="select-none text-on-surface-variant/60">
                        {snippet!.startLine + index}
                      </span>
                      <code className="whitespace-pre-wrap">{line}</code>
                    </div>
                  ))}
                </pre>
              )}
              <button
                type="button"
                className="mt-3 px-2 py-1 font-headline text-[10px] font-semibold uppercase tracking-widest text-primary hover:bg-primary/10"
                onClick={() => (isExpanded ? collapse(node.id) : expand(node.id))}
              >
                {isExpanded ? 'COLLAPSE_SNIPPET' : 'EXPAND_SNIPPET'}
              </button>
            </section>
          </div>
        );
      })}
    </div>
  );
}
