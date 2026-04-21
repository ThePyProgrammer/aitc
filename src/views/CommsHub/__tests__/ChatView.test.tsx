import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatView } from '../ChatView';
import { useChatStore, type ChatChannel } from '../../../stores/chatStore';

// Mock @tanstack/react-virtual so jsdom's zero-sized containers still
// render every row (the real virtualizer would report 0 items because
// getBoundingClientRect returns 0,0 in jsdom).
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 64,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        key: i,
        index: i,
        start: i * 64,
        end: (i + 1) * 64,
        size: 64,
      })),
    measureElement: () => undefined,
  }),
}));

// Strip motion props so `<motion.div>` renders as plain div in jsdom.
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props;
      return <div {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</div>;
    },
    span: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props;
      return <span {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</span>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Tauri invoke so chatStore actions don't explode.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

function mkChannel(overrides: Partial<ChatChannel> = {}): ChatChannel {
  return {
    agentId: 'KAGENT-1',
    adapterType: 'claude-code',
    status: 'running',
    archived: false,
    chatDuplex: true,
    lastEvent: null,
    unreadCount: 0,
    currentSessionId: 'abcdef12-3456-7890-aaaa-bbbbccccdddd',
    ...overrides,
  };
}

function renderChatView(initialEntries: string[] = ['/comms']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ChatView />
    </MemoryRouter>,
  );
}

describe('ChatView', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    vi.clearAllMocks();
  });

  it('renders the MasterDetailShell hierarchy with CHAT-tab overrides', () => {
    renderChatView();
    expect(screen.getByTestId('master-detail-root')).toBeInTheDocument();
    const rail = screen.getByTestId('rail');
    expect(rail.style.width).toBe('280px');
    // detailWidth='flex' means no right-detail aside.
    expect(screen.queryByTestId('detail')).not.toBeInTheDocument();
  });

  it('mounts with no agent selected -> shows SELECT_AGENT_CHANNEL empty state', () => {
    renderChatView();
    expect(screen.getByText('SELECT_AGENT_CHANNEL')).toBeInTheDocument();
  });

  it('renders full detail-pane header when an agent is selected (duplex)', () => {
    useChatStore.setState({
      channels: [mkChannel()],
      selectedAgentId: 'KAGENT-1',
    });
    renderChatView();
    // Agent ID appears in both master list row + detail header (2x expected).
    expect(screen.getAllByText('KAGENT-1').length).toBeGreaterThanOrEqual(1);
    // Session pill (first 8 chars) lives only in the detail header.
    expect(screen.getByText(/SESSION · abcdef12/)).toBeInTheDocument();
    // Clear thread button is unique to the detail header.
    expect(screen.getByText('CLEAR_THREAD')).toBeInTheDocument();
  });

  it('duplex agent shows enabled ChatInput (no READ-ONLY badge)', () => {
    useChatStore.setState({
      channels: [mkChannel({ chatDuplex: true, adapterType: 'claude-code' })],
      selectedAgentId: 'KAGENT-1',
    });
    renderChatView();
    const input = screen.getByTestId('chat-input');
    // When enabled, no `opacity-50 cursor-not-allowed` wrapper class.
    expect(input.className).not.toContain('opacity-50');
    // No READ-ONLY_TRANSCRIPT badge when duplex.
    expect(screen.queryByText('READ-ONLY_TRANSCRIPT')).not.toBeInTheDocument();
  });

  it('read-only adapter (!chatDuplex) shows READ-ONLY_TRANSCRIPT badge + disabled input', () => {
    useChatStore.setState({
      channels: [
        mkChannel({
          agentId: 'CODEX-1',
          adapterType: 'codex',
          chatDuplex: false,
          currentSessionId: null,
        }),
      ],
      selectedAgentId: 'CODEX-1',
    });
    renderChatView();
    // READ-ONLY_TRANSCRIPT appears in both master row and detail header.
    expect(screen.getAllByText('READ-ONLY_TRANSCRIPT').length).toBeGreaterThanOrEqual(1);
    const input = screen.getByTestId('chat-input');
    expect(input.className).toContain('opacity-50');
  });

  it('archived channel disables input + tooltip mentions relaunch', () => {
    useChatStore.setState({
      channels: [mkChannel({ archived: true })],
      selectedAgentId: 'KAGENT-1',
    });
    renderChatView();
    const input = screen.getByTestId('chat-input');
    expect(input.className).toContain('opacity-50');
    const tooltip = input.getAttribute('title') ?? '';
    expect(tooltip.toLowerCase()).toContain('relaunch');
  });

  it('CLEAR_THREAD first click flips label to CONFIRM_CLEAR', () => {
    useChatStore.setState({
      channels: [mkChannel()],
      selectedAgentId: 'KAGENT-1',
    });
    renderChatView();
    const btn = screen.getByText('CLEAR_THREAD');
    fireEvent.click(btn);
    expect(screen.getByText('CONFIRM_CLEAR')).toBeInTheDocument();
  });

  it('CLEAR_THREAD auto-reverts after 3 seconds', () => {
    vi.useFakeTimers();
    try {
      useChatStore.setState({
        channels: [mkChannel()],
        selectedAgentId: 'KAGENT-1',
      });
      renderChatView();
      fireEvent.click(screen.getByText('CLEAR_THREAD'));
      expect(screen.getByText('CONFIRM_CLEAR')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(screen.getByText('CLEAR_THREAD')).toBeInTheDocument();
      expect(screen.queryByText('CONFIRM_CLEAR')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('CLEAR_THREAD second click fires chatStore.clearThread', () => {
    const clearThreadSpy = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      channels: [mkChannel()],
      selectedAgentId: 'KAGENT-1',
      clearThread: clearThreadSpy,
    });
    renderChatView();
    const btn = screen.getByText('CLEAR_THREAD');
    fireEvent.click(btn);
    fireEvent.click(screen.getByText('CONFIRM_CLEAR'));
    expect(clearThreadSpy).toHaveBeenCalledWith('KAGENT-1');
  });

  it('deep-link ?agent=KAGENT-1 selects that agent on mount', () => {
    const selectAgentSpy = vi.fn();
    useChatStore.setState({
      channels: [mkChannel({ agentId: 'KAGENT-1' })],
      selectAgent: selectAgentSpy,
    });
    renderChatView(['/comms?tab=chat&agent=KAGENT-1']);
    expect(selectAgentSpy).toHaveBeenCalledWith('KAGENT-1');
  });

  it('deep-link ?agent=UNKNOWN does NOT call selectAgent (T-10-32 mitigation)', () => {
    const selectAgentSpy = vi.fn();
    useChatStore.setState({
      channels: [mkChannel({ agentId: 'KAGENT-1' })],
      selectAgent: selectAgentSpy,
    });
    renderChatView(['/comms?tab=chat&agent=UNKNOWN-AGENT']);
    expect(selectAgentSpy).not.toHaveBeenCalled();
  });
});
