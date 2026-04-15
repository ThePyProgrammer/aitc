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

  return (
    <>
      <PassiveHookConsentDialog />
      <RouterProvider router={router} />
    </>
  );
}
export default App;
