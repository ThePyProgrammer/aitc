import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// Phase 19 D-02.2 — mock the chatStore module so ToolUseCard's selector
// returns a controllable paired tool_result. Tests override the mock's
// return value per-case to exercise the green/red/grey dot states.
const selectToolUseWithResultMock = vi.fn();

vi.mock('../../../stores/chatStore', () => ({
  useChatStore: (
    selector: (s: { eventsByAgent: Record<string, AgentEvent[]> }) => unknown,
  ) => selector({ eventsByAgent: {} }),
  selectToolUseWithResult: (events: AgentEvent[], toolUseId: string) =>
    selectToolUseWithResultMock(events, toolUseId),
}));

function mk(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: 3,
    agentId: 'a',
    sessionId: null,
    eventType: 'tool_use',
    payloadJson: {
      tool_use_id: 'toolu_mk_default',
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

beforeEach(() => {
  // Default: no paired tool_result (pending / grey dot).
  selectToolUseWithResultMock.mockReset();
  selectToolUseWithResultMock.mockReturnValue({
    toolUse: null,
    toolResult: null,
  });
});

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
            tool_use_id: 'toolu_bash',
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

// ---------------------------------------------------------------------------
// Phase 19 Plan 04 — D-02 enrichment (V-19-05..V-19-12 minus V-19-08 which
// lives in chatStore.test.ts). Seven assertions covering: per-tool secondary
// text, status-dot color tri-state, visual polish (py-1.5 + dot position).
// ---------------------------------------------------------------------------

describe('ToolUseCard enrichment (D-02 — V-19-05..V-19-12)', () => {
  // V-19-05 — MultiEdit renders "{N} hunks" secondary.
  it('renders "N hunks" secondary for MultiEdit', () => {
    const event = mk({
      payloadJson: {
        tool_use_id: 'toolu_a',
        tool_name: 'MultiEdit',
        tool_input: {
          file_path: '/tmp/x.ts',
          edits: [
            { old: 'a', new: 'b' },
            { old: 'c', new: 'd' },
            { old: 'e', new: 'f' },
          ],
        },
      },
    });
    const { container } = renderWithRouter(<ToolUseCard event={event} />);
    expect(screen.getByText(/3 hunks/)).toBeInTheDocument();
    // `/tmp/x.ts` is a raw text node inside the flex-1 summary <span>
    // adjacent to the secondary `· 3 hunks` span, so getByText(exact)
    // doesn't match — assert against the full card textContent.
    expect(container.textContent ?? '').toContain('/tmp/x.ts');
  });

  // V-19-06 — Write renders "{N} lines" secondary (newline count).
  it('renders "N lines" secondary for Write', () => {
    const event = mk({
      payloadJson: {
        tool_use_id: 'toolu_b',
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/y.ts', content: 'line1\nline2\nline3' },
      },
    });
    renderWithRouter(<ToolUseCard event={event} />);
    expect(screen.getByText(/3 lines/)).toBeInTheDocument();
  });

  // V-19-07 — WebFetch splits url into host (primary) + pathname (secondary).
  it('renders "host" primary + "pathname" secondary for WebFetch', () => {
    const event = mk({
      payloadJson: {
        tool_use_id: 'toolu_c',
        tool_name: 'WebFetch',
        tool_input: { url: 'https://example.com/docs/api' },
      },
    });
    const { container } = renderWithRouter(<ToolUseCard event={event} />);
    // host is a raw text node inside the flex-1 <span>; pathname is wrapped
    // in the secondary tint-span. Assert host via substring and pathname
    // via exact inner span match.
    expect(container.textContent ?? '').toContain('example.com');
    expect(screen.getByText('/docs/api')).toBeInTheDocument();
  });

  // V-19-09 — green dot on success (is_error === false).
  it('renders green status dot when paired tool_result.is_error === false', () => {
    selectToolUseWithResultMock.mockReturnValue({
      toolUse: null,
      toolResult: {
        id: 99,
        agentId: 'a',
        sessionId: null,
        eventType: 'tool_result',
        payloadJson: { is_error: false },
        approvalRequestId: null,
        sequenceNumber: null,
        createdAt: '2026-04-21T12:00:00Z',
        deliveryStatus: null,
      },
    });
    const event = mk({
      payloadJson: {
        tool_use_id: 'toolu_d',
        tool_name: 'Read',
        tool_input: { file_path: '/a.ts' },
      },
    });
    const { container } = renderWithRouter(<ToolUseCard event={event} />);
    const dot = container.querySelector('[data-testid="tool-status-dot"]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain('bg-primary');
    expect(dot?.getAttribute('data-status')).toBe('success');
  });

  // V-19-10 — red dot on error (is_error === true).
  it('renders red status dot when paired tool_result.is_error === true', () => {
    selectToolUseWithResultMock.mockReturnValue({
      toolUse: null,
      toolResult: {
        id: 100,
        agentId: 'a',
        sessionId: null,
        eventType: 'tool_result',
        payloadJson: { is_error: true },
        approvalRequestId: null,
        sequenceNumber: null,
        createdAt: '2026-04-21T12:00:00Z',
        deliveryStatus: null,
      },
    });
    const event = mk({
      payloadJson: {
        tool_use_id: 'toolu_e',
        tool_name: 'Bash',
        tool_input: { command: 'exit 1' },
      },
    });
    const { container } = renderWithRouter(<ToolUseCard event={event} />);
    const dot = container.querySelector('[data-testid="tool-status-dot"]');
    expect(dot?.className).toContain('bg-error');
    expect(dot?.getAttribute('data-status')).toBe('error');
  });

  // V-19-11 — grey/pending dot when no paired tool_result yet.
  it('renders grey (pending) status dot when no paired tool_result yet', () => {
    selectToolUseWithResultMock.mockReturnValue({
      toolUse: null,
      toolResult: null,
    });
    const event = mk({
      payloadJson: {
        tool_use_id: 'toolu_f',
        tool_name: 'Edit',
        tool_input: { file_path: '/a.ts' },
      },
    });
    const { container } = renderWithRouter(<ToolUseCard event={event} />);
    const dot = container.querySelector('[data-testid="tool-status-dot"]');
    expect(dot?.className).toContain('bg-on-surface-variant/30');
    expect(dot?.getAttribute('data-status')).toBe('pending');
  });

  // V-19-12 — py-1.5 on collapsed button AND dot precedes TOOL label.
  it('collapsed button uses py-1.5 and status dot precedes TOOL label', () => {
    const event = mk({
      payloadJson: {
        tool_use_id: 'toolu_g',
        tool_name: 'Edit',
        tool_input: { file_path: '/a.ts' },
      },
    });
    const { container } = renderWithRouter(<ToolUseCard event={event} />);
    const button = container.querySelector('button[aria-expanded]');
    expect(button?.className).toContain('py-1.5');
    // Guard against "py-2" surviving as a literal class token on the button.
    expect(button?.className).not.toMatch(/\bpy-2\b/);
    const dot = container.querySelector('[data-testid="tool-status-dot"]');
    const toolLabel = Array.from(container.querySelectorAll('span')).find(
      (s) => s.textContent === 'TOOL',
    );
    expect(dot).not.toBeNull();
    expect(toolLabel).not.toBeNull();
    // Confirm DOM order: dot comes before TOOL label.
    const pos = dot!.compareDocumentPosition(toolLabel!);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});
