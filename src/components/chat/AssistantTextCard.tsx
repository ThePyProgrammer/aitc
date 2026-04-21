// Phase 10 — `assistant_text` bubble (D-13).
// self-start, bg-surface-container-high. Body color is on-surface-variant
// for completed turns; on-surface (#ffffff) while streaming. When
// payloadJson.streaming === true, a StreamingCursor is appended and a
// `STREAMING…` label renders in secondary color (D-17).
//
// Per UI-SPEC the `@user` literal token inside the assistant body renders
// in `text-secondary font-bold` — the chat-side accent twin of the approval
// ASK_FOR_MORE_INFO secondary treatment.

import type { AgentEvent } from '../../stores/chatStore';
import { StreamingCursor } from './StreamingCursor';

export interface AssistantTextCardProps {
  event: AgentEvent;
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

export function AssistantTextCard({ event }: AssistantTextCardProps) {
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

  return (
    <div
      data-testid="assistant-text-card"
      className={`self-start max-w-[80%] bg-surface-container-high px-3 py-2 ${bodyColor}`}
    >
      <p className={`font-mono text-sm ${bodyColor} whitespace-pre-wrap`}>
        {renderContent(content)}
        {streaming && <StreamingCursor />}
      </p>
      {streaming && (
        <span
          aria-live="polite"
          className="font-headline text-[10px] font-bold tracking-widest uppercase text-secondary mt-1 inline-block"
        >
          STREAMING…
        </span>
      )}
    </div>
  );
}
