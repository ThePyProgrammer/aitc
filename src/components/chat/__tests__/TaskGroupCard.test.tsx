import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskGroupCard, getCurrentActivity } from '../TaskGroupCard';
import type { AgentEvent } from '../../../stores/chatStore';

// motion/react mock — strips motion props so the wrapper renders as a plain
// element (matches the pattern other chat tests use).
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

// Stub the ToolPreview registry pulled in transitively by ToolUseCard so we
// don't have to wire its dependencies for these grouping tests.
vi.mock('../../../views/CommsHub/ToolPreview', () => ({
  ToolPreview: (props: Record<string, unknown>) => (
    <div data-testid="tool-preview-stub" data-tool-name={props.toolName as string} />
  ),
}));

// MarkdownBody is also reachable via ToolUseCard for Agent OUTPUT — stub it.
vi.mock('../MarkdownBody', () => ({
  MarkdownBody: ({ content }: { content: string }) => (
    <div data-testid="markdown-body">{content}</div>
  ),
}));

// chatStore mock — ToolUseCard subscribes via useChatStore and looks up
// paired tool_results via selectToolUseWithResult. Defaults to empty so the
// grouping-test focus stays on rendering, not result-pairing. Tests that
// need a specific tool_result available to the lookup can override
// `mockEventsByAgent` in a beforeEach (and mockSelectToolUseWithResult).
const mockEventsByAgent: { current: Record<string, AgentEvent[]> } = {
  current: {},
};
type ToolUseWithResult = {
  toolUse: AgentEvent | null;
  toolResult: AgentEvent | null;
};
const mockSelectToolUseWithResult = vi.fn<
  (events: AgentEvent[], toolUseId: string) => ToolUseWithResult
>(() => ({ toolUse: null, toolResult: null }));

vi.mock('../../../stores/chatStore', () => ({
  useChatStore: (
    selector: (s: { eventsByAgent: Record<string, AgentEvent[]> }) => unknown,
  ) => selector({ eventsByAgent: mockEventsByAgent.current }),
  selectToolUseWithResult: (events: AgentEvent[], toolUseId: string) =>
    mockSelectToolUseWithResult(events, toolUseId),
}));

function mkNote(
  id: number,
  subtype: 'task_started' | 'task_progress' | 'task_notification',
  extras: Record<string, unknown>,
): AgentEvent {
  return {
    id,
    agentId: 'claude-cc-001',
    sessionId: 'sess-1',
    eventType: 'system_note',
    payloadJson: {
      text: `[system/${subtype}]`,
      data: { subtype, task_id: 'task-A', tool_use_id: 'toolu_1', ...extras },
    },
    approvalRequestId: null,
    sequenceNumber: id,
    createdAt: '2026-04-24T00:00:00Z',
    deliveryStatus: null,
  };
}

// Reset mock state between tests so per-test overrides don't leak.
beforeEach(() => {
  mockEventsByAgent.current = {};
  mockSelectToolUseWithResult.mockReset();
  mockSelectToolUseWithResult.mockReturnValue({
    toolUse: null,
    toolResult: null,
  });
});

