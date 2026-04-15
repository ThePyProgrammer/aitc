/**
 * Phase 8 Plan 05: ProtectedPathPreview — key/value table for tool_input
 * fields of Read/LS/Grep/Glob/WebFetch/WebSearch/Task when they are gated
 * solely because their file_path matched a `protected_paths` glob. Zero
 * chrome; label keys are UPPER_CASE.
 */
import type { ToolPreviewProps } from './registry';
import { parseToolInput } from './helpers';

const KEY_LABEL: Record<string, string> = {
  file_path: 'TARGET',
  path: 'TARGET',
  pattern: 'PATTERN',
  limit: 'LIMIT',
  offset: 'OFFSET',
  query: 'QUERY',
  url: 'URL',
  prompt: 'PROMPT',
  description: 'DESCRIPTION',
  glob: 'GLOB',
  type: 'TYPE',
  output_mode: 'OUTPUT_MODE',
  head_limit: 'HEAD_LIMIT',
};

export function ProtectedPathPreview({ toolInputJson }: ToolPreviewProps) {
  const input = parseToolInput(toolInputJson) ?? {};
  const entries = Object.entries(input).filter(([, v]) => v !== undefined && v !== null);

  if (entries.length === 0) {
    return (
      <section role="region" aria-label="Tool arguments" data-tool-preview="protected-path">
        <p className="font-mono text-xs text-on-surface-variant/60">NO_ARGUMENTS</p>
      </section>
    );
  }

  return (
    <section role="region" aria-label="Tool arguments" data-tool-preview="protected-path">
      <dl className="grid grid-cols-[120px_1fr] gap-y-1">
        {entries.map(([k, v]) => {
          const rendered = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return (
            <div key={k} className="contents">
              <dt className="font-headline text-[10px] font-normal uppercase tracking-widest text-on-surface-variant py-1 border-b border-outline-variant/15">
                {KEY_LABEL[k] ?? k.toUpperCase()}
              </dt>
              <dd
                className="font-mono text-xs font-bold truncate py-1 border-b border-outline-variant/15"
                title={rendered}
              >
                {rendered}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
ProtectedPathPreview.displayName = 'ProtectedPathPreview';
