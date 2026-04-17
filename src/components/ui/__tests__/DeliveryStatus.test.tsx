import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeliveryStatus } from '../DeliveryStatus';

describe('DeliveryStatus', () => {
  it('renders DELIVERED label', () => {
    render(<DeliveryStatus status="delivered" />);
    expect(screen.getByText('DELIVERED')).toBeInTheDocument();
  });

  it('renders QUEUED label', () => {
    render(<DeliveryStatus status="queued" />);
    expect(screen.getByText('QUEUED')).toBeInTheDocument();
  });

  it('renders CONSUMED label (Phase 10 D-10)', () => {
    const { container } = render(<DeliveryStatus status="consumed" />);
    expect(screen.getByText('CONSUMED')).toBeInTheDocument();
    // CheckCheck renders as an <svg> with lucide-check-check class
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class') ?? '').toContain('check-check');
  });

  it('renders UNSUPPORTED label', () => {
    render(<DeliveryStatus status="unsupported" />);
    expect(screen.getByText('UNSUPPORTED')).toBeInTheDocument();
  });
});
