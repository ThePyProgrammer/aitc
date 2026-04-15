import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RadarView } from './views/RadarView';
import { TowerView } from './views/TowerView';
import { ArsenalView } from './views/Arsenal/ArsenalView';
import { CommsView } from './views/CommsView';
import { ConflictsView } from './views/ConflictsView';
import { HistoryView } from './views/HistoryView';

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
  return <RouterProvider router={router} />;
}
export default App;
