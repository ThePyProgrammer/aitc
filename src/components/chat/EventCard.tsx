// Phase 10 — discriminated-union dispatcher keyed by event_type (D-13).
// Unknown event types fall through to SystemNoteCard (forward-compat).
//
// `prevEvent` enables continuation-aware rendering: AssistantTextCard
// suppresses its role label when the row immediately above is another
// assistant_text chunk, so multi-chunk streaming turns read as one block.

import type { AgentEvent } from '../../stores/chatStore';
import { UserMessageCard } from './UserMessageCard';
import { AssistantTextCard } from './AssistantTextCard';
import { ToolUseCard } from './ToolUseCard';
import { ApprovalLinkCard } from './ApprovalLinkCard';
import { ToolResultCard } from './ToolResultCard';
import { SessionBoundary } from './SessionBoundary';
import { RawStreamCard } from './RawStreamCard';
import { SystemNoteCard } from './SystemNoteCard';

export interface EventCardProps {
  event: AgentEvent;
  prevEvent?: AgentEvent;
}

export function EventCard({ event, prevEvent }: EventCardProps) {
  switch (event.eventType) {
    case 'user_text':
      return <UserMessageCard event={event} />;
    case 'assistant_text':
      return (
        <AssistantTextCard
          event={event}
          isContinuation={prevEvent?.eventType === 'assistant_text'}
        />
      );
    case 'tool_use':
      return <ToolUseCard event={event} />;
    case 'approval_link':
      return <ApprovalLinkCard event={event} />;
    case 'tool_result':
      return <ToolResultCard event={event} />;
    case 'session_boundary':
      return <SessionBoundary event={event} />;
    case 'raw_stdout':
    case 'raw_stderr':
      return <RawStreamCard event={event} />;
    case 'system_note':
      return <SystemNoteCard event={event} />;
    default:
      return <SystemNoteCard event={event} />;
  }
}
