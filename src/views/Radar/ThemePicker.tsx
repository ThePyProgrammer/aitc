// Theme picker UI for the graph radar. Mounted inside ForceConfigPanel
// above the existing force sliders. Reads the current themeId from
// radarStore and calls setThemeId on click so selection applies instantly
// (RadarCanvas's useEffect on theme flips dirtyRef for the next frame).
//
// Each row shows:
//   • theme display name (JetBrains Mono so long names stay legible)
//   • 3 swatch squares: hull stroke, edge stroke, node accent
//     (nodeGlow when available, else nodeStroke).
// The active theme row is marked with a '●' prefix + primary tint.

import { Check } from 'lucide-react';
import { useRadarStore } from '../../stores/radarStore';
import { THEMES, THEME_ORDER, type GraphTheme } from './themes';

/** Extract the accent color (node glow or stroke) for a swatch square. */
function nodeAccent(theme: GraphTheme): string {
  return theme.nodeGlow ?? theme.nodeStroke;
}

export function ThemePicker() {
  const themeId = useRadarStore((s) => s.themeId);
  const setThemeId = useRadarStore((s) => s.setThemeId);

  return (
    <div className="space-y-1" role="radiogroup" aria-label="Graph color theme">
      <div className="text-on-surface-variant">THEME</div>
      <div className="flex flex-col gap-[2px]">
        {THEME_ORDER.map((id) => {
          const theme = THEMES[id];
          const isActive = themeId === id;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={isActive}
              onClick={() => setThemeId(id)}
              className={`flex items-center gap-2 px-1.5 py-1 text-left transition-colors duration-100 ${
                isActive
                  ? 'text-primary bg-primary/10'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {/* Active marker — a 10px check keeps row width stable. */}
              <span className="w-3 flex items-center justify-center">
                {isActive ? <Check size={10} strokeWidth={2} /> : null}
              </span>
              <span className="flex-1 font-mono text-[10px] normal-case tracking-normal">
                {theme.name}
              </span>
              {/* Swatch: hull / edge / node-accent. */}
              <span className="flex items-center gap-0.5" aria-hidden="true">
                <span
                  className="inline-block w-2 h-2 border border-outline-variant/40"
                  style={{ background: theme.hullStroke }}
                />
                <span
                  className="inline-block w-2 h-2 border border-outline-variant/40"
                  style={{ background: theme.edgeStroke }}
                />
                <span
                  className="inline-block w-2 h-2 border border-outline-variant/40"
                  style={{ background: nodeAccent(theme) }}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
