import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EventCard } from '../EventCard';
import type { AgentEvent } from '../../../stores/chatStore';

// motion/react mock for ToolUseCard expansion animations.
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const {
        initial: _i,
        animate: _a,
        exit: _e,
        transition: _t,
        layout: _l,
        ...rest
      } = props;
      return <div {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</div>;
    },
    span: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props;
      return <span {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</span>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Phase 8 ToolPreview for ToolUseCard branch.
vi.mock('../../../views/CommsHub/ToolPreview', () => ({
  ToolPreview: () => <div data-testid="tool-preview-stub" />,
}));

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

function renderCard(event: AgentEvent) {
  return render(
    <MemoryRouter>
      <EventCard event={event} />
    </MemoryRouter>,
  );
}

describe('EventCard', () => {
  it('dispatches user_text -> UserMessageCard', () => {
    renderCard(mk({ eventType: 'user_text' }));
    expect(screen.getByTestId('user-message-card')).toBeInTheDocument();
  });

  it('dispatches assistant_text -> AssistantTextCard', () => {
    renderCard(mk({ eventType: 'assistant_text' }));
    expect(screen.getByTestId('assistant-text-card')).toBeInTheDocument();
  });

  it('dispatches tool_use -> ToolUseCard', () => {
    renderCard(
      mk({
        eventType: 'tool_use',
        payloadJson: { tool_name: 'Edit', tool_input: { file_path: '/tmp/a.txt' } },
      }),
    );
    expect(screen.getByTestId('tool-use-card')).toBeInTheDocument();
  });

  it('dispatches approval_link -> ApprovalLinkCard', () => {
    renderCard(mk({ eventType: 'approval_link' }));
    expect(screen.getByTestId('approval-link-card')).toBeInTheDocument();
  });

  it('dispatches tool_result -> ToolResultCard', () => {
    renderCard(mk({ eventType: 'tool_result' }));
    expect(screen.getByTestId('tool-result-card')).toBeInTheDocument();
  });

  it('dispatches session_boundary -> SessionBoundary', () => {
    renderCard(mk({ eventType: 'session_boundary' }));
    expect(screen.getByTestId('session-boundary')).toBeInTheDocument();
  });

  it('dispatches raw_stdout -> RawStreamCard (stdout variant)', () => {
    renderCard(mk({ eventType: 'raw_stdout' }));
    expect(screen.getByTestId('raw-stream-stdout')).toBeInTheDocument();
  });

  it('dispatches raw_stderr -> RawStreamCard (stderr variant)', () => {
    renderCard(mk({ eventType: 'raw_stderr' }));
    expect(screen.getByTestId('raw-stream-stderr')).toBeInTheDocument();
  });

  it('falls back to SystemNoteCard for unknown event types', () => {
    renderCard(mk({ eventType: 'weird_new_type' }));
    expect(screen.getByTestId('system-note-card')).toBeInTheDocument();
  });
});
