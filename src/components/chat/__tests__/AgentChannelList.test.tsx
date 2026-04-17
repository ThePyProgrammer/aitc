import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentChannelList } from '../AgentChannelList';
import { useChatStore, type ChatChannel } from '../../../stores/chatStore';

describe('AgentChannelList', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('renders empty state when no channels are present', () => {
    render(<AgentChannelList />);
    const list = screen.getByTestId('agent-channel-list');
    expect(list).toBeInTheDocument();
    expect(list.textContent ?? '').toContain('NO_AGENT_CHANNELS');
  });

  it('renders one AgentChannelRow per channel', () => {
    const channels: ChatChannel[] = [
      {
        agentId: 'claude-cc-001',
        adapterType: 'claude_code',
        status: 'running',
        archived: false,
        chatDuplex: true,
        lastEvent: null,
        unreadCount: 0,
        currentSessionId: null,
      },
      {
        agentId: 'codex-002',
        adapterType: 'codex',
        status: 'running',
        archived: false,
        chatDuplex: false,
        lastEvent: null,
        unreadCount: 3,
        currentSessionId: null,
      },
    ];
    useChatStore.setState({ channels });
    render(<AgentChannelList />);
    expect(screen.getAllByTestId('agent-channel-row')).toHaveLength(2);
  });
});
