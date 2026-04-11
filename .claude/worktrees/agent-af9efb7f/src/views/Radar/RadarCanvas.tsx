// Phase 4 RadarCanvas -- Canvas 2D treemap renderer.
//
// D-09, D-10, D-11, VIZN-01, VIZN-04, VIZN-05:
// Renders squarified treemap of codebase on Canvas 2D with:
// - HiDPI scaling (devicePixelRatio)
// - Zoom/pan via useCanvasZoomPan
// - Progressive detail (dirs at 1x, files at 3x, details at 8x)
// - Agent dots with pulse animation at file positions
// - Dirty-flag render loop via requestAnimationFrame

import { useEffect, useRef, useCallback, useState } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import { getAgentColor } from '../../stores/radarStore';
import { useAgentStore } from '../../stores/agentStore';
import { usePipelineStore } from '../../stores/pipelineStore';
import { useTreemapLayout, type TreemapRect } from '../../hooks/useTreemapLayout';
import { useCanvasZoomPan } from '../../hooks/useCanvasZoomPan';

// Surface colors from Command Horizon design system
const COLORS = {
  surfaceContainerLow: '#131313',
  surface: '#0e0e0e',
  outlineVariant: '#494847',
  onSurface: '#ffffff',
  onSurfaceVariant: '#adaaaa',
};

