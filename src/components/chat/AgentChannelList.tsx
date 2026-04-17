// Phase 10 — master list of chat channels (agent rows grouped by ACTIVE +
// ARCHIVED). Wave 0 (Plan 01) returns a minimal placeholder; Plan 05 wires
// TanStack Virtual with estimateSize=64.

import { useChatStore } from '../../stores/chatStore';
import { AgentChannelRow } from './AgentChannelRow';

export function AgentChannelList() {
  const channels = useChatStore((s) => s.channels);

  if (channels.length === 0) {
    return (
      <div
        data-testid="agent-channel-list"
        className="flex flex-col items-center justify-center p-4 font-headline text-[10px] uppercase tracking-widest text-on-surface-variant"
      >
        NO_AGENT_CHANNELS
      </div>
    );
  }

  return (
    <div data-testid="agent-channel-list" className="flex flex-col">
      {channels.map((channel) => (
        <AgentChannelRow key={channel.agentId} channel={channel} />
      ))}
    </div>
  );
}
