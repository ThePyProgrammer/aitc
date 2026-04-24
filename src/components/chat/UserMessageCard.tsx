// Phase 10 — `user_text` full-width row (no bubble).
// Renders the message content, a compact timestamp, and the delivery-status
// lifecycle icon (queued → delivered → consumed, or unsupported) per D-10.
//
// Style match: codey's PlaygroundPage `MessageRow` (full-width,
// `border-t` separators, small role label, no chat-bubble chrome).

import type { AgentEvent } from '../../stores/chatStore';
import { DeliveryStatus } from '../ui/DeliveryStatus';

export interface UserMessageCardProps {
  event: AgentEvent;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function UserMessageCard({ event }: UserMessageCardProps) {
  const payload =
    (event.payloadJson as { content?: string } | null) ?? { content: '' };
  const content = payload.content ?? '';
  const timestamp = formatTimestamp(event.createdAt);

  return (
    <div
      data-testid="user-message-card"
      // pt-3/pb-5 — asymmetric to put breathing room after the user message
      // (turn boundary), keeping the regular hairline rhythm above.
      className="w-full px-5 pt-3 pb-5 border-t border-outline-variant/10 bg-surface-container-lowest/60"
    >
      <div className="flex items-center gap-3 mb-1">
        <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/70">
          YOU
        </span>
        {timestamp && (
          <span className="font-mono text-[10px] text-on-surface-variant/50">
            {timestamp}
          </span>
        )}
        {event.deliveryStatus && (
          <span className="ml-auto">
            <DeliveryStatus status={event.deliveryStatus} />
          </span>
        )}
      </div>
      <p className="font-mono text-sm text-on-surface whitespace-pre-wrap">
        {content}
      </p>
    </div>
  );
}
