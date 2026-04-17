// Phase 10 — `assistant_text` bubble (D-13). self-start, surface-container-high fill.
// Wave 0 (Plan 01) renders a minimal stub; Plan 05 wires the StreamingCursor,
// @user mention highlighting, and shiki inline-code rendering.

import type { AgentEvent } from '../../stores/chatStore';

export interface AssistantTextCardProps {
  event: AgentEvent;
}

export function AssistantTextCard({ event }: AssistantTextCardProps) {
  const payload = event.payloadJson as { content?: string } | null;
  const content = payload?.content ?? '';
  return (
    <div
      data-testid="assistant-text-card"
      className="self-start max-w-[80%] bg-surface-container-high px-3 py-2"
    >
      <p className="font-mono text-sm text-on-surface-variant whitespace-pre-wrap">
        {content}
      </p>
    </div>
  );
}
