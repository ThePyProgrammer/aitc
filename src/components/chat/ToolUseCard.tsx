// Phase 10 — `tool_use` card (D-13, D-16). Collapsed by default; Plan 05
// wires the expand-to-<ToolPreview /> state + the linked-approval pill.

import type { AgentEvent } from '../../stores/chatStore';

export interface ToolUseCardProps {
  event: AgentEvent;
}

export function ToolUseCard({ event }: ToolUseCardProps) {
  const payload =
    (event.payloadJson as {
      tool_name?: string;
      tool_input?: Record<string, unknown>;
    } | null) ?? {};
  const toolName = (payload.tool_name ?? 'TOOL').toUpperCase();
  // Heuristic summary — Plan 05 moves this into ToolBadge + ToolPreview.
  const summary =
    (payload.tool_input?.file_path as string | undefined) ??
    (payload.tool_input?.command as string | undefined) ??
    '';
  return (
    <button
      type="button"
      data-testid="tool-use-card"
      className="self-start max-w-[80%] min-h-[36px] w-full bg-surface-container-high px-3 py-2 text-left font-mono text-xs text-on-surface-variant"
    >
      [{toolName}] {summary}
    </button>
  );
}
