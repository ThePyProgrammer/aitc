// Phase 10 — `tool_use` card (D-13, D-16).
// Collapsed by default as a 36px-tall one-liner showing:
//   [ToolBadge] summary [ChevronDown] [→ APPROVAL_{id}]
// Click to expand — renders the Phase 8 ToolPreview registry body inline.
// When approvalRequestId is set, a secondary-colored pill navigates to
// /comms?tab=requests&request={id}.

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import type { AgentEvent } from '../../stores/chatStore';
import { ToolBadge } from '../ui/ToolBadge';
import { ToolPreview } from '../../views/CommsHub/ToolPreview';

export interface ToolUseCardProps {
  event: AgentEvent;
}

// Heuristic one-line summary by tool type. Full detail is in the expanded
// ToolPreview — this is just a scannable scan-line.
function deriveSummary(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
): string {
  if (!toolInput) return '';
  const filePath = toolInput.file_path as string | undefined;
  const command = toolInput.command as string | undefined;
  const pattern = toolInput.pattern as string | undefined;
  const url = toolInput.url as string | undefined;
  switch (toolName) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'Read':
      return filePath ?? '';
    case 'Bash':
      return command ?? '';
    case 'Grep':
    case 'Glob':
      return pattern ?? '';
    case 'WebFetch':
    case 'WebSearch':
      return url ?? '';
    default:
      return (filePath ?? command ?? pattern ?? url ?? '') as string;
  }
}

export function ToolUseCard({ event }: ToolUseCardProps) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const payload =
    (event.payloadJson as {
      tool_name?: string;
      tool_input?: Record<string, unknown>;
    } | null) ?? {};
  const toolName = payload.tool_name ?? null;
  const toolInput = payload.tool_input ?? {};
  const summary = deriveSummary(toolName ?? undefined, payload.tool_input);
  const approvalId = event.approvalRequestId;

  const handleApprovalClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (approvalId != null) {
        navigate(`/comms?tab=requests&request=${approvalId}`);
      }
    },
    [approvalId, navigate],
  );

  return (
    <motion.div
      layout
      data-testid="tool-use-card"
      className={`self-start max-w-[80%] w-full ${
        expanded
          ? 'bg-surface-container-highest'
          : 'bg-surface-container-high'
      } overflow-hidden`}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      onClick={() => setExpanded((prev) => !prev)}
      role="button"
      tabIndex={0}
    >
      <div className="min-h-[36px] flex items-center gap-2 px-3 py-1">
        <ToolBadge toolName={toolName} />
        <span className="flex-1 truncate font-mono text-xs text-on-surface-variant">
          {summary}
        </span>
        {approvalId != null && (
          <button
            type="button"
            onClick={handleApprovalClick}
            className="font-headline text-[10px] font-bold tracking-widest uppercase text-secondary bg-secondary/10 border border-secondary/20 px-2 py-0.5 hover:bg-secondary/20"
          >
            → APPROVAL_{approvalId}
          </button>
        )}
        {expanded ? (
          <ChevronUp
            size={14}
            strokeWidth={1.5}
            className="text-on-surface-variant"
            aria-hidden="true"
          />
        ) : (
          <ChevronDown
            size={14}
            strokeWidth={1.5}
            className="text-on-surface-variant"
            aria-hidden="true"
          />
        )}
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-t border-outline-variant/10 px-3 py-2">
              <ToolPreview
                toolName={toolName ?? ''}
                toolInputJson={toolInput}
                filePath={(toolInput.file_path as string | undefined) ?? null}
                requestId={approvalId ?? 0}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
