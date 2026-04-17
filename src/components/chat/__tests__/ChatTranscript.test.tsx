import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatTranscript } from '../ChatTranscript';
import { useChatStore, type AgentEvent } from '../../../stores/chatStore';

describe('ChatTranscript', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('shows NO_AGENT_SELECTED when agentId is null', () => {
    render(<ChatTranscript agentId={null} />);
    expect(screen.getByTestId('chat-transcript-empty')).toBeInTheDocument();
  });

  it('shows NO_MESSAGES empty state when events array is empty', () => {
    render(<ChatTranscript agentId="claude-cc-001" />);
    expect(screen.getByText('NO_MESSAGES')).toBeInTheDocument();
  });

  it('renders each event through EventCard', () => {
    const event: AgentEvent = {
      id: 1,
      agentId: 'a',
      sessionId: null,
      eventType: 'user_text',
      payloadJson: { content: 'ping' },
      approvalRequestId: null,
      sequenceNumber: null,
      createdAt: '2026-04-17T12:00:00Z',
      deliveryStatus: 'delivered',
    };
    useChatStore.setState({ eventsByAgent: { a: [event] } });
    render(<ChatTranscript agentId="a" />);
    expect(screen.getByTestId('chat-transcript')).toBeInTheDocument();
    expect(screen.getByTestId('user-message-card')).toBeInTheDocument();
  });
});
