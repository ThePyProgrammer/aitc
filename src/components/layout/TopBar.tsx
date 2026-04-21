import { Minus, Square, X } from 'lucide-react';
import { useWindowControls } from '../../hooks/useWindowControls';
import { RepoStatusChip } from '../repo/RepoStatusChip';
import { PauseMonitoringToggle } from '../repo/PauseMonitoringToggle';
import { ChangeRepoButton } from '../repo/ChangeRepoButton';

export function TopBar() {
  const { minimize, toggleMaximize, close } = useWindowControls();

  return (
    <header
      data-tauri-drag-region
      className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center justify-between bg-surface-container-low"
    >
      {/* App title */}
      <div className="pl-6">
        <h1 className="text-primary font-headline text-xl font-bold tracking-tighter select-none">
          AI_CONTROL_CENTRE
        </h1>
      </div>

      {/* Repo session controls — right-aligned cluster, sits before window controls */}
      <div className="ml-auto flex items-center gap-2 pr-2">
        <RepoStatusChip />
        <PauseMonitoringToggle />
        <ChangeRepoButton />
      </div>

      {/* Window controls */}
      <div className="flex h-full">
        <button
          onClick={minimize}
          className="flex w-11 items-center justify-center text-on-surface-variant transition-colors duration-150 hover:bg-surface-container-high hover:text-on-surface"
          aria-label="Minimize"
        >
          <Minus size={16} strokeWidth={1.5} />
        </button>
        <button
          onClick={toggleMaximize}
          className="flex w-11 items-center justify-center text-on-surface-variant transition-colors duration-150 hover:bg-surface-container-high hover:text-on-surface"
          aria-label="Maximize"
        >
          <Square size={14} strokeWidth={1.5} />
        </button>
        <button
          onClick={close}
          className="flex w-11 items-center justify-center text-on-surface-variant transition-colors duration-150 hover:bg-error/20 hover:text-error"
          aria-label="Close"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}
