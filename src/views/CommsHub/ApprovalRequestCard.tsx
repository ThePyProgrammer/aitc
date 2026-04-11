import { motion } from 'motion/react';
import { UrgencyBadge } from '../../components/ui/UrgencyBadge';
import { useCommsStore, type ApprovalRequest } from '../../stores/commsStore';

interface ApprovalRequestCardProps {
  request: ApprovalRequest;
}

export function ApprovalRequestCard({ request }: ApprovalRequestCardProps) {
  const selectedRequestId = useCommsStore((s) => s.selectedRequestId);
  const selectRequest = useCommsStore((s) => s.selectRequest);
  const isSelected = selectedRequestId === request.id;

  const truncatedPath = request.filePath
    ? request.filePath.length > 40
      ? '...' + request.filePath.slice(-37)
      : request.filePath
    : 'N/A';

  return (
    <motion.div
      className={`p-2 cursor-pointer transition-colors duration-150 ${
        isSelected
          ? 'bg-surface-container-high border-l-2 border-primary'
          : 'bg-surface-container border-l-2 border-transparent hover:bg-surface-container-high'
      }`}
      onClick={() => selectRequest(request.id)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      role="button"
      aria-pressed={isSelected}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectRequest(request.id);
        }
      }}
    >
      {/* Agent ID and urgency */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-bold text-on-surface truncate">
          {request.agentId}
        </span>
        <UrgencyBadge urgency={request.urgency} />
      </div>

      {/* Request type */}
      <div className="mt-1">
        <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
          {request.requestType.replace(/_/g, ' ')}
        </span>
      </div>

      {/* File path */}
      <div className="mt-1">
        <span className="font-mono text-xs text-on-surface-variant truncate block" title={request.filePath ?? undefined}>
          {truncatedPath}
        </span>
      </div>

      {/* Timestamp */}
      <div className="mt-1">
        <span className="font-mono text-[10px] text-on-surface-variant/60">
          {new Date(request.createdAt).toLocaleTimeString()}
        </span>
      </div>
    </motion.div>
  );
}
