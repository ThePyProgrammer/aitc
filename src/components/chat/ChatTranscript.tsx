// Phase 10 — scrolling transcript pane.
// TanStack Virtual list with bottom-anchored scrolling (renders oldest→newest,
// newest at bottom). On mount, scrolls to bottom. When scrolled up and a new
// event arrives, renders the floating `↓ N_NEW_MESSAGES` pill bottom-right.
// Scroll-to-top (or near-top) dispatches loadOlder(agentId) for D-18 upward
// infinite-scroll.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useChatStore,
  selectTranscriptItems,
  type AgentEvent,
} from '../../stores/chatStore';
import { EventCard } from './EventCard';
import { MarkdownBody } from './MarkdownBody';
import { TaskGroupCard } from './TaskGroupCard';

const EMPTY_EVENTS: AgentEvent[] = [];
const BOTTOM_THRESHOLD_PX = 24;
const TOP_THRESHOLD_PX = 16;

export interface ChatTranscriptProps {
  agentId: string | null;
}

export function ChatTranscript({ agentId }: ChatTranscriptProps) {
  const rawEvents = useChatStore((s) =>
    agentId ? s.eventsByAgent[agentId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );
  // Phase 19 follow-up — tool_result events whose paired tool_use is on
  // the same transcript page are rendered INSIDE the parent ToolUseCard's
  // expanded body (see ToolResultSection). Filter them out of the
  // virtualized list so they don't double-render as standalone cards.
  // Orphan tool_result events (parent paginated off) still render via
  // ToolResultCard — defensive fallback.
  const flatEvents = useMemo(() => {
    const toolUseIds = new Set<string>();
    for (const e of rawEvents) {
      if (e.eventType === 'tool_use') {
        const id = (e.payloadJson as { tool_use_id?: string } | null)
          ?.tool_use_id;
        if (id) toolUseIds.add(id);
      }
    }
    if (toolUseIds.size === 0) return rawEvents;
    return rawEvents.filter((e) => {
      if (e.eventType !== 'tool_result') return true;
      const id = (e.payloadJson as { tool_use_id?: string } | null)
        ?.tool_use_id;
      return !id || !toolUseIds.has(id);
    });
  }, [rawEvents]);
  // Phase 19.1 — fold the Task-tool lifecycle bracket (system/task_started
  // → system/task_progress* → system/task_notification) into a single
  // collapsible group keyed by task_id. Ordinary events pass through as
  // single-slot items so the virtualizer still sees a flat list.
  const items = useMemo(() => selectTranscriptItems(flatEvents), [flatEvents]);

  // Phase 19 gap closure — per-agent mid-turn streaming buffer fed by
  // agent-assistant-delta. Renders below the virtualized list as a
  // synthetic assistant row; cleared by the store when the final
  // assistant_text row lands (or on TurnComplete for tool-only turns).
  const streamingContent = useChatStore((s) =>
    agentId ? s.streamingByAgent[agentId] ?? '' : '',
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
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 60,
    overscan: 10,
    getItemKey: (i) => {
      const item = items[i];
      if (!item) return i;
      return item.kind === 'event' ? item.event.id : `task:${item.taskId}`;
    },
  });

  // Scroll to bottom on mount / agent change.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
    prevLengthRef.current = items.length;
    setAtBottom(true);
    setNewMessageCount(0);
    // agentId reset should fire this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Handle new event arrival. Count is the number of TOP-LEVEL items
  // (groups count as one regardless of child count) so
  // `N_NEW_MESSAGES` stays meaningful when a subagent streams many
  // task_progress rows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevLengthRef.current;
    const curr = items.length;
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
  }, [items.length, atBottom]);

  // Streaming-row auto-scroll: when the mid-turn buffer grows and the user
  // is already at the bottom, keep them pinned. Does NOT bump
  // newMessageCount — an in-progress turn isn't a new message yet.
  useEffect(() => {
    if (!atBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [streamingContent.length, atBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBot = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
    setAtBottom(atBot);
    if (atBot) setNewMessageCount(0);
    // Near-top triggers loadOlder (D-18 upward infinite-scroll). Flat
    // `flatEvents` is the right signal here — we care whether there's a
    // real page of history to pull, regardless of how it grouped.
    if (el.scrollTop <= TOP_THRESHOLD_PX && agentId && flatEvents.length > 0) {
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

  if (items.length === 0 && streamingContent === '') {
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
        // pr-6 restores the 24px gray gutter on the right so `w-full`
        // cards (UserMessageCard / AssistantTextCard bg) stop symmetrical
        // with the outer wrapper's pl-6 on the left. WebKit paints the
        // scrollbar in the container's padding gutter — flush with the
        // detail pane's right edge — so we keep the scrollbar at the
        // screen edge AND put the gray margin back.
        className="flex-1 overflow-y-auto pr-6"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const item = items[vi.index];
            if (!item) return null;
            // Continuation detection for AssistantTextCard only flows
            // between top-level events; a task group breaks the chain
            // (which is the right behaviour — role label reappearing
            // after a subagent detour reads cleanly).
            const prevItem = vi.index > 0 ? items[vi.index - 1] : undefined;
            const prevEvent =
              prevItem?.kind === 'event' ? prevItem.event : undefined;
            const key =
              item.kind === 'event' ? item.event.id : `task:${item.taskId}`;
            return (
              <div
                key={key}
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
                {item.kind === 'event' ? (
                  <EventCard event={item.event} prevEvent={prevEvent} />
                ) : (
                  <TaskGroupCard
                    taskId={item.taskId}
                    header={item.header}
                    children={item.children}
                    footer={item.footer}
                  />
                )}
              </div>
            );
          })}
        </div>
        {streamingContent !== '' && (
          <div
            data-testid="streaming-assistant-row"
            className="w-full px-5 py-3 border-t border-outline-variant/10"
          >
            <div className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant/70 mb-1">
              CLAUDE
            </div>
            <MarkdownBody content={streamingContent} streaming />
          </div>
        )}
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
