/**
 * ApprovalActions — Phase 4 action row, extended in Phase 8 Plan 05:
 *  - pretool_use rows get a DontAskAgainCheckbox below the button row
 *    (D-22); its state flows into `approveRequest` / `approveWithEdits`
 *    as `{ alwaysAllowForSession }`.
 *  - DENY ignores the checkbox entirely (T-08-12 repudiation guard).
 *  - Checkbox resets when the requestId prop changes.
 */
import { useState, useRef, useEffect } from 'react';
import { useCommsStore } from '../../stores/commsStore';
import { DontAskAgainCheckbox } from './DontAskAgainCheckbox';

interface ApprovalActionsProps {
  requestId: number;
  hasEdits: boolean;
  editedContent: string;
  // Phase 8 extension:
  requestType?: string;
  /** Short badge label (e.g. 'EDIT', 'BASH', 'MCP'); null for write_access. */
  toolBadgeLabel?: string | null;
  agentId?: string;
}

export function ApprovalActions({
  requestId,
  hasEdits,
  editedContent,
  requestType,
  toolBadgeLabel,
  agentId,
}: ApprovalActionsProps) {
  const approveRequest = useCommsStore((s) => s.approveRequest);
  const denyRequest = useCommsStore((s) => s.denyRequest);
  const askMoreInfo = useCommsStore((s) => s.askMoreInfo);
  const approveWithEdits = useCommsStore((s) => s.approveWithEdits);

  const [confirmDeny, setConfirmDeny] = useState(false);
  const [showAskInput, setShowAskInput] = useState(false);
  const [askQuestion, setAskQuestion] = useState('');
  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset checkbox when the selected request changes.
  useEffect(() => {
    setAlwaysAllow(false);
  }, [requestId]);

  // Auto-revert deny confirmation after 3 seconds
  useEffect(() => {
    if (confirmDeny) {
      confirmTimeoutRef.current = setTimeout(() => {
        setConfirmDeny(false);
      }, 3000);
    }
    return () => {
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
      }
    };
  }, [confirmDeny]);

  const handleDenyClick = () => {
    if (confirmDeny) {
      // Second click — execute deny. T-08-12: never pass alwaysAllowForSession.
      denyRequest(requestId);
      setConfirmDeny(false);
    } else {
      setConfirmDeny(true);
    }
  };

  const handleAskSubmit = () => {
    if (askQuestion.trim()) {
      askMoreInfo(requestId, askQuestion.trim());
      setAskQuestion('');
      setShowAskInput(false);
    }
  };

  const isPretool = requestType === 'pretool_use';

  return (
    <div className="flex flex-col gap-2">
      {/* Button row */}
      <div className="flex items-center gap-2 h-[44px]">
        {!hasEdits && (
          <button
            onClick={() =>
              approveRequest(requestId, { alwaysAllowForSession: alwaysAllow })
            }
            className="px-4 py-2 bg-primary text-on-surface font-headline text-[10px] font-bold uppercase tracking-widest hover:bg-primary-container transition-colors duration-150"
          >
            APPROVE
          </button>
        )}

        {hasEdits && (
          <button
            onClick={() =>
              approveWithEdits(requestId, editedContent, {
                alwaysAllowForSession: alwaysAllow,
              })
            }
            className="px-4 py-2 bg-primary text-on-surface font-headline text-[10px] font-bold uppercase tracking-widest hover:bg-primary-container transition-colors duration-150"
          >
            APPROVE_WITH_EDITS
          </button>
        )}

        <button
          onClick={handleDenyClick}
          className={`px-4 py-2 font-headline text-[10px] font-bold uppercase tracking-widest transition-colors duration-150 ${
            confirmDeny
              ? 'bg-error-container text-on-error-container'
              : 'bg-error text-white'
          }`}
        >
          {confirmDeny ? 'CONFIRM_DENY' : 'DENY'}
        </button>

        <button
          onClick={() => setShowAskInput(!showAskInput)}
          className="px-4 py-2 border border-outline/20 text-secondary font-headline text-[10px] font-bold uppercase tracking-widest hover:bg-surface-container-high transition-colors duration-150"
        >
          ASK_FOR_MORE_INFO
        </button>
      </div>

      {/* Ask for more info input */}
      {showAskInput && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={askQuestion}
            onChange={(e) => setAskQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAskSubmit();
              if (e.key === 'Escape') setShowAskInput(false);
            }}
            placeholder="TYPE_QUERY..."
            className="flex-1 bg-surface-container-lowest border border-outline/10 px-3 py-2 font-mono text-xs text-on-surface outline-none focus:border-secondary/40"
            autoFocus
          />
          <button
            onClick={handleAskSubmit}
            className="px-3 py-2 bg-secondary/10 text-secondary font-headline text-[10px] font-bold uppercase tracking-widest hover:bg-secondary/20 transition-colors duration-150"
          >
            SEND
          </button>
        </div>
      )}

      {/* Phase 8 Plan 05: don't-ask-again checkbox (pretool_use only) */}
      {isPretool && toolBadgeLabel && agentId && (
        <DontAskAgainCheckbox
          checked={alwaysAllow}
          onChange={setAlwaysAllow}
          toolBadgeLabel={toolBadgeLabel}
          agentId={agentId}
        />
      )}
    </div>
  );
}
