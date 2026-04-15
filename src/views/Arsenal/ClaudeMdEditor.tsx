// Phase 9 ARSENAL — ClaudeMdEditor (Plan 05 Wave 3, centerpiece).
//
// Textarea-based inline editor for `<cwd>/CLAUDE.md` and
// `<cwd>/.claude/CLAUDE.md` (D-13). Implements:
//   - Save via writeClaudeMd with 10s UndoToast (D-14).
//   - Undo via writeClaudeMd({ content: savedSnapshot }) + RESTORED toast
//     (BLOCKER 5 REVISION).
//   - Discard with two-click confirmation (09-UI-SPEC §Destructive actions).
//   - ExternalChangeBanner when the watcher reports Changed while buffer is
//     dirty (D-15); silent reload when clean.
//   - Read-only banner for `~/.claude/CLAUDE.md` (backend returns editable:false).
//   - SAVE_FAILED toast with Rust error string, 8s auto-dismiss
//     (BLOCKER 5 REVISION).
//   - Keyboard: Ctrl/Cmd+S save, Esc with dirty → Discard, Esc on clean → blur.
//
// BLOCKER 3 REVISION: `cwd: string | null` is threaded end-to-end from
// ArsenalView → DetailPanel → ClaudeMdEditor and forwarded verbatim to the
// readClaudeMd / writeClaudeMd invoke calls.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Lock } from 'lucide-react';
import type { ReadClaudeMdResult } from '../../bindings';
import { useClaudeResourcesStore } from '../../stores/claudeResourcesStore';
import { Button } from '../../components/ui/Button';
import { UndoToast } from '../../components/ui/UndoToast';
import { ExternalChangeBanner } from '../../components/ui/ExternalChangeBanner';

export interface ClaudeMdEditorProps {
  path: string;
  cwd: string | null;
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? p : p.slice(idx + 1);
}

/** Small ghost toast primitive for SAVE_FAILED / RESTORED messages
 * (BLOCKER 5 REVISION). Reuses UndoToast surface styling without the
 * countdown ring. */
