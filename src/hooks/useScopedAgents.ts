// Returns the subset of agents whose cwd sits inside the currently-monitored
// repo. Views that talk about "the airspace" (Tower, Radar, Conflicts) should
// use this instead of reading useAgentStore directly so all counts and lists
// agree. The backend registry still tracks cross-repo agents -- this is a
// view-layer scoping concern.

import { useMemo } from 'react';
import type { AgentInfo } from '../stores/agentStore';
import { useAgentStore } from '../stores/agentStore';
import { useRepoStore } from '../stores/repoStore';

// Mirrors the backend's path-containment check. Strips trailing separators
// and anchors on `${root}/` / `${root}\\` so /foo/barn doesn't match /foo/bar.
// Agents with a null cwd stay visible -- the alternative is hiding agents
// whose cwd we just haven't received yet, which looks worse than the false
// positive.
export function cwdInsideRepo(cwd: string | null, root: string): boolean {
  if (!cwd) return true;
  const strip = (p: string) => p.replace(/[\\/]+$/, '');
  const c = strip(cwd);
  const r = strip(root);
  if (c === r) return true;
  return c.startsWith(`${r}/`) || c.startsWith(`${r}\\`);
}

export function useScopedAgents(): AgentInfo[] {
  const allAgents = useAgentStore((s) => s.agents);
  const activeRepo = useRepoStore((s) => s.activeRepo);
  return useMemo(
    () =>
      activeRepo
        ? allAgents.filter((a) => cwdInsideRepo(a.cwd, activeRepo))
        : allAgents,
    [allAgents, activeRepo],
  );
}