describe('TaskGroupCard', () => {
  const header = mkNote(1, 'task_started', {
    description: 'Echo hello',
    task_type: 'local_agent',
    prompt: "Echo 'hello' and stop.",
  });
  const child1 = mkNote(2, 'task_progress', {
    description: 'Running List entries',
    last_tool_name: 'Bash',
    usage: { total_tokens: 12345 },
  });
  const child2 = mkNote(3, 'task_progress', {
    description: 'Running Print',
    last_tool_name: 'Bash',
    usage: { total_tokens: 23456 },
  });
  const footerCompleted = mkNote(4, 'task_notification', {
    status: 'completed',
    summary: 'Echo hello',
    usage: { total_tokens: 30000, tool_uses: 2, duration_ms: 1704 },
  });

  it('renders collapsed by default with description, step count, and success dot', () => {
    render(
      <TaskGroupCard
        taskId="task-A"
        header={header}
        children={[child1, child2]}
        footer={footerCompleted}
      />,
    );
    const card = screen.getByTestId('task-group-card');
    expect(card.textContent).toContain('SUBAGENT_TASK');
    expect(card.textContent).toContain('Echo hello');
    expect(card.textContent).toContain('2 STEPS');
    const dot = screen.getByTestId('task-status-dot');
    expect(dot.dataset.status).toBe('success');
    expect(dot.className).toContain('bg-primary');
    // Expanded body should NOT be visible yet.
    expect(screen.queryByTestId('task-prompt-section')).toBeNull();
  });

  it('expands to show brief toggle, progress list, and completion result on click', () => {
    render(
      <MemoryRouter>
        <TaskGroupCard
          taskId="task-A"
          header={header}
          children={[child1, child2]}
          footer={footerCompleted}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // Brief is collapsed by default — only the toggle is visible.
    const promptSection = screen.getByTestId('task-prompt-section');
    expect(promptSection.textContent).toContain('SHOW_BRIEF');
    expect(promptSection.textContent).toContain('local_agent');
    expect(screen.queryByTestId('task-brief-body')).toBeNull();
    // Click the brief toggle (it's the only button labeled SHOW_BRIEF).
    fireEvent.click(screen.getByRole('button', { name: /SHOW_BRIEF/ }));
    expect(screen.getByTestId('task-brief-body').textContent).toContain(
      "Echo 'hello' and stop.",
    );

    const rows = screen.getAllByTestId('task-progress-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Running List entries');
    expect(rows[0].textContent).toContain('Bash');
    expect(rows[0].textContent).toContain('12345 tok');
    const result = screen.getByTestId('task-result-section');
    expect(result.textContent).toContain('COMPLETED');
    // No parent tool_result in chatStore mock → falls back to summary.
    expect(result.textContent).toContain('Echo hello');
    expect(result.textContent).toContain('30000 tokens');
    expect(result.textContent).toContain('1704ms');
  });

  it('renders a pending dot and RUNNING placeholder when footer is null', () => {
    render(
      <TaskGroupCard
        taskId="task-A"
        header={header}
        children={[child1]}
        footer={null}
      />,
    );
    const card = screen.getByTestId('task-group-card');
    expect(card.dataset.taskState).toBe('pending');
    expect(screen.getByTestId('task-status-dot').dataset.status).toBe(
      'pending',
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // Result section absent; in-flight placeholder present.
    expect(screen.queryByTestId('task-result-section')).toBeNull();
    expect(screen.getByTestId('task-inflight-section').textContent).toContain(
      'RUNNING',
    );
  });

  it('marks the card as error when footer.status indicates failure', () => {
    const footerError = mkNote(4, 'task_notification', {
      status: 'error',
      summary: 'agent crashed',
    });
    render(
      <TaskGroupCard
        taskId="task-A"
        header={header}
        children={[]}
        footer={footerError}
      />,
    );
    const card = screen.getByTestId('task-group-card');
    expect(card.dataset.taskState).toBe('error');
    expect(screen.getByTestId('task-status-dot').className).toContain(
      'bg-error',
    );
  });

  it('falls back to task_id prefix when no description or summary is available', () => {
    const bareHeader = mkNote(1, 'task_started', {});
    render(
      <TaskGroupCard
        taskId="abc123def456"
        header={bareHeader}
        children={[]}
        footer={null}
      />,
    );
    const card = screen.getByTestId('task-group-card');
    expect(card.textContent).toContain('task abc123de');
  });

  // Phase 19.2 — sub-agent tool_use rows render as nested ToolUseCards
  // inside the PROGRESS section.
  it('renders sub-agent tool_use children as nested ToolUseCards', () => {
    const subToolUse: AgentEvent = {
      id: 5,
      agentId: 'claude-cc-001',
      sessionId: 'sess-1',
      eventType: 'tool_use',
      payloadJson: {
        tool_name: 'Bash',
        tool_use_id: 'tu-sub-1',
        tool_input: { command: 'ls -la' },
      },
      approvalRequestId: null,
      sequenceNumber: 5,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
    const subToolResult: AgentEvent = {
      id: 6,
      agentId: 'claude-cc-001',
      sessionId: 'sess-1',
      eventType: 'tool_result',
      payloadJson: { tool_use_id: 'tu-sub-1', content: 'output' },
      approvalRequestId: null,
      sequenceNumber: 6,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
    render(
      <MemoryRouter>
        <TaskGroupCard
          taskId="task-A"
          header={header}
          children={[child1, subToolUse, subToolResult, child2]}
          footer={footerCompleted}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // Nested tool_use renders.
    const nested = screen.getAllByTestId('task-nested-tool-use');
    expect(nested).toHaveLength(1);
    // Both progress rows still render — they're separate from tool_use.
    const progressRows = screen.getAllByTestId('task-progress-row');
    expect(progressRows).toHaveLength(2);
    // tool_result is intentionally not surfaced (already paired in its
    // tool_use's expanded body via the per-agent events lookup).
    expect(
      screen.queryByText((c) => c.includes('output')),
    ).toBeNull();
  });

  // Phase 19.3 — when the parent Agent tool_result is in the chatStore,
  // RESULT renders its content via MarkdownBody (the merged body), not the
  // task_notification.summary fallback.
  it('renders parent tool_result content via MarkdownBody when available', () => {
    const parentToolResult: AgentEvent = {
      id: 99,
      agentId: 'claude-cc-001',
      sessionId: 'sess-1',
      eventType: 'tool_result',
      payloadJson: {
        tool_use_id: 'toolu_1', // matches header.data.tool_use_id from mkNote
        content: '# Audit Report\n\n- finding A',
      },
      approvalRequestId: null,
      sequenceNumber: 99,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
    mockEventsByAgent.current = { 'claude-cc-001': [parentToolResult] };
    mockSelectToolUseWithResult.mockReturnValue({
      toolUse: null,
      toolResult: parentToolResult,
    });

    render(
      <MemoryRouter>
        <TaskGroupCard
          taskId="task-A"
          header={header}
          children={[]}
          footer={footerCompleted}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const body = screen.getByTestId('task-result-body');
    // MarkdownBody mock surfaces content as text, so we can assert directly.
    expect(body.textContent).toContain('# Audit Report');
    expect(body.textContent).toContain('finding A');
    // Summary fallback path is hidden when parent body exists.
    expect(screen.queryByTestId('task-result-summary-fallback')).toBeNull();
  });

  it('counts only progress notes + tool_use rows in the step count (skips tool_result)', () => {
    const tu: AgentEvent = {
      id: 5,
      agentId: 'claude-cc-001',
      sessionId: 'sess-1',
      eventType: 'tool_use',
      payloadJson: {
        tool_name: 'Bash',
        tool_use_id: 'tu-1',
        tool_input: {},
      },
      approvalRequestId: null,
      sequenceNumber: 5,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
    const tr: AgentEvent = {
      id: 6,
      agentId: 'claude-cc-001',
      sessionId: 'sess-1',
      eventType: 'tool_result',
      payloadJson: { tool_use_id: 'tu-1', content: 'x' },
      approvalRequestId: null,
      sequenceNumber: 6,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
    render(
      <MemoryRouter>
        <TaskGroupCard
          taskId="task-A"
          header={header}
          children={[child1, tu, tr]}
          footer={null}
        />
      </MemoryRouter>,
    );
    const card = screen.getByTestId('task-group-card');
    // 1 progress note + 1 tool_use = 2 steps; tool_result excluded.
    expect(card.textContent).toContain('2 STEPS');
  });

  // -------------------------------------------------------------------------
  // Phase 19.4 — bigger collapsed card with live activity + spec strip +
  // pulse animation while pending. Distinguishes a long-running subagent
  // dispatch from a generic single-shot tool row.
  // -------------------------------------------------------------------------

  it('shows live activity line with current step + last task description', () => {
    render(
      <MemoryRouter>
        <TaskGroupCard
          taskId="task-A"
          header={header}
          children={[child1, child2]}
          footer={null}
        />
      </MemoryRouter>,
    );
    const activity = screen.getByTestId('task-current-activity');
    expect(activity.textContent).toContain('STEP 2');
    expect(activity.textContent).toContain('Running Print');
  });

  it('derives activity from latest tool_use when it is the most recent child', () => {
    const tu: AgentEvent = {
      id: 5,
      agentId: 'claude-cc-001',
      sessionId: 'sess-1',
      eventType: 'tool_use',
      payloadJson: {
        tool_name: 'Bash',
        tool_use_id: 'tu-1',
        tool_input: { command: 'cargo test --workspace' },
      },
      approvalRequestId: null,
      sequenceNumber: 5,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
    render(
      <MemoryRouter>
        <TaskGroupCard
          taskId="task-A"
          header={header}
          children={[child1, tu]}
          footer={null}
        />
      </MemoryRouter>,
    );
    const activity = screen.getByTestId('task-current-activity');
    // Tool name uppercased + first 50 chars of command.
    expect(activity.textContent).toContain('BASH');
    expect(activity.textContent).toContain('cargo test --workspace');
  });

  it('shows INITIALIZING when pending and no children have arrived yet', () => {
    render(
      <MemoryRouter>
        <TaskGroupCard
          taskId="task-A"
          header={header}
          children={[]}
          footer={null}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId('task-current-activity').textContent,
    ).toContain('INITIALIZING');
  });

  it('renders the spec strip with STEPS · TOOLS · MM:SS', () => {
    render(
      <MemoryRouter>
        <TaskGroupCard
          taskId="task-A"
          header={header}
          children={[child1, child2]}
          footer={footerCompleted}
        />
      </MemoryRouter>,
    );
    const strip = screen.getByTestId('task-spec-strip');
    expect(strip.textContent).toContain('2 STEPS');
    // footerCompleted's usage.tool_uses === 2.
    expect(strip.textContent).toContain('2 TOOLS');
    // Completed → freezes on duration_ms = 1704 → "00:01".
    expect(strip.textContent).toContain('00:01');
  });

  it('applies the radar-pulse animation to the Bot icon and status dot while pending', () => {
    render(
      <MemoryRouter>
        <TaskGroupCard
          taskId="task-A"
          header={header}
          children={[]}
          footer={null}
        />
      </MemoryRouter>,
    );
    const botIcon = screen.getByTestId('task-bot-icon');
    const dot = screen.getByTestId('task-status-dot');
    expect(botIcon.getAttribute('style') ?? '').toContain('radar-pulse');
    expect(dot.getAttribute('style') ?? '').toContain('radar-pulse');
  });

  it('does NOT animate Bot/dot when state is success', () => {
    render(
      <MemoryRouter>
        <TaskGroupCard
          taskId="task-A"
          header={header}
          children={[]}
          footer={footerCompleted}
        />
      </MemoryRouter>,
    );
    const botIcon = screen.getByTestId('task-bot-icon');
    const dot = screen.getByTestId('task-status-dot');
    expect(botIcon.getAttribute('style') ?? '').not.toContain('radar-pulse');
    expect(dot.getAttribute('style') ?? '').not.toContain('radar-pulse');
  });
});

describe('getCurrentActivity (helper)', () => {
  function mkProgress(id: number, description: string): AgentEvent {
    return {
      id,
      agentId: 'a',
      sessionId: 's',
      eventType: 'system_note',
      payloadJson: {
        text: '[system/task_progress]',
        data: { subtype: 'task_progress', task_id: 'task-A', description },
      },
      approvalRequestId: null,
      sequenceNumber: id,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
  }
  function mkUse(id: number, name: string, input: Record<string, unknown>): AgentEvent {
    return {
      id,
      agentId: 'a',
      sessionId: 's',
      eventType: 'tool_use',
      payloadJson: { tool_name: name, tool_use_id: `tu-${id}`, tool_input: input },
      approvalRequestId: null,
      sequenceNumber: id,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
  }
  function mkResult(id: number, tu: string): AgentEvent {
    return {
      id,
      agentId: 'a',
      sessionId: 's',
      eventType: 'tool_result',
      payloadJson: { tool_use_id: tu, content: '' },
      approvalRequestId: null,
      sequenceNumber: id,
      createdAt: '2026-04-24T00:00:00Z',
      deliveryStatus: null,
    };
  }

  it('returns null with no children and non-pending state', () => {
    expect(getCurrentActivity([], 'success')).toBeNull();
  });

  it('returns INITIALIZING with no children and pending state', () => {
    expect(getCurrentActivity([], 'pending')).toEqual({
      step: 0,
      label: 'INITIALIZING',
    });
  });

  it('skips tool_result rows when finding the latest activity', () => {
    const events = [
      mkUse(1, 'Bash', { command: 'ls' }),
      mkResult(2, 'tu-1'),
    ];
    const a = getCurrentActivity(events, 'pending');
    expect(a?.step).toBe(1); // tool_result not counted
    expect(a?.label).toContain('BASH');
    expect(a?.label).toContain('ls');
  });

  it('counts step number from non-tool_result children only', () => {
    const events = [
      mkProgress(1, 'one'),
      mkUse(2, 'Bash', { command: 'cmd' }),
      mkResult(3, 'tu-2'),
      mkProgress(4, 'two'),
    ];
    const a = getCurrentActivity(events, 'pending');
    expect(a?.step).toBe(3);
    expect(a?.label).toBe('two');
  });

  it('truncates tool_use primary input to 50 chars and first line', () => {
    const long = 'x'.repeat(200);
    const a = getCurrentActivity(
      [mkUse(1, 'Bash', { command: `${long}\nsecond` })],
      'pending',
    );
    expect(a?.label).toContain('BASH');
    // 50 chars of the first line, no second-line content.
    expect(a?.label).not.toContain('second');
    expect(a?.label.length).toBeLessThan(80);
  });
});
