import { useEffect, useMemo, useState } from 'react';
import { Rocket } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useAgentStore } from '../../stores/agentStore';
import { useConflictStore } from '../../stores/conflictStore';
import { useRepoStore } from '../../stores/repoStore';
import { AgentManifest } from './AgentManifest';
import { DeployDialog } from './DeployDialog';
import { ConflictBanner } from './ConflictBanner';
import { QuickCommands } from './QuickCommands';
import { SystemLogs } from './SystemLogs';

// Keep in sync with AgentManifest.tsx cwdInsideRepo; the two views must
// count the same set of agents.
function cwdInsideRepo(cwd: string | null, root: string): boolean {
  if (!cwd) return true;
  const strip = (p: string) => p.replace(/[\\/]+$/, '');
  const c = strip(cwd);
  const r = strip(root);
  if (c === r) return true;
  return c.startsWith(`${r}/`) || c.startsWith(`${r}\\`);
}

export function TowerControl() {
  const [deployOpen, setDeployOpen] = useState(false);
  const allAgents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const startPolling = useAgentStore((s) => s.startPolling);
  const activeConflicts = useConflictStore((s) => s.activeCount());
  const fetchConflicts = useConflictStore((s) => s.fetchConflicts);
  const subscribeToEvents = useConflictStore((s) => s.subscribeToEvents);
  const activeRepo = useRepoStore((s) => s.activeRepo);

  const agents = useMemo(
    () =>
      activeRepo
        ? allAgents.filter((a) => cwdInsideRepo(a.cwd, activeRepo))
        : allAgents,
    [allAgents, activeRepo],
  );

  useEffect(() => {
    // Initial data fetch
    fetchAgents();
    fetchConflicts();

    // Start real-time subscriptions
    const stopPolling = startPolling();
    let unlisten: (() => void) | undefined;
    subscribeToEvents().then((fn) => {
      unlisten = fn;
    });

    return () => {
      stopPolling();
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="min-h-[calc(100vh-56px)] bg-surface flex flex-col"
      style={{ animation: 'phosphor-in 150ms ease' }}
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="font-headline text-xl font-bold text-on-surface">
            TOWER CONTROL <span className="text-on-surface-variant font-normal">.01</span>
          </h1>
        </div>
        <p className="mt-1 font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
          MONITOR ACTIVE INTELLIGENCE PROTOCOLS
        </p>
      </div>

      {/* Stats bar */}
      <div className="px-6 pb-4 flex gap-6">
        <div className="flex items-center gap-2">
          <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
            ACTIVE_AGENTS
          </span>
          <span className="font-mono text-sm font-bold text-primary">
            {agents.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant">
            CONFLICTS
          </span>
          <span className={`font-mono text-sm font-bold ${activeConflicts > 0 ? 'text-error' : 'text-on-surface-variant'}`}>
            {activeConflicts}
          </span>
        </div>
      </div>

      {/* Conflict banners */}
      <div className="px-6 pb-2">
        <ConflictBanner />
      </div>

      {/* Main content */}
      <div className="flex-1 flex px-6 pb-6 gap-6">
        {/* Left: Agent manifest */}
        <div className="flex-1 flex flex-col">
          <AgentManifest />
        </div>

        {/* Right sidebar */}
        <div className="w-72 flex flex-col gap-4 shrink-0">
          {/* Deploy button */}
          <Button
            variant="primary"
            className="w-full flex items-center justify-center gap-2"
            onClick={() => setDeployOpen(true)}
          >
            <Rocket size={16} strokeWidth={1.5} />
            DEPLOY_AGENT
          </Button>

          <QuickCommands />
          <SystemLogs />
        </div>
      </div>

      {/* Deploy dialog */}
      <DeployDialog open={deployOpen} onClose={() => setDeployOpen(false)} />
    </div>
  );
}
