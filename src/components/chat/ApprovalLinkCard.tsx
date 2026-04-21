// Phase 10 — `approval_link` card (D-13). Renders a secondary-accented
// deep-link pill that routes to REQUESTS tab via
// `/comms?tab=requests&request={approval_request_id}`.

import { ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { AgentEvent } from '../../stores/chatStore';

export interface ApprovalLinkCardProps {
  event: AgentEvent;
}

function truncatePath(s: string, max = 40): string {
  if (s.length <= max) return s;
  // Keep the tail (commonly the most informative segment).
  return `…${s.slice(-(max - 1))}`;
}

export function ApprovalLinkCard({ event }: ApprovalLinkCardProps) {
  const navigate = useNavigate();
  const payload =
    (event.payloadJson as {
      tool_name?: string;
      file_path?: string;
      summary?: string;
      approval_request_id?: number;
    } | null) ?? {};
  const toolName = (payload.tool_name ?? 'TOOL').toUpperCase();
  const rawPath = payload.file_path ?? payload.summary ?? '';
  const filePath = rawPath ? truncatePath(rawPath, 40) : '';
  const approvalId =
    event.approvalRequestId ?? payload.approval_request_id ?? null;

  const handleClick = () => {
    if (approvalId != null) {
      navigate(`/comms?tab=requests&request=${approvalId}`);
    }
  };

  return (
    <button
      type="button"
      data-testid="approval-link-card"
      onClick={handleClick}
      className="self-start max-w-[80%] text-left bg-surface-container-high hover:bg-surface-container-highest px-3 py-2 border-l-2 border-secondary font-mono text-xs text-on-surface flex items-center gap-2 transition-colors"
    >
      <ExternalLink
        size={14}
        strokeWidth={1.5}
        className="text-secondary shrink-0"
        aria-hidden="true"
      />
      <span className="truncate">
        APPROVAL_REQUIRED → {toolName}
        {filePath && ` · ${filePath}`}
      </span>
    </button>
  );
}
