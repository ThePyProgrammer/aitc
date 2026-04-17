// Phase 10 — discriminated-union dispatcher keyed by event_type (D-13).
// Unknown event types fall through to SystemNoteCard (forward-compat).

import type { FC } from 'react';
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
}

const RENDERERS: Record<string, FC<EventCardProps>> = {
  user_text: UserMessageCard,
  assistant_text: AssistantTextCard,
  tool_use: ToolUseCard,
  approval_link: ApprovalLinkCard,
  tool_result: ToolResultCard,
  session_boundary: SessionBoundary,
  raw_stdout: RawStreamCard,
  raw_stderr: RawStreamCard,
  system_note: SystemNoteCard,
};

export function EventCard({ event }: EventCardProps) {
  const Renderer = RENDERERS[event.eventType] ?? SystemNoteCard;
  return <Renderer event={event} />;
}
