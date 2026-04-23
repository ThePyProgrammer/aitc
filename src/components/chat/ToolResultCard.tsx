// Phase 10 — `tool_result` card. Nested under its parent tool_use visually
// (lighter left-border indent).
//
// Renders full tool output (no truncation). Handles both stream-json
// content shapes — plain string OR Array<{type: "text", text: string}>.
// Long outputs scroll inside the card (max-h-[400px]) so a 10k-line Bash
// dump can't hijack the transcript scroller. `is_error: true` rows tint
// red and relabel as `ERROR` so failed tool calls read distinct.

import type { AgentEvent } from '../../stores/chatStore';

export interface ToolResultCardProps {
  event: AgentEvent;
}

// Claude's tool_result content is either a raw string or an array of
// content blocks (usually `{type: "text", text: "..."}`, occasionally other
// types we don't special-case). Flatten to a newline-joined string so
// `whitespace-pre-wrap` can render the full body faithfully.
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === 'object' && 'text' in block) {
          const t = (block as { text: unknown }).text;
          return typeof t === 'string' ? t : JSON.stringify(block);
        }
        return JSON.stringify(block);
      })
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

export function ToolResultCard({ event }: ToolResultCardProps) {
  const payload =
    (event.payloadJson as {
      content?: unknown;
      is_error?: boolean;
    } | null) ?? {};
  const body = extractText(payload.content);
  const isError = payload.is_error === true;

  return (
    <div
      data-testid="tool-result-card"
      className={`w-full px-5 py-2 border-t border-outline-variant/10 font-mono text-xs ${
        isError ? 'text-error' : 'text-on-surface-variant/70'
      }`}
    >
      <span
        className={`font-headline text-[10px] uppercase tracking-widest mr-2 ${
          isError ? 'text-error' : 'text-on-surface-variant/50'
        }`}
      >
        {isError ? 'ERROR' : 'RESULT'}
      </span>
      <pre className="inline-block align-top whitespace-pre-wrap max-h-[400px] overflow-y-auto font-mono max-w-full">
        {body}
      </pre>
    </div>
  );
}
