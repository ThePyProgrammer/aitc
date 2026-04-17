import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatView } from '../ChatView';
import { useChatStore } from '../../../stores/chatStore';

describe('ChatView', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('renders the MasterDetailShell hierarchy with CHAT-tab overrides', () => {
    render(<ChatView />);
    expect(screen.getByTestId('master-detail-root')).toBeInTheDocument();
    // 280px rail (Phase 10 override) vs 220px default.
    const rail = screen.getByTestId('rail');
    expect(rail.style.width).toBe('280px');
    // detailWidth='flex' means the right-detail aside is omitted.
    expect(screen.queryByTestId('detail')).not.toBeInTheDocument();
  });

  it('mounts with no agent selected -> transcript shows NO_AGENT_SELECTED', () => {
    render(<ChatView />);
    expect(screen.getByTestId('chat-transcript-empty')).toBeInTheDocument();
  });
});
