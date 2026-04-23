import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentPreview } from '../ToolPreview/AgentPreview';

// Mock MarkdownBody so we don't pull react-markdown / shiki into this test —
// we just need to assert that the brief content reaches the markdown renderer.
vi.mock('../../../components/chat/MarkdownBody', () => ({
  MarkdownBody: ({ content }: { content: string }) => (
    <div data-testid="markdown-body">{content}</div>
  ),
}));

describe('AgentPreview', () => {
  it('renders SHOW_BRIEF toggle with word count when prompt is present', () => {
    render(
      <AgentPreview
        requestId={1}
        toolName="Task"
        toolInputJson={{
          subagent_type: 'Explore',
          description: 'audit',
          prompt: 'one two three four five six',
        }}
        filePath={null}
      />,
    );
    expect(screen.getByText('SHOW_BRIEF')).toBeInTheDocument();
    expect(screen.getByText(/6 words/)).toBeInTheDocument();
    // Brief is collapsed by default.
    expect(screen.queryByTestId('agent-brief-body')).toBeNull();
  });

  it('toggles to HIDE_BRIEF and renders the prompt through MarkdownBody on click', () => {
    render(
      <AgentPreview
        requestId={1}
        toolName="Task"
        toolInputJson={{
          subagent_type: 'Explore',
          description: 'audit',
          prompt: '# Hello\n\n- bullet',
        }}
        filePath={null}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('HIDE_BRIEF')).toBeInTheDocument();
    const body = screen.getByTestId('agent-brief-body');
    expect(body).toBeInTheDocument();
    expect(screen.getByTestId('markdown-body').textContent).toContain('# Hello');
  });

  it('singularizes "1 word"', () => {
    render(
      <AgentPreview
        requestId={1}
        toolName="Task"
        toolInputJson={{ prompt: 'solo' }}
        filePath={null}
      />,
    );
    expect(screen.getByText(/1 word\)/)).toBeInTheDocument();
    expect(screen.queryByText(/1 words/)).toBeNull();
  });

  it('renders NO_BRIEF when prompt is missing', () => {
    render(
      <AgentPreview
        requestId={1}
        toolName="Task"
        toolInputJson={{ subagent_type: 'Explore', description: 'x' }}
        filePath={null}
      />,
    );
    expect(screen.getByText('NO_BRIEF')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders NO_BRIEF when prompt is an empty string', () => {
    render(
      <AgentPreview
        requestId={1}
        toolName="Task"
        toolInputJson={{ prompt: '   ' }}
        filePath={null}
      />,
    );
    expect(screen.getByText('NO_BRIEF')).toBeInTheDocument();
  });
});
