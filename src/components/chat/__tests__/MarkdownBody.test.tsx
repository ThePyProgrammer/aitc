// src/components/chat/__tests__/MarkdownBody.test.tsx
//
// Phase 19 Plan 03 — Wave 2 test suite for the MarkdownBody component.
// Replaces the Plan 01 `.todo` scaffold with 7 real assertions keyed 1:1
// to the V-19-13..V-19-19 validation rows:
//   V-19-13  **bold**             → <strong>
//   V-19-14  `- item` (GFM)       → <ul><li>
//   V-19-15  fenced ```typescript → highlightLines invoked with lang="typescript"
//   V-19-16  unknown lang         → does not crash
//   V-19-17  <script>             → stripped from DOM (rehype-sanitize)
//   V-19-18  @user mention        → wears text-secondary font-bold classes
//   V-19-19  unclosed fence       → does not throw (streaming tolerance)
//
// The useSyntaxHighlight singleton is mocked so CodeBlock's shiki path is
// deterministic and synchronous. highlightLines is exposed as a vi.fn spy
// so V-19-15 can assert call args.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const highlightLinesMock = vi.fn(
  (_h: unknown, source: string, lang: string) => [
    `<span data-stub-lang="${lang}">${source}</span>`,
  ],
);

vi.mock('../../../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: () => ({ highlighter: {}, isLoading: false }),
  highlightLines: (h: unknown, s: string, l: string) => highlightLinesMock(h, s, l),
}));

// Import AFTER the mock so MarkdownBody picks up the stubbed hook module.
import { MarkdownBody } from '../MarkdownBody';

beforeEach(() => {
  highlightLinesMock.mockClear();
});

describe('MarkdownBody (D-03 — V-19-13..19-19)', () => {
  // V-19-13
  it('renders **bold** as <strong>', () => {
    const { container } = render(<MarkdownBody content="**hello**" />);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('hello');
  });

  // V-19-14
  it('renders `- item` as <ul><li> (remark-gfm)', () => {
    const { container } = render(<MarkdownBody content={'- one\n- two'} />);
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('one');
    expect(items[1].textContent).toContain('two');
  });

  // V-19-15
  it('invokes highlightLines with lang="typescript" for a fenced typescript block', () => {
    render(
      <MarkdownBody content={'```typescript\nconst x = 1;\n```'} />,
    );
    const calls = highlightLinesMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const langs = calls.map((c) => c[2]);
    expect(langs).toContain('typescript');
  });

  // V-19-16
  it('renders unknown-language fenced block without crashing', () => {
    // The stub accepts any lang; this test proves the CodeBlock path
    // completes without throwing when an unknown grammar is requested.
    // Real shiki would throw on `esoteric`; the try/catch in CodeBlock
    // falls back to plain <pre><code> (Pitfall 5 — same defender serves
    // both unknown-lang and streaming-broken-fence).
    expect(() => {
      render(<MarkdownBody content={'```esoteric\nfoo bar\n```'} />);
    }).not.toThrow();
  });

  // V-19-17 — XSS mitigation (T-19-03-01)
  it('does NOT render <script> tags from assistant markdown (rehype-sanitize)', () => {
    // `<script>` is placed on its own block so react-markdown's default
    // HTML-block handling (allowDangerousHtml=false) treats it as a raw
    // HTML block and discards it; rehype-sanitize is belt-and-braces in
    // case a future upgrade or plugin re-enables raw HTML passthrough.
    // The "legitimate paragraph" survives as its own markdown block.
    const malicious = '<script>window.xss=1</script>\n\nlegitimate paragraph';
    const { container } = render(<MarkdownBody content={malicious} />);
    expect(container.querySelector('script')).toBeNull();
    // Ensure we didn't nuke the entire output — legitimate text survives.
    expect(container.textContent).toContain('legitimate paragraph');
  });

  // V-19-18 — Phase 10 D-23 @user styling preserved
  it('renders @user mention with text-secondary font-bold class', () => {
    render(<MarkdownBody content="please confirm @user thanks" />);
    const mention = screen.getByText('@user');
    expect(mention.tagName).toBe('SPAN');
    expect(mention.className).toContain('text-secondary');
    expect(mention.className).toContain('font-bold');
  });

  // V-19-19 — streaming tolerance (Pitfall 5 / T-19-03-03)
  it('does NOT throw when rendering partial fenced code (no closing ```)', () => {
    const partial = 'start\n```typescript\nconst x = 1';
    expect(() => {
      render(<MarkdownBody content={partial} streaming />);
    }).not.toThrow();
  });
});
