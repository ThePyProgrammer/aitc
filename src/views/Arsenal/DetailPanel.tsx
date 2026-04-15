// Phase 9 ARSENAL — DetailPanel (Plan 05 Wave 3).
//
// Right column of the master/detail. Renders:
//   - NO_RESOURCE_SELECTED empty state when nothing is selected.
//   - Header (resource name + Lock icon for read-only resources).
//   - PATH row.
//   - METADATA via FrontmatterTable.
//   - CONTENT/EDIT: ContentPreview for non-CLAUDE.md; ClaudeMdEditor for the
//     two whitelisted CLAUDE.md paths; read-only preview for `~/.claude/CLAUDE.md`
//     (handled inside ClaudeMdEditor when `editable` is false).
//
// BLOCKER 3 REVISION: `cwd: string | null` is threaded in from ArsenalView so
// the editor can forward it to readClaudeMd / writeClaudeMd.

import { Lock } from 'lucide-react';
import { useClaudeResourcesStore } from '../../stores/claudeResourcesStore';
import { ScopeChip } from '../../components/ui/ScopeChip';
import { FrontmatterTable } from './FrontmatterTable';
import { ContentPreview } from './ContentPreview';
import { ClaudeMdEditor } from './ClaudeMdEditor';

export interface DetailPanelProps {
  resourceId: string | null;
  cwd: string | null;
}

export function DetailPanel({ resourceId, cwd }: DetailPanelProps) {
  const resource = useClaudeResourcesStore((s) =>
    resourceId ? s.resourcesById[resourceId] ?? null : null,
  );

  if (!resource) {
    return (
      <div
        data-testid="arsenal-detail-empty"
        className="flex flex-col items-center justify-center py-16 px-6 h-full"
      >
        <div
          className="h-5 w-[2px] bg-secondary"
          style={{ animation: 'blink-cursor 1s step-end infinite' }}
        />
        <p className="mt-4 font-headline text-sm font-bold uppercase tracking-widest text-on-surface text-center">
          NO_RESOURCE_SELECTED
        </p>
        <p className="mt-2 font-mono text-xs text-on-surface-variant/60 text-center max-w-[360px]">
          Select a resource from the list to view its definition.
        </p>
      </div>
    );
  }

  const isClaudeMd = resource.metadata.kind === 'claudeMd';
  const readOnly =
    resource.metadata.kind === 'claudeMd'
      ? !resource.metadata.editable
      : true;

  return (
    <div className="flex flex-col gap-6 px-6 py-4">
      <header className="flex items-center gap-3">
        {readOnly && (
          <Lock
            size={14}
            strokeWidth={1.5}
            className="text-on-surface-variant shrink-0"
            aria-label="Read-only"
          />
        )}
        <h2 className="font-mono text-sm text-on-surface break-all">
          {resource.name}
        </h2>
        <ScopeChip scope={resource.scope} className="ml-auto" />
      </header>

      <section className="flex flex-col gap-1">
        <span className="font-headline text-[10px] tracking-widest uppercase text-on-surface-variant">
          PATH
        </span>
        <code className="font-mono text-xs text-on-surface break-all">
          {resource.path}
        </code>
      </section>

      <section className="flex flex-col gap-2">
        <span className="font-headline text-[10px] tracking-widest uppercase text-on-surface-variant">
          METADATA
        </span>
        <FrontmatterTable metadata={resource.metadata} />
      </section>

      <section className="flex flex-col gap-2">
        <span className="font-headline text-[10px] tracking-widest uppercase text-on-surface-variant">
          {isClaudeMd ? 'EDIT' : 'CONTENT'}
        </span>
        {isClaudeMd ? (
          <ClaudeMdEditor path={resource.path} cwd={cwd} />
        ) : (
          <ContentPreview path={resource.path} cwd={cwd} readOnly />
        )}
      </section>
    </div>
  );
}
