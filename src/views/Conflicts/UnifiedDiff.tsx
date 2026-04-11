/**
 * Virtualized unified diff renderer with syntax highlighting.
 *
 * Renders clean hunks with syntax-highlighted lines and conflict hunks
 * with Agent A (green) / Agent B (blue) backgrounds plus inline
 * resolution controls. Phase 5 Plan 03 -- D-01 implementation.
 *
 * T-05-09 mitigation: Lines are rendered via highlightLines which produces
 * span elements from Shiki tokens. Never inserts raw file content via
 * dangerouslySetInnerHTML on unprocessed user input -- all content passes
 * through Shiki's HTML-escaping pipeline first.
 */
import { useState, useMemo, useCallback, type RefObject } from 'react';
import { useSyntaxHighlight, highlightLines, detectLanguage } from '../../hooks/useSyntaxHighlight';
import type { MergeHunk } from '../../lib/merge';
import { HunkResolutionControls } from './HunkResolutionControls';

interface UnifiedDiffProps {
  hunks: MergeHunk[];
  resolutions: Map<number, 'a' | 'b' | 'custom'>;
  customEdits: Map<number, string>;
  filePath: string;
  onResolveHunk: (index: number, choice: 'a' | 'b' | 'custom', custom?: string) => void;
  hunkRefs: RefObject<Map<number, HTMLDivElement>>;
}

interface EditingState {
  hunkIndex: number;
  content: string;
}

