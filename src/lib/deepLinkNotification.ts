/**
 * Phase 8 Plan 05: deep-link notification + tray-click fallback (D-18).
 *
 * Subscribes to three Tauri events at app mount:
 *  - `approval-request-created` — if user is on /comms view, select the new
 *    pretool_use row (in-view deep-link; no focus-steal since already focused).
 *  - `notification-clicked` — focus window + route to /comms + select the
 *    payload.requestId row.
 *  - `tray-icon-clicked` — focus window + route to /comms + select the
 *    most-recent pending pretool_use row (fallback path when the OS
 *    swallows the toast onClick per RESEARCH §Pitfall 9). Falls through to
 *    most-recent pending write_access if no pretool_use is pending.
 *
 * T-08-11 mitigation: `FOCUS_MIN_INTERVAL_MS = 1000` debounce — a rapid
 * burst of tray-clicks or notification-clicks within 1 second grabs focus
 * at most once, preventing focus-stealing amplification.
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useCommsStore, type ApprovalRequest } from '../stores/commsStore';

export const FOCUS_MIN_INTERVAL_MS = 1000;

let lastFocusAt = 0;

/** Exposed for tests to reset the rate-limit state. */
export function __resetFocusRateLimit() {
  lastFocusAt = 0;
}

/** Dynamically import @tauri-apps/api/window so tests / headless / non-Tauri
 *  environments don't fail module resolution. */
async function tryFocusWindow(): Promise<void> {
  try {
    const mod = await import('@tauri-apps/api/window');
    if (typeof mod.getCurrentWindow === 'function') {
      await mod.getCurrentWindow().setFocus();
    }
  } catch {
    /* not in a Tauri runtime — no-op */
  }
}

async function focusAndRouteComms(): Promise<void> {
  const now = Date.now();
  if (now - lastFocusAt < FOCUS_MIN_INTERVAL_MS) return;
  lastFocusAt = now;

  await tryFocusWindow();

  if (typeof window !== 'undefined' && window.location) {
    const hash = window.location.hash ?? '';
    if (!hash.includes('/comms')) {
      window.location.hash = '#/comms';
    }
  }
}

/** Pick the id of the most-recent pending pretool_use row. Falls back to
 *  most-recent pending write_access row if no pretool_use is pending. */
export function pickMostRecentPendingPretoolId(): number | null {
  const { requests } = useCommsStore.getState();
  const pending = requests
    .filter((r) => r.status === 'pending')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const firstPretool = pending.find((r) => r.requestType === 'pretool_use');
  if (firstPretool) return firstPretool.id;
  return pending[0]?.id ?? null;
}

/** Mount the deep-link subscribers. Returns a combined unlisten fn. */
export async function mountDeepLink(): Promise<UnlistenFn> {
  const unlisteners: UnlistenFn[] = [];

  try {
    const unPending = await listen<ApprovalRequest>('approval-request-created', (ev) => {
      if (ev.payload.requestType !== 'pretool_use') return;
      if (
        typeof window !== 'undefined' &&
        window.location?.hash?.includes('/comms')
      ) {
        useCommsStore.getState().selectRequest(ev.payload.id);
      }
    });
    unlisteners.push(unPending);
  } catch {
    /* non-Tauri env */
  }

  try {
    const unTray = await listen('tray-icon-clicked', async () => {
      await focusAndRouteComms();
      const id = pickMostRecentPendingPretoolId();
      if (id !== null) useCommsStore.getState().selectRequest(id);
    });
    unlisteners.push(unTray);
  } catch {
    /* non-Tauri env */
  }

  try {
    const unNotif = await listen<{ requestId: number }>(
      'notification-clicked',
      async (ev) => {
        await focusAndRouteComms();
        if (ev.payload?.requestId) {
          useCommsStore.getState().selectRequest(ev.payload.requestId);
        }
      },
    );
    unlisteners.push(unNotif);
  } catch {
    /* non-Tauri env */
  }

  return () => {
    for (const un of unlisteners) {
      try {
        un();
      } catch {
        /* ignore */
      }
    }
  };
}
