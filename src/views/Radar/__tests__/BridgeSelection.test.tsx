// Phase 12 Wave 3 target: bridge click → selectedBridgeId, detail panel render.
// Analog: src/views/Radar/__tests__/RadarMinimap.test.tsx (Zustand selector-mock pattern — PATTERNS.md §Shared Pattern E).
// Witnesses: V-12-23 (click sets selectedBridgeId + BridgeDetailPanel renders).

import { describe, it } from 'vitest';

describe('BridgeSelection', () => {
  it.todo('V-12-23: click on bridge hit-region dispatches selectBridge(commandName)');
  it.todo('V-12-23: selected state renders BridgeDetailPanel with command/handler/caller list');
  it.todo('V-12-23: clicking already-selected bridge is a no-op (close via X button only)');
  it.todo('V-12-23: BridgeDetailPanel close button calls selectBridge(null)');
  it.todo('V-12-23: Escape key deselects bridge (and agent) per UI-SPEC §Keyboard');
});
