import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatTranscript } from '../ChatTranscript';
import { useChatStore, type AgentEvent } from '../../../stores/chatStore';

// TanStack Virtual doesn't render items in jsdom (zero-sized containers).
// Mock it to render all items linearly so the transcript contents are
// testable without mocking ResizeObserver/getBoundingClientRect.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => {
    const items = Array.from({ length: opts.count }, (_, i) => ({
      index: i,
      key: i,
      start: i * 60,
      size: 60,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => opts.count * 60,
      measureElement: () => {},
    };
  },
}));

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

// Stub the shiki singleton — the streaming-row test exercises MarkdownBody
// with plain text (no fences), but the hook still initializes. Mocking it
// avoids lazy shiki loading during jsdom tests.
vi.mock('../../../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: () => ({ highlighter: null, isLoading: false }),
  highlightLines: () => [],
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

  // Phase 19 gap closure — synthetic streaming row below the virtualized list.
  it('renders a streaming-assistant-row when streamingByAgent[agentId] is non-empty', () => {
    useChatStore.setState({
      streamingByAgent: { a: 'Hello world, streaming in progress' },
    });
    renderT(<ChatTranscript agentId="a" />);
    const row = screen.getByTestId('streaming-assistant-row');
    expect(row).toBeInTheDocument();
    expect(row.textContent ?? '').toContain(
      'Hello world, streaming in progress',
    );
    // CLAUDE label rides on the streaming row like a non-continuation assistant row.
    expect(row.textContent ?? '').toContain('CLAUDE');
  });

  it('streaming-assistant-row is absent when streamingByAgent[agentId] is empty', () => {
    useChatStore.setState({
      eventsByAgent: { a: [mkEvent()] },
      streamingByAgent: {},
    });
    renderT(<ChatTranscript agentId="a" />);
    expect(screen.queryByTestId('streaming-assistant-row')).toBeNull();
  });

  it('streaming row replaces NO_MESSAGES empty state when no persisted events exist yet', () => {
    useChatStore.setState({
      streamingByAgent: { 'claude-cc-001': 'Partial first-turn text' },
    });
    renderT(<ChatTranscript agentId="claude-cc-001" />);
    // Empty state suppressed — streaming content IS the first sign of life.
    expect(screen.queryByText('NO_MESSAGES')).toBeNull();
    expect(screen.getByTestId('streaming-assistant-row')).toBeInTheDocument();
  });

  // Phase 19 follow-up — paired tool_result cards are filtered from the
  // virtualized list (they render inside the parent ToolUseCard's expanded
  // body). Orphan tool_results (no parent on page) still render.
  it('filters tool_result events whose parent tool_use is on the same page', () => {
    useChatStore.setState({
      eventsByAgent: {
        a: [
          mkEvent({
            id: 10,
            eventType: 'tool_use',
            payloadJson: {
              tool_use_id: 'toolu_xx',
              tool_name: 'Bash',
              tool_input: { command: 'ls' },
            },
          }),
          mkEvent({
            id: 11,
            eventType: 'tool_result',
            payloadJson: { tool_use_id: 'toolu_xx', content: 'total 42' },
          }),
        ],
      },
    });
    renderT(<ChatTranscript agentId="a" />);
    // The paired tool_result's standalone card is filtered — only one
    // tool-use-card renders for the pair. No tool-result-card sibling.
    expect(
      document.querySelectorAll('[data-testid="tool-use-card"]').length,
    ).toBe(1);
    expect(
      document.querySelector('[data-testid="tool-result-card"]'),
    ).toBeNull();
  });

  it('renders orphan tool_result when its parent tool_use is not on the page', () => {
    useChatStore.setState({
      eventsByAgent: {
        a: [
          mkEvent({
            id: 20,
            eventType: 'tool_result',
            payloadJson: {
              tool_use_id: 'toolu_orphan',
              content: 'orphaned output',
            },
          }),
        ],
      },
    });
    renderT(<ChatTranscript agentId="a" />);
    // No parent tool_use on the page → orphan renders as a standalone
    // ToolResultCard so the user isn't missing data.
    expect(
      document.querySelector('[data-testid="tool-result-card"]'),
    ).not.toBeNull();
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

  it('renders a TaskGroupCard instead of flat task_* system notes when a lifecycle bracket is present', () => {
    function mkTaskNote(
      id: number,
      subtype: 'task_started' | 'task_progress' | 'task_notification',
      extras: Record<string, unknown> = {},
    ): AgentEvent {
      return {
        id,
        agentId: 'a',
        sessionId: null,
        eventType: 'system_note',
        payloadJson: {
          text: `[system/${subtype}]`,
          data: {
            subtype,
            task_id: 'task-A',
            tool_use_id: 'toolu_1',
            ...extras,
          },
        },
        approvalRequestId: null,
        sequenceNumber: id,
        createdAt: '2026-04-24T00:00:00Z',
        deliveryStatus: null,
      };
    }
    useChatStore.setState({
      eventsByAgent: {
        a: [
          mkEvent({ id: 1 }),
          mkTaskNote(2, 'task_started', {
            description: 'Echo hello',
            prompt: 'say hi',
          }),
          mkTaskNote(3, 'task_progress', { description: 'Running step' }),
          mkTaskNote(4, 'task_notification', {
            status: 'completed',
            summary: 'done',
          }),
          mkEvent({ id: 5, payloadJson: { content: 'pong' } }),
        ],
      },
    });
    renderT(<ChatTranscript agentId="a" />);
    // Task group present, keyed by task_id.
    const groups = screen.getAllByTestId('task-group-card');
    expect(groups).toHaveLength(1);
    expect(groups[0].dataset.taskId).toBe('task-A');
    expect(groups[0].dataset.taskState).toBe('success');
    // Individual task_* system notes no longer render as standalone cards
    // when they're inside a group.
    expect(screen.queryByText('[system/task_started]')).toBeNull();
    expect(screen.queryByText('[system/task_notification]')).toBeNull();
    // Surrounding events still render.
    expect(screen.getByText('ping')).toBeInTheDocument();
    expect(screen.getByText('pong')).toBeInTheDocument();
  });
});
