import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalRequestCard } from '../ApprovalRequestCard';
import { useCommsStore, type ApprovalRequest } from '../../../stores/commsStore';

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, transition: _t, ...rest } = props as Record<string, unknown>;
      return <div {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</div>;
    },
    span: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, transition: _t, ...rest } = props as Record<string, unknown>;
      return <span {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</span>;
    },
  },
}));

const baseRequest: ApprovalRequest = {
  id: 1,
  agentId: 'KAGENT-9',
  requestType: 'pretool_use',
  filePath: '/repo/src/main.ts',
  diffContent: null,
  status: 'pending',
  urgency: 'medium',
  responseNote: null,
  editedContent: null,
  createdAt: '2026-04-15T12:00:00Z',
  resolvedAt: null,
  toolName: 'Edit',
  toolInputJson: {
    file_path: '/repo/src/main.ts',
    old_string: 'const x = 1;',
    new_string: 'const x = 2;',
  },
  sessionId: 'session-abc',
};

describe('ApprovalRequestCard — Phase 8 Plan 05', () => {
  beforeEach(() => {
    useCommsStore.getState().reset();
  });

  it('renders ToolBadge for pretool_use row with toolName="Edit"', () => {
    const { container } = render(<ApprovalRequestCard request={baseRequest} />);
    expect(container.querySelector('[data-tool-badge="Edit"]')).not.toBeNull();
    expect(container.textContent).toContain('EDIT');
  });

  it('does NOT render ToolBadge for write_access row (no toolName)', () => {
    const writeAccess: ApprovalRequest = {
      ...baseRequest,
      requestType: 'write_access',
      toolName: null,
      toolInputJson: null,
    };
    const { container } = render(<ApprovalRequestCard request={writeAccess} />);
    expect(container.querySelector('[data-tool-badge]')).toBeNull();
  });

  it('preview line shows "+ const x = 2;" for Edit row', () => {
    const { container } = render(<ApprovalRequestCard request={baseRequest} />);
    expect(container.textContent).toContain('const x = 2;');
    expect(container.textContent).toContain('+');
  });

  it('preview line shows "$ npm install" for Bash row', () => {
    const bash: ApprovalRequest = {
      ...baseRequest,
      toolName: 'Bash',
      toolInputJson: { command: 'npm install' },
    };
    const { container } = render(<ApprovalRequestCard request={bash} />);
    expect(container.textContent).toContain('$');
    expect(container.textContent).toContain('npm install');
  });

  it('preview line shows em-dash for Read row', () => {
    const read: ApprovalRequest = {
      ...baseRequest,
      toolName: 'Read',
      toolInputJson: { file_path: '/etc/passwd' },
    };
    const { container } = render(<ApprovalRequestCard request={read} />);
    expect(container.textContent).toContain('—');
  });

  it('abandoned row has aria-disabled="true" and does NOT trigger selectRequest on click', () => {
    const abandoned: ApprovalRequest = { ...baseRequest, status: 'abandoned' };
    const selectSpy = vi.spyOn(useCommsStore.getState(), 'selectRequest');
    const { container } = render(<ApprovalRequestCard request={abandoned} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(root);
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('abandoned row shows "ABANDONED — AGENT EXITED" footer text', () => {
    const abandoned: ApprovalRequest = { ...baseRequest, status: 'abandoned' };
    render(<ApprovalRequestCard request={abandoned} />);
    expect(screen.getByText(/ABANDONED — AGENT EXITED/)).toBeTruthy();
  });

  it('abandoned row has tabIndex=-1 (non-keyboard-focusable)', () => {
    const abandoned: ApprovalRequest = { ...baseRequest, status: 'abandoned' };
    const { container } = render(<ApprovalRequestCard request={abandoned} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('tabindex')).toBe('-1');
  });

  it('pending row is clickable and calls selectRequest', () => {
    const selectSpy = vi.spyOn(useCommsStore.getState(), 'selectRequest');
    const { container } = render(<ApprovalRequestCard request={baseRequest} />);
    const root = container.firstElementChild as HTMLElement;
    fireEvent.click(root);
    expect(selectSpy).toHaveBeenCalledWith(1);
  });

  it('parses toolInputJson that arrives as a JSON string (backend TEXT column)', () => {
    const jsonStr: ApprovalRequest = {
      ...baseRequest,
      toolName: 'Bash',
      toolInputJson: '{"command": "echo hi"}',
    };
    const { container } = render(<ApprovalRequestCard request={jsonStr} />);
    expect(container.textContent).toContain('echo hi');
  });
});
