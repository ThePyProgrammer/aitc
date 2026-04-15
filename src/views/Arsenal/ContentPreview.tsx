// Phase 9 ARSENAL — ContentPreview (Plan 05 Wave 3).
//
// Read-only raw content viewer. Loads file content via `readClaudeMd`.
//
// PER WARNING 3 REVISION: `readClaudeMd` is intentionally reused as a generic
// text-file reader for v1. The Rust command does not enforce path validation
// on reads (only writes are gated by `is_editable`), so any readable text file
// at the Resource's path works — this is a deliberate simplification to keep
// the phase surface small. A dedicated `read_resource_file` command is a
// future refinement if read policies diverge.

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ReadClaudeMdResult } from '../../bindings';

export interface ContentPreviewProps {
  path: string;
  /** When true, always render as read-only (editable flag from backend is ignored). */
  readOnly?: boolean;
  cwd?: string | null;
}

export function ContentPreview({ path, cwd = null }: ContentPreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    invoke<ReadClaudeMdResult>('readClaudeMd', { path, cwd })
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [path, cwd]);

  if (error) {
    return (
      <pre
        data-testid="arsenal-content-error"
        className="font-mono text-xs text-error whitespace-pre-wrap"
      >
        {error}
      </pre>
    );
  }

  if (content === null) {
    return (
      <span
        data-testid="arsenal-content-loading"
        className="font-mono text-xs text-on-surface-variant"
      >
        LOADING…
      </span>
    );
  }

  return (
    <pre
      data-testid="arsenal-content-preview"
      className="font-mono text-sm text-on-surface whitespace-pre-wrap break-all max-h-[60vh] overflow-auto"
    >
      {content}
    </pre>
  );
}
