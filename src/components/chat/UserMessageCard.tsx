// Phase 10 — `user_text` bubble (D-13). self-end, surface-container fill.
// Wave 0 (Plan 01) renders a minimal stub; Plan 05 wires timestamps +
// DeliveryStatus + @-mention highlighting.

import type { AgentEvent } from '../../stores/chatStore';

export interface UserMessageCardProps {
  event: AgentEvent;
}

export function UserMessageCard({ event }: UserMessageCardProps) {
  const payload = event.payloadJson as { content?: string } | null;
  const content = payload?.content ?? '';
  return (
    <div
      data-testid="user-message-card"
      className="self-end max-w-[80%] bg-surface-container px-3 py-2"
    >
      <p className="font-mono text-sm text-on-surface">{content}</p>
    </div>
  );
}
