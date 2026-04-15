import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ToolPreview } from '../ToolPreview';
import { resolveRenderer } from '../ToolPreview/registry';
import { UnknownToolPreview } from '../ToolPreview/UnknownToolPreview';

describe('ToolPreview registry', () => {
  it('returns a registered stub for known tools', () => {
    const E = resolveRenderer('Edit');
    expect((E as unknown as { displayName?: string }).displayName).toBe('EditPreviewStub');
  });

  it('falls back to UnknownToolPreview for mcp__* tools', () => {
    expect(resolveRenderer('mcp__github__create_issue')).toBe(UnknownToolPreview);
  });

  it('falls back to UnknownToolPreview for null tool name', () => {
    expect(resolveRenderer(null)).toBe(UnknownToolPreview);
  });

  it('falls back to UnknownToolPreview for unregistered tools', () => {
    expect(resolveRenderer('NotARealTool')).toBe(UnknownToolPreview);
  });

  it('renders UnknownToolPreview for MCP tool', () => {
    const { container } = render(
      <ToolPreview
        requestId={1}
        toolName="mcp__github__create_issue"
        toolInputJson={{ title: 'x' }}
        filePath={null}
      />
    );
    expect(container.querySelector('[data-tool-preview="unknown"]')).not.toBeNull();
  });
});
