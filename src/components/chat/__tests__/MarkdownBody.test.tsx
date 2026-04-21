// src/components/chat/__tests__/MarkdownBody.test.tsx
//
// Wave 0 scaffold (Phase 19 Plan 01) — MarkdownBody is implemented in Plan 03.
// All assertions land as `it.todo` placeholders so the file compiles + runs
// cleanly now (7 .todo entries, vitest reports them as skipped / exit 0) and
// Plan 03's implementer flips `.todo` → real `it(…)` bodies without touching
// the suite's structure, mock shape, or file path.
//
// The `vi.mock('../../../hooks/useSyntaxHighlight', …)` block is intentionally
// wired today so Plan 03 can consume it immediately: the custom `code`
// renderer inside react-markdown will call `useSyntaxHighlight()` + feed
// `highlightLines(highlighter, src, lang)` through the singleton; the stub
// returns a deterministic span so tests can assert the code-block path
// without the shiki singleton's async warm-up.
import { describe, it, vi } from 'vitest';

// Mock the Phase 5 shiki singleton — Plan 03 MarkdownBody will consume it
// via a custom `code` renderer inside react-markdown. The stub returns a
// deterministic 'STUB' span so tests can assert the code-block path without
// the shiki singleton's async warm-up.
vi.mock('../../../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: () => ({ highlighter: {}, isLoading: false }),
  highlightLines: (_h: unknown, source: string, lang: string) => [
    `<span data-stub-lang="${lang}">${source}</span>`,
  ],
}));

describe('MarkdownBody (Plan 03 target)', () => {
  // V-19-13: **bold** → <strong>
  it.todo('renders **bold** as <strong>');

  // V-19-14: - item → <ul><li> (GFM)
  it.todo('renders `- item` as <ul><li> (GFM)');

  // V-19-15: fenced ```typescript``` invokes highlightLines with lang="typescript"
  it.todo('invokes highlightLines with lang="typescript" for a fenced typescript block');

  // V-19-16: unknown language renders as plain <pre><code>
  it.todo('renders unknown-language fenced block as plain <pre><code> without crash');

  // V-19-17: <script> does NOT end up in rendered DOM (XSS mitigation, T-19-01)
  it.todo('strips <script> from rendered DOM via rehype-sanitize');

  // V-19-18: @user mention preserves `text-secondary font-bold` classes
  it.todo('preserves @user mention styling inside markdown body');

  // V-19-19: broken fenced code does NOT throw (streaming tolerance)
  it.todo('does NOT throw when rendering partial fenced code (no closing ```)');
});