function SimpleToast({
  title,
  body,
  variant,
  onDismiss,
  autoDismissMs,
}: {
  title: string;
  body?: string;
  variant: 'primary' | 'error';
  onDismiss: () => void;
  autoDismissMs: number;
}) {
  useEffect(() => {
    const id = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(id);
  }, [onDismiss, autoDismissMs]);
  const stripe =
    variant === 'error' ? 'border-error' : 'border-primary';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col gap-1 bg-surface-container-high border-l-2 ${stripe} px-4 py-3`}
    >
      <span className="font-headline text-[11px] font-bold tracking-widest uppercase text-on-surface">
        {title}
      </span>
      {body && (
        <span className="font-mono text-[10px] text-on-surface-variant break-all">
          {body}
        </span>
      )}
    </div>
  );
}

export function ClaudeMdEditor({ path, cwd }: ClaudeMdEditorProps) {
  const filename = useMemo(() => basename(path), [path]);

  const [loading, setLoading] = useState(true);
  const [editable, setEditable] = useState(true);
  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');

  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [discardPending, setDiscardPending] = useState(false);
  const discardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read initial content + editability.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<ReadClaudeMdResult>('readClaudeMd', { path, cwd })
      .then((r) => {
        if (cancelled) return;
        setContent(r.content);
        setInitialContent(r.content);
        setEditable(r.editable);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setSaveError(String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, cwd]);

  const dirty = content !== initialContent;

  // D-15: subscribe to store's externalEdits[path]. When the value flips to
  // a newer timestamp while clean, silently reload; if dirty, the banner is
  // surfaced to the user.
  const externalMtime = useClaudeResourcesStore(
    (s) => s.externalEdits[path] ?? null,
  );
  const lastSeenExternalRef = useRef<number | null>(null);

  useEffect(() => {
    if (externalMtime === null) return;
    if (lastSeenExternalRef.current === externalMtime) return;
    lastSeenExternalRef.current = externalMtime;
    if (!dirty) {
      // Silent reload.
      invoke<ReadClaudeMdResult>('readClaudeMd', { path, cwd })
        .then((r) => {
          setContent(r.content);
          setInitialContent(r.content);
        })
        .catch(() => {
          /* swallow — the banner path handles user-facing errors */
        });
    }
    // If dirty, the banner renders based on (dirty && externalMtime !== null).
  }, [externalMtime, dirty, path, cwd]);

  const handleSave = useCallback(async () => {
    if (!editable || !dirty) return;
    const snapshot = initialContent;
    try {
      await invoke('writeClaudeMd', { path, content, cwd });
      setInitialContent(content);
      setSavedSnapshot(snapshot);
      setSavedAt(Date.now());
      setSaveError(null);
    } catch (err) {
      setSaveError(String(err));
    }
  }, [editable, dirty, initialContent, content, path, cwd]);

  const handleUndo = useCallback(async () => {
    if (savedSnapshot === null) return;
    try {
      await invoke('writeClaudeMd', {
        path,
        content: savedSnapshot,
        cwd,
      });
      setContent(savedSnapshot);
      setInitialContent(savedSnapshot);
      setSavedAt(null);
      setRestoredAt(Date.now());
      setSavedSnapshot(null);
    } catch (err) {
      setSaveError(String(err));
    }
  }, [savedSnapshot, path, cwd]);

  const handleDiscard = useCallback(() => {
    if (!dirty) return;
    if (discardPending) {
      setContent(initialContent);
      setDiscardPending(false);
      if (discardTimeoutRef.current) clearTimeout(discardTimeoutRef.current);
      return;
    }
    setDiscardPending(true);
    if (discardTimeoutRef.current) clearTimeout(discardTimeoutRef.current);
    discardTimeoutRef.current = setTimeout(() => {
      setDiscardPending(false);
    }, 3000);
  }, [dirty, discardPending, initialContent]);

  useEffect(
    () => () => {
      if (discardTimeoutRef.current) clearTimeout(discardTimeoutRef.current);
    },
    [],
  );

  const handleReload = useCallback(() => {
    invoke<ReadClaudeMdResult>('readClaudeMd', { path, cwd })
      .then((r) => {
        setContent(r.content);
        setInitialContent(r.content);
        lastSeenExternalRef.current = externalMtime;
      })
      .catch((err) => setSaveError(String(err)));
  }, [path, cwd, externalMtime]);

  const handleKeepMine = useCallback(() => {
    // Acknowledge the external change: stop showing the banner by marking
    // the mtime as seen. User's next Save will overwrite.
    lastSeenExternalRef.current = externalMtime;
  }, [externalMtime]);

  const handleViewDiff = useCallback(() => {
    // Diff viewer is a future refinement — for now, no-op (banner persists).
  }, []);

  // Keyboard: Ctrl/Cmd+S saves; Esc with dirty → Discard; Esc clean → blur.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleEditorKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isSave =
        (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S');
      if (isSave) {
        e.preventDefault();
        void handleSave();
        return;
      }
      if (e.key === 'Escape') {
        if (dirty) {
          e.preventDefault();
          handleDiscard();
        } else {
          textareaRef.current?.blur();
        }
      }
    },
    [handleSave, handleDiscard, dirty],
  );

  if (loading) {
    return (
      <div className="font-mono text-xs text-on-surface-variant">LOADING…</div>
    );
  }

  if (!editable) {
    return (
      <div className="flex flex-col gap-4">
        <div
          role="alert"
          data-testid="arsenal-readonly-banner"
          className="flex items-center gap-3 bg-surface-container-high px-4 py-3"
        >
          <Lock
            size={16}
            strokeWidth={1.5}
            className="text-on-surface-variant shrink-0"
            aria-hidden="true"
          />
          <span className="font-mono text-xs text-on-surface-variant">
            READ-ONLY — ~/.claude/CLAUDE.md editing is disabled this phase.
          </span>
        </div>
        <pre className="font-mono text-sm text-on-surface whitespace-pre-wrap break-all max-h-[60vh] overflow-auto">
          {content}
        </pre>
      </div>
    );
  }

  const showExternalBanner = dirty && externalMtime !== null;

  return (
    <div className="flex flex-col gap-4">
      {showExternalBanner && (
        <ExternalChangeBanner
          hasUnsavedEdits={dirty}
          onReload={handleReload}
          onKeepMine={handleKeepMine}
          onViewDiff={handleViewDiff}
        />
      )}
      <span className="font-headline text-[10px] tracking-widest uppercase text-on-surface-variant">
        EDIT
      </span>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleEditorKeyDown}
        aria-label={`Edit ${filename}`}
        data-testid="arsenal-editor-textarea"
        className="bg-surface w-full h-[60vh] font-mono text-sm text-on-surface p-4 focus:outline focus:outline-primary"
      />
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!dirty}
          tooltip={dirty ? undefined : 'No changes to save'}
          onClick={() => void handleSave()}
          data-testid="arsenal-save-button"
        >
          SAVE
        </Button>
        <Button
          variant="ghost"
          disabled={!dirty && !discardPending}
          className={dirty || discardPending ? 'text-error' : ''}
          onClick={handleDiscard}
          data-testid="arsenal-discard-button"
        >
          {discardPending ? 'CONFIRM DISCARD' : 'DISCARD'}
        </Button>
      </div>
      {savedAt !== null && savedSnapshot !== null && (
        <UndoToast
          filename={filename}
          onUndo={() => void handleUndo()}
          onDismiss={() => setSavedAt(null)}
        />
      )}
      {saveError !== null && (
        <SimpleToast
          title={`SAVE_FAILED — ${filename}`}
          body={saveError}
          variant="error"
          autoDismissMs={8000}
          onDismiss={() => setSaveError(null)}
        />
      )}
      {restoredAt !== null && (
        <SimpleToast
          title={`RESTORED — ${filename}`}
          variant="primary"
          autoDismissMs={3000}
          onDismiss={() => setRestoredAt(null)}
        />
      )}
    </div>
  );
}
