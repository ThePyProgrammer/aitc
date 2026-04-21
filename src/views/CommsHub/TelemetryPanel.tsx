// Phase 10 Plan 06 (D-21): per-agent chat section removed — chat UI now
// lives in the first-class CHAT tab (ChatView + AgentChannelList). This
// panel keeps SystemLoad + TelemetryFeed only.

import { SystemLoad } from './SystemLoad';
import { TelemetryFeed } from './TelemetryFeed';

export function TelemetryPanel() {
  return (
    <div className="w-[260px] shrink-0 bg-surface-container flex flex-col gap-6 p-4 overflow-auto">
      {/* System load metrics */}
      <SystemLoad />

      {/* Telemetry feed */}
      <TelemetryFeed />
    </div>
  );
}
