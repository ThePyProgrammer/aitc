import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UndoToast } from '../../components/ui/UndoToast';

describe('UndoToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders SAVED — {filename}', () => {
    render(<UndoToast filename="CLAUDE.md" onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/SAVED — CLAUDE\.md/)).toBeInTheDocument();
  });

  it('countdown starts at 10 and ticks to 9 after 1 second', () => {
    render(<UndoToast filename="a.md" onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('Undo in 10s')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByText('Undo in 9s')).toBeInTheDocument();
  });

  it('onUndo is called exactly once when UNDO button clicked; a second click does nothing', () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(<UndoToast filename="a.md" onUndo={onUndo} onDismiss={onDismiss} />);
    const btn = screen.getByRole('button', { name: /undo save/i });
    act(() => {
      btn.click();
    });
    expect(onUndo).toHaveBeenCalledTimes(1);
    // Onclick also triggers onDismiss (toast unmounts in parent tree); spam-click should not double-fire onUndo.
    act(() => {
      btn.click();
    });
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after 10 seconds by calling onDismiss', async () => {
    const onDismiss = vi.fn();
    render(<UndoToast filename="a.md" onUndo={vi.fn()} onDismiss={onDismiss} />);
    // Advance in 1s increments so each setTimeout fires and React re-renders
    // between ticks (the countdown chains per-render setTimeout calls).
    for (let i = 0; i < 11; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('× dismiss glyph calls onDismiss once and never calls onUndo', () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(<UndoToast filename="a.md" onUndo={onUndo} onDismiss={onDismiss} />);
    const dismissBtn = screen.getByRole('button', { name: /dismiss toast/i });
    act(() => {
      dismissBtn.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });
});
