import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssistantTextCard } from '../AssistantTextCard';
import type { AgentEvent } from '../../../stores/chatStore';

const ev: AgentEvent = {
  id: 2,
  agentId: 'a',
  sessionId: '0d836c4f',
  eventType: 'assistant_text',
  payloadJson: { content: 'OK' },
  approvalRequestId: null,
  sequenceNumber: null,
  createdAt: '2026-04-17T12:00:00Z',
  deliveryStatus: null,
};

describe('AssistantTextCard', () => {
  it('renders assistant content', () => {
    render(<AssistantTextCard event={ev} />);
    expect(screen.getByTestId('assistant-text-card')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
  });
});
