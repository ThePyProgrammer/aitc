import { useState, useRef, useEffect } from 'react';
import { useCommsStore } from '../../stores/commsStore';

interface ApprovalActionsProps {
  requestId: number;
  hasEdits: boolean;
  editedContent: string;
}

export function ApprovalActions({ requestId, hasEdits, editedContent }: ApprovalActionsProps) {
  const approveRequest = useCommsStore((s) => s.approveRequest);
  const denyRequest = useCommsStore((s) => s.denyRequest);
  const askMoreInfo = useCommsStore((s) => s.askMoreInfo);
  const approveWithEdits = useCommsStore((s) => s.approveWithEdits);

  const [confirmDeny, setConfirmDeny] = useState(false);
  const [showAskInput, setShowAskInput] = useState(false);
  const [askQuestion, setAskQuestion] = useState('');
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // Second click -- execute deny
      denyRequest(requestId);
      setConfirmDeny(false);
    } else {
      // First click -- show confirmation
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

  return (
    <div className="flex flex-col gap-2">
      {/* Button row */}
      <div className="flex items-center gap-2 h-[44px]">
        {/* APPROVE - hidden when edits exist */}
        {!hasEdits && (
          <button
            onClick={() => approveRequest(requestId)}
            className="px-4 py-2 bg-primary text-on-surface font-headline text-[10px] font-bold uppercase tracking-widest hover:bg-primary-container transition-colors duration-150"
          >
            APPROVE
          </button>
        )}

        {/* APPROVE_WITH_EDITS - visible only when edits exist */}
        {hasEdits && (
          <button
            onClick={() => approveWithEdits(requestId, editedContent)}
            className="px-4 py-2 bg-primary text-on-surface font-headline text-[10px] font-bold uppercase tracking-widest hover:bg-primary-container transition-colors duration-150"
          >
            APPROVE_WITH_EDITS
          </button>
        )}

        {/* DENY - two-step confirmation */}
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

        {/* ASK_FOR_MORE_INFO */}
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
    </div>
  );
}
