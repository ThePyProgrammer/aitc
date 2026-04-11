import { useEffect, useRef } from 'react';
import { useCommsStore } from '../../stores/commsStore';
import { DeliveryStatus } from '../../components/ui/DeliveryStatus';

interface ChatThreadProps {
  agentId: string;
}

export function ChatThread({ agentId }: ChatThreadProps) {
  const fetchMessages = useCommsStore((s) => s.fetchMessages);
  const messages = useCommsStore((s) => s.messages[agentId] ?? []);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchMessages(agentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 border border-outline-variant/10">
        <h3 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
          NO_MESSAGES
        </h3>
        <p className="mt-2 font-mono text-xs text-on-surface-variant/60">
          Send a message to begin communication with this agent.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-auto max-h-[300px] border border-outline-variant/10 p-3">
      {sorted.map((msg) => {
        const isOutbound = msg.direction === 'outbound';
        return (
          <div
            key={msg.id}
            className={`flex flex-col max-w-[80%] ${
              isOutbound ? 'self-end' : 'self-start'
            }`}
          >
            <div
              className={`px-3 py-2 ${
                isOutbound
                  ? 'bg-surface-container'
                  : 'bg-surface-container-low'
              }`}
            >
              <p className="font-mono text-sm text-on-surface">{msg.content}</p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-on-surface-variant" style={{ fontSize: '10px' }}>
                {new Date(msg.createdAt).toLocaleTimeString()}
              </span>
              <DeliveryStatus status={msg.deliveryStatus} />
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
