import { useRepoStore } from '../../stores/repoStore';
import { usePipelineStore } from '../../stores/pipelineStore';

/** UI-SPEC: Title-bar chip showing truncated repo path + WATCHING/PAUSED state dot. */
export function RepoStatusChip() {
  const activeRepo = useRepoStore((s) => s.activeRepo);
  const isPaused = useRepoStore((s) => s.isPaused);
  const isWatching = usePipelineStore((s) => s.isWatching);

  if (!activeRepo) return null;

  // Middle-truncate long paths: keep first segment + last 2 segments.
  const parts = activeRepo.split(/[\\/]/).filter(Boolean);
  const display =
    parts.length <= 3
      ? activeRepo
      : `${parts[0]}/…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`;

  const watching = isWatching && !isPaused;
  const stateLabel = watching ? 'WATCHING' : 'PAUSED';
  const dotColorVar = watching ? 'var(--color-primary)' : 'var(--color-tertiary)';
  const labelColorVar = watching ? 'var(--color-primary)' : 'var(--color-tertiary)';

  return (
    <div
      title={activeRepo}
      className="flex items-center gap-2 px-2 py-1 bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] font-mono text-sm"
    >
      <span
        aria-hidden="true"
        className={`inline-block w-2 h-2 rounded-none ${watching ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: dotColorVar }}
      />
      <span className="truncate max-w-[22ch]">{display}</span>
      <span
        className="text-[11px] font-sans uppercase tracking-[0.08em]"
        style={{ color: labelColorVar }}
      >
        {stateLabel}
      </span>
    </div>
  );
}
