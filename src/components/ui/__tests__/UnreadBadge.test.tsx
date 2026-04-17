import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnreadBadge } from '../UnreadBadge';

describe('UnreadBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<UnreadBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a numeric label for counts 1-99', () => {
    render(<UnreadBadge count={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it("renders '99+' for counts above 99", () => {
    render(<UnreadBadge count={150} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });
});
