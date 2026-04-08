import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RadarPulse } from '../components/ui/RadarPulse';

describe('Radar Pulse Animation', () => {
  it('renders central dot element', () => {
    const { container } = render(<RadarPulse />);
    const dot = container.querySelector('[data-testid="pulse-dot"]');
    expect(dot).toBeInTheDocument();
  });

  it('renders at least 2 concentric ping ring elements', () => {
    const { container } = render(<RadarPulse />);
    const rings = container.querySelectorAll('[data-testid="pulse-ring"]');
    expect(rings.length).toBeGreaterThanOrEqual(2);
  });

  it('applies ping-scale animation class to rings', () => {
    const { container } = render(<RadarPulse />);
    const rings = container.querySelectorAll('[data-testid="pulse-ring"]');
    rings.forEach((ring) => {
      const style = ring.getAttribute('style') || ring.className;
      expect(style).toMatch(/ping-scale/);
    });
  });

  it('accepts size prop', () => {
    const { container: smContainer } = render(<RadarPulse size="sm" />);
    const { container: lgContainer } = render(<RadarPulse size="lg" />);
    expect(smContainer.querySelector('[data-testid="pulse-dot"]')).toBeInTheDocument();
    expect(lgContainer.querySelector('[data-testid="pulse-dot"]')).toBeInTheDocument();
  });
});
