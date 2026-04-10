import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useAgentStore } from '../../stores/agentStore';

export function QuickCommands() {
  const [confirmHalt, setConfirmHalt] = useState(false);
  const agents = useAgentStore((s) => s.agents);
  const terminateAgent = useAgentStore((s) => s.terminateAgent);

  const handleHaltAll = async () => {
    for (const agent of agents) {
      await terminateAgent(agent.id);
    }
    setConfirmHalt(false);
  };

  return (
    <div className="bg-surface-container-low p-6">
      <h3 className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-4">
        QUICK_COMMANDS
      </h3>

      <div className="flex flex-col gap-2">
        <Button variant="ghost" className="w-full justify-start">
          FLUSH_PENDING_TASKS
        </Button>
        <Button variant="ghost" className="w-full justify-start">
          RESTART_TOWER_DAEMON
        </Button>

        {!confirmHalt ? (
          <button
            onClick={() => setConfirmHalt(true)}
            className="w-full text-left px-4 py-2 bg-transparent border border-outline/20 font-headline text-xs font-bold uppercase tracking-widest text-error hover:bg-error/10 transition-colors duration-150"
          >
            EMERGENCY_HALT_ALL
          </button>
        ) : (
          <div className="flex items-center gap-2 px-4 py-2 bg-error/5 border border-error/20">
            <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-error">
              CONFIRM HALT?
            </span>
            <button
              onClick={handleHaltAll}
              className="px-3 py-1 bg-error text-on-error font-headline text-[10px] font-bold uppercase tracking-widest hover:bg-error/80 transition-colors"
            >
              CONFIRM
            </button>
            <button
              onClick={() => setConfirmHalt(false)}
              className="px-3 py-1 bg-transparent border border-outline/20 text-on-surface-variant font-headline text-[10px] font-bold uppercase tracking-widest hover:bg-surface-container-high transition-colors"
            >
              CANCEL
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
