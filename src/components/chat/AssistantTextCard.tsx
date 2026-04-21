// Phase 10 — `assistant_text` full-width row (no bubble).
// Matches codey's PlaygroundPage `MessageRow` style. Body text fills the
// panel edge-to-edge; a `border-t` separator distinguishes adjacent rows
// without chat-bubble chrome.
//
// Streaming lifecycle (D-17): while `payloadJson.streaming === true`, a
// tiny pulsing caret trails the tokens and a secondary `STREAMING…` label
// is rendered in the footer.
//
// Per UI-SPEC the `@user` literal token inside the assistant body renders
// in `text-secondary font-bold` — the chat-side accent twin of the approval
// ASK_FOR_MORE_INFO secondary treatment.

import type { AgentEvent } from '../../stores/chatStore';
import { StreamingCursor } from './StreamingCursor';

export interface AssistantTextCardProps {
  event: AgentEvent;
  /**
   * When the immediately-preceding row is also an assistant_text chunk,
   * suppress the `CLAUDE` role label so a multi-chunk streaming turn reads
   * as one continuous block instead of repeating the label every row.
   */
  isContinuation?: boolean;
}

// Word-bounded @user regex — matches @user when it's not part of a longer
// identifier (e.g. NOT @username, NOT foo_@user_bar). Mirrors the backend
// is_awaiting_user_mention pattern (Pitfall 5 defense).
const AT_USER_RE = /(^|\W)(@user)(?=\W|$)/g;

function renderContent(content: string): React.ReactNode[] {
  if (!content) return [];
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  AT_USER_RE.lastIndex = 0;
  while ((match = AT_USER_RE.exec(content)) !== null) {
    const leading = match[1] ?? '';
    const mentionStart = match.index + leading.length;
    if (mentionStart > cursor) {
      parts.push(content.slice(cursor, mentionStart));
    }
    parts.push(
      <span
        key={`mention-${key++}`}
        className="text-secondary font-bold"
      >
        @user
      </span>,
    );
    cursor = mentionStart + '@user'.length;
  }
  if (cursor < content.length) {
    parts.push(content.slice(cursor));
  }
  return parts;
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
      <p className={`font-mono text-sm ${bodyColor} whitespace-pre-wrap leading-relaxed`}>
        {renderContent(content)}
        {streaming && <StreamingCursor />}
      </p>
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
