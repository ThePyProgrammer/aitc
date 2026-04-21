import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ToolPreview } from '../ToolPreview';
import { resolveRenderer } from '../ToolPreview/registry';
import { EditPreview } from '../ToolPreview/EditPreview';
import { WritePreview } from '../ToolPreview/WritePreview';
import { BashPreview } from '../ToolPreview/BashPreview';
import { NotebookPreview } from '../ToolPreview/NotebookPreview';
import { ProtectedPathPreview } from '../ToolPreview/ProtectedPathPreview';
import { UnknownToolPreview } from '../ToolPreview/UnknownToolPreview';

vi.mock('../../../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: () => ({ highlighter: null, isLoading: false }),
  highlightLines: (_h: unknown, code: string) => code.split('\n'),
  detectLanguage: () => 'text',
}));

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, transition: _t, ...rest } = props as Record<string, unknown>;
      return <div {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</div>;
    },
    span: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, transition: _t, ...rest } = props as Record<string, unknown>;
      return <span {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</span>;
    },
  },
}));

describe('ToolPreview registry — Phase 8 Plan 05 real renderers', () => {
  it('resolveRenderer returns EditPreview for Edit', () => {
    expect(resolveRenderer('Edit')).toBe(EditPreview);
  });

  it('resolveRenderer returns EditPreview for MultiEdit', () => {
    expect(resolveRenderer('MultiEdit')).toBe(EditPreview);
  });

  it('resolveRenderer returns WritePreview for Write', () => {
    expect(resolveRenderer('Write')).toBe(WritePreview);
  });

  it('resolveRenderer returns BashPreview for Bash', () => {
    expect(resolveRenderer('Bash')).toBe(BashPreview);
  });

  it('resolveRenderer returns NotebookPreview for NotebookEdit', () => {
    expect(resolveRenderer('NotebookEdit')).toBe(NotebookPreview);
  });

  it.each(['Read', 'LS', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Task'])(
    'resolveRenderer returns ProtectedPathPreview for %s',
    (tool) => {
      expect(resolveRenderer(tool)).toBe(ProtectedPathPreview);
    },
  );

  it('falls back to UnknownToolPreview for mcp__* tools', () => {
    expect(resolveRenderer('mcp__github__create_issue')).toBe(UnknownToolPreview);
  });

  it('falls back to UnknownToolPreview for null tool name', () => {
    expect(resolveRenderer(null)).toBe(UnknownToolPreview);
  });

  it('falls back to UnknownToolPreview for unregistered tools', () => {
    expect(resolveRenderer('NotARealTool')).toBe(UnknownToolPreview);
  });

  it('ToolPreview dispatcher renders EditPreview for Edit', () => {
    const { container } = render(
      <ToolPreview
        requestId={1}
        toolName="Edit"
        toolInputJson={{ old_string: 'a', new_string: 'b' }}
        filePath="/x.ts"
      />,
    );
    expect(container.querySelector('[data-tool-preview="edit"]')).not.toBeNull();
  });

  it('ToolPreview renders UnknownToolPreview for MCP tool', () => {
    const { container } = render(
      <ToolPreview
        requestId={1}
        toolName="mcp__github__create_issue"
        toolInputJson={{ title: 'x' }}
        filePath={null}
      />,
    );
    expect(container.querySelector('[data-tool-preview="unknown"]')).not.toBeNull();
  });
});
