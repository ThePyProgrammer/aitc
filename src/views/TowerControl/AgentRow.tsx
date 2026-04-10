import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Square } from 'lucide-react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { AgentInfo } from '../../stores/agentStore';
import { useAgentStore } from '../../stores/agentStore';

interface AgentRowProps {
  agent: AgentInfo;
  isEven: boolean;
}

export function AgentRow({ agent, isEven }: AgentRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const [editingIntent, setEditingIntent] = useState(false);
  const [intentValue, setIntentValue] = useState(agent.intent ?? '');
  const terminateAgent = useAgentStore((s) => s.terminateAgent);
  const updateIntent = useAgentStore((s) => s.updateIntent);

  const isConflict = agent.state === 'conflict';
  const bgClass = isConflict
    ? 'bg-error/5'
    : isEven
      ? 'bg-surface-container-low'
      : 'bg-surface-container';

  const handleTerminate = async () => {
    await terminateAgent(agent.id);
    setConfirmTerminate(false);
  };

  const handleIntentSubmit = async () => {
    if (intentValue.trim()) {
      await updateIntent(agent.id, intentValue.trim());
    }
    setEditingIntent(false);
  };

  return (
    <div>
      <div
        className={`flex h-12 items-center px-4 transition-colors duration-150 hover:bg-surface-container-high cursor-pointer ${bgClass} ${
          isConflict ? 'border-l-2 border-error' : 'border-l-2 border-transparent'
        }`}
        onClick={() => setExpanded(!expanded)}
        role="row"
        aria-expanded={expanded}
      >
        {/* AGENT_ID - 20% */}
        <div className="w-[20%] font-mono text-xs font-bold text-on-surface truncate">
          {agent.id}
        </div>

        {/* PROTOCOL - 15% */}
        <div className="w-[15%] font-mono text-xs text-secondary truncate">
          {agent.protocol}
        </div>

        {/* STATUS - 15% */}
        <div className="w-[15%]">
          <StatusBadge variant={agent.state}>{agent.state.toUpperCase()}</StatusBadge>
        </div>

        {/* PROCESS_PATH - 50% */}
        <div className="w-[50%] flex items-center gap-2">
          <span
            className="font-mono text-xs text-on-surface-variant truncate flex-1"
            style={{ direction: 'rtl', textAlign: 'left' }}
          >
            {agent.cwd ?? 'N/A'}
          </span>

          {/* Stop button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmTerminate(true);
            }}
            className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-1 text-on-surface-variant hover:text-error transition-opacity duration-150"
            aria-label={`Stop agent ${agent.id}`}
          >
            <Square size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`overflow-hidden ${bgClass} border-l-2 ${isConflict ? 'border-error' : 'border-transparent'}`}
          >
            <div className="px-4 py-3 flex flex-col gap-2">
              {/* Intent */}
              <div className="flex items-center gap-2">
                <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
                  INTENT:
                </span>
                {editingIntent ? (
                  <input
                    type="text"
                    value={intentValue}
                    onChange={(e) => setIntentValue(e.target.value)}
                    onBlur={handleIntentSubmit}
                    onKeyDown={(e) => e.key === 'Enter' && handleIntentSubmit()}
                    className="flex-1 bg-surface-container-lowest border border-outline/10 px-2 py-1 font-mono text-xs text-on-surface outline-none focus:border-primary/40"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingIntent(true);
                    }}
                    className="font-mono text-xs text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    {agent.intent ?? (
                      <span className="text-on-surface-variant/50 italic">
                        INTENT_UNKNOWN -- Click to label
                      </span>
                    )}
                  </button>
                )}
              </div>

              {/* Metadata */}
              <div className="flex gap-6">
                <span className="font-mono text-[10px] text-on-surface-variant">
                  PID: {agent.pid ?? 'N/A'}
                </span>
                <span className="font-mono text-[10px] text-on-surface-variant">
                  TYPE: {agent.agentType}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Terminate confirmation strip */}
      <AnimatePresence>
        {confirmTerminate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden bg-surface-container border-l-2 border-error"
          >
            <div className="px-4 py-2 flex items-center gap-3">
              <span className="font-headline text-xs font-bold uppercase tracking-widest text-error">
                TERMINATE {agent.id}?
              </span>
              <button
                onClick={handleTerminate}
                className="px-3 py-1 bg-error-container text-on-error-container font-headline text-[10px] font-bold uppercase tracking-widest hover:bg-error hover:text-on-error transition-colors duration-150"
              >
                CONFIRM_TERMINATE
              </button>
              <button
                onClick={() => setConfirmTerminate(false)}
                className="px-3 py-1 bg-transparent border border-outline/20 text-on-surface-variant font-headline text-[10px] font-bold uppercase tracking-widest hover:bg-surface-container-high transition-colors duration-150"
              >
                CANCEL
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
