import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCommsStore, type ChatMessage } from '../../stores/commsStore';

interface MiniChatCardProps {
  agentId: string;
  agentType: string;
}

export function MiniChatCard({ agentId, agentType }: MiniChatCardProps) {
  const [expanded, setExpanded] = useState(false);
  const messages = useCommsStore((s) => s.messages[agentId]) ?? [];

  const lastMessages = messages.slice(-5);
  const lastMessage = messages[messages.length - 1];

  return (
    <motion.div
      layout
      className="bg-surface-container-low border border-outline-variant/10 overflow-hidden"
      style={{ minHeight: expanded ? 'auto' : '120px', maxHeight: expanded ? 'none' : '120px' }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
    >
      {/* Header - always visible */}
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-mono text-xs font-bold text-on-surface">
            {agentId}
          </span>
          <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/60">
            {agentType}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!expanded && messages.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-mono font-bold bg-primary text-surface rounded-full">
              {messages.length}
            </span>
          )}
          {expanded ? (
            <ChevronUp size={14} strokeWidth={1.5} className="text-on-surface-variant" />
          ) : (
            <ChevronDown size={14} strokeWidth={1.5} className="text-on-surface-variant" />
          )}
        </div>
      </button>

      {/* Preview - collapsed only */}
      {!expanded && lastMessage && (
        <div className="px-3 pb-2">
          <p className="font-mono text-on-surface-variant truncate" style={{ fontSize: '10px' }}>
            {lastMessage.content}
          </p>
        </div>
      )}

      {/* Expanded messages */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="px-3 pb-2"
          >
            {lastMessages.length === 0 ? (
              <p className="font-mono text-on-surface-variant/40" style={{ fontSize: '10px' }}>
                No messages yet.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {lastMessages.map((msg: ChatMessage) => (
                  <div
                    key={msg.id}
                    className={`flex gap-1 ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                  >
                    <span
                      className={`font-mono px-1.5 py-0.5 ${
                        msg.direction === 'outbound'
                          ? 'bg-surface-container text-on-surface'
                          : 'bg-surface-container-low text-on-surface'
                      }`}
                      style={{ fontSize: '10px' }}
                    >
                      {msg.content.length > 60 ? msg.content.slice(0, 60) + '...' : msg.content}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
