/**
 * AgentPreview — INPUT renderer for the `Task` tool (sub-agent dispatch).
 *
 * A Task call isn't really a "tool" with file/path arguments — it's a
 * delegated mini-conversation with a sub-agent. The interesting field is
 * `prompt` (the brief), which can run 1000+ words. We hide it behind a
 * SHOW_BRIEF toggle to keep the transcript scannable, and render it as
 * markdown when expanded (briefs themselves are usually markdown-shaped:
 * bullet lists, code refs, fenced blocks).
 *
 * `subagent_type` and `description` are NOT repeated here — they already
 * live in the collapsed-row label and primary slot of ToolUseCard.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ToolPreviewProps } from './registry';
import { parseToolInput } from './helpers';
import { MarkdownBody } from '../../../components/chat/MarkdownBody';

function countWords(s: string): number {
  const t = s.trim();
  if (t === '') return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export function AgentPreview({ toolInputJson }: ToolPreviewProps) {
  const input = parseToolInput(toolInputJson) ?? {};
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const [shown, setShown] = useState(false);
  const words = useMemo(() => countWords(prompt), [prompt]);

  if (prompt === '') {
    return (
      <section role="region" aria-label="Agent brief" data-tool-preview="agent">
        <p className="font-mono text-xs text-on-surface-variant/60">NO_BRIEF</p>
      </section>
    );
  }

  return (
    <section role="region" aria-label="Agent brief" data-tool-preview="agent">
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-expanded={shown}
        className="flex items-center gap-1.5 font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/70 hover:text-on-surface transition-colors"
      >
        {shown ? (
          <ChevronDown size={11} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronRight size={11} strokeWidth={1.5} aria-hidden="true" />
        )}
        <span>{shown ? 'HIDE_BRIEF' : 'SHOW_BRIEF'}</span>
        <span className="text-on-surface-variant/50">
          ({words} {words === 1 ? 'word' : 'words'})
        </span>
      </button>
      {shown && (
        <div className="mt-3" data-testid="agent-brief-body">
          <MarkdownBody content={prompt} />
        </div>
      )}
    </section>
  );
}
AgentPreview.displayName = 'AgentPreview';
