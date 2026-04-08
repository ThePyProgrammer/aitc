import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { useSidebarStore } from '../../stores/sidebarStore';

export function AppShell() {
  const expanded = useSidebarStore((s) => s.expanded);
  return (
    <div className="min-h-screen bg-surface">
      <TopBar />
      <Sidebar />
      <main
        className={`pt-14 transition-[margin-left] duration-200 ease-in-out ${
          expanded ? 'ml-64' : 'ml-20'
        }`}
      >
        <Outlet />
      </main>
    </div>
  );
}
