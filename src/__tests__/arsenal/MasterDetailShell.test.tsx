import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  MASTER_DETAIL_PANEL,
  MASTER_DETAIL_RAIL,
  MasterDetailShell,
} from '../../components/layout/MasterDetailShell';

describe('MasterDetailShell', () => {
  it('renders all five slots (header, tabs, rail, list, detail)', () => {
    render(
      <MasterDetailShell
        header={<div data-testid="header-slot">HDR</div>}
        tabs={<div data-testid="tabs-slot">TABS</div>}
        rail={<div data-testid="rail-slot">RAIL</div>}
        list={<div data-testid="list-slot">LIST</div>}
        detail={<div data-testid="detail-slot">DETAIL</div>}
      />,
    );
    expect(screen.getByTestId('header-slot')).toBeInTheDocument();
    expect(screen.getByTestId('tabs-slot')).toBeInTheDocument();
    expect(screen.getByTestId('rail-slot')).toBeInTheDocument();
    expect(screen.getByTestId('list-slot')).toBeInTheDocument();
    expect(screen.getByTestId('detail-slot')).toBeInTheDocument();
  });

  it('rail region has w-[220px] shrink-0 classes', () => {
    render(
      <MasterDetailShell
        rail={<div>r</div>}
        list={<div>l</div>}
        detail={<div>d</div>}
      />,
    );
    const rail = screen.getByTestId('rail');
    expect(rail.className).toMatch(/w-\[220px\]/);
    expect(rail.className).toMatch(/shrink-0/);
  });

  it('detail region has 2xl:w-[520px] xl:w-[480px] shrink-0 classes', () => {
    render(
      <MasterDetailShell
        rail={<div>r</div>}
        list={<div>l</div>}
        detail={<div>d</div>}
      />,
    );
    const detail = screen.getByTestId('detail');
    expect(detail.className).toMatch(/2xl:w-\[520px\]/);
    expect(detail.className).toMatch(/xl:w-\[480px\]/);
    expect(detail.className).toMatch(/shrink-0/);
  });

  it('root container fills parent height and uses flex-col (consumer owns viewport bound)', () => {
    // Changed 2026-04-21: MasterDetailShell no longer hardcodes
    // `h-[calc(100vh-56px)]`. Mounting it inside a view that already
    // provides its own viewport-height container (e.g. CommsView with
    // heading + tab bar) would otherwise overflow. Consumers now supply
    // the height (Arsenal's `<main>`, CommsView's flex-1 body) and MDS
    // fills it via `h-full`.
    render(
      <MasterDetailShell
        rail={<div>r</div>}
        list={<div>l</div>}
        detail={<div>d</div>}
      />,
    );
    const root = screen.getByTestId('master-detail-root');
    expect(root.className).toMatch(/h-full/);
    expect(root.className).toMatch(/flex-col/);
  });

  it('exports MASTER_DETAIL_RAIL=220 and MASTER_DETAIL_PANEL=520 constants', () => {
    expect(MASTER_DETAIL_RAIL).toBe(220);
    expect(MASTER_DETAIL_PANEL).toBe(520);
  });
});
