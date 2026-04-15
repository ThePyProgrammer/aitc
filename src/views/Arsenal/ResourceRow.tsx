// Phase 9 ARSENAL — ResourceRow (Plan 05 Wave 3).
//
// Single resource row: fixed 56px tall, 4 columns (name / description /
// ScopeChip / truncated path). Selected row gets the phosphor-green left
// border + container-high surface per 09-UI-SPEC §Color §Mouse sections.

import { Lock } from 'lucide-react';
import type { Resource } from '../../bindings';
import { ScopeChip } from '../../components/ui/ScopeChip';

export interface ResourceRowProps {
  resource: Resource;
  selected: boolean;
  onClick: () => void;
}

function isReadOnly(resource: Resource): boolean {
  if (resource.metadata.kind === 'claudeMd') {
    return !resource.metadata.editable;
  }
  // Everything else is read-only in v1 (per 09-UI-SPEC §Read-only indicators).
  return true;
}

export function ResourceRow({ resource, selected, onClick }: ResourceRowProps) {
  const readOnly = isReadOnly(resource);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={selected}
      role="option"
      data-testid="arsenal-resource-row"
      data-resource-id={resource.id}
      className={`h-14 w-full flex items-center px-6 gap-4 text-left transition-colors duration-150 ${
        selected
          ? 'bg-surface-container-high border-l-2 border-primary'
          : 'border-l-2 border-transparent hover:bg-surface-container'
      }`}
    >
      {readOnly && (
        <Lock
          size={14}
          strokeWidth={1.5}
          className="text-on-surface-variant shrink-0"
          aria-label="Read-only"
        />
      )}
      <span
        className={`font-mono text-sm truncate min-w-[120px] max-w-[220px] ${
          selected ? 'text-primary' : 'text-on-surface'
        }`}
      >
        {resource.name}
      </span>
      <span className="font-mono text-xs text-on-surface-variant truncate flex-1">
        {resource.description ?? '—'}
      </span>
      <ScopeChip scope={resource.scope} />
      <span className="font-mono text-xs text-on-surface-variant truncate max-w-[260px] ml-auto">
        {resource.path}
      </span>
    </button>
  );
}
