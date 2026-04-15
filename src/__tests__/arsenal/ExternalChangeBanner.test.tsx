import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalChangeBanner } from '../../components/ui/ExternalChangeBanner';

describe('ExternalChangeBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderBanner(
    overrides: Partial<{
      hasUnsavedEdits: boolean;
      onReload: () => void;
      onKeepMine: () => void;
      onViewDiff: () => void;
    }> = {},
  ) {
    const onReload = overrides.onReload ?? vi.fn();
    const onKeepMine = overrides.onKeepMine ?? vi.fn();
    const onViewDiff = overrides.onViewDiff ?? vi.fn();
    render(
      <ExternalChangeBanner
        hasUnsavedEdits={overrides.hasUnsavedEdits ?? false}
        onReload={onReload}
        onKeepMine={onKeepMine}
        onViewDiff={onViewDiff}
      />,
    );
    return { onReload, onKeepMine, onViewDiff };
  }

  it('renders RELOAD, KEEP MINE, VIEW DIFF buttons', () => {
    renderBanner();
    expect(screen.getByRole('button', { name: /reload from disk/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /keep my unsaved edits/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view diff/i })).toBeInTheDocument();
  });

  it('RELOAD fires immediately when hasUnsavedEdits=false', () => {
    const { onReload } = renderBanner({ hasUnsavedEdits: false });
    act(() => {
      screen.getByRole('button', { name: /reload from disk/i }).click();
    });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('RELOAD requires two clicks when hasUnsavedEdits=true', () => {
    const { onReload } = renderBanner({ hasUnsavedEdits: true });
    const btn = screen.getByRole('button', { name: /reload from disk/i });
    act(() => {
      btn.click();
    });
    expect(onReload).not.toHaveBeenCalled();
    expect(btn.textContent).toMatch(/CONFIRM RELOAD/);
    act(() => {
      btn.click();
    });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('KEEP MINE always requires two clicks; 3s lapse reverts confirmation', () => {
    const { onKeepMine } = renderBanner({ hasUnsavedEdits: true });
    const btn = screen.getByRole('button', { name: /keep my unsaved edits/i });
    act(() => {
      btn.click();
    });
    expect(onKeepMine).not.toHaveBeenCalled();
    expect(btn.textContent).toMatch(/CONFIRM OVERWRITE/);
    // After 3s the confirmation should lapse and return to KEEP MINE label.
    act(() => {
      vi.advanceTimersByTime(3_100);
    });
    expect(btn.textContent).toMatch(/KEEP MINE/);
    // First click again re-enters confirmation.
    act(() => {
      btn.click();
    });
    expect(btn.textContent).toMatch(/CONFIRM OVERWRITE/);
    // Second click within 3s fires onKeepMine.
    act(() => {
      btn.click();
    });
    expect(onKeepMine).toHaveBeenCalledTimes(1);
  });

  it('VIEW DIFF fires on first click', () => {
    const { onViewDiff } = renderBanner();
    act(() => {
      screen.getByRole('button', { name: /view diff/i }).click();
    });
    expect(onViewDiff).toHaveBeenCalledTimes(1);
  });

  it('renders the exact message copy', () => {
    renderBanner();
    expect(
      screen.getByText('This file changed on disk while you were editing.'),
    ).toBeInTheDocument();
  });
});
