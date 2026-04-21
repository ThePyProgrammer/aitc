import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserMessageCard } from '../UserMessageCard';
import type { AgentEvent } from '../../../stores/chatStore';

function mk(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 1,
    agentId: 'a',
    sessionId: null,
    eventType: 'user_text',
    payloadJson: { content: 'hello world' },
    approvalRequestId: null,
    sequenceNumber: null,
    createdAt: '2026-04-17T12:00:00Z',
    deliveryStatus: 'queued',
    ...overrides,
  };
}

describe('UserMessageCard', () => {
  it('renders message content', () => {
    render(<UserMessageCard event={mk()} />);
    expect(screen.getByTestId('user-message-card')).toBeInTheDocument();
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('renders the self-end and surface-container classes', () => {
    render(<UserMessageCard event={mk()} />);
    const card = screen.getByTestId('user-message-card');
    expect(card.className).toContain('self-end');
    // surface-container fill lives on the inner bubble, not the flex-column wrapper.
    expect(card.innerHTML).toContain('bg-surface-container');
  });

  it('renders a timestamp (Data-sm)', () => {
    render(<UserMessageCard event={mk({ createdAt: '2026-04-17T12:34:56Z' })} />);
    // Timestamp rendered via locale time — just assert a short digit pattern.
    const card = screen.getByTestId('user-message-card');
    expect(card.textContent ?? '').toMatch(/\d/);
  });

  it('renders DeliveryStatus with the provided status label', () => {
    render(<UserMessageCard event={mk({ deliveryStatus: 'queued' })} />);
    expect(screen.getByText('QUEUED')).toBeInTheDocument();
  });

  it('renders DELIVERED label when deliveryStatus=delivered', () => {
    render(<UserMessageCard event={mk({ deliveryStatus: 'delivered' })} />);
    expect(screen.getByText('DELIVERED')).toBeInTheDocument();
  });

  it('renders CONSUMED label when deliveryStatus=consumed', () => {
    render(<UserMessageCard event={mk({ deliveryStatus: 'consumed' })} />);
    expect(screen.getByText('CONSUMED')).toBeInTheDocument();
  });

  it('omits DeliveryStatus when deliveryStatus is null', () => {
    render(<UserMessageCard event={mk({ deliveryStatus: null })} />);
    expect(screen.queryByText('QUEUED')).toBeNull();
    expect(screen.queryByText('DELIVERED')).toBeNull();
    expect(screen.queryByText('CONSUMED')).toBeNull();
  });

  it('falls back to empty content when payload is malformed', () => {
    render(<UserMessageCard event={mk({ payloadJson: null })} />);
    expect(screen.getByTestId('user-message-card')).toBeInTheDocument();
  });
});
