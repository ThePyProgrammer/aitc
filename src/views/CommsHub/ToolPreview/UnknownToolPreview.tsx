/**
 * Phase 8 Plan 05: UnknownToolPreview — fallback for `mcp__*` tools and any
 * unrecognized tool_name. Renders tool_input as pretty-printed JSON inside
 * a shiki-highlighted code block with an `UNVERIFIED_TOOL` banner.
 *
 * T-08-10 mitigation: shiki escapes token content; banner is static text.
 */
import { useMemo } from 'react';
import type { ToolPreviewProps } from './registry';
import { useSyntaxHighlight, highlightLines } from '../../../hooks/useSyntaxHighlight';
import { parseToolInput } from './helpers';

export function UnknownToolPreview({ toolInputJson, requestId }: ToolPreviewProps) {
  const input = parseToolInput(toolInputJson) ?? {};
  const pretty = useMemo(() => JSON.stringify(input, null, 2), [input]);
  const { highlighter } = useSyntaxHighlight();

  const lines = useMemo(() => {
    if (!highlighter) return null;
    try {
      return highlightLines(highlighter, pretty, 'json');
    } catch {
      return null;
    }
  }, [highlighter, pretty]);

  const bodyId = `toolpreview-unknown-${requestId}`;

  return (
    <section role="region" aria-label="Unverified tool raw input" data-tool-preview="unknown">
      <p className="mb-2 font-headline text-[10px] uppercase tracking-widest text-tertiary">
        UNVERIFIED_TOOL — AITC has no renderer for this tool; raw input shown below.
      </p>
      <div
        id={bodyId}
        className="bg-surface-container-lowest p-4 border border-outline-variant/15 overflow-auto font-mono text-xs leading-5"
      >
        {lines
          ? lines.map((html, i) => (
              <div key={i} dangerouslySetInnerHTML={{ __html: html === '' ? '&nbsp;' : html }} />
            ))
          : pretty.split('\n').map((line, i) => (
              <div key={i}>{line === '' ? '\u00a0' : line}</div>
            ))}
      </div>
    </section>
  );
}
UnknownToolPreview.displayName = 'UnknownToolPreview';
