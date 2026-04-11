// Phase 4 RadarView -- Airspace Radar layout.
//
// VIZN-01, VIZN-02: Main radar view with treemap canvas, agent manifest,
// tooltip overlay, and minimap. Shows AWAITING_SIGNAL when no watch session
// is active. Fetches tree index and starts agent polling on mount.

import { useEffect, useCallback, useRef, useState } from 'react';
import { RadarPulse } from '../components/ui/RadarPulse';
import { RadarCanvas } from './Radar/RadarCanvas';
import { RadarManifest } from './Radar/RadarManifest';
import { AgentTooltip } from './Radar/AgentTooltip';
import { RadarMinimap } from './Radar/RadarMinimap';
import { useRadarStore } from '../stores/radarStore';
import { useAgentStore } from '../stores/agentStore';
import { usePipelineStore } from '../stores/pipelineStore';

export function RadarView() {
  const treeData = useRadarStore((s) => s.treeData);
  const fetchTreeIndex = useRadarStore((s) => s.fetchTreeIndex);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const startPolling = useAgentStore((s) => s.startPolling);
  const isWatching = usePipelineStore((s) => s.isWatching);
  const agents = useAgentStore((s) => s.agents);

  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    fetchTreeIndex();
    fetchAgents();
    const cleanup = startPolling();
    return cleanup;
  }, [fetchTreeIndex, fetchAgents, startPolling]);

  // Track container rect for tooltip clamping
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setContainerRect(el.getBoundingClientRect());
    });
    observer.observe(el);
    setContainerRect(el.getBoundingClientRect());
    return () => observer.disconnect();
  }, []);

  const handleHoveredAgentChange = useCallback(
    (agentId: string | null, mouseX: number, mouseY: number) => {
      setHoveredAgentId(agentId);
      setMousePos({ x: mouseX, y: mouseY });
    },
    [],
  );

  const hoveredAgent = hoveredAgentId
    ? agents.find((a) => a.id === hoveredAgentId) ?? null
    : null;

  const showEmptyState = treeData.length === 0 && !isWatching;

  if (showEmptyState) {
    return (
      <div
        className="relative min-h-[calc(100vh-56px)] bg-surface-container-lowest overflow-hidden"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(73, 72, 71, 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(73, 72, 71, 0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      >
        {/* Scanline sweep */}
        <div
          className="pointer-events-none absolute left-0 right-0 h-[2px] bg-primary/20"
          style={{ animation: 'scan 4s linear infinite' }}
        />

        {/* Crosshair overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute left-0 right-0 h-px bg-outline-variant/15" />
          <div className="absolute top-0 bottom-0 w-px bg-outline-variant/15" />
        </div>

        {/* Concentric circles */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="absolute h-[200px] w-[200px] border border-outline-variant/10"
            style={{ borderRadius: '50% !important' }}
          />
          <div
            className="absolute h-[400px] w-[400px] border border-outline-variant/10"
            style={{ borderRadius: '50% !important' }}
          />
          <div
            className="absolute h-[600px] w-[600px] border border-outline-variant/10"
            style={{ borderRadius: '50% !important' }}
          />
        </div>

        {/* Center content with phosphor-in animation */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-4"
          style={{ animation: 'phosphor-in 150ms ease' }}
        >
          <RadarPulse size="lg" color="primary" />

          <h2 className="mt-4 text-primary font-headline text-sm font-bold uppercase tracking-widest">
            AWAITING_SIGNAL
          </h2>

          <p className="text-on-surface-variant font-mono text-xs">
            No active watch session. Start a file watcher to populate the airspace map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-[calc(100vh-56px)] bg-surface relative">
      <RadarCanvas onHoveredAgentChange={handleHoveredAgentChange} />
      <RadarManifest />
      <RadarMinimap />

      {/* Agent tooltip overlay */}
      {hoveredAgent && (
        <AgentTooltip
          agent={hoveredAgent}
          mouseX={mousePos.x}
          mouseY={mousePos.y}
          containerRect={containerRect}
        />
      )}
    </div>
  );
}
