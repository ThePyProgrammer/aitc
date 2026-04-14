import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRepoStore } from '../../stores/repoStore';

/** UI-SPEC: button opening inline confirm -> picker. */
export function ChangeRepoButton() {
  const [confirming, setConfirming] = useState(false);
  const changeRepo = useRepoStore((s) => s.changeRepo);

  if (confirming) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 bg-[var(--color-surface-container-high)]">
        <span className="text-xs font-mono text-[var(--color-on-surface)] max-w-[40ch]">
          Switching repositories will stop the current watch. Unsaved agent session data is preserved.
        </span>
        <button
          type="button"
          onClick={async () => {
            setConfirming(false);
            await changeRepo();
          }}
          className="h-7 px-2 text-xs font-sans uppercase tracking-[0.08em] text-[var(--color-primary)] hover:bg-[var(--color-surface-container)]"
        >
          Switch repository
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="h-7 px-2 text-xs font-sans uppercase tracking-[0.08em] text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-container)]"
        >
          Keep current repo
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label="Change repo"
      title="Change repo"
      onClick={() => setConfirming(true)}
      className="h-8 px-3 inline-flex items-center gap-1 text-xs font-sans uppercase tracking-[0.08em] text-[var(--color-on-surface)] hover:bg-[var(--color-surface-container-high)]"
    >
      <RefreshCw size={14} strokeWidth={1.5} />
      <span>Change repo</span>
    </button>
  );
}
