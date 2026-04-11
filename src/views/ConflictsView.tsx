import { RadarPulse } from '../components/ui/RadarPulse';
import { Button } from '../components/ui/Button';
import { useConflictStore } from '../stores/conflictStore';
import { MergeView } from './Conflicts/MergeView';

export function ConflictsView() {
  const activeMerge = useConflictStore((s) => s.activeMerge);
  const alerts = useConflictStore((s) => s.alerts);
  const activeAlerts = alerts.filter((a) => !a.dismissed);
  const openMerge = useConflictStore((s) => s.openMerge);

  // If merge is active, show MergeView
  if (activeMerge) {
    return <MergeView />;
  }

  // If no active conflicts, show empty state
  if (activeAlerts.length === 0) {
    return (
      <div className="min-h-[calc(100vh-56px)] bg-surface flex items-center justify-center">
        <div
          className="flex flex-col items-center gap-4"
          style={{ animation: 'phosphor-in 150ms ease' }}
        >
          {/* Ambient radar pulse with ALL_CLEAR label */}
          <div className="flex flex-col items-center gap-2">
            <RadarPulse size="sm" color="primary" />
            <span className="text-primary/40 font-mono text-[10px] uppercase tracking-widest">
              ALL_CLEAR
            </span>
          </div>

          <h2 className="mt-4 text-on-surface-variant font-headline text-sm font-bold uppercase tracking-widest">
            ZERO_CONFLICTS_DETECTED
          </h2>

          <p className="text-on-surface-variant/60 font-mono text-xs">
            Airspace clear. File conflicts between agents will surface here.
          </p>

          <Button
            variant="primary"
            disabled
            tooltip="Agent management available in a future update"
            className="mt-4"
          >
            DEPLOY_AGENT
          </Button>
        </div>
      </div>
    );
  }

  // Conflict list: show active alerts as clickable rows
  return (
    <div className="min-h-[calc(100vh-56px)] bg-surface p-6" style={{ animation: 'phosphor-in 150ms ease' }}>
      <h2 className="text-on-surface-variant font-headline text-sm font-bold uppercase tracking-widest mb-4">
        ACTIVE_CONFLICTS
      </h2>
      <div className="flex flex-col gap-2">
        {activeAlerts.map((alert) => (
          <button
            key={alert.id}
            onClick={() => openMerge(alert.id)}
            className="flex items-center gap-4 p-4 bg-surface-container hover:bg-surface-container-high transition-colors duration-150 text-left"
          >
            <span className="text-error font-mono text-xs">{alert.id}</span>
            <span className="text-on-surface font-mono text-sm flex-1 truncate">{alert.filePath}</span>
            <span className="text-on-surface-variant font-mono text-xs">
              {alert.agentAId} vs {alert.agentBId}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
