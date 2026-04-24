import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TaskGroupCard } from '../TaskGroupCard';
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
// paired tool_results via selectToolUseWithResult. Return empty so the
// grouping-test focus stays on rendering, not result-pairing.
vi.mock('../../../stores/chatStore', () => ({
  useChatStore: (
    selector: (s: { eventsByAgent: Record<string, AgentEvent[]> }) => unknown,
  ) => selector({ eventsByAgent: {} }),
  selectToolUseWithResult: () => ({ toolUse: null, toolResult: null }),
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
    expect(card.textContent).toContain('2 steps');
    const dot = screen.getByTestId('task-status-dot');
    expect(dot.dataset.status).toBe('success');
    expect(dot.className).toContain('bg-primary');
    // Expanded body should NOT be visible yet.
    expect(screen.queryByTestId('task-prompt-section')).toBeNull();
  });

  it('expands to show prompt, progress list, and completion result on click', () => {
    render(
      <TaskGroupCard
        taskId="task-A"
        header={header}
        children={[child1, child2]}
        footer={footerCompleted}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByTestId('task-prompt-section').textContent).toContain(
      "Echo 'hello' and stop.",
    );
    expect(screen.getByTestId('task-prompt-section').textContent).toContain(
      'local_agent',
    );
    const rows = screen.getAllByTestId('task-progress-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Running List entries');
    expect(rows[0].textContent).toContain('Bash');
    expect(rows[0].textContent).toContain('12345 tok');
    const result = screen.getByTestId('task-result-section');
    expect(result.textContent).toContain('COMPLETED');
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
    expect(card.textContent).toContain('2 steps');
  });
});
