// Phase 10 — `approval_link` inline row (D-13). Quiet full-width line
// matching codey's `MessageRow` pattern, no pill chrome. Clicks navigate
// to `/comms?tab=requests&request={approval_request_id}`.

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
      className="w-full text-left px-5 py-2 border-t border-outline-variant/10 hover:bg-surface-container/20 transition-colors flex items-center gap-2"
    >
      <span className="font-headline text-[10px] uppercase tracking-widest text-secondary shrink-0">
        APPROVAL
      </span>
      <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant shrink-0">
        {toolName}
      </span>
      <span className="flex-1 truncate font-mono text-xs text-on-surface-variant/70">
        {filePath}
      </span>
      {approvalId != null && (
        <span className="font-mono text-[10px] text-secondary shrink-0">
          #{approvalId}
        </span>
      )}
      <ExternalLink
        size={12}
        strokeWidth={1.5}
        className="text-secondary/60 shrink-0"
        aria-hidden="true"
      />
    </button>
  );
}
