// Phase 9 ARSENAL — CreateClaudeMdPrompt.
//
// Shows "Create" buttons for missing CLAUDE.md files (cwd/CLAUDE.md and
// cwd/.claude/CLAUDE.md). Rendered inside the INSTRUCTIONS tab — either
// below existing rows or as part of the empty state.

import { useCallback, useState } from 'react';
import { FilePlus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { Resource } from '../../bindings';

export interface CreateClaudeMdPromptProps {
  cwd: string | null;
  resources: Resource[];
}

export function CreateClaudeMdPrompt({
  cwd,
  resources,
}: CreateClaudeMdPromptProps) {
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!cwd) return null;

  // Check which project CLAUDE.md files already exist by matching paths.
  const cwdClaudeMd = `${cwd}/CLAUDE.md`;
  const dotClaudeMd = `${cwd}/.claude/CLAUDE.md`;

  const hasCwdClaudeMd = resources.some(
    (r) =>
      r.category === 'claudeMd' &&
      r.scope === 'project' &&
      (r.path === cwdClaudeMd || r.path.endsWith('/CLAUDE.md') && !r.path.includes('.claude/CLAUDE.md')),
  );
  const hasDotClaudeMd = resources.some(
    (r) =>
      r.category === 'claudeMd' &&
      r.scope === 'project' &&
      r.path.endsWith('.claude/CLAUDE.md'),
  );

  const handleCreate = useCallback(
    async (path: string, label: string) => {
      setCreating(label);
      setError(null);
      try {
        await invoke('write_claude_md', {
          path,
          content: `# Project Instructions\n\nAdd your project-specific Claude instructions here.\n`,
          cwd,
        });
      } catch (err) {
        setError(String(err));
      } finally {
        setCreating(null);
      }
    },
    [cwd],
  );

  const buttons: { path: string; label: string; exists: boolean }[] = [
    { path: cwdClaudeMd, label: 'CLAUDE.md', exists: hasCwdClaudeMd },
    { path: dotClaudeMd, label: '.claude/CLAUDE.md', exists: hasDotClaudeMd },
  ];

  const missing = buttons.filter((b) => !b.exists);
  if (missing.length === 0) return null;

  return (
    <div className="px-6 py-4 flex flex-col gap-3">
      <span className="font-headline text-[10px] tracking-widest uppercase text-on-surface-variant">
        CREATE INSTRUCTION FILE
      </span>
      <div className="flex gap-3">
        {missing.map(({ path, label }) => (
          <button
            key={path}
            type="button"
            disabled={creating !== null}
            onClick={() => handleCreate(path, label)}
            className="flex items-center gap-2 px-4 py-2 rounded-none border border-outline-variant/30 bg-surface-container text-on-surface font-mono text-xs transition-colors hover:bg-surface-container-high hover:border-primary/40 disabled:opacity-50"
          >
            <FilePlus size={14} strokeWidth={1.5} />
            {creating === label ? 'Creating…' : `Create ${label}`}
          </button>
        ))}
      </div>
      {error && (
        <p className="font-mono text-xs text-error">{error}</p>
      )}
    </div>
  );
}
