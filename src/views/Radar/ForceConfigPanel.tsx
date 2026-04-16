// Collapsible panel for tuning force-directed graph parameters.
// Exposes center force strength and cluster (proximity) force strength
// as sliders. Values commit to radarStore.forceConfig which triggers
// a re-settle in useGraphLayout.

import { useState } from 'react';
import { Settings2, ChevronDown, ChevronUp } from 'lucide-react';
import { useRadarStore, DEFAULT_FORCE_CONFIG } from '../../stores/radarStore';

export function ForceConfigPanel() {
  const [open, setOpen] = useState(false);
  const forceConfig = useRadarStore((s) => s.forceConfig);
  const setForceConfig = useRadarStore((s) => s.setForceConfig);

  return (
    <div className="absolute top-2 right-2 z-10 font-headline text-[10px] uppercase tracking-widest">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2 py-1 bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
        aria-expanded={open}
        aria-label="Force configuration"
      >
        <Settings2 size={14} strokeWidth={1.5} />
        FORCES
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div className="mt-1 bg-surface-container border border-outline-variant p-3 w-56 space-y-3">
          <label className="block">
            <span className="flex justify-between text-on-surface-variant">
              CENTER
              <span className="font-mono text-on-surface">
                {forceConfig.centerStrength.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={forceConfig.centerStrength}
              onChange={(e) =>
                setForceConfig({ centerStrength: parseFloat(e.target.value) })
              }
              className="w-full mt-1 accent-primary"
            />
          </label>

          <label className="block">
            <span className="flex justify-between text-on-surface-variant">
              PROXIMITY
              <span className="font-mono text-on-surface">
                {forceConfig.clusterStrength.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={forceConfig.clusterStrength}
              onChange={(e) =>
                setForceConfig({ clusterStrength: parseFloat(e.target.value) })
              }
              className="w-full mt-1 accent-primary"
            />
          </label>

          <button
            onClick={() => setForceConfig({ ...DEFAULT_FORCE_CONFIG })}
            className="w-full px-2 py-1 text-on-surface-variant hover:bg-surface-container-high"
          >
            RESET DEFAULTS
          </button>
        </div>
      )}
    </div>
  );
}
