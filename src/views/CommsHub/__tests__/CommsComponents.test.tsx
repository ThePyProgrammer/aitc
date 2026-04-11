import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeliveryStatus } from '../../../components/ui/DeliveryStatus';
import { ChatThread } from '../ChatThread';
import { MiniChatCard } from '../MiniChatCard';
import { TelemetryPanel } from '../TelemetryPanel';
import type { ChatMessage } from '../../../stores/commsStore';
import type { AgentInfo } from '../../../stores/agentStore';

// Mock stores
const mockCommsState: Record<string, unknown> = {
  messages: {} as Record<string, ChatMessage[]>,
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  selectRequest: vi.fn(),
};

vi.mock('../../../stores/commsStore', () => ({
  useCommsStore: (selector: (s: typeof mockCommsState) => unknown) => selector(mockCommsState),
}));

const mockAgentState: Record<string, unknown> = {
  agents: [] as AgentInfo[],
};

vi.mock('../../../stores/agentStore', () => ({
  useAgentStore: (selector: (s: typeof mockAgentState) => unknown) => selector(mockAgentState),
}));

vi.mock('../../../stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: { events: unknown[] }) => unknown) =>
    selector({ events: [] }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({ cpuPercent: 45, memoryPercent: 62 }),
}));

// Mock motion/react to avoid animation issues in tests
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

const makeMockMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 1,
  agentId: 'agent-1',
  direction: 'inbound',
  content: 'Hello from agent',
  deliveryStatus: 'delivered',
  approvalRequestId: null,
  createdAt: '2026-04-10T12:00:00Z',
  ...overrides,
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

  it('renders UNSUPPORTED with X icon when status="unsupported"', () => {
    render(<DeliveryStatus status="unsupported" />);
    expect(screen.getByText('UNSUPPORTED')).toBeInTheDocument();
  });
});

describe('ChatThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommsState.messages = {};
    mockCommsState.fetchMessages = vi.fn();
  });

  it('renders messages from commsStore for given agentId', () => {
    mockCommsState.messages = {
      'agent-1': [
        makeMockMessage({ id: 1, content: 'First message' }),
        makeMockMessage({ id: 2, content: 'Second message', direction: 'outbound' }),
      ],
    };
    render(<ChatThread agentId="agent-1" />);
    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
  });

  it('shows NO_MESSAGES empty state when no messages exist', () => {
    mockCommsState.messages = {};
    render(<ChatThread agentId="agent-1" />);
    expect(screen.getByText('NO_MESSAGES')).toBeInTheDocument();
    expect(
      screen.getByText('Send a message to begin communication with this agent.')
    ).toBeInTheDocument();
  });

  it('calls fetchMessages on mount with agentId', () => {
    mockCommsState.messages = {};
    render(<ChatThread agentId="agent-1" />);
    expect(mockCommsState.fetchMessages).toHaveBeenCalledWith('agent-1');
  });
});

describe('MiniChatCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommsState.messages = {};
  });

  it('renders collapsed with agent ID visible', () => {
    render(<MiniChatCard agentId="agent-1" agentType="claude_code" />);
    expect(screen.getByText('agent-1')).toBeInTheDocument();
    expect(screen.getByText('claude_code')).toBeInTheDocument();
  });

  it('expands on click to show messages area', () => {
    mockCommsState.messages = {
      'agent-1': [
        makeMockMessage({ id: 1, content: 'Msg 1' }),
        makeMockMessage({ id: 2, content: 'Msg 2' }),
      ],
    };
    render(<MiniChatCard agentId="agent-1" agentType="claude_code" />);

    // Click to expand
    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Messages should be visible when expanded
    expect(screen.getByText('Msg 1')).toBeInTheDocument();
    expect(screen.getByText('Msg 2')).toBeInTheDocument();
  });

  it('shows last message preview when collapsed', () => {
    mockCommsState.messages = {
      'agent-1': [
        makeMockMessage({ id: 1, content: 'Preview text here' }),
      ],
    };
    render(<MiniChatCard agentId="agent-1" agentType="claude_code" />);
    expect(screen.getByText('Preview text here')).toBeInTheDocument();
  });
});

describe('TelemetryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mounts SystemLoad, TelemetryFeed, and MiniChatCard sub-panels', () => {
    mockAgentState.agents = [
      {
        id: 'agent-1',
        agentType: 'claude_code',
        protocol: 'hooks',
        state: 'running',
        pid: 1234,
        cwd: '/project',
        intent: null,
      },
    ];
    mockCommsState.messages = {};

    render(<TelemetryPanel />);

    // SystemLoad heading
    expect(screen.getByText('SYSTEM_LOAD')).toBeInTheDocument();
    // CPU and Memory labels
    expect(screen.getByText('CPU_CLUSTER')).toBeInTheDocument();
    expect(screen.getByText('MEMORY_SNAP')).toBeInTheDocument();
    // TelemetryFeed heading
    expect(screen.getByText('TELEMETRY_FEED')).toBeInTheDocument();
    // Agent channels heading
    expect(screen.getByText('AGENT_CHANNELS')).toBeInTheDocument();
    // MiniChatCard for the agent
    expect(screen.getByText('agent-1')).toBeInTheDocument();
  });
});
