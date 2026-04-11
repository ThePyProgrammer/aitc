import { useAgentStore } from '../../stores/agentStore';
import { SystemLoad } from './SystemLoad';
import { TelemetryFeed } from './TelemetryFeed';
import { MiniChatCard } from './MiniChatCard';

export function TelemetryPanel() {
  const agents = useAgentStore((s) => s.agents);

  return (
    <div className="w-[260px] shrink-0 bg-surface-container flex flex-col gap-6 p-4 overflow-auto">
      {/* System load metrics */}
      <SystemLoad />

      {/* Telemetry feed */}
      <TelemetryFeed />

      {/* Mini chat cards - one per active agent */}
      <div className="flex flex-col gap-2">
        <h3 className="font-headline text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          AGENT_CHANNELS
        </h3>
        {agents.length === 0 ? (
          <p className="font-mono text-on-surface-variant/40" style={{ fontSize: '10px' }}>
            No active agents.
          </p>
        ) : (
          agents.map((agent) => (
            <MiniChatCard
              key={agent.id}
              agentId={agent.id}
              agentType={agent.agentType}
            />
          ))
        )}
      </div>
    </div>
  );
}
