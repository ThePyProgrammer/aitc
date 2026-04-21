// Phase 10 — `session_boundary` horizontal divider (D-03, D-13).
// 40px tall, centered label between two outline-variant/20 hairlines.
// Three kinds:
//   - started  → `SESSION_STARTED · {session_id[:8]}`
//   - ended    → `SESSION_ENDED · {reason}` (also renders exit code when crashed)
//   - resumed  → `SESSION_RESUMED · via --resume`
// Unknown kinds fall back to the raw kind label, uppercased.

import type { AgentEvent } from '../../stores/chatStore';

export interface SessionBoundaryProps {
  event: AgentEvent;
}

function formatIsoRight(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  } catch {
    return '';
  }
}

function buildLabel(payload: {
  kind?: string;
  session_id?: string;
  reason?: string;
  exit_code?: number;
}, fallbackSessionId: string | null): string {
  const kind = payload.kind ?? '';
  const sid = (payload.session_id ?? fallbackSessionId ?? '').slice(0, 8);
  switch (kind) {
    case 'started':
      return sid
        ? `SESSION_STARTED · ${sid}`
        : 'SESSION_STARTED';
    case 'ended': {
      const reason = payload.reason ?? 'completed';
      if (typeof payload.exit_code === 'number' && payload.exit_code !== 0) {
        return `SESSION_ENDED · crashed (exit ${payload.exit_code})`;
      }
      return `SESSION_ENDED · ${reason}`;
    }
    case 'resumed':
      return 'SESSION_RESUMED · via --resume';
    default:
      return kind ? `SESSION_${kind.toUpperCase()}` : 'SESSION';
  }
}

export function SessionBoundary({ event }: SessionBoundaryProps) {
  const payload =
    (event.payloadJson as {
      kind?: string;
      session_id?: string;
      reason?: string;
      exit_code?: number;
    } | null) ?? {};
  const label = buildLabel(payload, event.sessionId);
  const rightTs = formatIsoRight(event.createdAt);

  return (
    <div
      data-testid="session-boundary"
      className="h-10 px-5 flex items-center gap-3 font-headline text-[10px] uppercase tracking-widest text-on-surface-variant"
    >
      <span className="flex-1 border-t border-outline-variant/20" />
      <span>{label}</span>
      {rightTs && (
        <span className="font-mono text-on-surface-variant/60 normal-case tracking-normal">
          {rightTs}
        </span>
      )}
      <span className="flex-1 border-t border-outline-variant/20" />
    </div>
  );
}
