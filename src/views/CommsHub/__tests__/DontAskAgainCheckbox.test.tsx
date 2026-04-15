import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { DontAskAgainCheckbox } from '../DontAskAgainCheckbox';

describe('DontAskAgainCheckbox — Phase 8 Plan 05', () => {
  it('renders with label containing BASH when toolBadgeLabel="BASH"', () => {
    render(
      <DontAskAgainCheckbox
        checked={false}
        onChange={() => {}}
        toolBadgeLabel="BASH"
        agentId="KAGENT-9"
      />,
    );
    expect(screen.getByText(/DON'T_ASK_AGAIN_THIS_SESSION_FOR_BASH/)).toBeTruthy();
  });

  it('click on checkbox button toggles onChange with flipped value', () => {
    const onChange = vi.fn();
    render(
      <DontAskAgainCheckbox
        checked={false}
        onChange={onChange}
        toolBadgeLabel="EDIT"
        agentId="KAGENT-9"
      />,
    );
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('click on label also toggles onChange', () => {
    const onChange = vi.fn();
    render(
      <DontAskAgainCheckbox
        checked={false}
        onChange={onChange}
        toolBadgeLabel="EDIT"
        agentId="KAGENT-9"
      />,
    );
    const label = screen.getByText(/DON'T_ASK_AGAIN_THIS_SESSION_FOR_EDIT/);
    fireEvent.click(label);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('aria-checked reflects checked prop', () => {
    const { rerender } = render(
      <DontAskAgainCheckbox
        checked={false}
        onChange={() => {}}
        toolBadgeLabel="BASH"
        agentId="KAGENT-9"
      />,
    );
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    rerender(
      <DontAskAgainCheckbox
        checked={true}
        onChange={() => {}}
        toolBadgeLabel="BASH"
        agentId="KAGENT-9"
      />,
    );
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
  });

  it('does not itself submit any approval action', () => {
    const onChange = vi.fn();
    render(
      <DontAskAgainCheckbox
        checked={false}
        onChange={onChange}
        toolBadgeLabel="MCP"
        agentId="KAGENT-9"
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    // onChange is the only side-effect surface; no invoke spy to assert.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('aria-label reads "Don\'t ask again this session for {LABEL}"', () => {
    render(
      <DontAskAgainCheckbox
        checked={false}
        onChange={() => {}}
        toolBadgeLabel="WRITE"
        agentId="KAGENT-9"
      />,
    );
    expect(screen.getByLabelText(/Don't ask again this session for WRITE/)).toBeTruthy();
  });
});
