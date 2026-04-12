import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { CommandPalette } from '../ui/CommandPalette';
import { useSidebarStore } from '../../stores/sidebarStore';
import { RepoSessionProvider } from '../../providers/RepoSessionProvider';

export function AppShell() {
  const expanded = useSidebarStore((s) => s.expanded);
  return (
    <RepoSessionProvider>
      <div className="min-h-screen bg-surface">
        <TopBar />
        <Sidebar />
        <CommandPalette />
        <main
          className={`pt-14 transition-[margin-left] duration-200 ease-in-out ${
            expanded ? 'ml-64' : 'ml-20'
          }`}
        >
          <Outlet />
        </main>
      </div>
    </RepoSessionProvider>
  );
}
