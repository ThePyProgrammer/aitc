import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToolUseCard } from '../ToolUseCard';
import type { AgentEvent } from '../../../stores/chatStore';

// motion/react mock — strips motion-specific props so the wrapper renders as a plain div.
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const {
        initial: _i,
        animate: _a,
        exit: _e,
        transition: _t,
        layout: _l,
        ...rest
      } = props;
      const Children = children as React.ReactNode;
      return <div {...(rest as Record<string, unknown>)}>{Children}</div>;
    },
    span: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props;
      return <span {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</span>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Phase 8 ToolPreview so we don't have to wire its dependencies here.
vi.mock('../../../views/CommsHub/ToolPreview', () => ({
  ToolPreview: (props: Record<string, unknown>) => (
    <div data-testid="tool-preview-stub" data-tool-name={props.toolName as string} />
  ),
}));

function mk(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
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
    ...overrides,
  };
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ToolUseCard', () => {
  it('renders collapsed by default with TOOL label + tool name + summary + chevron', () => {
    renderWithRouter(<ToolUseCard event={mk()} />);
    const card = screen.getByTestId('tool-use-card');
    expect(card).toBeInTheDocument();
    // Flat-row pattern: plain text labels instead of ToolBadge pill.
    expect(card.textContent ?? '').toContain('TOOL');
    expect(card.textContent ?? '').toContain('EDIT');
    expect(card.textContent ?? '').toContain('/tmp/a.txt');
    // Expanded body (ToolPreview) should NOT be rendered yet.
    expect(screen.queryByTestId('tool-preview-stub')).toBeNull();
  });

  it('click expands to render Phase 8 ToolPreview', () => {
    renderWithRouter(<ToolUseCard event={mk()} />);
    const card = screen.getByTestId('tool-use-card');
    // The outer row is a <motion.div>; the clickable header is the
    // nested <button aria-expanded="false">. Click that.
    const toggle = card.querySelector('button[aria-expanded]');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle!);
    expect(screen.getByTestId('tool-preview-stub')).toBeInTheDocument();
    expect(screen.getByTestId('tool-preview-stub')).toHaveAttribute(
      'data-tool-name',
      'Edit',
    );
  });

  it('renders APPROVAL_{id} pill when approvalRequestId is set', () => {
    renderWithRouter(<ToolUseCard event={mk({ approvalRequestId: 42 })} />);
    expect(screen.getByText(/APPROVAL_42/)).toBeInTheDocument();
  });

  it('derives a BASH summary from tool_input.command', () => {
    renderWithRouter(
      <ToolUseCard
        event={mk({
          payloadJson: {
            tool_name: 'Bash',
            tool_input: { command: 'cargo test --workspace' },
          },
        })}
      />,
    );
    expect(screen.getByTestId('tool-use-card').textContent ?? '').toContain(
      'cargo test --workspace',
    );
  });
});
