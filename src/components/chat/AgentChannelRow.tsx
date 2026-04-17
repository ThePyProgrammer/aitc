// Phase 10 — single master-list row (64px tall). Wave 0 (Plan 01) renders
// agent ID + adapter chip + unread badge; Plan 05 wires last-event preview,
// timestamps, and selection state.

import type { ChatChannel } from '../../stores/chatStore';
import { ReadOnlyBadge } from './ReadOnlyBadge';

export interface AgentChannelRowProps {
  channel: ChatChannel;
}

export function AgentChannelRow({ channel }: AgentChannelRowProps) {
  const isReadOnly = !channel.chatDuplex;
  return (
    <div
      data-testid="agent-channel-row"
      data-agent-id={channel.agentId}
      className={`h-16 flex flex-col justify-center px-3 ${
        channel.archived ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-bold text-on-surface truncate">
          {channel.agentId}
        </span>
        <span className="font-headline text-[10px] font-bold tracking-widest uppercase text-on-surface-variant">
          {channel.adapterType.toUpperCase()}
        </span>
        {isReadOnly && <ReadOnlyBadge />}
      </div>
      {channel.unreadCount > 0 && (
        <span
          data-testid="agent-channel-unread"
          className="mt-0.5 font-mono text-[10px] text-primary"
        >
          {channel.unreadCount}
        </span>
      )}
    </div>
  );
}
