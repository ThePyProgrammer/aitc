import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApprovalLinkCard } from '../ApprovalLinkCard';
import type { AgentEvent } from '../../../stores/chatStore';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

function mk(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 4,
    agentId: 'a',
    sessionId: null,
    eventType: 'approval_link',
    payloadJson: {
      tool_name: 'Write',
      summary: '/etc/hosts',
      approval_request_id: 42,
    },
    approvalRequestId: 42,
    sequenceNumber: null,
    createdAt: '2026-04-17T12:00:00Z',
    deliveryStatus: null,
    ...overrides,
  };
}

describe('ApprovalLinkCard', () => {
  it('renders APPROVAL_REQUIRED with tool_name + path', () => {
    render(
      <MemoryRouter>
        <ApprovalLinkCard event={mk()} />
      </MemoryRouter>,
    );
    const card = screen.getByTestId('approval-link-card');
    expect(card.textContent ?? '').toContain('APPROVAL_REQUIRED');
    expect(card.textContent ?? '').toContain('WRITE');
    expect(card.textContent ?? '').toContain('/etc/hosts');
  });

  it('has border-l-2 border-secondary class', () => {
    render(
      <MemoryRouter>
        <ApprovalLinkCard event={mk()} />
      </MemoryRouter>,
    );
    const card = screen.getByTestId('approval-link-card');
    expect(card.className).toContain('border-l-2');
    expect(card.className).toContain('border-secondary');
  });

  it('clicking the card navigates to /comms?tab=requests&request={id}', () => {
    navigateSpy.mockClear();
    render(
      <MemoryRouter>
        <ApprovalLinkCard event={mk()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('approval-link-card'));
    expect(navigateSpy).toHaveBeenCalledWith(
      '/comms?tab=requests&request=42',
    );
  });
});
