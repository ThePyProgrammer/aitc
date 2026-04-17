import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserMessageCard } from '../UserMessageCard';
import type { AgentEvent } from '../../../stores/chatStore';

const ev: AgentEvent = {
  id: 1,
  agentId: 'a',
  sessionId: null,
  eventType: 'user_text',
  payloadJson: { content: 'hello world' },
  approvalRequestId: null,
  sequenceNumber: null,
  createdAt: '2026-04-17T12:00:00Z',
  deliveryStatus: 'queued',
};

describe('UserMessageCard', () => {
  it('renders message content', () => {
    render(<UserMessageCard event={ev} />);
    expect(screen.getByTestId('user-message-card')).toBeInTheDocument();
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });
});
