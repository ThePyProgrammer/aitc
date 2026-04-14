import { Pause, Play } from 'lucide-react';
import { useRepoStore } from '../../stores/repoStore';

/** UI-SPEC: icon-label button toggling repoStore.isPaused. Amber when paused. */
export function PauseMonitoringToggle() {
  const activeRepo = useRepoStore((s) => s.activeRepo);
  const isPaused = useRepoStore((s) => s.isPaused);
  const togglePause = useRepoStore((s) => s.togglePause);

  const disabled = !activeRepo;
  const label = isPaused ? 'Resume monitoring' : 'Pause monitoring';

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={disabled ? 'Open a repository first' : label}
      onClick={togglePause}
      className={`h-8 px-3 inline-flex items-center gap-1 text-xs font-sans uppercase tracking-[0.08em]
        ${disabled
          ? 'text-[var(--color-on-surface-variant)] opacity-50 cursor-not-allowed'
          : 'text-[var(--color-on-surface)] hover:bg-[var(--color-surface-container-high)]'
        }`}
    >
      {isPaused ? (
        <Play size={14} strokeWidth={1.5} />
      ) : (
        <Pause size={14} strokeWidth={1.5} />
      )}
      <span>{label}</span>
    </button>
  );
}
