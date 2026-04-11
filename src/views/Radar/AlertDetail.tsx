// Phase 4 Plan 05 -- Agent details panel (bottom of manifest).
//
// Shows selected agent's recent activity log (last 10 pipeline events),
// current file path, intent text. Scrollable, max ~300px.

import { useMemo } from 'react';
import { useRadarStore } from '../../stores/radarStore';
import { useAgentStore } from '../../stores/agentStore';
import { usePipelineStore } from '../../stores/pipelineStore';

export function AlertDetail() {
  const selectedAgentId = useRadarStore((s) => s.selectedAgentId);
  const agents = useAgentStore((s) => s.agents);
  const events = usePipelineStore((s) => s.events);

  const agent = agents.find((a) => a.id === selectedAgentId);

  // Get last 10 events for this agent
  const recentEvents = useMemo(() => {
    if (!agent?.pid) return [];
    return events
      .filter((ev) => {
        if (ev.attribution.kind === 'pid') return ev.attribution.value === agent.pid;
        if (ev.attribution.kind === 'ambiguous') return ev.attribution.value.includes(agent.pid!);
        return false;
      })
      .slice(0, 10);
  }, [events, agent?.pid]);

  if (!agent) return null;

  return (
    <div className="border-t border-outline/10">
      <h3 className="px-3 py-2 font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
        AGENT_DETAILS
      </h3>

      <div className="px-3 pb-3 max-h-[300px] overflow-y-auto">
        {/* Intent */}
        {agent.intent && (
          <div className="mb-2">
            <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
              INTENT:
            </span>
            <p className="font-mono text-xs text-on-surface mt-0.5">
              {agent.intent}
            </p>
          </div>
        )}

        {/* Current file */}
        {recentEvents.length > 0 && (
          <div className="mb-2">
            <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
              CURRENT_FILE:
            </span>
            <p className="font-mono text-[10px] text-on-surface-variant mt-0.5 truncate">
              {recentEvents[0].path}
            </p>
          </div>
        )}

        {/* Activity log */}
        <div>
          <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
            ACTIVITY_LOG:
          </span>
          {recentEvents.length === 0 ? (
            <p className="font-mono text-[10px] text-on-surface-variant/50 mt-1">
              No recent activity
            </p>
          ) : (
            <div className="mt-1 flex flex-col gap-0.5">
              {recentEvents.map((ev, i) => {
                const timeAgo = Math.round((Date.now() - ev.timestampMs) / 1000);
                const kindLabel = ev.kind.kind.toUpperCase();
                return (
                  <div key={`${ev.path}-${ev.timestampMs}-${i}`} className="flex items-center gap-2">
                    <span className="font-mono text-[9px] text-on-surface-variant/60 shrink-0 w-8">
                      {timeAgo}s
                    </span>
                    <span className="font-mono text-[9px] text-primary/80 shrink-0 w-12">
                      {kindLabel}
                    </span>
                    <span
                      className="font-mono text-[9px] text-on-surface-variant truncate"
                      style={{ direction: 'rtl', textAlign: 'left' }}
                    >
                      {ev.path}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
