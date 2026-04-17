// Phase 10 — `session_boundary` horizontal divider. 40px tall, centred
// label, outline-variant/20 hairline. Plan 05 wires the started/ended/crashed
// copy variants.

import type { AgentEvent } from '../../stores/chatStore';

export interface SessionBoundaryProps {
  event: AgentEvent;
}

export function SessionBoundary({ event }: SessionBoundaryProps) {
  const payload =
    (event.payloadJson as {
      kind?: string;
      session_id?: string;
      reason?: string;
    } | null) ?? {};
  const sessionPrefix = (payload.session_id ?? event.sessionId ?? '').slice(0, 8);
  const label = (payload.kind ?? 'SESSION').toUpperCase();
  return (
    <div
      data-testid="session-boundary"
      className="h-10 flex items-center gap-3 font-headline text-[10px] uppercase tracking-widest text-on-surface-variant"
    >
      <span className="flex-1 border-t border-outline-variant/20" />
      <span>
        {label}
        {sessionPrefix && ` · ${sessionPrefix}`}
      </span>
      <span className="flex-1 border-t border-outline-variant/20" />
    </div>
  );
}
