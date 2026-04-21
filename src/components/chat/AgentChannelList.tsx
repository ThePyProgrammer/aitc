// Phase 10 — master list of chat channels (agent rows grouped by ACTIVE +
// ARCHIVED). TanStack Virtual powers the ACTIVE section (estimateSize=64,
// overscan=10). ARCHIVED is collapsible (default collapsed per UI-SPEC).
// Most-recent-activity descending sort.

import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useChatStore, type ChatChannel } from '../../stores/chatStore';
import { AgentChannelRow } from './AgentChannelRow';

function sortByRecency(channels: ChatChannel[]): ChatChannel[] {
  const copy = [...channels];
  copy.sort((a, b) => {
    const ta = a.lastEvent?.createdAt ?? '';
    const tb = b.lastEvent?.createdAt ?? '';
    // Newest first — empty strings sort to the bottom.
    if (!ta && !tb) return a.agentId.localeCompare(b.agentId);
    if (!ta) return 1;
    if (!tb) return -1;
    return tb.localeCompare(ta);
  });
  return copy;
}

export function AgentChannelList() {
  const channels = useChatStore((s) => s.channels);
  const archivedCollapsed = useChatStore((s) => s.archivedCollapsed);
  const setArchivedCollapsed = useChatStore((s) => s.setArchivedCollapsed);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectAgent = useChatStore((s) => s.selectAgent);

  const { active, archived } = useMemo(() => {
    const sorted = sortByRecency(channels);
    return {
      active: sorted.filter((c) => !c.archived),
      archived: sorted.filter((c) => c.archived),
    };
  }, [channels]);

  const activeScrollRef = useRef<HTMLDivElement>(null);
  const activeVirt = useVirtualizer({
    count: active.length,
    getScrollElement: () => activeScrollRef.current,
    estimateSize: () => 64,
    overscan: 10,
  });

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
    <div
      data-testid="agent-channel-list"
      className="flex flex-col h-full bg-surface-container-low"
    >
      <div className="px-3 pt-4 pb-2">
        <h3 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface">
          AGENT_CHANNELS
        </h3>
      </div>

      {/* ACTIVE section */}
      <div className="px-3 pb-1">
        <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
          ACTIVE
        </span>
      </div>
      <div
        ref={activeScrollRef}
        role="listbox"
        aria-label="Active agent channels"
        className="flex-1 overflow-auto"
      >
        <div
          style={{
            height: `${activeVirt.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {activeVirt.getVirtualItems().map((vi) => {
            const channel = active[vi.index];
            return (
              <div
                key={channel.agentId}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <AgentChannelRow
                  channel={channel}
                  selected={channel.agentId === selectedAgentId}
                  onClick={() => selectAgent(channel.agentId)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ARCHIVED section */}
      {archived.length > 0 && (
        <>
          <button
            type="button"
            data-testid="archived-section-header"
            onClick={() => setArchivedCollapsed(!archivedCollapsed)}
            className="flex items-center justify-between px-3 py-2 hover:bg-surface-container transition-colors"
            aria-expanded={!archivedCollapsed}
          >
            <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              ARCHIVED [{archived.length}]
            </span>
            {archivedCollapsed ? (
              <ChevronDown size={14} strokeWidth={1.5} className="text-on-surface-variant" />
            ) : (
              <ChevronUp size={14} strokeWidth={1.5} className="text-on-surface-variant" />
            )}
          </button>
          {!archivedCollapsed && (
            <div className="max-h-64 overflow-auto">
              {archived.map((channel) => (
                <AgentChannelRow
                  key={channel.agentId}
                  channel={channel}
                  selected={channel.agentId === selectedAgentId}
                  onClick={() => selectAgent(channel.agentId)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
