// Phase 12 Plan 05 (Wave 4) — BridgeTooltip hover overlay tests.
// Witnesses: V-12-24 (command name + signature + handler + caller count +
// CHANNEL-BEARING + DANGLING + clamp math).

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BridgeTooltip } from '../BridgeTooltip';
import type { GraphNode } from '../../../stores/radarStore';

function makeBridge(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'bridge:ping',
    dirKey: 'bridge',
    dirDepth: 0,
    kind: 'bridge',
    commandName: 'ping',
    rustName: 'ping',
    handlerFile: 'src-tauri/src/handlers.rs',
    handlerLine: 5,
    signatureSummary: '() → Promise<null>',
    hasChannelArg: false,
    callerCount: 3,
    callerFiles: [],
    ...overrides,
  };
}

describe('BridgeTooltip', () => {
  it('V-12-24: renders command name + rustName + handler + caller count + signature', () => {
    const bridge = makeBridge({});
    const { getByText } = render(
      <BridgeTooltip
        bridge={bridge}
        mouseX={100}
        mouseY={100}
        containerWidth={800}
        containerHeight={600}
      />,
    );
    expect(getByText('ping')).toBeTruthy();
    // rustName rendered UPPERCASE.
    expect(getByText('PING')).toBeTruthy();
    expect(getByText(/HANDLER src-tauri\/src\/handlers\.rs:5/)).toBeTruthy();
    expect(getByText(/3_CALLERS/)).toBeTruthy();
    expect(getByText(/\(\) → Promise<null>/)).toBeTruthy();
  });

  it('V-12-24: CHANNEL-BEARING pill only when hasChannelArg=true', () => {
    const bridge = makeBridge({
      commandName: 'startWatch',
      rustName: 'start_watch',
      hasChannelArg: true,
      callerCount: 1,
    });
    const { getByText } = render(
      <BridgeTooltip
        bridge={bridge}
        mouseX={0}
        mouseY={0}
        containerWidth={800}
        containerHeight={600}
      />,
    );
    expect(getByText('CHANNEL-BEARING')).toBeTruthy();
  });

  it('V-12-24: DANGLING — NO CALLERS shown when callerCount=0', () => {
    const bridge = makeBridge({
      commandName: 'unused',
      rustName: 'unused',
      callerCount: 0,
    });
    const { getByText } = render(
      <BridgeTooltip
        bridge={bridge}
        mouseX={0}
        mouseY={0}
        containerWidth={800}
        containerHeight={600}
      />,
    );
    expect(getByText(/DANGLING — NO CALLERS/)).toBeTruthy();
  });

  it('V-12-24: DANGLING — NO HANDLER shown when handlerFile=""', () => {
    const bridge = makeBridge({
      commandName: 'orphan',
      rustName: 'orphan',
      handlerFile: '',
      handlerLine: 0,
      callerCount: 2,
    });
    const { getByText } = render(
      <BridgeTooltip
        bridge={bridge}
        mouseX={0}
        mouseY={0}
        containerWidth={800}
        containerHeight={600}
      />,
    );
    expect(getByText(/DANGLING — NO HANDLER/)).toBeTruthy();
  });

  it('V-12-24: non-dangling bridge does NOT show DANGLING row', () => {
    const bridge = makeBridge({ callerCount: 1, handlerFile: 'x' });
    const { queryByText } = render(
      <BridgeTooltip
        bridge={bridge}
        mouseX={0}
        mouseY={0}
        containerWidth={800}
        containerHeight={600}
      />,
    );
    expect(queryByText(/DANGLING/)).toBeNull();
  });

  it('V-12-24: clamps left/top when overflowing container (flip to upper-left)', () => {
    const bridge = makeBridge({});
    const { container } = render(
      <BridgeTooltip
        bridge={bridge}
        mouseX={780}
        mouseY={580}
        containerWidth={800}
        containerHeight={600}
      />,
    );
    const outer = container.querySelector('[style*="left"]') as HTMLElement;
    expect(outer).toBeTruthy();
    // Clamped: left = mouseX - tooltipW - 12 = 780 - 260 - 12 = 508.
    expect(parseInt(outer.style.left, 10)).toBeLessThan(780);
    // Clamped: top = mouseY - tooltipH - 12 = 580 - 140 - 12 = 428.
    expect(parseInt(outer.style.top, 10)).toBeLessThan(580);
  });

  it('V-12-24: clamps left/top to >=0 when mouse near (0,0)', () => {
    const bridge = makeBridge({});
    const { container } = render(
      <BridgeTooltip
        bridge={bridge}
        mouseX={-10}
        mouseY={-10}
        containerWidth={800}
        containerHeight={600}
      />,
    );
    const outer = container.querySelector('[style*="left"]') as HTMLElement;
    expect(outer).toBeTruthy();
    // With mouseX=-10: left = -10+12 = 2 which is >= 0, no clamp. OK.
    // With mouseX=-100: left = -100+12 = -88 → clamp to 4.
    const { container: container2 } = render(
      <BridgeTooltip
        bridge={bridge}
        mouseX={-100}
        mouseY={-100}
        containerWidth={800}
        containerHeight={600}
      />,
    );
    const outer2 = container2.querySelector(
      '[style*="left"]',
    ) as HTMLElement;
    expect(parseInt(outer2.style.left, 10)).toBeGreaterThanOrEqual(0);
    expect(parseInt(outer2.style.top, 10)).toBeGreaterThanOrEqual(0);
  });

  it('V-12-24: falls back to callerFiles.length when callerCount is undefined', () => {
    // Simulate IpcBridgeDto shape — no callerCount, has callerFiles.
    const bridge: any = {
      commandName: 'myCmd',
      rustName: 'my_cmd',
      handlerFile: 'src-tauri/src/x.rs',
      handlerLine: 42,
      signatureSummary: '(a: u8) → String',
      hasChannelArg: false,
      callerFiles: [
        { file: 'src/a.ts', line: 1, shape: 'literal' },
        { file: 'src/b.ts', line: 2, shape: 'literal' },
      ],
    };
    const { getByText } = render(
      <BridgeTooltip
        bridge={bridge}
        mouseX={0}
        mouseY={0}
        containerWidth={800}
        containerHeight={600}
      />,
    );
    expect(getByText(/2_CALLERS/)).toBeTruthy();
  });
});
