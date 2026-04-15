import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { BashPreview } from '../ToolPreview/BashPreview';

vi.mock('../../../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: () => ({ highlighter: null, isLoading: false }),
  highlightLines: (_h: unknown, code: string) => code.split('\n'),
  detectLanguage: () => 'text',
}));

describe('BashPreview — Phase 8 Plan 05', () => {
  it('renders DESCRIPTION section when description present', () => {
    const { container } = render(
      <BashPreview
        requestId={1}
        toolName="Bash"
        toolInputJson={{ command: 'ls', description: 'List files' }}
        filePath={null}
      />,
    );
    expect(container.querySelector('[data-bash-section="description"]')).not.toBeNull();
    expect(container.textContent).toContain('DESCRIPTION');
    expect(container.textContent).toContain('List files');
  });

  it('OMITS DESCRIPTION section when description absent', () => {
    const { container } = render(
      <BashPreview
        requestId={1}
        toolName="Bash"
        toolInputJson={{ command: 'ls' }}
        filePath={null}
      />,
    );
    expect(container.querySelector('[data-bash-section="description"]')).toBeNull();
  });

  it('renders COMMAND section always', () => {
    const { container } = render(
      <BashPreview
        requestId={1}
        toolName="Bash"
        toolInputJson={{ command: 'npm test' }}
        filePath={null}
      />,
    );
    expect(container.querySelector('[data-bash-section="command"]')).not.toBeNull();
    expect(container.textContent).toContain('npm test');
  });

  it('renders METADATA with CWD + TIMEOUT when both present', () => {
    const { container } = render(
      <BashPreview
        requestId={1}
        toolName="Bash"
        toolInputJson={{ command: 'x', cwd: '/repo', timeout: 120000 }}
        filePath={null}
      />,
    );
    expect(container.querySelector('[data-bash-section="metadata"]')).not.toBeNull();
    expect(container.textContent).toContain('CWD');
    expect(container.textContent).toContain('/repo');
    expect(container.textContent).toContain('TIMEOUT');
    expect(container.textContent).toContain('120000ms');
  });

  it('OMITS METADATA section when neither cwd nor timeout present', () => {
    const { container } = render(
      <BashPreview
        requestId={1}
        toolName="Bash"
        toolInputJson={{ command: 'x' }}
        filePath={null}
      />,
    );
    expect(container.querySelector('[data-bash-section="metadata"]')).toBeNull();
  });

  it('shows SHOW_ALL toggle when command exceeds 40 lines', () => {
    const longCmd = Array.from({ length: 50 }, (_v, i) => `echo line ${i}`).join('\n');
    const { container } = render(
      <BashPreview
        requestId={1}
        toolName="Bash"
        toolInputJson={{ command: longCmd }}
        filePath={null}
      />,
    );
    expect(container.textContent).toContain('SHOW_ALL');
  });

  it('does NOT show SHOW_ALL toggle when command is short', () => {
    const { container } = render(
      <BashPreview
        requestId={1}
        toolName="Bash"
        toolInputJson={{ command: 'ls' }}
        filePath={null}
      />,
    );
    expect(container.textContent).not.toContain('SHOW_ALL');
  });

  it('parses tool_input that arrives as a JSON string', () => {
    const { container } = render(
      <BashPreview
        requestId={1}
        toolName="Bash"
        toolInputJson={'{"command": "git status", "cwd": "/repo"}'}
        filePath={null}
      />,
    );
    expect(container.textContent).toContain('git status');
    expect(container.textContent).toContain('/repo');
  });
});
