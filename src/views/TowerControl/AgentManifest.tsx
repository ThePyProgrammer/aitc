import { StatusBadge } from '../../components/ui/StatusBadge';
import { useAgentStore } from '../../stores/agentStore';
import { useRepoStore } from '../../stores/repoStore';
import { AgentRow } from './AgentRow';

// Match when an agent's cwd sits inside the monitored repo root. Mirrors the
// backend containment check (handles trailing separators, avoids prefix-match
// false positives like /foo/barn matching /foo/bar). Agents without a cwd
// stay visible since we can't determine scope.
function cwdInsideRepo(cwd: string | null, root: string): boolean {
  if (!cwd) return true;
  const strip = (p: string) => p.replace(/[\\/]+$/, '');
  const c = strip(cwd);
  const r = strip(root);
  if (c === r) return true;
  return c.startsWith(`${r}/`) || c.startsWith(`${r}\\`);
}

export function AgentManifest() {
  const allAgents = useAgentStore((s) => s.agents);
  const isLoading = useAgentStore((s) => s.isLoading);
  const activeRepo = useRepoStore((s) => s.activeRepo);

  // Tower Control is scoped to the currently-watched repo: agents running
  // elsewhere are still tracked by the registry (for cross-repo conflict
  // detection later) but listing them here just confuses the user, who
  // expects "agents in this airspace".
  const agents = activeRepo
    ? allAgents.filter((a) => cwdInsideRepo(a.cwd, activeRepo))
    : allAgents;

  if (agents.length === 0 && !isLoading) {
    return (
      <div className="flex-1 bg-surface-container-low flex flex-col items-center justify-center py-16">
        <div style={{ animation: 'pulse 2s ease infinite' }}>
          <StatusBadge variant="idle">STANDBY</StatusBadge>
        </div>
        <h3 className="mt-4 font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
          TOWER_OFFLINE
        </h3>
        <p className="mt-2 font-mono text-xs text-on-surface-variant/60 max-w-md text-center">
          No agents detected. Deploy or attach agents to populate the manifest.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-surface-container-low">
      {/* Column headers */}
      <div className="flex h-10 items-center px-4 border-b border-outline/10">
        <div className="w-[20%] font-headline text-[10px] font-bold uppercase tracking-[0.1em] text-on-surface-variant">
          AGENT_ID
        </div>
        <div className="w-[15%] font-headline text-[10px] font-bold uppercase tracking-[0.1em] text-on-surface-variant">
          PROTOCOL
        </div>
        <div className="w-[15%] font-headline text-[10px] font-bold uppercase tracking-[0.1em] text-on-surface-variant">
          STATUS
        </div>
        <div className="w-[50%] font-headline text-[10px] font-bold uppercase tracking-[0.1em] text-on-surface-variant">
          PROCESS_PATH
        </div>
      </div>

      {/* Agent rows */}
      <div role="table" aria-label="Agent manifest">
        {agents.map((agent, index) => (
          <AgentRow key={agent.id} agent={agent} isEven={index % 2 === 0} />
        ))}
      </div>
    </div>
  );
}
