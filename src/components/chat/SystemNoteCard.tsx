// Phase 10 — `system_note` + fallback for unknown event_types. Centred,
// uppercase, on-surface-variant.

import type { AgentEvent } from '../../stores/chatStore';

export interface SystemNoteCardProps {
  event: AgentEvent;
}

export function SystemNoteCard({ event }: SystemNoteCardProps) {
  const payload = (event.payloadJson as { text?: string } | null) ?? {};
  const text = payload.text ?? `UNKNOWN_EVENT · ${event.eventType}`;
  return (
    <div
      data-testid="system-note-card"
      className="w-full text-center font-headline text-[10px] uppercase tracking-widest text-on-surface-variant py-2"
    >
      {text}
    </div>
  );
}
