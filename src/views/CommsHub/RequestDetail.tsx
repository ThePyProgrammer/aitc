import { useState, useCallback } from 'react';
import { useCommsStore } from '../../stores/commsStore';
import { InlineDiff } from './InlineDiff';
import { ApprovalActions } from './ApprovalActions';
import { ChatThread } from './ChatThread';
import { ChatInput } from './ChatInput';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { UrgencyBadge } from '../../components/ui/UrgencyBadge';
import { ToolBadge, toolLabelFor } from '../../components/ui/ToolBadge';
import { ToolPreview } from './ToolPreview';

export function RequestDetail() {
  const selectedRequest = useCommsStore((s) => s.selectedRequest());
  const setEditing = useCommsStore((s) => s.setEditing);
  const [edits, setEdits] = useState<Map<number, string>>(new Map());

  const handleEditsChange = useCallback((newEdits: Map<number, string>) => {
    setEdits(newEdits);
  }, []);

  const handleEditStart = useCallback(() => {
    if (selectedRequest) {
      setEditing(selectedRequest.id);
    }
  }, [selectedRequest, setEditing]);

  // Build edited content string from edits map
  const buildEditedContent = (): string => {
    if (!selectedRequest?.diffContent) return '';
    const lines = selectedRequest.diffContent.split('\n');
    const editedLines = lines.map((line, index) => {
      if (edits.has(index)) {
        return edits.get(index)!;
      }
      return line;
    });
    return editedLines.join('\n');
  };

  if (!selectedRequest) {
    return (
      <div className="flex-1 bg-surface-container-highest flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-5 w-[2px] bg-secondary"
            style={{ animation: 'blink-cursor 1s step-end infinite' }}
          />
          <h2 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
            SELECT_REQUEST
          </h2>
          <p className="font-mono text-xs text-on-surface-variant/60">
            Choose a request from the queue to view details.
          </p>
        </div>
      </div>
    );
  }

  const statusVariant = selectedRequest.status === 'pending' ? 'waiting'
    : selectedRequest.status === 'approved' ? 'running'
    : selectedRequest.status === 'denied' ? 'error'
    : 'idle';

  return (
    <div className="flex-1 bg-surface-container-highest flex flex-col overflow-auto">
      {/* Header */}
      <div className="px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-sm font-bold text-on-surface">
            {selectedRequest.agentId}
          </h2>
          <StatusBadge variant={statusVariant}>
            {selectedRequest.status.toUpperCase()}
          </StatusBadge>
          <UrgencyBadge urgency={selectedRequest.urgency} />
          {selectedRequest.requestType === 'pretool_use' && selectedRequest.toolName && (
            <ToolBadge toolName={selectedRequest.toolName} />
          )}
        </div>

        {/* Request type and file path */}
        <div className="mt-2 flex flex-col gap-1">
          <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
            {selectedRequest.requestType.replace(/_/g, ' ')}
          </span>
          {selectedRequest.filePath && (
            <span className="font-mono text-xs text-on-surface-variant">
              {selectedRequest.filePath}
            </span>
          )}
        </div>
      </div>

      {/* Body: ToolPreview for pretool_use rows, InlineDiff for write_access. */}
      <div className="px-6 flex-1">
        {selectedRequest.requestType === 'pretool_use' ? (
          <ToolPreview
            requestId={selectedRequest.id}
            toolName={selectedRequest.toolName ?? ''}
            toolInputJson={selectedRequest.toolInputJson}
            filePath={selectedRequest.filePath}
          />
        ) : (
          <InlineDiff
            diffContent={selectedRequest.diffContent}
            onEditsChange={handleEditsChange}
            onEditStart={handleEditStart}
          />
        )}
      </div>

      {/* Approval actions */}
      <div className="px-6 py-4">
        <ApprovalActions
          requestId={selectedRequest.id}
          hasEdits={edits.size > 0}
          editedContent={buildEditedContent()}
          requestType={selectedRequest.requestType}
          toolBadgeLabel={toolLabelFor(selectedRequest.toolName)}
          agentId={selectedRequest.agentId}
        />
      </div>

      {/* Chat thread */}
      <div className="px-6 pb-2">
        <ChatThread agentId={selectedRequest.agentId} />
      </div>

      {/* Chat input */}
      <div className="px-6 pb-4">
        <ChatInput agentId={selectedRequest.agentId} />
      </div>
    </div>
  );
}
