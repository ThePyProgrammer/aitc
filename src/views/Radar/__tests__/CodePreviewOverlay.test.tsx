import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GraphNode, Viewport } from '../../../stores/radarStore';
import {
  CodePreviewOverlay,
  MAX_CODE_PREVIEW_CARDS,
  selectFocusedCodePreviewNodes,
} from '../CodePreviewOverlay';

const viewport: Viewport = { zoom: 4, panX: 400, panY: 300 };

function node(id: string, x: number, y: number, signatures?: string[]): GraphNode {
  return {
    id,
    dirKey: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '',
    dirDepth: id.includes('/') ? id.split('/').length - 1 : 0,
    kind: 'file',
    x,
    y,
    signatures,
    signatureSource: signatures ? 'tree_sitter' : undefined,
  };
}

describe('selectFocusedCodePreviewNodes', () => {
  it('prioritizes hovered, selected, active-agent, and center-near files while capping cards at 6', () => {
    const nodes = [
      node('near-1.ts', 0, 0),
      node('hovered.ts', 300, 0),
      node('selected.ts', -300, 0),
      node('active-a.ts', 280, 80),
      node('active-b.ts', -280, -80),
      node('near-2.ts', 20, 0),
      node('near-3.ts', -20, 0),
      node('near-4.ts', 0, 20),
      node('near-5.ts', 0, -20),
    ];

    const selected = selectFocusedCodePreviewNodes({
      nodes,
      viewport,
      canvasWidth: 800,
      canvasHeight: 600,
      hoveredNodeId: 'hovered.ts',
      selectedNodeId: 'selected.ts',
      activeAgentFileIds: ['active-a.ts', 'active-b.ts'],
    });

    expect(MAX_CODE_PREVIEW_CARDS).toBe(6);
    expect(selected).toHaveLength(6);
    expect(selected.map((n) => n.id).slice(0, 4)).toEqual([
      'hovered.ts',
      'selected.ts',
      'active-a.ts',
      'active-b.ts',
    ]);
  });
});

describe('CodePreviewOverlay', () => {
  it('renders signature cards as JSX text and caps visible cards at 6', () => {
    const nodes = Array.from({ length: 8 }, (_, i) =>
      node(`src/f${i}.ts`, i * 4, 0, [`export function f${i}(): string`]),
    );

    render(
      <CodePreviewOverlay
        nodes={nodes}
        viewport={viewport}
        canvasWidth={800}
        canvasHeight={600}
        hoveredNodeId={null}
        selectedNodeId={null}
        activeAgentFileIds={[]}
      />,
    );

    expect(screen.getAllByTestId('code-preview-card')).toHaveLength(6);
    expect(screen.getByText('export function f0(): string')).toBeTruthy();
  });

  it('renders exact fallback copy when signatures are unavailable', () => {
    render(
      <CodePreviewOverlay
        nodes={[node('src/no-symbols.ts', 0, 0)]}
        viewport={viewport}
        canvasWidth={800}
        canvasHeight={600}
        hoveredNodeId="src/no-symbols.ts"
        selectedNodeId={null}
        activeAgentFileIds={[]}
      />,
    );

    expect(screen.getByText('PATH_METADATA')).toBeTruthy();
    expect(
      screen.getByText(
        'SIGNATURES_UNAVAILABLE — No signature data for this file yet. Showing path metadata instead.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('No exported symbols detected.')).toBeTruthy();
  });

  it('expands snippets with EXPAND_SNIPPET, caps at 12 lines, and collapses with COLLAPSE_SNIPPET', async () => {
    const onRequestSnippet = vi.fn(async () => ({
      startLine: 10,
      lines: Array.from({ length: 20 }, (_, i) => `line ${i + 1} <script>`),
    }));

    render(
      <CodePreviewOverlay
        nodes={[node('src/snippet.ts', 0, 0, ['export const snippet = true'])]}
        viewport={viewport}
        canvasWidth={800}
        canvasHeight={600}
        hoveredNodeId="src/snippet.ts"
        selectedNodeId={null}
        activeAgentFileIds={[]}
        onRequestSnippet={onRequestSnippet}
      />,
    );

    fireEvent.click(screen.getByText('EXPAND_SNIPPET'));

    await waitFor(() => expect(onRequestSnippet).toHaveBeenCalledWith('src/snippet.ts'));
    expect(await screen.findByText('10')).toBeTruthy();
    expect(screen.getByText('line 1 <script>')).toBeTruthy();
    expect(screen.getByText('line 12 <script>')).toBeTruthy();
    expect(screen.queryByText('line 13 <script>')).toBeNull();

    fireEvent.click(screen.getByText('COLLAPSE_SNIPPET'));
    expect(screen.queryByText('line 1 <script>')).toBeNull();
  });

  it('keeps 320px-wide cards within an 8px inset and max height 240px', () => {
    render(
      <CodePreviewOverlay
        nodes={[node('src/edge.ts', 500, 500, ['export class Edge {}'])]}
        viewport={{ zoom: 4, panX: 400, panY: 300 }}
        canvasWidth={800}
        canvasHeight={600}
        hoveredNodeId="src/edge.ts"
        selectedNodeId={null}
        activeAgentFileIds={[]}
      />,
    );

    const card = screen.getByTestId('code-preview-card');
    expect(card).toHaveStyle({ width: '320px', maxHeight: '240px' });
    expect(Number.parseFloat(card.style.left)).toBeLessThanOrEqual(800 - 320 - 8);
    expect(Number.parseFloat(card.style.top)).toBeLessThanOrEqual(600 - 240 - 8);
    expect(Number.parseFloat(card.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(card.style.top)).toBeGreaterThanOrEqual(8);
  });
});
