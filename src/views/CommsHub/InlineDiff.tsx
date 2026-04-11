import { useState, useCallback } from 'react';
import { diffLines } from 'diff';

interface InlineDiffProps {
  diffContent: string | null;
  onEditsChange?: (edits: Map<number, string>) => void;
  onEditStart?: () => void;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber: number;
}

function parseDiffContent(diffContent: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let lineNumber = 1;

  // Try to parse as unified diff format
  const diffParts = diffContent.split('\n');
  let isUnifiedDiff = diffParts.some((line) => line.startsWith('@@'));

  if (isUnifiedDiff) {
    for (const line of diffParts) {
      // Skip diff headers
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
        continue;
      }
      if (line.startsWith('+')) {
        lines.push({ type: 'added', content: line.slice(1), lineNumber: lineNumber++ });
      } else if (line.startsWith('-')) {
        lines.push({ type: 'removed', content: line.slice(1), lineNumber: lineNumber++ });
      } else {
        lines.push({ type: 'unchanged', content: line.startsWith(' ') ? line.slice(1) : line, lineNumber: lineNumber++ });
      }
    }
  } else {
    // Fallback: use diffLines to compute diff from raw content
    // Treat content as a single block of text showing additions
    const changes = diffLines('', diffContent);
    for (const change of changes) {
      const changeLines = change.value.split('\n').filter((l) => l !== '');
      for (const cl of changeLines) {
        lines.push({
          type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
          content: cl,
          lineNumber: lineNumber++,
        });
      }
    }
  }

  return lines;
}

export function InlineDiff({ diffContent, onEditsChange, onEditStart }: InlineDiffProps) {
  const [edits, setEdits] = useState<Map<number, string>>(new Map());

  const handleLineClick = useCallback(
    (lineIndex: number, lineType: string) => {
      if (lineType !== 'added') return;
      onEditStart?.();
    },
    [onEditStart]
  );

  const handleContentEdit = useCallback(
    (lineIndex: number, newContent: string) => {
      setEdits((prev) => {
        const updated = new Map(prev);
        updated.set(lineIndex, newContent);
        onEditsChange?.(updated);
        return updated;
      });
    },
    [onEditsChange]
  );

  if (!diffContent) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant/10 p-4 flex items-center justify-center">
        <span className="font-mono text-xs text-on-surface-variant/60">
          NO_DIFF_CONTENT
        </span>
      </div>
    );
  }

  const lines = parseDiffContent(diffContent);

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/10 overflow-auto">
      {lines.map((line, index) => {
        const isEdited = edits.has(index);
        const isEditable = line.type === 'added';
        const displayContent = isEdited ? edits.get(index)! : line.content;

        // Line type styling
        let textColor = 'text-[#adaaaa]';
        let bgColor = 'bg-transparent';
        let gutterBorder = 'border-l-2 border-transparent';
        let additionalStyles = '';

        if (isEdited) {
          textColor = 'text-[#00cffc]';
          bgColor = 'bg-[rgba(0,207,252,0.05)]';
          gutterBorder = 'border-l-2 border-secondary';
        } else if (line.type === 'added') {
          textColor = 'text-[#8eff71]';
          bgColor = 'bg-[rgba(142,255,113,0.05)]';
          gutterBorder = 'border-l-2 border-primary';
        } else if (line.type === 'removed') {
          textColor = 'text-[#ff7351]';
          bgColor = 'bg-[rgba(255,115,81,0.05)]';
          gutterBorder = 'border-l-2 border-error';
          additionalStyles = 'line-through';
        }

        return (
          <div
            key={index}
            className={`flex items-stretch h-5 ${bgColor} ${gutterBorder} ${
              isEditable ? 'cursor-text' : ''
            }`}
            onClick={() => handleLineClick(index, line.type)}
          >
            {/* Line number */}
            <span className="w-10 shrink-0 text-right pr-2 font-mono text-xs text-outline select-none leading-5">
              {line.lineNumber}
            </span>

            {/* Line content */}
            <span
              className={`flex-1 font-mono text-xs leading-5 px-2 ${textColor} ${additionalStyles} ${
                isEditable ? 'outline-none' : ''
              }`}
              contentEditable={isEditable}
              suppressContentEditableWarning={isEditable}
              onBlur={(e) => {
                if (isEditable) {
                  const newText = (e.target as HTMLElement).innerText;
                  if (newText !== line.content) {
                    handleContentEdit(index, newText);
                  }
                }
              }}
            >
              {displayContent}
            </span>
          </div>
        );
      })}
    </div>
  );
}
