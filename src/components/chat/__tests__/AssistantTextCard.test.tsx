import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssistantTextCard } from '../AssistantTextCard';
import type { AgentEvent } from '../../../stores/chatStore';

function mk(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 2,
    agentId: 'a',
    sessionId: '0d836c4f',
    eventType: 'assistant_text',
    payloadJson: { content: 'OK' },
    approvalRequestId: null,
    sequenceNumber: null,
    createdAt: '2026-04-17T12:00:00Z',
    deliveryStatus: null,
    ...overrides,
  };
}

describe('AssistantTextCard', () => {
  it('renders assistant content as a full-width row (codey flat-row style)', () => {
    render(<AssistantTextCard event={mk()} />);
    const card = screen.getByTestId('assistant-text-card');
    // Full-width row, no bubble chrome.
    expect(card.className).toContain('w-full');
    expect(card.className).not.toContain('self-start');
    expect(card.className).not.toContain('bg-surface-container-high');
    expect(card.className).toContain('border-t');
    // CLAUDE role label + body content.
    expect(card.textContent ?? '').toContain('CLAUDE');
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('non-streaming: no cursor, on-surface-variant body color', () => {
    render(<AssistantTextCard event={mk({ payloadJson: { content: 'done' } })} />);
    expect(screen.queryByTestId('streaming-cursor')).toBeNull();
    const card = screen.getByTestId('assistant-text-card');
    // Default color is on-surface-variant (completed turn)
    expect(card.innerHTML).toContain('text-on-surface-variant');
  });

  it('streaming=true: renders StreamingCursor + STREAMING label + on-surface body color', () => {
    render(
      <AssistantTextCard
        event={mk({ payloadJson: { content: 'partial', streaming: true } })}
      />,
    );
    expect(screen.getByTestId('streaming-cursor')).toBeInTheDocument();
    expect(screen.getByText(/STREAMING/i)).toBeInTheDocument();
    const card = screen.getByTestId('assistant-text-card');
    expect(card.innerHTML).toContain('text-on-surface');
  });

  it('@user tokens are wrapped in a secondary-colored span', () => {
    render(
      <AssistantTextCard
        event={mk({ payloadJson: { content: 'please confirm @user thanks' } })}
      />,
    );
    const highlight = screen.getByText('@user');
    expect(highlight.tagName).toBe('SPAN');
    expect(highlight.className).toContain('text-secondary');
    expect(highlight.className).toContain('font-bold');
  });

  it('falls back to empty content when payload is null', () => {
    render(<AssistantTextCard event={mk({ payloadJson: null })} />);
    expect(screen.getByTestId('assistant-text-card')).toBeInTheDocument();
  });
});
