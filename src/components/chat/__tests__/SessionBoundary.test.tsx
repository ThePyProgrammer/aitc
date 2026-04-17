import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionBoundary } from '../SessionBoundary';
import type { AgentEvent } from '../../../stores/chatStore';

const ev: AgentEvent = {
  id: 5,
  agentId: 'a',
  sessionId: '0d836c4f-8546-4aeb-a994-6fb94ba800b7',
  eventType: 'session_boundary',
  payloadJson: {
    kind: 'session_started',
    session_id: '0d836c4f-8546-4aeb-a994-6fb94ba800b7',
  },
  approvalRequestId: null,
  sequenceNumber: null,
  createdAt: '2026-04-17T12:00:00Z',
  deliveryStatus: null,
};

describe('SessionBoundary', () => {
  it('renders centered label with session id prefix', () => {
    render(<SessionBoundary event={ev} />);
    const boundary = screen.getByTestId('session-boundary');
    expect(boundary).toBeInTheDocument();
    expect(boundary.textContent ?? '').toContain('0d836c4f');
  });
});
