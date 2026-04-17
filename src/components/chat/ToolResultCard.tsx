// Phase 10 — `tool_result` card. Nested under its parent tool_use visually
// (lighter left-border indent). Plan 05 wires the full content preview.

import type { AgentEvent } from '../../stores/chatStore';

export interface ToolResultCardProps {
  event: AgentEvent;
}

export function ToolResultCard({ event }: ToolResultCardProps) {
  const payload =
    (event.payloadJson as {
      content?: unknown;
      is_error?: boolean;
    } | null) ?? {};
  const preview =
    typeof payload.content === 'string'
      ? payload.content
      : JSON.stringify(payload.content ?? '');
  return (
    <div
      data-testid="tool-result-card"
      className="self-start max-w-[80%] bg-surface-container-high px-3 py-2 border-l border-outline-variant/20 font-mono text-xs text-on-surface-variant"
    >
      {preview.slice(0, 200)}
    </div>
  );
}
