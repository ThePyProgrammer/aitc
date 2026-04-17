import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolUseCard } from '../ToolUseCard';
import type { AgentEvent } from '../../../stores/chatStore';

const ev: AgentEvent = {
  id: 3,
  agentId: 'a',
  sessionId: null,
  eventType: 'tool_use',
  payloadJson: {
    tool_name: 'Edit',
    tool_input: { file_path: '/tmp/a.txt' },
  },
  approvalRequestId: null,
  sequenceNumber: null,
  createdAt: '2026-04-17T12:00:00Z',
  deliveryStatus: null,
};

describe('ToolUseCard', () => {
  it('renders collapsed one-liner with uppercase tool name and path', () => {
    render(<ToolUseCard event={ev} />);
    const card = screen.getByTestId('tool-use-card');
    expect(card).toBeInTheDocument();
    expect(card.textContent ?? '').toContain('EDIT');
    expect(card.textContent ?? '').toContain('/tmp/a.txt');
  });
});
