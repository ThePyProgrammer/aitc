import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkillPreview } from '../ToolPreview/SkillPreview';

describe('SkillPreview', () => {
  it('renders an ARGS row when args is present', () => {
    render(
      <SkillPreview
        requestId={1}
        toolName="Skill"
        toolInputJson={{ skill: 'gsd-ui-review', args: 'Tower, Arsenal' }}
        filePath={null}
      />,
    );
    expect(screen.getByText('ARGS')).toBeInTheDocument();
    expect(screen.getByText('Tower, Arsenal')).toBeInTheDocument();
    // No NO_ARGS fallback when args is present.
    expect(screen.queryByText('NO_ARGS')).toBeNull();
  });

  it('renders NO_ARGS when args is missing', () => {
    render(
      <SkillPreview
        requestId={1}
        toolName="Skill"
        toolInputJson={{ skill: 'gsd-ui-review' }}
        filePath={null}
      />,
    );
    expect(screen.getByText('NO_ARGS')).toBeInTheDocument();
  });

  it('renders NO_ARGS when args is whitespace-only', () => {
    render(
      <SkillPreview
        requestId={1}
        toolName="Skill"
        toolInputJson={{ skill: 'x', args: '   ' }}
        filePath={null}
      />,
    );
    expect(screen.getByText('NO_ARGS')).toBeInTheDocument();
  });

  it('trims surrounding whitespace from args', () => {
    render(
      <SkillPreview
        requestId={1}
        toolName="Skill"
        toolInputJson={{ skill: 'x', args: '  hello  ' }}
        filePath={null}
      />,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
