// Phase 9 ARSENAL — Master/Detail layout primitive (Plan 04 Wave 2).
//
// Locks the three-column shell defined in 09-UI-SPEC.md so future views
// (Settings page, MCP inspector) can reuse the same rhythm:
//   rail 220px (surface-container-low) / list flex-1 (surface) / detail 520px (surface-container-low)
// Root fills viewport minus the 56px TopBar. Dividers use surface-tier contrast,
// not borders, per the Command Horizon No-Line Rule.

import type { ReactNode } from 'react';

export const MASTER_DETAIL_RAIL = 220;
export const MASTER_DETAIL_PANEL = 520;

export interface MasterDetailShellProps {
  header?: ReactNode;
  tabs?: ReactNode;
  rail: ReactNode;
  list: ReactNode;
  detail: ReactNode;
}

export function MasterDetailShell({
  header,
  tabs,
  rail,
  list,
  detail,
}: MasterDetailShellProps) {
  return (
    <div
      data-testid="master-detail-root"
      className="h-[calc(100vh-56px)] flex flex-col"
    >
      {header && (
        <div data-testid="header" className="px-6 pt-4 pb-0">
          {header}
        </div>
      )}
      {tabs && (
        <div data-testid="tabs" className="h-11 px-6 flex items-center">
          {tabs}
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        <aside
          data-testid="rail"
          className="w-[220px] shrink-0 bg-surface-container-low overflow-y-auto"
        >
          {rail}
        </aside>
        <section
          data-testid="list"
          className="flex-1 min-w-[420px] bg-surface overflow-hidden flex flex-col"
        >
          {list}
        </section>
        <aside
          data-testid="detail"
          className="w-[480px] 2xl:w-[520px] xl:w-[480px] shrink-0 bg-surface-container-low overflow-y-auto"
        >
          {detail}
        </aside>
      </div>
    </div>
  );
}
