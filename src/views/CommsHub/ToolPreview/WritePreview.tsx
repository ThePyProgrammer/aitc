/**
 * Phase 8 Plan 05: WritePreview — syntax-highlighted code block for the
 * `Write` tool. Language inferred from file_path extension via inferLanguage.
 * Truncates at 400px height / 2KB bytes; ShowAllToggle appears when either
 * limit is exceeded (D-16).
 *
 * T-08-10 mitigation: content rendered via highlightLines → shiki-produced
 * `<span style="color:...">` strings. Shiki HTML-escapes token content
 * internally; we route the per-line strings through dangerouslySetInnerHTML
 * only because the strings themselves are shiki output (same pattern as
 * Phase 5 UnifiedDiff). No raw tool_input content ever hits the DOM
 * un-escaped.
 */
import { useState, useMemo } from 'react';
import type { ToolPreviewProps } from './registry';
import { useSyntaxHighlight, highlightLines } from '../../../hooks/useSyntaxHighlight';
import { parseToolInput, inferLanguage } from './helpers';
import { ShowAllToggle } from './ShowAllToggle';

const MAX_BYTES = 2048;
const MAX_LINES = 40;

export function WritePreview({ toolInputJson, filePath, requestId }: ToolPreviewProps) {
  const input = parseToolInput(toolInputJson);
  const content = String(input?.content ?? '');
  const lang = inferLanguage(filePath);
  const lineCount = content === '' ? 0 : content.split('\n').length;
  const byteLen = new Blob([content]).size;
  const exceeds = lineCount > MAX_LINES || byteLen > MAX_BYTES;

  const [expanded, setExpanded] = useState(false);
  const { highlighter } = useSyntaxHighlight();

  const lines = useMemo(() => {
    if (!highlighter || content === '') return null;
    try {
      return highlightLines(highlighter, content, lang);
    } catch {
      return null;
    }
  }, [highlighter, content, lang]);

  const bodyId = `toolpreview-write-${requestId}`;

  return (
    <section role="region" aria-label={`Write preview for ${filePath ?? 'file'}`} data-tool-preview="write">
      <div className="flex items-center justify-between mb-2">
        <span className="font-headline text-sm font-bold uppercase tracking-widest">CREATE</span>
        <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
          {lang.toUpperCase()}
        </span>
      </div>
      <div
        id={bodyId}
        data-language={lang}
        className="bg-surface-container-lowest p-4 border border-outline-variant/15 overflow-auto font-mono text-xs leading-5"
        style={{ maxHeight: exceeds && !expanded ? '400px' : undefined }}
      >
        {lines
          ? lines.map((html, i) => (
              <div key={i} dangerouslySetInnerHTML={{ __html: html === '' ? '&nbsp;' : html }} />
            ))
          : // Fallback: render the raw content with React (auto-escaped) while
            // the shiki highlighter warms up or if highlighting fails.
            content.split('\n').map((line, i) => (
              <div key={i}>{line === '' ? '\u00a0' : line}</div>
            ))}
      </div>
      {exceeds && (
        <ShowAllToggle
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          controlsId={bodyId}
        />
      )}
    </section>
  );
}
WritePreview.displayName = 'WritePreview';
