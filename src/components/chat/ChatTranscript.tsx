// Phase 10 — scrolling transcript pane.
// TanStack Virtual list with bottom-anchored scrolling (renders oldest→newest,
// newest at bottom). On mount, scrolls to bottom. When scrolled up and a new
// event arrives, renders the floating `↓ N_NEW_MESSAGES` pill bottom-right.
// Scroll-to-top (or near-top) dispatches loadOlder(agentId) for D-18 upward
// infinite-scroll.

import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useChatStore, type AgentEvent } from '../../stores/chatStore';
import { EventCard } from './EventCard';

const EMPTY_EVENTS: AgentEvent[] = [];
const BOTTOM_THRESHOLD_PX = 24;
const TOP_THRESHOLD_PX = 16;

export interface ChatTranscriptProps {
  agentId: string | null;
}

export function ChatTranscript({ agentId }: ChatTranscriptProps) {
  const events = useChatStore((s) =>
    agentId ? s.eventsByAgent[agentId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );
  const loadOlder = useChatStore((s) => s.loadOlder);
  const channels = useChatStore((s) => s.channels);
  const currentChannel = channels.find((c) => c.agentId === agentId) ?? null;
  const isArchived = !!currentChannel?.archived;

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 60,
    overscan: 10,
    getItemKey: (i) => events[i]?.id ?? i,
  });

  // Scroll to bottom on mount / agent change.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
    prevLengthRef.current = events.length;
    setAtBottom(true);
    setNewMessageCount(0);
    // agentId reset should fire this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Handle new event arrival.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevLengthRef.current;
    const curr = events.length;
    const delta = curr - prev;
    if (delta > 0) {
      if (atBottom) {
        // Stay pinned to bottom.
        el.scrollTo({ top: el.scrollHeight });
        setNewMessageCount(0);
      } else {
        setNewMessageCount((c) => c + delta);
      }
    }
    prevLengthRef.current = curr;
  }, [events.length, atBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBot = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
    setAtBottom(atBot);
    if (atBot) setNewMessageCount(0);
    // Near-top triggers loadOlder (D-18 upward infinite-scroll).
    if (el.scrollTop <= TOP_THRESHOLD_PX && agentId && events.length > 0) {
      void loadOlder(agentId);
    }
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNewMessageCount(0);
  };

  if (!agentId) {
    return (
      <div
        data-testid="chat-transcript-empty"
        className="flex-1 flex flex-col items-center justify-center font-headline text-[10px] uppercase tracking-widest text-on-surface-variant"
      >
        NO_AGENT_SELECTED
      </div>
    );
  }

  if (events.length === 0) {
    if (isArchived) {
      return (
        <div
          data-testid="chat-transcript"
          className="flex-1 flex flex-col items-center justify-center gap-2 p-6"
        >
          <h3 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
            SESSION_ARCHIVED
          </h3>
          <p className="font-mono text-xs text-on-surface-variant/60 text-center">
            This agent has terminated. Relaunch from Tower Control to resume the thread.
          </p>
        </div>
      );
    }
    return (
      <div
        data-testid="chat-transcript"
        className="flex-1 flex flex-col items-center justify-center gap-2 p-6"
      >
        <h3 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
          NO_MESSAGES
        </h3>
        <p className="font-mono text-xs text-on-surface-variant/60 text-center">
          Send a message to begin communication with this agent.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div
        ref={scrollRef}
        data-testid="chat-transcript"
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const event = events[vi.index];
            return (
              <div
                key={event.id}
                ref={virtualizer.measureElement}
                data-index={vi.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <EventCard event={event} />
              </div>
            );
          })}
        </div>
      </div>
      {newMessageCount > 0 && (
        <button
          type="button"
          data-testid="new-messages-pill"
          onClick={jumpToBottom}
          className="absolute bottom-4 right-4 font-headline text-[10px] font-bold tracking-widest uppercase px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
        >
          ↓ {newMessageCount}_NEW_MESSAGES
        </button>
      )}
    </div>
  );
}
