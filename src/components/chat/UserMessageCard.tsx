// Phase 10 — `user_text` bubble (D-13). self-end, surface-container fill.
// Renders the message content, a compact timestamp, and the delivery-status
// lifecycle icon (queued → delivered → consumed, or unsupported) per D-10.

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
      className="self-end flex flex-col max-w-[80%]"
    >
      <div className="bg-surface-container px-3 py-2">
        <p className="font-mono text-sm text-on-surface whitespace-pre-wrap">
          {content}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 mt-1">
        {timestamp && (
          <span className="font-mono text-[10px] text-on-surface-variant">
            {timestamp}
          </span>
        )}
        {event.deliveryStatus && (
          <DeliveryStatus status={event.deliveryStatus} />
        )}
      </div>
    </div>
  );
}
