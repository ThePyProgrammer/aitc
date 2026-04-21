/**
 * Phase 8 Plan 05: EditPreview / MultiEditPreview renderer.
 *
 * Delegates to the existing InlineDiff component (Phase 4). For Edit,
 * synthesizes a unified-diff string from {old_string, new_string} and
 * hands it to InlineDiff, preserving the editable-line → approve_with_edits
 * flow (D-17). For MultiEdit, stacks InlineDiff segments separated by
 * `HUNK {n}/{total}` labels (Phase 5 HunkNavigator style parity).
 */
import type { ToolPreviewProps } from './registry';
import { InlineDiff } from '../InlineDiff';
import { parseToolInput } from './helpers';

function synthesizeUnifiedDiff(oldStr: string, newStr: string): string {
  // Produce a minimal unified-diff-ish block that InlineDiff's existing
  // parser consumes (it detects `@@` or falls back to diffLines).
  const oldLines = oldStr.split('\n').map((l) => `-${l}`);
  const newLines = newStr.split('\n').map((l) => `+${l}`);
  return ['@@', ...oldLines, ...newLines].join('\n');
}

interface MultiEditEdit {
  old_string?: string;
  new_string?: string;
}

export function EditPreview({ toolInputJson, toolName, filePath }: ToolPreviewProps) {
  const input = parseToolInput(toolInputJson);
  if (!input) {
    return (
      <div
        className="bg-surface-container-lowest border border-error/20 p-4 font-mono text-xs text-error"
        role="alert"
      >
        PREIMAGE_LOAD_FAILED — Unable to read {filePath ?? 'file'}. File may have been deleted or renamed.
      </div>
    );
  }

  if (toolName === 'MultiEdit' && Array.isArray(input.edits)) {
    const edits = input.edits as MultiEditEdit[];
    const total = edits.length;
    return (
      <div className="flex flex-col" data-tool-preview="multi-edit">
        {edits.map((e, i) => (
          <div key={i} className="mb-4">
            <div className="mb-2 font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              HUNK {String(i + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </div>
            <InlineDiff
              diffContent={synthesizeUnifiedDiff(e.old_string ?? '', e.new_string ?? '')}
            />
          </div>
        ))}
      </div>
    );
  }

  const oldStr = String(input.old_string ?? '');
  const newStr = String(input.new_string ?? '');
  return (
    <div data-tool-preview="edit">
      <InlineDiff diffContent={synthesizeUnifiedDiff(oldStr, newStr)} />
    </div>
  );
}
EditPreview.displayName = 'EditPreview';