export function UnifiedDiff({
  hunks,
  resolutions,
  customEdits,
  filePath,
  onResolveHunk,
  hunkRefs,
}: UnifiedDiffProps) {
  const { highlighter, isLoading } = useSyntaxHighlight();
  const [editing, setEditing] = useState<EditingState | null>(null);

  const lang = useMemo(() => detectLanguage(filePath), [filePath]);

  // Pre-compute highlighted lines for all hunks
  const highlightedHunks = useMemo(() => {
    if (!highlighter) return null;

    return hunks.map((hunk) => {
      if (hunk.type === 'clean') {
        return {
          type: 'clean' as const,
          lines: highlightLines(highlighter, hunk.aLines.join('\n'), lang),
        };
      }
      return {
        type: 'conflict' as const,
        aLines: highlightLines(highlighter, hunk.aLines.join('\n'), lang),
        bLines: highlightLines(highlighter, hunk.bLines.join('\n'), lang),
      };
    });
  }, [highlighter, hunks, lang]);

  const handleResolve = useCallback(
    (hunkIndex: number, choice: 'a' | 'b' | 'custom', custom?: string) => {
      if (choice === 'custom') {
        // Enter edit mode with combined content as starting point
        const hunk = hunks.find((h) => h.index === hunkIndex);
        const initialContent = customEdits.get(hunkIndex) ?? hunk?.aLines.join('\n') ?? '';
        setEditing({ hunkIndex, content: initialContent });
      } else {
        onResolveHunk(hunkIndex, choice, custom);
      }
    },
    [hunks, customEdits, onResolveHunk],
  );

  const handleSaveEdit = useCallback(
    (hunkIndex: number) => {
      if (editing && editing.hunkIndex === hunkIndex) {
        onResolveHunk(hunkIndex, 'custom', editing.content);
        setEditing(null);
      }
    },
    [editing, onResolveHunk],
  );

  const handleCancelEdit = useCallback(() => {
    setEditing(null);
  }, []);

  if (isLoading || !highlightedHunks) {
    return (
      <div className="flex-1 bg-surface-container overflow-y-auto flex items-center justify-center">
        <span className="font-mono text-xs text-on-surface-variant/40 animate-pulse">
          Loading syntax highlighter...
        </span>
      </div>
    );
  }

  // Build a running line number across all hunks
  let globalLine = 1;

  return (
    <div className="flex-1 bg-surface-container overflow-y-auto">
      {hunks.map((hunk, hunkIdx) => {
        const highlighted = highlightedHunks[hunkIdx];
        const isConflict = hunk.type === 'conflict';
        const isResolved = isConflict && resolutions.has(hunk.index);
        const resolution = resolutions.get(hunk.index);
        const isEditing = editing?.hunkIndex === hunk.index;

        if (!isConflict) {
          // Clean hunk -- render lines with line numbers
          const lines = highlighted.type === 'clean' ? highlighted.lines : [];
          const startLine = globalLine;
          globalLine += lines.length;

          return (
            <div key={`clean-${hunkIdx}`} className="font-mono text-[13px] leading-[20px]">
              {lines.map((lineHtml, i) => (
                <div key={`${startLine + i}`} className="flex">
                  <span className="w-12 text-right pr-2 text-on-surface-variant/40 text-xs select-none shrink-0 leading-[20px]">
                    {startLine + i}
                  </span>
                  <span
                    className="flex-1 px-2 whitespace-pre"
                    dangerouslySetInnerHTML={{ __html: lineHtml }}
                  />
                </div>
              ))}
            </div>
          );
        }

        // Conflict hunk
        const aLines = highlighted.type === 'conflict' ? highlighted.aLines : [];
        const bLines = highlighted.type === 'conflict' ? highlighted.bLines : [];
        const startLine = globalLine;
        globalLine += Math.max(aLines.length, bLines.length);

        // Determine resolved lines to show
        let resolvedLines: string[] | null = null;
        if (isResolved && resolution === 'a') {
          resolvedLines = aLines;
        } else if (isResolved && resolution === 'b') {
          resolvedLines = bLines;
        } else if (isResolved && resolution === 'custom') {
          const customContent = customEdits.get(hunk.index) ?? '';
          resolvedLines = highlighter
            ? highlightLines(highlighter, customContent, lang)
            : customContent.split('\n');
        }

        return (
          <div
            key={`conflict-${hunk.index}`}
            ref={(el) => {
              if (el && hunkRefs.current) {
                hunkRefs.current.set(hunk.index, el);
              }
            }}
            className="border-y border-outline-variant/10"
          >
            {isResolved && resolvedLines ? (
              // Resolved state: show resolved lines with muted green background
              <div className="font-mono text-[13px] leading-[20px] bg-primary/5">
                {resolvedLines.map((lineHtml, i) => (
                  <div key={`resolved-${startLine + i}`} className="flex">
                    <span className="w-12 text-right pr-2 text-on-surface-variant/40 text-xs select-none shrink-0 leading-[20px]">
                      {startLine + i}
                    </span>
                    <span
                      className="flex-1 px-2 whitespace-pre"
                      dangerouslySetInnerHTML={{ __html: lineHtml }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* Agent A lines */}
                <div className="font-mono text-[13px] leading-[20px] bg-[rgba(142,255,113,0.1)] border-l-2 border-primary">
                  {aLines.map((lineHtml, i) => (
                    <div key={`a-${startLine + i}`} className="flex">
                      <span className="w-12 text-right pr-2 text-on-surface-variant/40 text-xs select-none shrink-0 leading-[20px]">
                        {startLine + i}
                      </span>
                      <span
                        className="flex-1 px-2 whitespace-pre"
                        dangerouslySetInnerHTML={{ __html: lineHtml }}
                      />
                    </div>
                  ))}
                </div>

                {/* Resolution controls or edit area */}
                {isEditing ? (
                  <div className="bg-surface-container-high p-2">
                    <textarea
                      value={editing?.content ?? ''}
                      onChange={(e) =>
                        setEditing((prev) =>
                          prev ? { ...prev, content: e.target.value } : null,
                        )
                      }
                      className="w-full bg-surface text-on-surface font-mono text-[13px] leading-[20px] p-2 border border-outline-variant/20 resize-y min-h-[60px] focus:outline focus:outline-2 focus:outline-primary"
                      aria-label={`Custom edit for hunk ${hunk.index + 1}`}
                    />
                    <div className="flex gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(hunk.index)}
                        className="px-3 py-1 bg-primary text-on-primary font-headline text-xs font-bold uppercase tracking-widest hover:shadow-[0_0_10px_rgba(142,255,113,0.4)] transition-all duration-150"
                      >
                        SAVE
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-3 py-1 text-on-surface-variant font-headline text-xs font-bold uppercase tracking-widest hover:bg-surface-container transition-colors duration-150"
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                ) : (
                  <HunkResolutionControls
                    hunkIndex={hunk.index}
                    onResolve={(choice, custom) => handleResolve(hunk.index, choice, custom)}
                  />
                )}

                {/* Agent B lines */}
                <div className="font-mono text-[13px] leading-[20px] bg-[rgba(0,207,252,0.1)] border-l-2 border-[#00cffc]">
                  {bLines.map((lineHtml, i) => (
                    <div key={`b-${startLine + i}`} className="flex">
                      <span className="w-12 text-right pr-2 text-on-surface-variant/40 text-xs select-none shrink-0 leading-[20px]">
                        {startLine + i}
                      </span>
                      <span
                        className="flex-1 px-2 whitespace-pre"
                        dangerouslySetInnerHTML={{ __html: lineHtml }}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
