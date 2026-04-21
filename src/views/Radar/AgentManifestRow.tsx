// Phase 4 Plan 05 -- Agent manifest row for radar panel.
//
// Click-to-select agent and center radar viewport on their current-position
// graph node. Phase 7 Plan 04 migrated this row off `useTreemapLayout` (D-04
// deletion) — it now uses `graphNodes` world positions directly so the
// viewport can pan to the agent's file without synthesizing treemap rects.

import { useMemo } from 'react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { AgentInfo } from '../../stores/agentStore';
import { useRadarStore, getAgentColor } from '../../stores/radarStore';
import { usePipelineStore } from '../../stores/pipelineStore';

interface AgentManifestRowProps {
  agent: AgentInfo;
}

export function AgentManifestRow({ agent }: AgentManifestRowProps) {
  const selectedAgentId = useRadarStore((s) => s.selectedAgentId);
  const selectAgent = useRadarStore((s) => s.selectAgent);
  const setViewport = useRadarStore((s) => s.setViewport);
  const graphNodes = useRadarStore((s) => s.graphNodes);
  const events = usePipelineStore((s) => s.events);

  const isSelected = selectedAgentId === agent.id;
  const color = getAgentColor(agent.id);

  // Count files touched by this agent.
  const fileCount = useMemo(() => {
    const paths = new Set<string>();
    for (const ev of events) {
      if (ev.attribution.kind === 'pid' && ev.attribution.value === agent.pid) {
        paths.add(ev.path);
      } else if (
        ev.attribution.kind === 'ambiguous' &&
        agent.pid &&
        ev.attribution.value.includes(agent.pid)
      ) {
        paths.add(ev.path);
      }
    }
    return paths.size;
  }, [events, agent.pid]);

  const handleClick = () => {
    selectAgent(agent.id);

    // Find the agent's most recent FileEvent and pan to the matching graph
    // node's world position (with zoom 3x for file-level detail).
    if (!agent.pid) return;

    const agentEvent = events.find((ev) => {
      if (ev.attribution.kind === 'pid')
        return ev.attribution.value === agent.pid;
      if (ev.attribution.kind === 'ambiguous')
        return ev.attribution.value.includes(agent.pid!);
      return false;
    });
    if (!agentEvent) return;

    const normalizedPath = agentEvent.path.replace(/\\/g, '/');
    const node = graphNodes.find((n) => {
      const nPath = n.id.replace(/\\/g, '/');
      return (
        nPath === normalizedPath ||
        normalizedPath.endsWith(nPath) ||
        nPath.endsWith(normalizedPath)
      );
    });
    if (!node || node.x === undefined || node.y === undefined) return;

    // Center the viewport on the node at zoom 3.
    const viewportCenterX = 400; // half of assumed canvas width
    const viewportCenterY = 300;
    setViewport({
      panX: viewportCenterX - node.x * 3,
      panY: viewportCenterY - node.y * 3,
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
