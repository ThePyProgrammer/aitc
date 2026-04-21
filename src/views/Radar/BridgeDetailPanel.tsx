// Phase 12 Plan 05 (Wave 4) — right-side panel section that surfaces the
// currently-selected bridge's metadata inside RadarManifest.
//
// Rendered ONLY when radarStore.selectedBridgeId !== null AND a matching
// bridge GraphNode is present — otherwise returns null (AlertDetail pattern).
//
// Click a caller row to pan+zoom the radar canvas to that file (reusing
// AgentManifestRow's "center viewport on (node.x*3, node.y*3) with zoom 3"
// idiom).

import { X } from 'lucide-react';
import { useRadarStore } from '../../stores/radarStore';

export function BridgeDetailPanel() {
  const selectedBridgeId = useRadarStore((s) => s.selectedBridgeId);
  const graphNodes = useRadarStore((s) => s.graphNodes);
  const bridge = graphNodes.find(
    (n) => n.kind === 'bridge' && n.commandName === selectedBridgeId,
  );
  const selectBridge = useRadarStore((s) => s.selectBridge);
  const setViewport = useRadarStore((s) => s.setViewport);

  if (!selectedBridgeId || !bridge) return null;

  const handleCallerClick = (callerPath: string) => {
    const node = graphNodes.find((n) => n.id === callerPath);
    if (!node || node.x === undefined || node.y === undefined) return;
    // Match AgentManifestRow idiom: center at (400, 300) at zoom 3.
    setViewport({
      panX: 400 - node.x * 3,
      panY: 300 - node.y * 3,
      zoom: 3,
    });
  };

  return (
    <div className="px-3 py-4 border-t border-outline-variant/20">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
          BRIDGE_DETAIL
        </h3>
        <button
          onClick={() => selectBridge(null)}
          className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant hover:text-on-surface"
          aria-label="Close bridge detail"
        >
          <X size={14} strokeWidth={1.5} />
          CLOSE
        </button>
      </div>

      <div className="mb-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
          COMMAND
        </div>
        <div className="font-mono text-xs font-bold text-on-surface">
          {bridge.commandName}
        </div>
      </div>

      <div className="mb-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
          HANDLER
        </div>
        <div className="font-mono text-[10px] text-on-surface-variant break-all">
          {bridge.handlerFile || '—'}
          {bridge.handlerLine ? `:${bridge.handlerLine}` : ''}
        </div>
      </div>

      {bridge.signatureSummary && (
        <div className="mb-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
            SIGNATURE
          </div>
          <div className="font-mono text-[10px] text-on-surface-variant break-all">
            {bridge.signatureSummary}
          </div>
        </div>
      )}

      <div className="mb-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">
          CALLERS ({bridge.callerFiles?.length ?? 0})
        </div>
        <div className="space-y-1 mt-1">
          {(bridge.callerFiles ?? []).map((c, i) => (
            <button
              key={`${c.file}:${c.line}:${i}`}
              onClick={() => handleCallerClick(c.file)}
              className="block w-full text-left px-2 py-1 font-mono text-[10px] text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface break-all"
            >
              {c.file}:{c.line}
            </button>
          ))}
        </div>
      </div>

      {bridge.hasChannelArg && (
        <div
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: '#00cffc' }}
        >
          [ CHANNEL-BEARING ]
        </div>
      )}
    </div>
  );
}
