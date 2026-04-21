// Phase 12 Plan 05 (Wave 4) — hover overlay for bridge diamonds.
//
// Analog: src/views/Radar/AgentTooltip.tsx — same glassmorphism chrome +
// clamp math, different content rows (command name / rust name / signature /
// handler path + line / caller count / CHANNEL-BEARING + DANGLING indicators).
//
// Accepts either a GraphNode (kind='bridge') from the store or an IpcBridgeDto
// from the bindings directly; normalizes field access across both shapes via
// `'field' in bridge ? … : (bridge as any).snake_case` so the caller doesn't
// have to re-shape.

import type { IpcBridgeDto, IpcCallSite } from '../../bindings';
import type { GraphNode } from '../../stores/radarStore';

interface BridgeTooltipProps {
  bridge: GraphNode | IpcBridgeDto;
  mouseX: number;
  mouseY: number;
  containerWidth: number;
  containerHeight: number;
}

export function BridgeTooltip({
  bridge,
  mouseX,
  mouseY,
  containerWidth,
  containerHeight,
}: BridgeTooltipProps) {
  // UI-SPEC §Tooltip — wider than the 240px agent tooltip to fit signatures.
  const tooltipW = 260;
  const tooltipH = 140;
  let left = mouseX + 12;
  let top = mouseY + 12;
  if (left + tooltipW > containerWidth) left = mouseX - tooltipW - 12;
  if (top + tooltipH > containerHeight) top = mouseY - tooltipH - 12;
  if (left < 0) left = 4;
  if (top < 0) top = 4;

  // Shape-agnostic field access — both the camelCase bindings DTO and the
  // camelCase GraphNode fields resolve via the same key today, but keep
  // the fallback path available for future snake_case sources.
  const b = bridge as unknown as Record<string, unknown>;
  const commandName = (b.commandName as string | undefined) ?? '';
  const rustName =
    (b.rustName as string | undefined) ??
    (b.rust_name as string | undefined) ??
    '';
  const signatureSummary =
    (b.signatureSummary as string | undefined) ??
    (b.signature_summary as string | undefined) ??
    '';
  const handlerFile =
    (b.handlerFile as string | undefined) ??
    (b.handler_file as string | undefined) ??
    '';
  const handlerLine =
    (b.handlerLine as number | undefined) ??
    (b.handler_line as number | undefined) ??
    0;
  const hasChannelArg =
    (b.hasChannelArg as boolean | undefined) ??
    (b.has_channel_arg as boolean | undefined) ??
    false;
  const callerCountValue =
    (b.callerCount as number | undefined) ??
    (b.caller_count as number | undefined);
  const callerFiles =
    (b.callerFiles as IpcCallSite[] | undefined) ??
    (b.caller_files as IpcCallSite[] | undefined) ??
    [];
  const callerCount =
    callerCountValue !== undefined ? callerCountValue : callerFiles.length;

  const isDangling = callerCount === 0 || !handlerFile;

  return (
    <div className="absolute z-50 pointer-events-none" style={{ left, top }}>
      <div
        className="p-3 border border-outline/20"
        style={{
          backgroundColor: 'rgba(36, 36, 36, 0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          width: tooltipW,
        }}
      >
        <div className="font-mono text-xs font-bold text-on-surface truncate">
          {commandName}
        </div>
        {rustName && (
          <div className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">
            {rustName.toUpperCase()}
          </div>
        )}
        <div className="font-mono text-[10px] text-on-surface-variant mb-1 truncate">
          HANDLER {handlerFile || '—'}
          {handlerLine ? `:${handlerLine}` : ''}
        </div>
        <div className="font-mono text-[10px] text-on-surface-variant mb-1">
          {callerCount}_CALLERS
        </div>
        {signatureSummary && (
          <div className="font-mono text-[10px] text-on-surface-variant mb-1 break-words">
            {signatureSummary}
          </div>
        )}
        {hasChannelArg && (
          <div
            className="font-mono text-[10px] uppercase tracking-widest"
            style={{ color: '#00cffc' }}
          >
            CHANNEL-BEARING
          </div>
        )}
        {isDangling && (
          <div className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant/50">
            DANGLING — {!handlerFile ? 'NO HANDLER' : 'NO CALLERS'}
          </div>
        )}
      </div>
    </div>
  );
}
