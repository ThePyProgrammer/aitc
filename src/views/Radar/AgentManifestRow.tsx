// Phase 4 Plan 05 -- Agent manifest row for radar panel.
//
// Follows AgentRow visual pattern from TowerControl but compact.
// Click to select agent and center radar viewport on agent position.

import { useMemo } from 'react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { AgentInfo } from '../../stores/agentStore';
import { useRadarStore, getAgentColor } from '../../stores/radarStore';
import { usePipelineStore } from '../../stores/pipelineStore';
import { useTreemapLayout, graphNodesToTreeEntries } from '../../hooks/useTreemapLayout';

interface AgentManifestRowProps {
  agent: AgentInfo;
}

export function AgentManifestRow({ agent }: AgentManifestRowProps) {
  const selectedAgentId = useRadarStore((s) => s.selectedAgentId);
  const selectAgent = useRadarStore((s) => s.selectAgent);
  const setViewport = useRadarStore((s) => s.setViewport);
  // Phase 7 Plan 03: derive treemap layout input from graphNodes —
  // Plan 04 rewrites this row to hit-test against graph node positions.
  const graphNodes = useRadarStore((s) => s.graphNodes);
  const events = usePipelineStore((s) => s.events);

  const isSelected = selectedAgentId === agent.id;
  const color = getAgentColor(agent.id);

  // Count files touched by this agent
  const fileCount = useMemo(() => {
    const paths = new Set<string>();
    for (const ev of events) {
      if (ev.attribution.kind === 'pid' && ev.attribution.value === agent.pid) {
        paths.add(ev.path);
      } else if (ev.attribution.kind === 'ambiguous' && agent.pid && ev.attribution.value.includes(agent.pid)) {
        paths.add(ev.path);
      }
    }
    return paths.size;
  }, [events, agent.pid]);

  // Treemap layout for finding agent position
  // Use a reasonable default size (will approximate)
  const treeEntries = useMemo(() => graphNodesToTreeEntries(graphNodes), [graphNodes]);
  const layout = useTreemapLayout(treeEntries, 800, 600);

  const handleClick = () => {
    selectAgent(agent.id);

    // Find the agent's most recent file, then center viewport on that treemap rect
    if (!agent.pid) return;

    const agentEvent = events.find((ev) => {
      if (ev.attribution.kind === 'pid') return ev.attribution.value === agent.pid;
      if (ev.attribution.kind === 'ambiguous') return ev.attribution.value.includes(agent.pid!);
      return false;
    });
    if (!agentEvent) return;

    const normalizedPath = agentEvent.path.replace(/\\/g, '/');
    const rect = layout.find((r) => {
      const rPath = r.path.replace(/\\/g, '/');
      return rPath === normalizedPath || normalizedPath.endsWith(rPath) || rPath.endsWith(normalizedPath);
    });
    if (!rect) return;

    // Center viewport on this rect
    const cx = (rect.x0 + rect.x1) / 2;
    const cy = (rect.y0 + rect.y1) / 2;
    // Set pan so the center of the rect is at the center of a typical viewport
    const viewportCenterX = 400; // half of assumed canvas width
    const viewportCenterY = 300;
    setViewport({
      panX: viewportCenterX - cx * 3,
      panY: viewportCenterY - cy * 3,
      zoom: 3,
    });
  };

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors duration-150 hover:bg-surface-container-high ${
        isSelected
          ? 'bg-surface-container-high'
          : 'bg-transparent'
      }`}
      style={isSelected ? { borderLeft: `2px solid ${color}` } : { borderLeft: '2px solid transparent' }}
      onClick={handleClick}
      role="button"
      aria-label={`Select agent ${agent.id}`}
      data-testid={`agent-manifest-row-${agent.id}`}
    >
      {/* Color swatch */}
      <div
        className="w-2 h-2 shrink-0"
        style={{ backgroundColor: color, borderRadius: '50%' }}
        data-testid="agent-color-swatch"
      />

      {/* Agent ID */}
      <span className="font-mono text-xs font-bold text-on-surface truncate flex-1">
        {agent.id}
      </span>

      {/* Status badge */}
      <StatusBadge variant={agent.state}>{agent.state.toUpperCase()}</StatusBadge>

      {/* File count */}
      <span className="font-mono text-[10px] text-on-surface-variant shrink-0">
        {fileCount}
      </span>
    </div>
  );
}
