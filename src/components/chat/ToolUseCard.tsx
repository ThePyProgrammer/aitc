// Phase 10 — `tool_use` inline row (D-13, D-16).
// Quiet single-line row that blends with the transcript flow. Collapsed:
//   TOOL · {TOOL_NAME} {summary} [→ APPROVAL_{id}]   ▾
// Click to expand — renders the Phase 8 ToolPreview registry body below.
//
// Style match: codey's full-width row pattern. No bubble chrome, no
// self-start/max-width; the row fills the panel edge-to-edge so tool events
// don't visually compete with assistant/user text.

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import type { AgentEvent } from '../../stores/chatStore';
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
      className="w-full border-t border-outline-variant/10"
      transition={{ duration: 0.12, ease: 'easeOut' }}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-2 px-5 py-2 text-left hover:bg-surface-container/20 transition-colors"
        aria-expanded={expanded}
      >
        <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/50 shrink-0">
          TOOL
        </span>
        <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant shrink-0">
          {(toolName ?? 'UNKNOWN').toUpperCase()}
        </span>
        <span className="flex-1 truncate font-mono text-xs text-on-surface-variant/70">
          {summary}
        </span>
        {approvalId != null && (
          <button
            type="button"
            onClick={handleApprovalClick}
            className="font-headline text-[10px] tracking-widest uppercase text-secondary hover:underline shrink-0"
          >
            → APPROVAL_{approvalId}
          </button>
        )}
        {expanded ? (
          <ChevronUp
            size={12}
            strokeWidth={1.5}
            className="text-on-surface-variant/60 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <ChevronDown
            size={12}
            strokeWidth={1.5}
            className="text-on-surface-variant/60 shrink-0"
            aria-hidden="true"
          />
        )}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-3 pt-1 bg-surface-container/20">
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
