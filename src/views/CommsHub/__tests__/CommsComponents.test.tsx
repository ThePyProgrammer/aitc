// Phase 10 Plan 06 (D-21): ChatThread / ChatInput / MiniChatCard describe
// blocks deleted. The Phase 4 embedded chat surface is gone — replaced by
// the first-class CHAT tab (ChatView + components/chat/*). DeliveryStatus
// describe retained (it's a shared primitive) and TelemetryPanel describe
// trimmed to the surviving SystemLoad + TelemetryFeed contract.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeliveryStatus } from '../../../components/ui/DeliveryStatus';
import { TelemetryPanel } from '../TelemetryPanel';

vi.mock('../../../stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: { events: unknown[] }) => unknown) =>
    selector({ events: [] }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({ cpuPercent: 45, memoryPercent: 62 }),
}));

// Strip motion props so `<motion.*>` renders as plain elements in tests.
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props;
      return <div {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// jsdom does not implement scrollIntoView
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('DeliveryStatus', () => {
  it('renders DELIVERED with Check icon when status="delivered"', () => {
    render(<DeliveryStatus status="delivered" />);
    expect(screen.getByText('DELIVERED')).toBeInTheDocument();
  });

  it('renders QUEUED with Clock icon when status="queued"', () => {
    render(<DeliveryStatus status="queued" />);
    expect(screen.getByText('QUEUED')).toBeInTheDocument();
  });

  it('renders CONSUMED with CheckCheck icon when status="consumed"', () => {
    // Phase 10 D-10: "consumed" variant added in Plan 01 Task 3.
    render(<DeliveryStatus status="consumed" />);
    expect(screen.getByText('CONSUMED')).toBeInTheDocument();
  });

  it('renders UNSUPPORTED with X icon when status="unsupported"', () => {
    render(<DeliveryStatus status="unsupported" />);
    expect(screen.getByText('UNSUPPORTED')).toBeInTheDocument();
  });
});

describe('TelemetryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mounts SystemLoad and TelemetryFeed sub-panels (no AGENT_CHANNELS block)', () => {
    render(<TelemetryPanel />);

    // SystemLoad heading
    expect(screen.getByText('SYSTEM_LOAD')).toBeInTheDocument();
    // CPU and Memory labels
    expect(screen.getByText('CPU_CLUSTER')).toBeInTheDocument();
    expect(screen.getByText('MEMORY_SNAP')).toBeInTheDocument();
    // TelemetryFeed heading
    expect(screen.getByText('TELEMETRY_FEED')).toBeInTheDocument();
    // D-21: AGENT_CHANNELS section is gone.
    expect(screen.queryByText('AGENT_CHANNELS')).not.toBeInTheDocument();
  });
});
