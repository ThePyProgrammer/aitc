import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  MasterDetailShell,
  MASTER_DETAIL_RAIL,
  MASTER_DETAIL_PANEL,
} from '../MasterDetailShell';

describe('MasterDetailShell', () => {
  it('renders with Phase 9 defaults (220px rail, 520px detail)', () => {
    render(
      <MasterDetailShell
        rail={<div>rail-content</div>}
        list={<div>list-content</div>}
        detail={<div>detail-content</div>}
      />,
    );
    const rail = screen.getByTestId('rail');
    expect(rail.style.width).toBe(`${MASTER_DETAIL_RAIL}px`);
    const detail = screen.getByTestId('detail');
    expect(detail.style.width).toBe(`${MASTER_DETAIL_PANEL}px`);
    expect(screen.getByText('rail-content')).toBeInTheDocument();
    expect(screen.getByText('list-content')).toBeInTheDocument();
    expect(screen.getByText('detail-content')).toBeInTheDocument();
  });

  it('accepts railWidth override (Phase 10 CHAT tab uses 280px)', () => {
    render(
      <MasterDetailShell
        rail={<div />}
        list={<div />}
        detail={<div />}
        railWidth={280}
      />,
    );
    const rail = screen.getByTestId('rail');
    expect(rail.style.width).toBe('280px');
  });

  it("omits detail aside when detailWidth='flex' (CHAT tab transcript)", () => {
    render(
      <MasterDetailShell
        rail={<div />}
        list={<div>chat-transcript</div>}
        detail={<div>should-not-render</div>}
        detailWidth="flex"
      />,
    );
    expect(screen.queryByTestId('detail')).not.toBeInTheDocument();
    expect(screen.queryByText('should-not-render')).not.toBeInTheDocument();
    expect(screen.getByText('chat-transcript')).toBeInTheDocument();
  });

  it('renders header and tabs when provided', () => {
    render(
      <MasterDetailShell
        header={<h1>HEADER</h1>}
        tabs={<nav>TABS</nav>}
        rail={<div />}
        list={<div />}
        detail={<div />}
      />,
    );
    expect(screen.getByText('HEADER')).toBeInTheDocument();
    expect(screen.getByText('TABS')).toBeInTheDocument();
  });
});
