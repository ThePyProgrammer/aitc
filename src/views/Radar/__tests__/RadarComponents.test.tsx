import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RadarManifest } from '../RadarManifest';
import { AgentManifestRow } from '../AgentManifestRow';
import { RadarMinimap } from '../RadarMinimap';
import type { AgentInfo } from '../../../stores/agentStore';

// Mock motion/react to avoid animation issues in tests
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { initial, animate, exit, transition, ...domProps } = props as Record<string, unknown>;
      return <div {...(domProps as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>;
    },
    span: ({ children, ...props }: Record<string, unknown>) => {
      const { initial, animate, exit, transition, ...domProps } = props as Record<string, unknown>;
      return <span {...(domProps as React.HTMLAttributes<HTMLSpanElement>)}>{children as React.ReactNode}</span>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
  ChevronRight: () => <span data-testid="chevron-right" />,
  ChevronLeft: () => <span data-testid="chevron-left" />,
  Square: () => <span data-testid="square-icon" />,
}));

// Store mock state
const mockRadarState = {
  treeData: [],
  viewport: { zoom: 1, panX: 0, panY: 0 },
  selectedAgentId: null as string | null,
  isManifestOpen: true,
  fetchTreeIndex: vi.fn(),
  setViewport: vi.fn(),
  selectAgent: vi.fn(),
  toggleManifest: vi.fn(),
  reset: vi.fn(),
};

const mockAgentState = {
  agents: [] as AgentInfo[],
  isLoading: false,
  error: null,
  fetchAgents: vi.fn(),
  launchAgent: vi.fn(),
  terminateAgent: vi.fn(),
  updateIntent: vi.fn(),
  startPolling: vi.fn(() => vi.fn()),
  reset: vi.fn(),
};

const mockPipelineState = {
  events: [],
  eventCount: 0,
  processes: [],
  worktrees: [],
  isWatching: false,
  droppedBatches: 0,
  ingest: vi.fn(),
  setWorktrees: vi.fn(),
  setProcesses: vi.fn(),
  setWatching: vi.fn(),
  reset: vi.fn(),
};

// Mock stores
vi.mock('../../../stores/radarStore', () => ({
  useRadarStore: (selector: (s: typeof mockRadarState) => unknown) => selector(mockRadarState),
  getAgentColor: (id: string) => '#8eff71',
  AGENT_DOT_PALETTE: ['#8eff71', '#00cffc', '#ffd16f', '#ff7351'],
}));

vi.mock('../../../stores/agentStore', () => ({
  useAgentStore: (selector: (s: typeof mockAgentState) => unknown) => selector(mockAgentState),
}));

vi.mock('../../../stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: typeof mockPipelineState) => unknown) => selector(mockPipelineState),
}));

vi.mock('../../../hooks/useTreemapLayout', () => ({
  useTreemapLayout: () => [],
  buildFileTree: () => ({ path: '', name: 'root', size: 0, isDir: true, children: [] }),
  computeTreemapLayout: () => [],
}));

const mockAgent1: AgentInfo = {
  id: 'claude-1',
  agentType: 'claude',
  protocol: 'hooks',
  state: 'running',
  pid: 1234,
  cwd: '/tmp/project',
  intent: 'refactoring auth',
};

const mockAgent2: AgentInfo = {
  id: 'codex-2',
  agentType: 'codex',
  protocol: 'cli',
  state: 'idle',
  pid: 5678,
  cwd: '/tmp/project',
  intent: null,
};

describe('RadarManifest', () => {
  beforeEach(() => {
    mockRadarState.isManifestOpen = true;
    mockRadarState.selectedAgentId = null;
    mockAgentState.agents = [];
    vi.clearAllMocks();
  });

  it('renders AGENT_MANIFEST header when isManifestOpen=true', () => {
    mockAgentState.agents = [];
    const { getByText } = render(<RadarManifest />);
    expect(getByText('AGENT_MANIFEST')).toBeInTheDocument();
  });

  it('collapse toggle calls radarStore.toggleManifest', () => {
    const { getByTestId } = render(<RadarManifest />);
    const toggle = getByTestId('manifest-toggle');
    fireEvent.click(toggle);
    expect(mockRadarState.toggleManifest).toHaveBeenCalled();
  });

  it('renders AgentManifestRow for each agent in agentStore', () => {
    mockAgentState.agents = [mockAgent1, mockAgent2];
    const { getByText } = render(<RadarManifest />);
    expect(getByText('claude-1')).toBeInTheDocument();
    expect(getByText('codex-2')).toBeInTheDocument();
  });
});

describe('AgentManifestRow', () => {
  beforeEach(() => {
    mockRadarState.selectedAgentId = null;
    vi.clearAllMocks();
  });

  it('renders agent ID and colored circle swatch', () => {
    const { getByText, getByTestId } = render(
      <AgentManifestRow agent={mockAgent1} />,
    );
    expect(getByText('claude-1')).toBeInTheDocument();
    expect(getByTestId('agent-color-swatch')).toBeInTheDocument();
  });

  it('click calls radarStore.selectAgent with agent.id', () => {
    const { getByTestId } = render(
      <AgentManifestRow agent={mockAgent1} />,
    );
    const row = getByTestId('agent-manifest-row-claude-1');
    fireEvent.click(row);
    expect(mockRadarState.selectAgent).toHaveBeenCalledWith('claude-1');
  });

  it('shows selected state styling when agent is selected', () => {
    mockRadarState.selectedAgentId = 'claude-1';
    const { getByTestId } = render(
      <AgentManifestRow agent={mockAgent1} />,
    );
    const row = getByTestId('agent-manifest-row-claude-1');
    expect(row.className).toContain('bg-surface-container-high');
  });
});

describe('RadarMinimap', () => {
  beforeEach(() => {
    mockRadarState.treeData = [];
    mockRadarState.viewport = { zoom: 1, panX: 0, panY: 0 };
    vi.clearAllMocks();
  });

  it('renders at 160x120 dimensions when treeData is present', () => {
    mockRadarState.treeData = [
      { path: 'src/index.ts', size: 100, isDir: false, depth: 1 },
    ];
    const { getByTestId } = render(<RadarMinimap />);
    const container = getByTestId('radar-minimap');
    expect(container.style.width).toBe('160px');
    expect(container.style.height).toBe('120px');
  });

  it('shows viewport indicator rectangle when viewport is set', () => {
    mockRadarState.treeData = [
      { path: 'src/index.ts', size: 100, isDir: false, depth: 1 },
    ];
    mockRadarState.viewport = { zoom: 2, panX: 100, panY: 50 };
    const { getByTestId } = render(<RadarMinimap />);
    expect(getByTestId('minimap-viewport-indicator')).toBeInTheDocument();
  });
});
