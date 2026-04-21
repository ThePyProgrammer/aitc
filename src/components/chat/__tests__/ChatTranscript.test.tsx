import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatTranscript } from '../ChatTranscript';
import { useChatStore, type AgentEvent } from '../../../stores/chatStore';

// motion/react mock for EventCard child tool-use expansion animations.
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

// Mock ToolPreview for tool_use branch.
vi.mock('../../../views/CommsHub/ToolPreview', () => ({
  ToolPreview: () => <div data-testid="tool-preview-stub" />,
}));

function renderT(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function mkEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 1,
    agentId: 'a',
    sessionId: null,
    eventType: 'user_text',
    payloadJson: { content: 'ping' },
    approvalRequestId: null,
    sequenceNumber: null,
    createdAt: '2026-04-17T12:00:00Z',
    deliveryStatus: 'delivered',
    ...overrides,
  };
}

describe('ChatTranscript', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    // Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn();
  });

  it('shows NO_AGENT_SELECTED when agentId is null', () => {
    renderT(<ChatTranscript agentId={null} />);
    expect(screen.getByTestId('chat-transcript-empty')).toBeInTheDocument();
  });

  it('shows NO_MESSAGES empty state when events array is empty', () => {
    renderT(<ChatTranscript agentId="claude-cc-001" />);
    expect(screen.getByText('NO_MESSAGES')).toBeInTheDocument();
  });

  it('shows SESSION_ARCHIVED empty state when channel.archived=true', () => {
    useChatStore.setState({
      channels: [
        {
          agentId: 'a',
          adapterType: 'claude_code',
          status: 'terminated',
          archived: true,
          chatDuplex: true,
          lastEvent: null,
          unreadCount: 0,
          currentSessionId: null,
        },
      ],
    });
    renderT(<ChatTranscript agentId="a" />);
    expect(screen.getByText('SESSION_ARCHIVED')).toBeInTheDocument();
  });

  it('renders each event through EventCard', () => {
    useChatStore.setState({ eventsByAgent: { a: [mkEvent()] } });
    renderT(<ChatTranscript agentId="a" />);
    expect(screen.getByTestId('chat-transcript')).toBeInTheDocument();
    expect(screen.getByTestId('user-message-card')).toBeInTheDocument();
  });

  it('scrolls to bottom on mount (scrollTo called)', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollTo = scrollSpy;
    useChatStore.setState({ eventsByAgent: { a: [mkEvent()] } });
    renderT(<ChatTranscript agentId="a" />);
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('scrolling to top triggers loadOlder', () => {
    const loadOlderSpy = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      eventsByAgent: { a: [mkEvent(), mkEvent({ id: 2 })] },
      loadOlder: loadOlderSpy,
    });
    renderT(<ChatTranscript agentId="a" />);
    const scrollEl = screen.getByTestId('chat-transcript');
    // Simulate scrollTop = 0 — directly fire a scroll event.
    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 0,
      configurable: true,
    });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(scrollEl, 'clientHeight', {
      value: 300,
      configurable: true,
    });
    fireEvent.scroll(scrollEl);
    expect(loadOlderSpy).toHaveBeenCalledWith('a');
  });

  it('new-messages pill appears when scrolled up and a new event arrives', () => {
    useChatStore.setState({
      eventsByAgent: { a: [mkEvent()] },
    });
    const { rerender } = renderT(<ChatTranscript agentId="a" />);
    const scrollEl = screen.getByTestId('chat-transcript');
    // Simulate user scrolled up (not at bottom).
    Object.defineProperty(scrollEl, 'scrollTop', {
      value: 100,
      configurable: true,
    });
    Object.defineProperty(scrollEl, 'scrollHeight', {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(scrollEl, 'clientHeight', {
      value: 300,
      configurable: true,
    });
    fireEvent.scroll(scrollEl);

    // New event arrives.
    useChatStore.setState({
      eventsByAgent: { a: [mkEvent(), mkEvent({ id: 2 })] },
    });
    rerender(
      <MemoryRouter>
        <ChatTranscript agentId="a" />
      </MemoryRouter>,
    );

    // Expect the pill to render somewhere.
    expect(screen.getByTestId('new-messages-pill')).toBeInTheDocument();
  });
});
