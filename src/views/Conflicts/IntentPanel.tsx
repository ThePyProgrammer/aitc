/**
 * Fixed bottom panel displaying agent intent cards side by side.
 *
 * Shows Agent A and Agent B intent from agentStore so users can
 * understand why each agent made their changes. Phase 5 Plan 03 -- D-03.
 */
import { useAgentStore } from '../../stores/agentStore';

interface IntentPanelProps {
  agentAId: string;
  agentBId: string;
}

export function IntentPanel({ agentAId, agentBId }: IntentPanelProps) {
  const agents = useAgentStore((s) => s.agents);
  const agentA = agents.find((a) => a.id === agentAId);
  const agentB = agents.find((a) => a.id === agentBId);

  const agentAIntent = agentA?.intent ?? null;
  const agentBIntent = agentB?.intent ?? null;

  return (
    <div className="h-[140px] bg-surface-container border-t border-outline-variant/20 flex gap-4 p-4 shrink-0">
      {/* Agent A intent card */}
      <div className="flex-1 border-l-2 border-primary bg-surface-container-low p-4 overflow-y-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-headline text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
            {agentAId}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 text-[8px] font-mono font-bold uppercase bg-primary/10 text-primary border border-primary/20">
            AGENT_A
          </span>
        </div>
        <p className="font-mono text-sm text-on-surface leading-relaxed">
          {agentAIntent ?? <span className="italic text-on-surface-variant/60">No intent available for this agent.</span>}
        </p>
      </div>

      {/* Agent B intent card */}
      <div className="flex-1 border-l-2 border-[#00cffc] bg-surface-container-low p-4 overflow-y-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-headline text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
            {agentBId}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 text-[8px] font-mono font-bold uppercase bg-[#00cffc]/10 text-[#00cffc] border border-[#00cffc]/20">
            AGENT_B
          </span>
        </div>
        <p className="font-mono text-sm text-on-surface leading-relaxed">
          {agentBIntent ?? <span className="italic text-on-surface-variant/60">No intent available for this agent.</span>}
        </p>
      </div>
    </div>
  );
}