export function RadarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(true);
  const layoutRef = useRef<TreemapRect[]>([]);
  const animFrameRef = useRef<number>(0);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);

  const treeData = useRadarStore((s) => s.treeData);
  const agents = useAgentStore((s) => s.agents);
  const events = usePipelineStore((s) => s.events);

  const layout = useTreemapLayout(treeData, canvasSize.width, canvasSize.height);
  const { viewport, setViewport, handlers, screenToWorld } = useCanvasZoomPan();

  // Sync viewport to store for persistence
  const storeSetViewport = useRadarStore((s) => s.setViewport);
  useEffect(() => {
    storeSetViewport(viewport);
  }, [viewport, storeSetViewport]);

  // Update layout ref and mark dirty
  useEffect(() => {
    layoutRef.current = layout;
    dirtyRef.current = true;
  }, [layout]);

  // Mark dirty on viewport or agents change
  useEffect(() => {
    dirtyRef.current = true;
  }, [viewport, agents, events]);

  // ResizeObserver for container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setCanvasSize({ width: Math.floor(width), height: Math.floor(height) });
          dirtyRef.current = true;
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // HiDPI canvas setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvasSize.width * dpr);
    canvas.height = Math.floor(canvasSize.height * dpr);
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
    dirtyRef.current = true;
  }, [canvasSize]);

  // Build agent-to-file mapping from recent events
  const getAgentFileMap = useCallback(() => {
    const agentFiles = new Map<string, string>();
    // Attribute recent events to agents via PID
    for (const agent of agents) {
      if (!agent.pid) continue;
      // Find most recent event attributed to this agent's PID
      const agentEvent = events.find((ev) => {
        if (ev.attribution.kind === 'pid') {
          return ev.attribution.value === agent.pid;
        }
        if (ev.attribution.kind === 'ambiguous') {
          return ev.attribution.value.includes(agent.pid!);
        }
        return false;
      });
      if (agentEvent) {
        agentFiles.set(agent.id, agentEvent.path);
      }
    }
    return agentFiles;
  }, [agents, events]);

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let hasAnimatingDots = false;

    function render() {
      if (!ctx) return;

      if (dirtyRef.current || hasAnimatingDots) {
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas!.width, canvas!.height);
        ctx.restore();

        // Reset transform and apply viewport
        ctx.setTransform(
          viewport.zoom * (window.devicePixelRatio || 1),
          0,
          0,
          viewport.zoom * (window.devicePixelRatio || 1),
          viewport.panX * (window.devicePixelRatio || 1),
          viewport.panY * (window.devicePixelRatio || 1),
        );

        drawTreemap(ctx, layoutRef.current, viewport.zoom);
        hasAnimatingDots = drawAgentDots(ctx, layoutRef.current, viewport.zoom);
        dirtyRef.current = false;
      }

      animFrameRef.current = requestAnimationFrame(render);
    }

    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  });

  // Draw treemap rectangles with progressive detail
  function drawTreemap(ctx: CanvasRenderingContext2D, rects: TreemapRect[], zoom: number) {
    for (const rect of rects) {
      const screenW = (rect.x1 - rect.x0) * zoom;
      const screenH = (rect.y1 - rect.y0) * zoom;

      // Sub-pixel culling (VIZN-04)
      if (screenW < 1 || screenH < 1) continue;

      const w = rect.x1 - rect.x0;
      const h = rect.y1 - rect.y0;

      if (rect.isFile) {
        // File cell
        ctx.fillStyle = COLORS.surface;
        ctx.fillRect(rect.x0, rect.y0, w, h);
        ctx.strokeStyle = `rgba(73, 72, 71, 0.15)`;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(rect.x0, rect.y0, w, h);
      } else {
        // Directory rectangle
        ctx.fillStyle = COLORS.surfaceContainerLow;
        ctx.fillRect(rect.x0, rect.y0, w, h);
        ctx.strokeStyle = `rgba(73, 72, 71, 0.3)`;
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x0, rect.y0, w, h);
      }

      // Progressive detail: directory labels at zoom >= 1
      if (!rect.isFile && zoom >= 1 && screenW > 60) {
        ctx.fillStyle = COLORS.onSurfaceVariant;
        ctx.font = '10px "Space Grotesk", sans-serif';
        ctx.textBaseline = 'top';
        const label = rect.name.toUpperCase();
        const maxTextW = w - 4;
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x0, rect.y0, w, h);
        ctx.clip();
        ctx.fillText(label, rect.x0 + 3, rect.y0 + 2, maxTextW);
        ctx.restore();
      }

      // Progressive detail: file labels at zoom >= 3
      if (rect.isFile && zoom >= 3 && screenW > 40) {
        ctx.fillStyle = COLORS.onSurfaceVariant;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        const maxTextW = w - 4;
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x0, rect.y0, w, h);
        ctx.clip();
        ctx.fillText(rect.name, rect.x0 + 2, rect.y0 + h / 2, maxTextW);
        ctx.restore();
      }

      // Progressive detail: file details (size) at zoom >= 8
      if (rect.isFile && zoom >= 8 && screenW > 60) {
        ctx.fillStyle = COLORS.onSurfaceVariant;
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.textBaseline = 'bottom';
        const sizeLabel = rect.size >= 1024
          ? `${(rect.size / 1024).toFixed(1)}KB`
          : `${rect.size}B`;
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x0, rect.y0, w, h);
        ctx.clip();
        ctx.fillText(sizeLabel, rect.x0 + 2, rect.y0 + h - 2);
        ctx.restore();
      }
    }
  }

  // Draw agent dots with pulse animation
  function drawAgentDots(
    ctx: CanvasRenderingContext2D,
    rects: TreemapRect[],
    zoom: number,
  ): boolean {
    const agentFileMap = getAgentFileMap();
    let hasAnimation = false;

    for (const agent of agents) {
      const filePath = agentFileMap.get(agent.id);
      if (!filePath) continue;

      // Find matching treemap rect (normalize path separators)
      const normalizedPath = filePath.replace(/\\/g, '/');
      const rect = rects.find((r) => {
        const rPath = r.path.replace(/\\/g, '/');
        return rPath === normalizedPath || normalizedPath.endsWith(rPath) || rPath.endsWith(normalizedPath);
      });
      if (!rect) continue;

      const cx = (rect.x0 + rect.x1) / 2;
      const cy = (rect.y0 + rect.y1) / 2;
      const dotRadius = 4 / zoom; // 8px diameter in screen space
      const color = getAgentColor(agent.id);

      // Pulse animation: 2s cycle
      const phase = (Date.now() % 2000) / 2000;
      const pulseScale1 = 1 + phase * 1.5; // 1 to 2.5
      const pulseScale2 = 1 + ((phase + 0.25) % 1) * 1.5;
      const pulseAlpha1 = 0.3 * (1 - phase);
      const pulseAlpha2 = 0.2 * (1 - ((phase + 0.25) % 1));

      // Outer pulse ring 2
      ctx.beginPath();
      ctx.arc(cx, cy, dotRadius * pulseScale2, 0, Math.PI * 2);
      ctx.fillStyle = color.slice(0, 7) + Math.round(pulseAlpha2 * 255).toString(16).padStart(2, '0');
      ctx.fill();

      // Outer pulse ring 1
      ctx.beginPath();
      ctx.arc(cx, cy, dotRadius * pulseScale1, 0, Math.PI * 2);
      ctx.fillStyle = color.slice(0, 7) + Math.round(pulseAlpha1 * 255).toString(16).padStart(2, '0');
      ctx.fill();

      // Center dot
      ctx.beginPath();
      ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      hasAnimation = true;
    }

    return hasAnimation;
  }

  // Hit testing for agent dot hover
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const world = screenToWorld(screenX, screenY);

      const agentFileMap = getAgentFileMap();
      let found: string | null = null;

      for (const agent of agents) {
        const filePath = agentFileMap.get(agent.id);
        if (!filePath) continue;

        const normalizedPath = filePath.replace(/\\/g, '/');
        const tmRect = layoutRef.current.find((r) => {
          const rPath = r.path.replace(/\\/g, '/');
          return rPath === normalizedPath || normalizedPath.endsWith(rPath) || rPath.endsWith(normalizedPath);
        });
        if (!tmRect) continue;

        const cx = (tmRect.x0 + tmRect.x1) / 2;
        const cy = (tmRect.y0 + tmRect.y1) / 2;
        const dist = Math.sqrt((world.x - cx) ** 2 + (world.y - cy) ** 2);
        if (dist <= 8 / viewport.zoom) {
          found = agent.id;
          break;
        }
      }

      setHoveredAgentId(found);
    },
    [screenToWorld, agents, getAgentFileMap, viewport.zoom],
  );

  // Attach native event handlers (onWheel needs passive: false)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { onWheel, onMouseDown, onMouseMove, onMouseUp } = handlers;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [handlers]);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden bg-surface-container-lowest">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        className="block"
        data-hovered-agent={hoveredAgentId}
      />
      {/* Zoom indicator */}
      <div className="absolute bottom-3 right-3 font-mono text-[10px] text-on-surface-variant/50 select-none">
        {viewport.zoom.toFixed(1)}x
      </div>
    </div>
  );
}
