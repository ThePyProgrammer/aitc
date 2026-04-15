/**
 * ApprovalRequestCard — Phase 4 card extended in Phase 8 Plan 05:
 *  - Renders ToolBadge adjacent to UrgencyBadge for pretool_use rows (D-14)
 *  - Renders single-line preview (first changed line / `$ command` / em-dash)
 *  - Renders the "abandoned" chrome (dimmed, non-interactive) when
 *    `status === 'abandoned'` (D-09)
 */
import { motion } from 'motion/react';
import { UrgencyBadge } from '../../components/ui/UrgencyBadge';
import { ToolBadge } from '../../components/ui/ToolBadge';
import { useCommsStore, type ApprovalRequest } from '../../stores/commsStore';
import { derivePreviewLine, type PreviewGlyphColor } from './ToolPreview/helpers';

interface ApprovalRequestCardProps {
  request: ApprovalRequest;
}

const GLYPH_CLASS: Record<PreviewGlyphColor, string> = {
  primary: 'text-primary',
  error: 'text-error',
  tertiary: 'text-tertiary',
  variant: 'text-on-surface-variant/60',
};

export function ApprovalRequestCard({ request }: ApprovalRequestCardProps) {
  const selectedRequestId = useCommsStore((s) => s.selectedRequestId);
  const selectRequest = useCommsStore((s) => s.selectRequest);
  const isSelected = selectedRequestId === request.id;
  const isAbandoned = request.status === 'abandoned';

  const truncatedPath = request.filePath
    ? request.filePath.length > 40
      ? '...' + request.filePath.slice(-37)
      : request.filePath
    : 'N/A';

  const isPretool = request.requestType === 'pretool_use';
  const preview = isPretool
    ? derivePreviewLine(request.toolName, request.toolInputJson)
    : null;

  const rootClass = isAbandoned
    ? 'p-2 bg-surface-container/40 border-l-2 border-outline-variant pointer-events-none'
    : `p-2 cursor-pointer transition-colors duration-150 ${
        isSelected
          ? 'bg-surface-container-high border-l-2 border-primary'
          : 'bg-surface-container border-l-2 border-transparent hover:bg-surface-container-high'
      }`;

  const contentOpacity = isAbandoned ? 'opacity-40' : '';

  return (
    <motion.div
      className={rootClass}
      onClick={isAbandoned ? undefined : () => selectRequest(request.id)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      role={isAbandoned ? 'listitem' : 'button'}
      aria-pressed={!isAbandoned && isSelected ? true : undefined}
      aria-disabled={isAbandoned ? true : undefined}
      aria-label={
        isAbandoned
          ? `Abandoned. Agent exited. ${request.agentId} ${
              request.toolName ?? request.requestType
            } request for ${truncatedPath}.`
          : undefined
      }
      tabIndex={isAbandoned ? -1 : 0}
      onKeyDown={(e) => {
        if (!isAbandoned && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          selectRequest(request.id);
        }
      }}
    >
      {/* Agent ID + Urgency + ToolBadge */}
      <div className={`flex items-center justify-between gap-2 ${contentOpacity}`}>
        <span className="font-mono text-xs font-bold text-on-surface truncate">
          {request.agentId}
        </span>
        <div className="flex items-center gap-2">
          <UrgencyBadge urgency={request.urgency} />
          {isPretool && <ToolBadge toolName={request.toolName} />}
        </div>
      </div>

      {/* Request type */}
      <div className={`mt-1 ${contentOpacity}`}>
        <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
          {request.requestType.replace(/_/g, ' ')}
        </span>
      </div>

      {/* File path */}
      <div className={`mt-1 ${contentOpacity}`}>
        <span
          className="font-mono text-xs text-on-surface-variant truncate block"
          title={request.filePath ?? undefined}
        >
          {truncatedPath}
        </span>
      </div>

      {/* Preview line (pretool_use only) */}
      {preview && (
        <div className={`mt-2 ${contentOpacity}`}>
          <span className="font-mono text-[10px] leading-[1.4] tracking-[-0.025em] text-on-surface-variant truncate block overflow-hidden whitespace-nowrap">
            <span className={GLYPH_CLASS[preview.glyphColor]}>{preview.glyph}</span>
            {preview.content ? <> {preview.content}</> : null}
          </span>
        </div>
      )}

      {/* Footer: abandoned note OR timestamp */}
      {isAbandoned ? (
        <div className="mt-1">
          <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/60">
            ABANDONED — AGENT EXITED
          </span>
        </div>
      ) : (
        <div className="mt-1">
          <span className="font-mono text-[10px] text-on-surface-variant/60">
            {new Date(request.createdAt).toLocaleTimeString()}
          </span>
        </div>
      )}
    </motion.div>
  );
}
