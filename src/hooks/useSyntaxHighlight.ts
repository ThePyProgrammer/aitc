/**
 * Shiki syntax highlighter singleton hook.
 *
 * Initializes a single Shiki highlighter instance with 7 language grammars
 * and the github-dark theme. Provides line-level token highlighting
 * (not full HTML wrapping) for use in the merge diff viewer.
 *
 * T-05-07 mitigation: Shiki HTML-escapes token content by default.
 * highlightLines produces spans from tokens, never raw HTML insertion.
 */
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import { useState, useEffect } from 'react';

type HighlighterCore = Awaited<ReturnType<typeof createHighlighterCore>>;

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [import('shiki/themes/github-dark.mjs')],
      langs: [
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/rust.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/css.mjs'),
        import('shiki/langs/html.mjs'),
        import('shiki/langs/python.mjs'),
      ],
    });
  }
  return highlighterPromise;
}

/**
 * React hook that provides the Shiki highlighter singleton.
 *
 * @returns `{ highlighter, isLoading }` - highlighter is null until ready
 */
export function useSyntaxHighlight(): {
  highlighter: HighlighterCore | null;
  isLoading: boolean;
} {
  const [highlighter, setHighlighter] = useState<HighlighterCore | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((hl) => {
      if (!cancelled) {
        setHighlighter(hl);
        setIsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { highlighter, isLoading };
}

/**
 * Highlight code into per-line HTML strings using Shiki tokens.
 *
 * Produces `<span>` elements with inline color styles. Does NOT wrap
 * in `<pre>` or `<code>` tags -- caller controls the container.
 *
 * @param highlighter - Initialized Shiki highlighter instance
 * @param code - Source code string
 * @param lang - Shiki language ID (e.g. 'typescript', 'rust')
 * @returns Array of HTML strings, one per line
 */
export function highlightLines(
  highlighter: HighlighterCore,
  code: string,
  lang: string,
): string[] {
  const result = highlighter.codeToTokens(code, { lang, theme: 'github-dark' });

  return result.tokens.map((line) =>
    line
      .map((token) => {
        const color = token.color ?? '#d4d4d4';
        // Shiki already HTML-escapes token content (T-05-07)
        const escaped = token.content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<span style="color: ${color}">${escaped}</span>`;
      })
      .join(''),
  );
}

const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.rs': 'rust',
  '.json': 'json',
  '.css': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.py': 'python',
};

/**
 * Detect Shiki language ID from a file path's extension.
 *
 * @param filePath - File path (e.g. 'src/main.ts')
 * @returns Shiki language ID or 'text' for unknown extensions
 */
export function detectLanguage(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return 'text';
  const ext = filePath.slice(lastDot).toLowerCase();
  return EXTENSION_MAP[ext] ?? 'text';
}
