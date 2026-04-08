import { RadarPulse } from '../components/ui/RadarPulse';
import { Button } from '../components/ui/Button';

export function RadarView() {
  return (
    <div
      className="relative min-h-[calc(100vh-56px)] bg-surface-container-lowest overflow-hidden"
      style={{
        backgroundImage:
          'linear-gradient(to right, rgba(73, 72, 71, 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(73, 72, 71, 0.1) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }}
    >
      {/* Scanline sweep */}
      <div
        className="pointer-events-none absolute left-0 right-0 h-[2px] bg-primary/20"
        style={{ animation: 'scan 4s linear infinite' }}
      />

      {/* Crosshair overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {/* Horizontal line */}
        <div className="absolute left-0 right-0 h-px bg-outline-variant/15" />
        {/* Vertical line */}
        <div className="absolute top-0 bottom-0 w-px bg-outline-variant/15" />
      </div>

      {/* Concentric circles */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="absolute h-[200px] w-[200px] border border-outline-variant/10"
          style={{ borderRadius: '50% !important' }}
        />
        <div
          className="absolute h-[400px] w-[400px] border border-outline-variant/10"
          style={{ borderRadius: '50% !important' }}
        />
        <div
          className="absolute h-[600px] w-[600px] border border-outline-variant/10"
          style={{ borderRadius: '50% !important' }}
        />
      </div>

      {/* Center content with phosphor-in animation */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-4"
        style={{ animation: 'phosphor-in 150ms ease' }}
      >
        <RadarPulse size="lg" color="primary" />

        <h2 className="mt-4 text-primary font-headline text-sm font-bold uppercase tracking-widest">
          AWAITING_SIGNAL
        </h2>

        <p className="text-on-surface-variant font-mono text-xs">
          No agents deployed. Deploy an agent to begin monitoring.
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
