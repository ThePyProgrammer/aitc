import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RadarView } from './views/RadarView';
import { TowerView } from './views/TowerView';
import { CommsView } from './views/CommsView';
import { ConflictsView } from './views/ConflictsView';

const router = createMemoryRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <RadarView /> },
      { path: 'radar', element: <RadarView /> },
      { path: 'tower', element: <TowerView /> },
      { path: 'comms', element: <CommsView /> },
      { path: 'conflicts', element: <ConflictsView /> },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}
export default App;
