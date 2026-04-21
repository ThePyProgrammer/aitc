// Phase 9 ARSENAL — Master/Detail layout primitive (Plan 04 Wave 2).
// Phase 10 Plan 01 — added optional railWidth + detailWidth props without
// breaking Phase 9 consumers. `detailWidth: 'flex'` hides the fixed detail
// aside so the CHAT tab's transcript (a list, not a rail+detail) can flex.
//
// Locks the three-column shell defined in 09-UI-SPEC.md so future views
// (Settings page, MCP inspector, CHAT tab) can reuse the same rhythm:
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
  detail?: ReactNode;
  /** Phase 10 Plan 01 — override the 220px rail (CHAT tab uses 280px). */
  railWidth?: number;
  /** Phase 10 Plan 01 — override the 520px detail pane, or 'flex' to omit it. */
  detailWidth?: number | 'flex';
}

export function MasterDetailShell({
  header,
  tabs,
  rail,
  list,
  detail,
  railWidth = MASTER_DETAIL_RAIL,
  detailWidth = MASTER_DETAIL_PANEL,
}: MasterDetailShellProps) {
  const showDetail = detail !== undefined && detailWidth !== 'flex';

  return (
    <div
      data-testid="master-detail-root"
      className="h-full flex flex-col"
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
          style={{ width: `${railWidth}px` }}
          className="shrink-0 bg-surface-container-low overflow-y-auto"
        >
          {rail}
        </aside>
        <section
          data-testid="list"
          className="flex-1 min-w-[420px] bg-surface overflow-hidden flex flex-col"
        >
          {list}
        </section>
        {showDetail && (
          <aside
            data-testid="detail"
            style={{ width: `${detailWidth}px` }}
            className="shrink-0 bg-surface-container-low overflow-y-auto"
          >
            {detail}
          </aside>
        )}
      </div>
    </div>
  );
}
