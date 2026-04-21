import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentChannelList } from '../AgentChannelList';
import { useChatStore, type ChatChannel } from '../../../stores/chatStore';

function mkChannel(overrides: Partial<ChatChannel> = {}): ChatChannel {
  return {
    agentId: 'claude-cc-001',
    adapterType: 'claude_code',
    status: 'running',
    archived: false,
    chatDuplex: true,
    lastEvent: null,
    unreadCount: 0,
    currentSessionId: null,
    ...overrides,
  };
}

describe('AgentChannelList', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('renders empty state when no channels are present', () => {
    render(<AgentChannelList />);
    const list = screen.getByTestId('agent-channel-list');
    expect(list.textContent ?? '').toContain('NO_AGENT_CHANNELS');
  });

  it('renders the AGENT_CHANNELS header', () => {
    useChatStore.setState({ channels: [mkChannel()] });
    render(<AgentChannelList />);
    expect(screen.getByText('AGENT_CHANNELS')).toBeInTheDocument();
  });

  it('splits into ACTIVE and ARCHIVED sections', () => {
    const active = mkChannel({ agentId: 'a-1', archived: false });
    const archived = mkChannel({ agentId: 'a-2', archived: true });
    useChatStore.setState({
      channels: [active, archived],
      archivedCollapsed: false,
    });
    render(<AgentChannelList />);
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText(/ARCHIVED/)).toBeInTheDocument();
  });

  it('ARCHIVED section is collapsed by default (archived rows hidden)', () => {
    const archived = mkChannel({ agentId: 'zz-archived', archived: true });
    useChatStore.setState({ channels: [archived], archivedCollapsed: true });
    render(<AgentChannelList />);
    expect(screen.getByText(/ARCHIVED/)).toBeInTheDocument();
    // Row should NOT be visible when archived section is collapsed.
    expect(screen.queryByText('zz-archived')).toBeNull();
  });

  it('clicking ARCHIVED header toggles expansion', () => {
    const archived = mkChannel({ agentId: 'zz-archived', archived: true });
    useChatStore.setState({ channels: [archived], archivedCollapsed: true });
    render(<AgentChannelList />);
    const header = screen.getByTestId('archived-section-header');
    fireEvent.click(header);
    expect(useChatStore.getState().archivedCollapsed).toBe(false);
  });

  it('clicking a row calls selectAgent', () => {
    const selectSpy = vi.fn();
    useChatStore.setState({
      channels: [mkChannel({ agentId: 'a-1' })],
      selectAgent: selectSpy,
    });
    render(<AgentChannelList />);
    const row = screen.getByText('a-1').closest('[data-testid="agent-channel-row"]');
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(selectSpy).toHaveBeenCalledWith('a-1');
  });

  it('selected row carries the primary left border class', () => {
    useChatStore.setState({
      channels: [mkChannel({ agentId: 'a-1' })],
      selectedAgentId: 'a-1',
    });
    render(<AgentChannelList />);
    const row = screen.getByText('a-1').closest('[data-testid="agent-channel-row"]');
    expect(row!.className).toContain('border-l-2');
    expect(row!.className).toContain('border-primary');
  });
});
