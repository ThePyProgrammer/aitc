// Phase 10 — scrolling transcript pane. Wave 0 (Plan 01) maps events
// through EventCard with a plain scroll container; Plan 05 wires TanStack
// Virtual upward infinite-scroll, inverted orientation, and the
// `↓ N_NEW_MESSAGES` pill.

import { useChatStore } from '../../stores/chatStore';
import { EventCard } from './EventCard';

const EMPTY_EVENTS: never[] = [];

export interface ChatTranscriptProps {
  agentId: string | null;
}

export function ChatTranscript({ agentId }: ChatTranscriptProps) {
  // Returning a stable reference on empty so Zustand's shallow equality
  // check doesn't force a re-render loop under React 19's strict
  // useSyncExternalStore guard.
  const events = useChatStore((s) =>
    agentId ? s.eventsByAgent[agentId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  );

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
    return (
      <div
        data-testid="chat-transcript"
        className="flex-1 flex flex-col items-center justify-center gap-2 p-6"
      >
        <h3 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
          NO_MESSAGES
        </h3>
        <p className="font-mono text-xs text-on-surface-variant/60">
          Send a message to begin communication with this agent.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="chat-transcript"
      className="flex-1 flex flex-col gap-2 overflow-y-auto p-4"
    >
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}
