// Phase 10 — `assistant_text` full-width row (no bubble).
// Matches codey's PlaygroundPage `MessageRow` style. Body text fills the
// panel edge-to-edge; a `border-t` separator distinguishes adjacent rows
// without chat-bubble chrome.
//
// Streaming lifecycle (D-17): while `payloadJson.streaming === true`, a
// tiny pulsing caret trails the tokens and a secondary `STREAMING…` label
// is rendered in the footer. The caret + @user-mention styling live inside
// MarkdownBody (Phase 19 Plan 03, D-03.5) — this component retains only the
// shell (role label, wrapper, streaming hint label).

import type { AgentEvent } from '../../stores/chatStore';
import { MarkdownBody } from './MarkdownBody';

export interface AssistantTextCardProps {
  event: AgentEvent;
  /**
   * When the immediately-preceding row is also an assistant_text chunk,
   * suppress the `CLAUDE` role label so a multi-chunk streaming turn reads
   * as one continuous block instead of repeating the label every row.
   */
  isContinuation?: boolean;
}

export function AssistantTextCard({
  event,
  isContinuation = false,
}: AssistantTextCardProps) {
  const payload =
    (event.payloadJson as {
      content?: string;
      streaming?: boolean;
    } | null) ?? {};
  const content = payload.content ?? '';
  const streaming = payload.streaming === true;

  // Active-turn body pops to on-surface (#ffffff); completed turns sit in
  // on-surface-variant. The cursor + label only render during streaming.
  const bodyColor = streaming ? 'text-on-surface' : 'text-on-surface-variant';

  // Multi-chunk streaming often produces adjacent assistant_text rows —
  // we only want the `CLAUDE` label once per turn. The `border-t` row
  // separator also collapses so the chunks visually coalesce.
  const wrapperClass = isContinuation
    ? 'w-full px-5 pb-3'
    : 'w-full px-5 py-3 border-t border-outline-variant/10';

  return (
    <div data-testid="assistant-text-card" className={wrapperClass}>
      {!isContinuation && (
        <div className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/70 mb-1">
          CLAUDE
        </div>
      )}
      <div className={`${bodyColor} leading-relaxed`}>
        <MarkdownBody content={content} streaming={streaming} />
      </div>
      {streaming && (
        <span
          aria-live="polite"
          className="font-headline text-[10px] font-bold tracking-widest uppercase text-secondary mt-2 inline-block"
        >
          STREAMING…
        </span>
      )}
    </div>
  );
}
