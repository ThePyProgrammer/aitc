/**
 * Phase 8 Plan 05: NotebookPreview — like WritePreview but header reads
 * `NOTEBOOK_EDIT` + `CELL {NN}` (from input.cell_id or cell_index), and
 * content is `input.new_source`. Claude notebooks default to python.
 */
import { useState, useMemo } from 'react';
import type { ToolPreviewProps } from './registry';
import { useSyntaxHighlight, highlightLines } from '../../../hooks/useSyntaxHighlight';
import { parseToolInput } from './helpers';
import { ShowAllToggle } from './ShowAllToggle';

const MAX_BYTES = 2048;
const MAX_LINES = 40;

export function NotebookPreview({ toolInputJson, filePath, requestId }: ToolPreviewProps) {
  const input = parseToolInput(toolInputJson);
  const content = String(input?.new_source ?? '');
  const cellId = input?.cell_id ?? input?.cell_index ?? '?';
  const cellType = input?.cell_type === 'markdown' ? 'markdown' : 'python';
  const lang = cellType === 'markdown' ? 'text' : 'python';

  const lineCount = content === '' ? 0 : content.split('\n').length;
  const exceeds = lineCount > MAX_LINES || new Blob([content]).size > MAX_BYTES;
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

  const bodyId = `toolpreview-notebook-${requestId}`;
  const cellLabel = `CELL ${String(cellId).padStart(2, '0')}`;

  return (
    <section
      role="region"
      aria-label={`Notebook preview for ${filePath ?? 'notebook'} ${cellLabel}`}
      data-tool-preview="notebook"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="font-headline text-sm font-bold uppercase tracking-widest">
            NOTEBOOK_EDIT
          </span>
          <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
            {cellLabel}
          </span>
        </div>
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
          : content.split('\n').map((line, i) => (
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
NotebookPreview.displayName = 'NotebookPreview';
