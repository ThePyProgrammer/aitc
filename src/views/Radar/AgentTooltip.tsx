// Phase 4 Plan 05 -- Agent tooltip overlay.
//
// T-04-12: Intent text rendered as JSX text node (React escaping).
// Never use dangerouslySetInnerHTML.
// Glassmorphism per UI-SPEC: surface-container-highest at 60% opacity,
// backdrop-blur-[20px].

import { useMemo } from 'react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { AgentInfo } from '../../stores/agentStore';
import { usePipelineStore } from '../../stores/pipelineStore';

interface AgentTooltipProps {
  agent: AgentInfo;
  mouseX: number;
  mouseY: number;
  containerRect: DOMRect | null;
}

export function AgentTooltip({ agent, mouseX, mouseY, containerRect }: AgentTooltipProps) {
  const events = usePipelineStore((s) => s.events);

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

  // Position: offset 12px right and 12px below cursor, clamp to viewport bounds
  const tooltipW = 240;
  const tooltipH = 100;
  const containerW = containerRect?.width ?? window.innerWidth;
  const containerH = containerRect?.height ?? window.innerHeight;

  let left = mouseX + 12;
  let top = mouseY + 12;

  // Clamp to viewport bounds
  if (left + tooltipW > containerW) {
    left = mouseX - tooltipW - 12;
  }
  if (top + tooltipH > containerH) {
    top = mouseY - tooltipH - 12;
  }
  if (left < 0) left = 4;
  if (top < 0) top = 4;

  return (
    <div
      className="absolute z-50 pointer-events-none"
      style={{ left, top }}
    >
      <div
        className="p-3 border border-outline/20"
        style={{
          backgroundColor: 'rgba(36, 36, 36, 0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          width: tooltipW,
        }}
      >
        {/* Agent ID */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="font-mono text-xs font-bold text-on-surface truncate">
            {agent.id}
          </span>
          <StatusBadge variant={agent.state}>{agent.state.toUpperCase()}</StatusBadge>
        </div>

        {/* File count */}
        <div className="font-mono text-[10px] text-on-surface-variant mb-1">
          FILES: {fileCount}
        </div>

        {/* Intent text - JSX text node for XSS safety (T-04-12) */}
        {agent.intent && (
          <p className="font-mono text-sm text-on-surface leading-tight line-clamp-2 overflow-hidden">
            {agent.intent}
          </p>
        )}
      </div>
    </div>
  );
}
