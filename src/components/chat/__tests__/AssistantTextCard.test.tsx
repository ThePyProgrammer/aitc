import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssistantTextCard } from '../AssistantTextCard';
import type { AgentEvent } from '../../../stores/chatStore';

// Phase 19 Plan 03 — the body render is now owned by MarkdownBody (D-03.5).
// Stub it here so these tests stay focused on the AssistantTextCard SHELL:
// wrapperClass, CLAUDE label, bodyColor, STREAMING label, isContinuation
// collapsing. The @user tokenization test (previously in this file) moves
// into MarkdownBody.test.tsx — that's the component's concern now.
//
// The stub renders a streaming-cursor marker so the "streaming=true" shell
// test can still assert on a cursor being in the DOM tree (preserves the
// Phase 10 visual contract from a shell-observability perspective).
vi.mock('../MarkdownBody', () => ({
  MarkdownBody: ({ content, streaming }: { content: string; streaming?: boolean }) => (
    <div data-testid="markdown-body-stub">
      {content}
      {streaming && <span data-testid="streaming-cursor" />}
    </div>
  ),
}));

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

  it('delegates body rendering to MarkdownBody with content + streaming props', () => {
    render(
      <AssistantTextCard
        event={mk({ payloadJson: { content: 'hello @user world', streaming: false } })}
      />,
    );
    // Shell invariant — MarkdownBody is the body renderer; its own test suite
    // covers @user tokenization, markdown syntax, XSS mitigation.
    const stub = screen.getByTestId('markdown-body-stub');
    expect(stub).toBeInTheDocument();
    expect(stub.textContent).toContain('hello @user world');
  });

  it('isContinuation=true: suppresses CLAUDE label and border-t separator', () => {
    render(
      <AssistantTextCard
        event={mk({ payloadJson: { content: 'more' } })}
        isContinuation
      />,
    );
    const card = screen.getByTestId('assistant-text-card');
    expect(card.textContent ?? '').not.toContain('CLAUDE');
    expect(card.className).not.toContain('border-t');
  });

  it('falls back to empty content when payload is null', () => {
    render(<AssistantTextCard event={mk({ payloadJson: null })} />);
    expect(screen.getByTestId('assistant-text-card')).toBeInTheDocument();
  });
});
