import { RadarPulse } from '../components/ui/RadarPulse';
import { Button } from '../components/ui/Button';

export function ConflictsView() {
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
