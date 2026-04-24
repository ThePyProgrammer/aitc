import { useEffect } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RadarView } from './views/RadarView';
import { TowerView } from './views/TowerView';
import { ArsenalView } from './views/Arsenal/ArsenalView';
import { CommsView } from './views/CommsView';
import { ConflictsView } from './views/ConflictsView';
import { HistoryView } from './views/HistoryView';
import { PassiveHookConsentDialog } from './views/CommsHub/PassiveHookConsentDialog';
import { mountDeepLink } from './lib/deepLinkNotification';
import { useChatChannel } from './hooks/useChatChannel';
import { useChatStore } from './stores/chatStore';

const router = createMemoryRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <RadarView /> },
      { path: 'radar', element: <RadarView /> },
      { path: 'tower', element: <TowerView /> },
      { path: 'arsenal', element: <ArsenalView /> },
      { path: 'comms', element: <CommsView /> },
      { path: 'conflicts', element: <ConflictsView /> },
      { path: 'history', element: <HistoryView /> },
    ],
  },
]);

function App() {
  // Phase 8 Plan 05: mount the deep-link notification subscriber at app root.
  // Subscribes to approval-request-created / notification-clicked /
  // tray-icon-clicked Tauri events and routes to /comms with the correct
  // pending pretool_use row.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    mountDeepLink()
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* non-Tauri env */
      });
    return () => unlisten?.();
  }, []);

  // Phase 10 Plan 06 (D-24): mount chat subscriptions at the app root so
  // agent-event-appended / agent-turn-complete / etc. fire regardless of
  // whether CommsView is currently mounted. Also fetch the initial channel
  // list so the unread dot / master list is populated before the user
  // navigates to /comms.
  const { subscribe, unsubscribe } = useChatChannel();
  useEffect(() => {
    void subscribe();
    void useChatStore.getState().fetchChannels();
    // unsubscribe is now async (it awaits any in-flight subscribe to
    // avoid leaking listeners under React.StrictMode); fire-and-forget
    // is fine here — the cleanup just needs to enqueue the teardown.
    return () => {
      void unsubscribe();
    };
  }, [subscribe, unsubscribe]);

  return (
    <>
      <PassiveHookConsentDialog />
      <RouterProvider router={router} />
    </>
  );
}
export default App;
