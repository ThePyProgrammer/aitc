import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { GraphNode } from '../../../stores/radarStore';
import { CodePreviewOverlay, type CodePreviewCard } from '../CodePreviewOverlay';

// jsdom has no ResizeObserver — mirror the RadarCanvas component-test shim.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
    NoopResizeObserver;
}

const baseNode = (id: string, x: number, y: number): GraphNode => ({
  id,
  dirKey: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '',
  dirDepth: id.split('/').length - 1,
  x,
  y,
  kind: 'file',
});

function card(id: string, index: number, overrides: Partial<CodePreviewCard> = {}): CodePreviewCard {
  return {
    node: baseNode(id, 20 + index * 40, 30 + index * 30),
    signatures: [`export function fn${index}(): void`],
    exportedSymbols: [`fn${index}`],
    snippet: `export function fn${index}() {\n  return ${index};\n}`,
    ...overrides,
  };
}

const editSpy = vi.fn();

function renderOverlay(cards: CodePreviewCard[], containerWidth = 800, containerHeight = 600) {
  return render(
    <CodePreviewOverlay
      cards={cards}
      viewport={{ zoom: 4, panX: 0, panY: 0 }}
      containerRect={{
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: containerWidth,
        bottom: containerHeight,
        width: containerWidth,
        height: containerHeight,
        toJSON: () => ({}),
      } as DOMRect}
      onRepositoryEdit={editSpy}
    />,
  );
}

describe('CodePreviewOverlay — Phase 13 Wave 0', () => {
  it('caps rendered signature cards at 6 to satisfy T-13-04 and UI-SPEC line 189', () => {
    renderOverlay(Array.from({ length: 8 }, (_, i) => card(`src/file${i}.ts`, i)));
    expect(screen.getAllByTestId('code-preview-card')).toHaveLength(6);
  });

  it('renders fallback PATH_METADATA and SIGNATURES_UNAVAILABLE copy as JSX text', () => {
    renderOverlay([
      card('src/no-signatures.ts', 0, {
        signatures: [],
        exportedSymbols: [],
        snippet: undefined,
      }),
    ]);

    expect(screen.getByText('PATH_METADATA')).toBeTruthy();
    expect(
      screen.getByText('SIGNATURES_UNAVAILABLE — No signature data for this file yet. Showing path metadata instead.'),
    ).toBeTruthy();
    expect(screen.getByText('No exported symbols detected.')).toBeTruthy();
  });

  it('expands and collapses snippets with local state and no repository edit/write action', () => {
    renderOverlay([card('src/App.tsx', 0)]);

    fireEvent.click(screen.getByRole('button', { name: 'EXPAND_SNIPPET' }));
    expect(screen.getByText('COLLAPSE_SNIPPET')).toBeTruthy();
    expect(screen.getByText(/return 0;/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'COLLAPSE_SNIPPET' }));
    expect(screen.getByText('EXPAND_SNIPPET')).toBeTruthy();
    expect(editSpy).not.toHaveBeenCalled();
  });

  it('keeps 320px-wide cards within an 8px inset and max height 240px', () => {
    renderOverlay([card('src/edge.ts', 0, { node: baseNode('src/edge.ts', 790, 590) })], 800, 600);
    const preview = screen.getByTestId('code-preview-card');
    expect(preview).toHaveStyle({ width: '320px', maxHeight: '240px' });
    expect(Number.parseFloat(preview.style.left)).toBeLessThanOrEqual(800 - 320 - 8);
    expect(Number.parseFloat(preview.style.top)).toBeLessThanOrEqual(600 - 240 - 8);
    expect(Number.parseFloat(preview.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(preview.style.top)).toBeGreaterThanOrEqual(8);
  });
});
