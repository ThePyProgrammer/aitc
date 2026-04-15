import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScopeChip } from '../../components/ui/ScopeChip';

describe('ScopeChip', () => {
  it('renders GLOBAL label with text-tertiary for global scope', () => {
    render(<ScopeChip scope="global" />);
    const el = screen.getByText('GLOBAL');
    expect(el.className).toMatch(/text-tertiary/);
  });

  it('renders PROJECT label with text-primary for project scope', () => {
    render(<ScopeChip scope="project" />);
    const el = screen.getByText('PROJECT');
    expect(el.className).toMatch(/text-primary/);
  });

  it('has UI-SPEC typography classes (font-headline, 11px, bold, tracking-widest, uppercase, bg-surface-container-high)', () => {
    render(<ScopeChip scope="project" />);
    const el = screen.getByText('PROJECT');
    expect(el.className).toMatch(/font-headline/);
    expect(el.className).toMatch(/text-\[11px\]/);
    expect(el.className).toMatch(/font-bold/);
    expect(el.className).toMatch(/tracking-widest/);
    expect(el.className).toMatch(/uppercase/);
    expect(el.className).toMatch(/bg-surface-container-high/);
  });
});
