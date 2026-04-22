// Phase 12 fix quick/260422-dqu — ForceConfigPanel BOUNDARY slider gate tests.
//
// The BOUNDARY slider tunes `forceBoundary`'s language-axis separation
// strength. On repos without a Tauri IPC surface (e.g. TS + Python) there
// are zero bridges, the boundary line + labels + force are all gated off,
// and the slider would tune a force that is not visibly doing anything —
// so the slider must not render either.
//
// Follows the Zustand selector-mock pattern from BridgeSelection.test.tsx
// per 12-05-SUMMARY key-decisions bullet 6: `vi.mock('../../../stores/radarStore', …)`
// with mutable mockRadarState drives conditional render paths without
// spinning the real store.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ForceConfigPanel } from '../ForceConfigPanel';

const mockRadarState: {
  graphNodes: Array<{
    id: string;
    kind?: 'file' | 'bridge';
    dirKey: string;
    dirDepth: number;
    commandName?: string;
  }>;
  forceConfig: {
    centerStrength: number;
    clusterStrength: number;
    linkStrength: number;
    chargeStrength: number;
    boundaryStrength: number;
  };
  setForceConfig: ReturnType<typeof vi.fn>;
  themeId: string;
  setThemeId: ReturnType<typeof vi.fn>;
} = {
  graphNodes: [],
  forceConfig: {
    centerStrength: 0.05,
    clusterStrength: 0.08,
    linkStrength: 0.3,
    chargeStrength: -80,
    boundaryStrength: 0.15,
  },
  setForceConfig: vi.fn(),
  themeId: 'phosphor-classic',
  setThemeId: vi.fn(),
};

vi.mock('../../../stores/radarStore', () => ({
  useRadarStore: (selector: (s: typeof mockRadarState) => unknown) =>
    selector(mockRadarState),
  DEFAULT_FORCE_CONFIG: {
    centerStrength: 0.05,
    clusterStrength: 0.08,
    linkStrength: 0.3,
    chargeStrength: -80,
    boundaryStrength: 0.15,
  },
}));

beforeEach(() => {
  mockRadarState.graphNodes = [];
  mockRadarState.forceConfig = {
    centerStrength: 0.05,
    clusterStrength: 0.08,
    linkStrength: 0.3,
    chargeStrength: -80,
    boundaryStrength: 0.15,
  };
  mockRadarState.setForceConfig = vi.fn();
  mockRadarState.themeId = 'phosphor-classic';
  mockRadarState.setThemeId = vi.fn();
});

function openPanel() {
  const toggle = screen.getByRole('button', { name: /force configuration/i });
  fireEvent.click(toggle);
}

describe('ForceConfigPanel BOUNDARY slider (quick/260422-dqu)', () => {
  it('hides the BOUNDARY label when no bridges are in graphNodes', () => {
    mockRadarState.graphNodes = [
      { id: 'src/foo.ts', kind: 'file', dirKey: 'src', dirDepth: 1 },
    ];
    render(<ForceConfigPanel />);
    openPanel();
    expect(screen.queryByText('BOUNDARY')).toBeNull();
  });

  it('shows the BOUNDARY label when at least one bridge is present', () => {
    mockRadarState.graphNodes = [
      { id: 'src/foo.ts', kind: 'file', dirKey: 'src', dirDepth: 1 },
      {
        id: 'bridge:launchAgent',
        kind: 'bridge',
        commandName: 'launchAgent',
        dirKey: 'bridge',
        dirDepth: 0,
      },
    ];
    render(<ForceConfigPanel />);
    openPanel();
    expect(screen.getByText('BOUNDARY')).toBeTruthy();
  });

  it('still renders the LINKS/PROXIMITY/REPULSION/CENTER sliders on no-bridges repos', () => {
    mockRadarState.graphNodes = [];
    render(<ForceConfigPanel />);
    openPanel();
    expect(screen.getByText('LINKS')).toBeTruthy();
    expect(screen.getByText('PROXIMITY')).toBeTruthy();
    expect(screen.getByText('REPULSION')).toBeTruthy();
    expect(screen.getByText('CENTER')).toBeTruthy();
  });
});
