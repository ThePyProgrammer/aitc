import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommsTabBar } from '../CommsTabBar';

describe('CommsTabBar', () => {
  it('renders REQUESTS and CHAT tabs', () => {
    render(
      <CommsTabBar
        active="requests"
        unreadChat={0}
        pendingRequests={0}
        onTabChange={() => {}}
      />,
    );
    expect(screen.getByText('REQUESTS')).toBeInTheDocument();
    expect(screen.getByText('CHAT')).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected', () => {
    render(
      <CommsTabBar
        active="chat"
        unreadChat={5}
        pendingRequests={2}
        onTabChange={() => {}}
      />,
    );
    const [chatTab, requestsTab] = screen.getAllByRole('tab');
    expect(requestsTab).toHaveAttribute('aria-selected', 'false');
    expect(chatTab).toHaveAttribute('aria-selected', 'true');
  });

  it('fires onTabChange when a tab is clicked', () => {
    const cb = vi.fn();
    render(
      <CommsTabBar
        active="requests"
        unreadChat={0}
        pendingRequests={0}
        onTabChange={cb}
      />,
    );
    fireEvent.click(screen.getByText('CHAT'));
    expect(cb).toHaveBeenCalledWith('chat');
  });

  it('shows unread badge on CHAT when unreadChat > 0', () => {
    render(
      <CommsTabBar
        active="requests"
        unreadChat={3}
        pendingRequests={0}
        onTabChange={() => {}}
      />,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
