// Phase 10 — `approval_link` card (D-13). Routes to REQUESTS tab via
// `?tab=requests&request={id}` in Plan 05. Wave 0 renders a literal pill.

import type { AgentEvent } from '../../stores/chatStore';

export interface ApprovalLinkCardProps {
  event: AgentEvent;
}

export function ApprovalLinkCard({ event }: ApprovalLinkCardProps) {
  const payload =
    (event.payloadJson as {
      tool_name?: string;
      file_path?: string;
      summary?: string;
    } | null) ?? {};
  const toolName = (payload.tool_name ?? 'TOOL').toUpperCase();
  const filePath = payload.file_path ?? payload.summary ?? '';
  return (
    <div
      data-testid="approval-link-card"
      className="self-start max-w-[80%] bg-surface-container-high px-3 py-2 border-l-2 border-secondary font-mono text-xs text-on-surface"
    >
      APPROVAL_REQUIRED → {toolName} {filePath && `· ${filePath}`}
    </div>
  );
}
