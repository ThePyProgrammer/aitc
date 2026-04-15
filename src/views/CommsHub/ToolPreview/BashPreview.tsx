/**
 * Phase 8 Plan 05: BashPreview — three stacked sections:
 *   1. DESCRIPTION (omitted if input.description absent)
 *   2. COMMAND (shiki-highlighted bash block, 400px/2KB truncation)
 *   3. METADATA (CWD / TIMEOUT rows, omit missing)
 *
 * T-08-10 mitigation: shiki highlightLines escapes token content; raw
 * description text renders via React (auto-escaped); metadata values via
 * React children (auto-escaped).
 */
import { useState, useMemo } from 'react';
import type { ToolPreviewProps } from './registry';
import { useSyntaxHighlight, highlightLines } from '../../../hooks/useSyntaxHighlight';
import { parseToolInput } from './helpers';
import { ShowAllToggle } from './ShowAllToggle';

const MAX_BYTES = 2048;
const MAX_LINES = 40;

export function BashPreview({ toolInputJson, requestId }: ToolPreviewProps) {
  const input = parseToolInput(toolInputJson);
  const command = String(input?.command ?? '');
  const description = input?.description ? String(input.description) : null;
  const cwd = input?.cwd ? String(input.cwd) : null;
  const timeout = input?.timeout !== undefined && input?.timeout !== null ? input.timeout : null;

  const lineCount = command === '' ? 0 : command.split('\n').length;
  const exceeds = lineCount > MAX_LINES || new Blob([command]).size > MAX_BYTES;
  const [expanded, setExpanded] = useState(false);
  // Bash grammar is not preloaded by useSyntaxHighlight (only ts/js/rs/json/css/html/py).
  // Fall back to plain text rendering for Bash — auto-escaped via React children.
  const { highlighter } = useSyntaxHighlight();

  const lines = useMemo(() => {
    if (!highlighter || command === '') return null;
    try {
      return highlightLines(highlighter, command, 'text');
    } catch {
      return null;
    }
  }, [highlighter, command]);

  const bodyId = `toolpreview-bash-${requestId}`;
  const hasMetadata = cwd !== null || timeout !== null;

  return (
    <section className="flex flex-col" role="region" aria-label="Bash preview" data-tool-preview="bash">
      {description && (
        <div className="mb-6" data-bash-section="description">
          <div className="mb-[10px] font-headline text-sm font-bold uppercase tracking-widest">
            DESCRIPTION
          </div>
          <p className="font-body text-sm">{description}</p>
        </div>
      )}

      <div className="mb-6" data-bash-section="command">
        <div className="mb-[10px] font-headline text-sm font-bold uppercase tracking-widest">
          COMMAND
        </div>
        <div
          id={bodyId}
          className="bg-surface-container-lowest p-4 border border-outline-variant/15 overflow-auto font-mono text-xs leading-5"
          style={{ maxHeight: exceeds && !expanded ? '400px' : undefined }}
        >
          {lines
            ? lines.map((html, i) => (
                <div key={i} dangerouslySetInnerHTML={{ __html: html === '' ? '&nbsp;' : html }} />
              ))
            : command.split('\n').map((line, i) => (
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
      </div>

      {hasMetadata && (
        <div data-bash-section="metadata">
          <div className="mb-[10px] font-headline text-sm font-bold uppercase tracking-widest">
            METADATA
          </div>
          <dl className="grid grid-cols-[120px_1fr] gap-y-1">
            {cwd !== null && (
              <>
                <dt className="font-headline text-[10px] font-normal uppercase tracking-widest text-on-surface-variant">
                  CWD
                </dt>
                <dd className="font-mono text-xs font-bold truncate" title={cwd}>
                  {cwd}
                </dd>
              </>
            )}
            {timeout !== null && (
              <>
                <dt className="font-headline text-[10px] font-normal uppercase tracking-widest text-on-surface-variant">
                  TIMEOUT
                </dt>
                <dd className="font-mono text-xs font-bold">{String(timeout)}ms</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}
BashPreview.displayName = 'BashPreview';
