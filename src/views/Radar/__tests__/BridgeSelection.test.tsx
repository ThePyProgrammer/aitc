// Phase 12 Plan 05 (Wave 4) — BridgeDetailPanel selection + render tests.
// Witnesses: V-12-23 (click sets selectedBridgeId + panel renders + caller
// pan + close button + channel-bearing indicator).
//
// Uses the Zustand selector-mock pattern (PATTERNS.md §Shared Pattern E):
// stub useRadarStore to accept a selector and invoke it against a mutable
// mockRadarState object.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { BridgeDetailPanel } from '../BridgeDetailPanel';

const mockRadarState: any = {
  selectedBridgeId: null,
  graphNodes: [],
  selectBridge: vi.fn(),
  setViewport: vi.fn(),
};

vi.mock('../../../stores/radarStore', () => ({
  useRadarStore: (sel: any) => sel(mockRadarState),
}));

beforeEach(() => {
  mockRadarState.selectedBridgeId = null;
  mockRadarState.graphNodes = [];
  mockRadarState.selectBridge = vi.fn();
  mockRadarState.setViewport = vi.fn();
});

describe('BridgeDetailPanel', () => {
  it('V-12-23: renders null when selectedBridgeId is null', () => {
    const { container } = render(<BridgeDetailPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('V-12-23: renders null when selectedBridgeId has no matching bridge in graphNodes', () => {
    mockRadarState.selectedBridgeId = 'ghost';
    mockRadarState.graphNodes = [];
    const { container } = render(<BridgeDetailPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('V-12-23: renders COMMAND + HANDLER + SIGNATURE + CALLERS when bridge selected', () => {
    mockRadarState.selectedBridgeId = 'ping';
    mockRadarState.graphNodes = [
      {
        id: 'bridge:ping',
        kind: 'bridge',
        dirKey: 'bridge',
        dirDepth: 0,
        commandName: 'ping',
        handlerFile: 'src-tauri/src/handlers.rs',
        handlerLine: 5,
        signatureSummary: '() → Promise<null>',
        callerFiles: [{ file: 'src/app.ts', line: 10, shape: 'literal' }],
        hasChannelArg: false,
      },
    ];
    const { getByText } = render(<BridgeDetailPanel />);
    expect(getByText('ping')).toBeTruthy();
    expect(getByText(/src-tauri\/src\/handlers\.rs/)).toBeTruthy();
    expect(getByText(/\(\) → Promise<null>/)).toBeTruthy();
    expect(getByText(/CALLERS \(1\)/)).toBeTruthy();
    expect(getByText(/src\/app\.ts:10/)).toBeTruthy();
  });

  it('V-12-23: close button calls selectBridge(null)', () => {
    mockRadarState.selectedBridgeId = 'ping';
    mockRadarState.graphNodes = [
      {
        id: 'bridge:ping',
        kind: 'bridge',
        dirKey: 'bridge',
        dirDepth: 0,
        commandName: 'ping',
        handlerFile: 'x',
        handlerLine: 1,
        callerFiles: [],
        hasChannelArg: false,
      },
    ];
    const { getByLabelText } = render(<BridgeDetailPanel />);
    fireEvent.click(getByLabelText('Close bridge detail'));
    expect(mockRadarState.selectBridge).toHaveBeenCalledWith(null);
  });

  it('V-12-23: caller row click calls setViewport to pan + zoom 3x', () => {
    mockRadarState.selectedBridgeId = 'ping';
    mockRadarState.graphNodes = [
      {
        id: 'bridge:ping',
        kind: 'bridge',
        dirKey: 'bridge',
        dirDepth: 0,
        commandName: 'ping',
        handlerFile: 'x',
        handlerLine: 1,
        callerFiles: [{ file: 'src/app.ts', line: 10, shape: 'literal' }],
        hasChannelArg: false,
      },
      {
        id: 'src/app.ts',
        kind: 'file',
        dirKey: 'src',
        dirDepth: 1,
        x: 100,
        y: 50,
      },
    ];
    const { getByText } = render(<BridgeDetailPanel />);
    fireEvent.click(getByText('src/app.ts:10'));
    expect(mockRadarState.setViewport).toHaveBeenCalledWith({
      panX: 400 - 100 * 3,
      panY: 300 - 50 * 3,
      zoom: 3,
    });
  });

  it('V-12-23: caller row click is a no-op when the file node is not in graphNodes', () => {
    mockRadarState.selectedBridgeId = 'ping';
    mockRadarState.graphNodes = [
      {
        id: 'bridge:ping',
        kind: 'bridge',
        dirKey: 'bridge',
        dirDepth: 0,
        commandName: 'ping',
        handlerFile: 'x',
        handlerLine: 1,
        callerFiles: [{ file: 'src/missing.ts', line: 10, shape: 'literal' }],
        hasChannelArg: false,
      },
    ];
    const { getByText } = render(<BridgeDetailPanel />);
    fireEvent.click(getByText('src/missing.ts:10'));
    expect(mockRadarState.setViewport).not.toHaveBeenCalled();
  });

  it('V-12-23: channel-bearing bridge shows CHANNEL-BEARING indicator', () => {
    mockRadarState.selectedBridgeId = 'startWatch';
    mockRadarState.graphNodes = [
      {
        id: 'bridge:startWatch',
        kind: 'bridge',
        dirKey: 'bridge',
        dirDepth: 0,
        commandName: 'startWatch',
        handlerFile: 'x',
        handlerLine: 1,
        callerFiles: [],
        hasChannelArg: true,
      },
    ];
    const { getByText } = render(<BridgeDetailPanel />);
    expect(getByText(/CHANNEL-BEARING/)).toBeTruthy();
  });

  it('V-12-23: non-channel bridge does NOT show CHANNEL-BEARING indicator', () => {
    mockRadarState.selectedBridgeId = 'ping';
    mockRadarState.graphNodes = [
      {
        id: 'bridge:ping',
        kind: 'bridge',
        dirKey: 'bridge',
        dirDepth: 0,
        commandName: 'ping',
        handlerFile: 'x',
        handlerLine: 1,
        callerFiles: [],
        hasChannelArg: false,
      },
    ];
    const { queryByText } = render(<BridgeDetailPanel />);
    expect(queryByText(/CHANNEL-BEARING/)).toBeNull();
  });
});
