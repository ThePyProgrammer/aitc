// Phase 4 Plan 05 -- Right-side collapsible agent manifest panel.
//
// D-12, UI-SPEC: 280px width, surface-container-low bg (#131313).
// Collapse/expand with Motion slide animation (200ms ease-in-out).
// Lists all agents via AgentManifestRow. AlertDetail at bottom.

import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useRadarStore } from '../../stores/radarStore';
import { useScopedAgents } from '../../hooks/useScopedAgents';
import { AgentManifestRow } from './AgentManifestRow';
import { AlertDetail } from './AlertDetail';
import { BridgeDetailPanel } from './BridgeDetailPanel';

export function RadarManifest() {
  const isManifestOpen = useRadarStore((s) => s.isManifestOpen);
  const toggleManifest = useRadarStore((s) => s.toggleManifest);
  const agents = useScopedAgents();

  return (
    <div className="relative flex">
      {/* Collapse toggle button (always visible) */}
      <button
        onClick={toggleManifest}
        className="absolute -left-6 top-3 z-50 w-6 h-8 flex items-center justify-center bg-surface-container-low border border-outline/10 border-r-0 text-on-surface-variant hover:text-on-surface transition-colors duration-150"
        aria-label={isManifestOpen ? 'Collapse manifest' : 'Expand manifest'}
        data-testid="manifest-toggle"
      >
        {isManifestOpen ? (
          <ChevronRight size={14} strokeWidth={1.5} />
        ) : (
          <ChevronLeft size={14} strokeWidth={1.5} />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isManifestOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden border-l border-outline/10 flex flex-col"
            style={{
              backgroundColor: '#131313',
              minWidth: 0,
            }}
            data-testid="radar-manifest-panel"
          >
            <div className="w-[280px] flex flex-col h-full">
              {/* Header */}
              <div className="px-3 py-3 border-b border-outline/10">
                <h2 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
                  AGENT_MANIFEST
                </h2>
              </div>

              {/* Agent list */}
              <div className="flex-1 overflow-y-auto">
                {agents.length === 0 ? (
                  <div className="px-3 py-4">
                    <p className="font-mono text-[10px] text-on-surface-variant/50">
                      No agents deployed
                    </p>
                  </div>
                ) : (
                  agents.map((agent) => (
                    <AgentManifestRow key={agent.id} agent={agent} />
                  ))
                )}
              </div>

              {/* Alert/Detail section */}
              <AlertDetail />

              {/* Phase 12 — bridge detail when selectedBridgeId !== null */}
              <BridgeDetailPanel />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
