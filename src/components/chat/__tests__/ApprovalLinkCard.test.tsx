import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApprovalLinkCard } from '../ApprovalLinkCard';
import type { AgentEvent } from '../../../stores/chatStore';

const ev: AgentEvent = {
  id: 4,
  agentId: 'a',
  sessionId: null,
  eventType: 'approval_link',
  payloadJson: {
    tool_name: 'Write',
    file_path: '/etc/hosts',
    approval_request_id: 42,
  },
  approvalRequestId: 42,
  sequenceNumber: null,
  createdAt: '2026-04-17T12:00:00Z',
  deliveryStatus: null,
};

describe('ApprovalLinkCard', () => {
  it('renders approval-required pill', () => {
    render(<ApprovalLinkCard event={ev} />);
    const card = screen.getByTestId('approval-link-card');
    expect(card).toBeInTheDocument();
    expect(card.textContent ?? '').toContain('APPROVAL_REQUIRED');
  });
});
