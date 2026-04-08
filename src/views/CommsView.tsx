import { Button } from '../components/ui/Button';

export function CommsView() {
  return (
    <div className="min-h-[calc(100vh-56px)] bg-surface flex items-center justify-center">
      <div
        className="flex flex-col items-center gap-4"
        style={{ animation: 'phosphor-in 150ms ease' }}
      >
        {/* Blinking cursor indicator */}
        <div
          className="h-5 w-[2px] bg-secondary"
          style={{ animation: 'blink-cursor 1s step-end infinite' }}
        />

        <h2 className="mt-4 text-on-surface-variant font-headline text-sm font-bold uppercase tracking-widest">
          NO_ACTIVE_CHANNELS
        </h2>

        <p className="text-on-surface-variant/60 font-mono text-xs">
          No pending requests. Agent communications will appear here.
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
