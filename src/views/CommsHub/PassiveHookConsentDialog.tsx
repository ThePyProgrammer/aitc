/**
 * Phase 8 Plan 05: PassiveHookConsentDialog — modal shown when the backend
 * detects a Claude Code process running in a repo that doesn't yet have the
 * AITC PreToolUse hook installed (D-04/D-05). Emits via Tauri event
 * `passive-claude-detected`; accept/decline calls backend commands
 * `accept_passive_hook_consent` / `decline_passive_hook_consent`.
 *
 * Queues multiple events: if three fire back-to-back, they surface
 * one-at-a-time so the user can make an explicit decision per cwd.
 * T-08-UX: no auto-accept — each modal is an explicit user action.
 *
 * Uses createPortal to render at document.body — escapes any parent
 * transform/contain that would break fixed positioning.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface PassiveClaudeDetectedPayload {
  cwd: string;
  pid: number;
  agentId: string;
}

export function PassiveHookConsentDialog() {
  const [queue, setQueue] = useState<PassiveClaudeDetectedPayload[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<PassiveClaudeDetectedPayload>('passive-claude-detected', (ev) => {
      if (cancelled) return;
      setQueue((q) => [...q, ev.payload]);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        /* headless / test env — ignore */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (queue.length === 0) return null;
  const current = queue[0];

  const dismiss = () => setQueue((q) => q.slice(1));

  const accept = async () => {
    setBusy(true);
    try {
      await invoke('accept_passive_hook_consent', { repoCwd: current.cwd });
    } catch {
      /* swallow — backend logs; user can retry on next detect */
    } finally {
      setBusy(false);
      dismiss();
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await invoke('decline_passive_hook_consent', { repoCwd: current.cwd });
    } catch {
      /* swallow */
    } finally {
      setBusy(false);
      dismiss();
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="passive-consent-title"
      data-passive-consent-dialog
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '28rem',
          padding: '1.5rem',
          backgroundColor: 'var(--color-surface-container)',
          border: '1px solid var(--color-outline-variant)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        }}
      >
        <h2
          id="passive-consent-title"
          className="font-headline text-sm font-bold uppercase tracking-widest mb-4"
        >
          INSTALL AITC HOOK
        </h2>
        <p className="font-body text-sm mb-2">
          A Claude Code agent ({current.agentId}) is running in:
        </p>
        <p className="font-mono text-xs mb-4 break-all">{current.cwd}</p>
        <p className="font-body text-sm mb-6 text-on-surface-variant">
          Install the AITC PreToolUse hook in this repo&apos;s{' '}
          <code className="text-primary">.claude/settings.local.json</code> so AITC can gate tool
          calls from this agent? The change applies to future sessions; the currently-running agent
          is unaffected.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={decline}
            className="px-4 py-2 bg-surface-container-high font-headline text-[10px] font-bold uppercase tracking-widest disabled:opacity-50 hover:bg-surface-container-highest transition-colors"
          >
            DECLINE
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={accept}
            className="px-4 py-2 bg-primary text-on-primary font-headline text-[10px] font-bold uppercase tracking-widest disabled:opacity-50 hover:bg-primary-dim transition-colors"
          >
            ACCEPT
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
