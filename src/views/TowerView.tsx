import { StatusBadge } from '../components/ui/StatusBadge';
import { Button } from '../components/ui/Button';

export function TowerView() {
  return (
    <div className="min-h-[calc(100vh-56px)] bg-surface flex items-center justify-center">
      <div
        className="flex flex-col items-center gap-4"
        style={{ animation: 'phosphor-in 150ms ease' }}
      >
        {/* Ambient pulsing status badge */}
        <div style={{ animation: 'pulse 2s ease infinite' }}>
          <StatusBadge variant="idle">STANDBY</StatusBadge>
        </div>

        <h2 className="mt-4 text-on-surface-variant font-headline text-sm font-bold uppercase tracking-widest">
          TOWER_OFFLINE
        </h2>

        <p className="text-on-surface-variant/60 font-mono text-xs">
          Agent manifest unavailable. Deploy or attach agents to populate.
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
