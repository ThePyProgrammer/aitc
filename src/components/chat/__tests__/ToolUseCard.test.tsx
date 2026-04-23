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
  it('renders collapsed by default with tool name + summary + status dot + chevron (Option 3 — no TOOL prefix)', () => {
    renderWithRouter(<ToolUseCard event={mk()} />);
    const card = screen.getByTestId('tool-use-card');
    expect(card).toBeInTheDocument();
    // Option 3: dropped the redundant 'TOOL' label; tool name is the
    // identity anchor, operation sits at full contrast next to it.
    expect(card.textContent ?? '').not.toMatch(/\bTOOL\b/);
    expect(card.textContent ?? '').toContain('EDIT');
    expect(card.textContent ?? '').toContain('/tmp/a.txt');
    // Status dot is present (now on the right status column, not leading).
    expect(card.querySelector('[data-testid="tool-status-dot"]')).not.toBeNull();
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

  it('renders APPROVAL_{id} pill inside the expanded body header (Option 3 — hoisted from collapsed)', () => {
    const { container } = renderWithRouter(
      <ToolUseCard event={mk({ approvalRequestId: 42 })} />,
    );
    // Not visible when collapsed — the pill now lives in the expanded strip.
    expect(screen.queryByText(/APPROVAL_42/)).toBeNull();
    // Expand and confirm.
    fireEvent.click(container.querySelector('button[aria-expanded]')!);
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

  // V-19-12 (updated) — py-2.5 collapsed-row padding + Option 3 layout:
  // tool name → operation → status dot → chevron. Earlier py-1.5 was the
  // Phase 19 D-02.4 "codey tight rhythm" choice; later padding audit
  // bumped it to py-2.5 for better breathing room on big monitors.
  it('collapsed button uses py-2.5 and status dot sits in the right status column', () => {
    const event = mk({
      payloadJson: {
        tool_use_id: 'toolu_g',
        tool_name: 'Edit',
        tool_input: { file_path: '/a.ts' },
      },
    });
    const { container } = renderWithRouter(<ToolUseCard event={event} />);
    const button = container.querySelector('button[aria-expanded]');
    expect(button?.className).toContain('py-2.5');
    const dot = container.querySelector('[data-testid="tool-status-dot"]');
    const toolName = Array.from(container.querySelectorAll('span')).find(
      (s) => s.textContent === 'EDIT',
    );
    expect(dot).not.toBeNull();
    expect(toolName).not.toBeNull();
    // Option 3: tool name leads the row; status dot sits on the right
    // (between operation text and chevron). Confirm DOM order:
    // tool name appears BEFORE the dot.
    const pos = toolName!.compareDocumentPosition(dot!);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  // Phase 19 follow-up — paired tool_result renders inside the expanded body.
  it('renders paired tool_result content inside the expanded body', () => {
    selectToolUseWithResultMock.mockReturnValue({
      toolUse: null,
      toolResult: {
        id: 200,
        agentId: 'a',
        sessionId: null,
        eventType: 'tool_result',
        payloadJson: {
          tool_use_id: 'toolu_res',
          content: 'total 42\ndrwxr-xr-x  5 user  staff  160 Apr 22 10:00 .',
          is_error: false,
        },
        approvalRequestId: null,
        sequenceNumber: null,
        createdAt: '2026-04-22T12:00:00Z',
        deliveryStatus: null,
      },
    });
    const event = mk({
      payloadJson: {
        tool_use_id: 'toolu_res',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
      },
    });
    const { container } = renderWithRouter(<ToolUseCard event={event} />);
    // Not rendered when collapsed.
    expect(
      container.querySelector('[data-testid="tool-result-section"]'),
    ).toBeNull();
    // Expand.
    const toggle = container.querySelector('button[aria-expanded]');
    fireEvent.click(toggle!);
    const section = container.querySelector(
      '[data-testid="tool-result-section"]',
    );
    expect(section).not.toBeNull();
    expect(section?.textContent ?? '').toContain('OUTPUT');
    expect(section?.textContent ?? '').toContain('drwxr-xr-x');
  });

  it('renders ERROR label + red tint when paired tool_result.is_error is true', () => {
    selectToolUseWithResultMock.mockReturnValue({
      toolUse: null,
      toolResult: {
        id: 201,
        agentId: 'a',
        sessionId: null,
        eventType: 'tool_result',
        payloadJson: {
          tool_use_id: 'toolu_err',
          content: 'ls: cannot access /nope: No such file or directory',
          is_error: true,
        },
        approvalRequestId: null,
        sequenceNumber: null,
        createdAt: '2026-04-22T12:00:00Z',
        deliveryStatus: null,
      },
    });
    const event = mk({
      payloadJson: {
        tool_use_id: 'toolu_err',
        tool_name: 'Bash',
        tool_input: { command: 'ls /nope' },
      },
    });
    const { container } = renderWithRouter(<ToolUseCard event={event} />);
    fireEvent.click(container.querySelector('button[aria-expanded]')!);
    const section = container.querySelector(
      '[data-testid="tool-result-section"]',
    );
    expect(section?.textContent ?? '').toContain('ERROR');
    // Option 3 layout: text-error is applied to the OUTPUT header <span>
    // and the <pre> output body (not the outer <section>). Check descendants.
    const errorTinted = section?.querySelector('.text-error');
    expect(errorTinted).not.toBeNull();
  });
});
