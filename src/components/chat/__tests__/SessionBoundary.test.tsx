import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionBoundary } from '../SessionBoundary';
import type { AgentEvent } from '../../../stores/chatStore';

function mk(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 5,
    agentId: 'a',
    sessionId: '0d836c4f-8546-4aeb-a994-6fb94ba800b7',
    eventType: 'session_boundary',
    payloadJson: {
      kind: 'started',
      session_id: '0d836c4f-8546-4aeb-a994-6fb94ba800b7',
    },
    approvalRequestId: null,
    sequenceNumber: null,
    createdAt: '2026-04-17T12:00:00Z',
    deliveryStatus: null,
    ...overrides,
  };
}

describe('SessionBoundary', () => {
  it('renders SESSION_STARTED variant with session_id prefix', () => {
    render(<SessionBoundary event={mk({ payloadJson: { kind: 'started', session_id: '0d836c4f-xxx' } })} />);
    const node = screen.getByTestId('session-boundary');
    expect(node.textContent ?? '').toContain('SESSION_STARTED');
    expect(node.textContent ?? '').toContain('0d836c4f');
  });

  it('renders SESSION_ENDED variant with reason', () => {
    render(
      <SessionBoundary
        event={mk({ payloadJson: { kind: 'ended', reason: 'completed' } })}
      />,
    );
    const node = screen.getByTestId('session-boundary');
    expect(node.textContent ?? '').toContain('SESSION_ENDED');
    expect(node.textContent ?? '').toContain('completed');
  });

  it('renders SESSION_RESUMED variant', () => {
    render(
      <SessionBoundary event={mk({ payloadJson: { kind: 'resumed' } })} />,
    );
    const node = screen.getByTestId('session-boundary');
    expect(node.textContent ?? '').toContain('SESSION_RESUMED');
  });
});
