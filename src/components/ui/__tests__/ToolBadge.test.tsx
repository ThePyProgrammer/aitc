import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolBadge, toolLabelFor } from '../ToolBadge';

vi.mock('motion/react', () => ({
  motion: {
    span: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, transition: _t, ...rest } = props as Record<string, unknown>;
      return <span {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</span>;
    },
  },
}));

describe('ToolBadge', () => {
  it.each([
    ['Edit', 'EDIT'],
    ['MultiEdit', 'MULTI-EDIT'],
    ['Write', 'WRITE'],
    ['NotebookEdit', 'NOTEBOOK'],
    ['Bash', 'BASH'],
    ['Read', 'READ'],
    ['LS', 'LS'],
    ['Grep', 'GREP'],
    ['Glob', 'GLOB'],
    ['WebFetch', 'WEBFETCH'],
    ['WebSearch', 'WEBSEARCH'],
    ['Task', 'TASK'],
  ])('renders correct label for %s', (tool, label) => {
    const { container } = render(<ToolBadge toolName={tool} />);
    expect(container.textContent).toContain(label);
    expect(container.querySelector(`[data-tool-badge="${tool}"]`)).not.toBeNull();
  });

  it('shows MCP label for mcp__* tools', () => {
    render(<ToolBadge toolName="mcp__github__create_issue" />);
    expect(screen.getByLabelText('mcp__github__create_issue tool')).toBeTruthy();
    expect(document.body.textContent).toContain('MCP');
  });

  it('shows UNKNOWN label for unrecognized tools', () => {
    render(<ToolBadge toolName="NotATool" />);
    expect(document.body.textContent).toContain('UNKNOWN');
  });

  it('renders null when toolName is null', () => {
    const { container } = render(<ToolBadge toolName={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('Bash badge uses tertiary color class', () => {
    const { container } = render(<ToolBadge toolName="Bash" />);
    const badge = container.querySelector('[data-tool-badge="Bash"]');
    expect(badge?.className).toMatch(/text-tertiary/);
  });

  it('Write badge uses primary phosphor color class', () => {
    const { container } = render(<ToolBadge toolName="Write" />);
    const badge = container.querySelector('[data-tool-badge="Write"]');
    expect(badge?.className).toMatch(/text-primary/);
  });

  it('Read badge uses on-surface-variant color class', () => {
    const { container } = render(<ToolBadge toolName="Read" />);
    const badge = container.querySelector('[data-tool-badge="Read"]');
    expect(badge?.className).toMatch(/text-on-surface-variant/);
  });

  it('WebFetch/Task/MCP badges use secondary color class', () => {
    const { container: c1 } = render(<ToolBadge toolName="WebFetch" />);
    expect(c1.querySelector('[data-tool-badge="WebFetch"]')?.className).toMatch(/text-secondary/);
    const { container: c2 } = render(<ToolBadge toolName="mcp__foo__bar" />);
    expect(c2.querySelector('[data-tool-badge="mcp__foo__bar"]')?.className).toMatch(/text-secondary/);
  });
});

describe('toolLabelFor helper', () => {
  it('returns null for null tool', () => {
    expect(toolLabelFor(null)).toBeNull();
  });

  it('returns canonical labels', () => {
    expect(toolLabelFor('Edit')).toBe('EDIT');
    expect(toolLabelFor('MultiEdit')).toBe('MULTI-EDIT');
    expect(toolLabelFor('Bash')).toBe('BASH');
    expect(toolLabelFor('mcp__gh__create')).toBe('MCP');
    expect(toolLabelFor('NotATool')).toBe('UNKNOWN');
  });
});
