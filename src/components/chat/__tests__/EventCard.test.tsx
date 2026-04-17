import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventCard } from '../EventCard';
import type { AgentEvent } from '../../../stores/chatStore';

function mk(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 1,
    agentId: 'claude-cc-001',
    sessionId: null,
    eventType: 'user_text',
    payloadJson: { content: 'hello' },
    approvalRequestId: null,
    sequenceNumber: null,
    createdAt: '2026-04-17T12:00:00Z',
    deliveryStatus: null,
    ...overrides,
  };
}

describe('EventCard', () => {
  it('dispatches user_text -> UserMessageCard', () => {
    render(<EventCard event={mk({ eventType: 'user_text' })} />);
    expect(screen.getByTestId('user-message-card')).toBeInTheDocument();
  });

  it('dispatches assistant_text -> AssistantTextCard', () => {
    render(<EventCard event={mk({ eventType: 'assistant_text' })} />);
    expect(screen.getByTestId('assistant-text-card')).toBeInTheDocument();
  });

  it('dispatches tool_use -> ToolUseCard', () => {
    render(
      <EventCard
        event={mk({
          eventType: 'tool_use',
          payloadJson: { tool_name: 'Edit', tool_input: { file_path: '/tmp/a.txt' } },
        })}
      />,
    );
    expect(screen.getByTestId('tool-use-card')).toBeInTheDocument();
  });

  it('dispatches approval_link -> ApprovalLinkCard', () => {
    render(<EventCard event={mk({ eventType: 'approval_link' })} />);
    expect(screen.getByTestId('approval-link-card')).toBeInTheDocument();
  });

  it('dispatches tool_result -> ToolResultCard', () => {
    render(<EventCard event={mk({ eventType: 'tool_result' })} />);
    expect(screen.getByTestId('tool-result-card')).toBeInTheDocument();
  });

  it('dispatches session_boundary -> SessionBoundary', () => {
    render(<EventCard event={mk({ eventType: 'session_boundary' })} />);
    expect(screen.getByTestId('session-boundary')).toBeInTheDocument();
  });

  it('dispatches raw_stdout -> RawStreamCard (stdout variant)', () => {
    render(<EventCard event={mk({ eventType: 'raw_stdout' })} />);
    expect(screen.getByTestId('raw-stream-stdout')).toBeInTheDocument();
  });

  it('dispatches raw_stderr -> RawStreamCard (stderr variant)', () => {
    render(<EventCard event={mk({ eventType: 'raw_stderr' })} />);
    expect(screen.getByTestId('raw-stream-stderr')).toBeInTheDocument();
  });

  it('falls back to SystemNoteCard for unknown event types', () => {
    render(<EventCard event={mk({ eventType: 'weird_new_type' })} />);
    expect(screen.getByTestId('system-note-card')).toBeInTheDocument();
  });
});
