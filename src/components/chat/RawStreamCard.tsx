// Phase 10 — raw stdout / stderr tail lines (read-only adapter transcripts).
// Terminal-tail aesthetic: surface-container-lowest fill, Data font, no bubble
// chrome. stderr variant tints body with text-error.
//
// Per threat T-10-30: truncate at 4 KiB per event to cap DOM churn; the DB row
// is NOT truncated (exports retain the full line).

import type { AgentEvent } from '../../stores/chatStore';

export interface RawStreamCardProps {
  event: AgentEvent;
}

const MAX_BYTES = 4096;

function truncateForRender(line: string): { body: string; footer: string | null } {
  // Approximate byte length via TextEncoder; falls back to char length.
  let byteLen: number;
  try {
    byteLen = new TextEncoder().encode(line).length;
  } catch {
    byteLen = line.length;
  }
  if (byteLen <= MAX_BYTES) return { body: line, footer: null };
  // Truncate by chars (approx) — exact byte-boundary trim not required for a
  // developer-facing tail view.
  const trimmed = line.slice(0, MAX_BYTES);
  const extra = byteLen - MAX_BYTES;
  return {
    body: trimmed,
    footer: `… (truncated, ${extra} more bytes)`,
  };
}

export function RawStreamCard({ event }: RawStreamCardProps) {
  const payload = (event.payloadJson as { line?: string } | null) ?? {};
  const rawLine = payload.line ?? '';
  const isStderr = event.eventType === 'raw_stderr';
  const { body, footer } = truncateForRender(rawLine);
  return (
    <pre
      data-testid={isStderr ? 'raw-stream-stderr' : 'raw-stream-stdout'}
      className={`self-start max-w-[90%] bg-surface-container-lowest px-3 py-1 font-mono text-xs whitespace-pre-wrap ${
        isStderr ? 'text-error' : 'text-on-surface-variant'
      }`}
    >
      {body}
      {footer && (
        <span className="block text-on-surface-variant/60 mt-1">{footer}</span>
      )}
    </pre>
  );
}
