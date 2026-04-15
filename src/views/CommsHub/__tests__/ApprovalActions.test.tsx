import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ApprovalActions } from '../ApprovalActions';
import { useCommsStore } from '../../../stores/commsStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

describe('ApprovalActions — Phase 8 Plan 05 pretool_use extension', () => {
  beforeEach(() => {
    useCommsStore.getState().reset();
    vi.clearAllMocks();
  });

  it('renders DontAskAgainCheckbox for pretool_use row with toolBadgeLabel', () => {
    render(
      <ApprovalActions
        requestId={1}
        hasEdits={false}
        editedContent=""
        requestType="pretool_use"
        toolBadgeLabel="BASH"
        agentId="KAGENT-9"
      />,
    );
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(screen.getByText(/DON'T_ASK_AGAIN_THIS_SESSION_FOR_BASH/)).toBeTruthy();
  });

  it('does NOT render DontAskAgainCheckbox for write_access row', () => {
    render(
      <ApprovalActions
        requestId={1}
        hasEdits={false}
        editedContent=""
        requestType="write_access"
        toolBadgeLabel={null}
        agentId="agent-1"
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('does NOT render DontAskAgainCheckbox when requestType/toolBadgeLabel omitted (backward compat)', () => {
    render(<ApprovalActions requestId={1} hasEdits={false} editedContent="" />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('APPROVE click passes alwaysAllowForSession: false by default', () => {
    const approveSpy = vi.fn();
    useCommsStore.setState({ approveRequest: approveSpy });

    render(
      <ApprovalActions
        requestId={1}
        hasEdits={false}
        editedContent=""
        requestType="pretool_use"
        toolBadgeLabel="BASH"
        agentId="KAGENT-9"
      />,
    );
    fireEvent.click(screen.getByText('APPROVE'));
    expect(approveSpy).toHaveBeenCalledWith(1, { alwaysAllowForSession: false });
  });

  it('APPROVE click passes alwaysAllowForSession: true after checkbox checked', () => {
    const approveSpy = vi.fn();
    useCommsStore.setState({ approveRequest: approveSpy });

    render(
      <ApprovalActions
        requestId={1}
        hasEdits={false}
        editedContent=""
        requestType="pretool_use"
        toolBadgeLabel="BASH"
        agentId="KAGENT-9"
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('APPROVE'));
    expect(approveSpy).toHaveBeenCalledWith(1, { alwaysAllowForSession: true });
  });

  it('APPROVE_WITH_EDITS click passes alwaysAllowForSession: true after checkbox checked', () => {
    const approveWithEditsSpy = vi.fn();
    useCommsStore.setState({ approveWithEdits: approveWithEditsSpy });

    render(
      <ApprovalActions
        requestId={1}
        hasEdits={true}
        editedContent="edited"
        requestType="pretool_use"
        toolBadgeLabel="EDIT"
        agentId="KAGENT-9"
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('APPROVE_WITH_EDITS'));
    expect(approveWithEditsSpy).toHaveBeenCalledWith(1, 'edited', {
      alwaysAllowForSession: true,
    });
  });

  it('DENY two-click flow does NOT pass alwaysAllowForSession (T-08-12)', () => {
    const denySpy = vi.fn();
    useCommsStore.setState({ denyRequest: denySpy });

    render(
      <ApprovalActions
        requestId={1}
        hasEdits={false}
        editedContent=""
        requestType="pretool_use"
        toolBadgeLabel="BASH"
        agentId="KAGENT-9"
      />,
    );
    // Even with checkbox checked...
    fireEvent.click(screen.getByRole('checkbox'));
    // First click — confirm state
    fireEvent.click(screen.getByText('DENY'));
    // Second click — actual deny
    fireEvent.click(screen.getByText('CONFIRM_DENY'));
    expect(denySpy).toHaveBeenCalledWith(1);
    // Must NOT have been called with alwaysAllowForSession
    expect(denySpy).not.toHaveBeenCalledWith(1, expect.objectContaining({
      alwaysAllowForSession: true,
    }));
  });

  it('checkbox state resets when requestId prop changes', () => {
    const approveSpy = vi.fn();
    useCommsStore.setState({ approveRequest: approveSpy });

    const { rerender } = render(
      <ApprovalActions
        requestId={1}
        hasEdits={false}
        editedContent=""
        requestType="pretool_use"
        toolBadgeLabel="BASH"
        agentId="KAGENT-9"
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');

    // Switch to a different request
    rerender(
      <ApprovalActions
        requestId={2}
        hasEdits={false}
        editedContent=""
        requestType="pretool_use"
        toolBadgeLabel="BASH"
        agentId="KAGENT-9"
      />,
    );
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');

    // And APPROVE now passes alwaysAllowForSession: false
    fireEvent.click(screen.getByText('APPROVE'));
    expect(approveSpy).toHaveBeenLastCalledWith(2, { alwaysAllowForSession: false });
  });
});
