// Phase 10 — raw stdout / stderr tail lines (read-only adapter transcripts).
// Switches on event.eventType to tint stderr with text-error.

import type { AgentEvent } from '../../stores/chatStore';

export interface RawStreamCardProps {
  event: AgentEvent;
}

export function RawStreamCard({ event }: RawStreamCardProps) {
  const payload = (event.payloadJson as { line?: string } | null) ?? {};
  const line = payload.line ?? '';
  const isStderr = event.eventType === 'raw_stderr';
  return (
    <pre
      data-testid={isStderr ? 'raw-stream-stderr' : 'raw-stream-stdout'}
      className={`self-start max-w-[90%] bg-surface-container-lowest px-3 py-1 font-mono text-xs whitespace-pre-wrap ${
        isStderr ? 'text-error' : 'text-on-surface-variant'
      }`}
    >
      {line}
    </pre>
  );
}
