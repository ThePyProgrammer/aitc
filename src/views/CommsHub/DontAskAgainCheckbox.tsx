/**
 * Phase 8 Plan 05: DontAskAgainCheckbox — session-scoped always-allow
 * checkbox rendered below the ApprovalActions button row for pretool_use
 * rows only (D-22). Flips state on click; never submits approval itself.
 * State flows to `approveRequest` / `approveWithEdits` via the parent
 * ApprovalActions `{ alwaysAllowForSession }` opts arg.
 *
 * Label copy: `DON'T_ASK_AGAIN_THIS_SESSION_FOR_{TOOL_BADGE_LABEL}`.
 * UPPER_SNAKE_CASE per 08-UI-SPEC copywriting contract.
 */
import { Check } from 'lucide-react';

interface DontAskAgainCheckboxProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Tool badge label: 'EDIT' / 'BASH' / 'MCP' / etc. — NOT the raw tool_name. */
  toolBadgeLabel: string;
  agentId: string;
}

export function DontAskAgainCheckbox({
  checked,
  onChange,
  toolBadgeLabel,
  agentId,
}: DontAskAgainCheckboxProps) {
  const describedBy = `dontask-desc-${agentId}-${toolBadgeLabel}`;
  const toggle = () => onChange(!checked);
  return (
    <div className="flex items-center gap-2 h-6 mt-2" data-dontask-checkbox-root>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`Don't ask again this session for ${toolBadgeLabel}`}
        aria-describedby={describedBy}
        onClick={toggle}
        className={`w-4 h-4 border flex items-center justify-center transition-colors duration-150 ${
          checked
            ? 'border-primary/40 bg-primary/10'
            : 'border-outline-variant/30 bg-transparent'
        }`}
      >
        {checked && <Check className="w-2.5 h-2.5 text-primary" strokeWidth={1.5} />}
      </button>
      <label
        className="font-headline text-[10px] font-normal uppercase tracking-widest text-on-surface-variant cursor-pointer select-none"
        onClick={toggle}
      >
        {`DON'T_ASK_AGAIN_THIS_SESSION_FOR_${toolBadgeLabel}`}
      </label>
      <span id={describedBy} className="sr-only">
        Approves all {toolBadgeLabel} calls from {agentId} until AITC restarts or the agent exits.
      </span>
    </div>
  );
}
