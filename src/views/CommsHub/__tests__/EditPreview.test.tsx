import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EditPreview } from '../ToolPreview/EditPreview';

describe('EditPreview — Phase 8 Plan 05', () => {
  it('Edit with {old_string, new_string} renders InlineDiff via data-tool-preview="edit"', () => {
    const { container } = render(
      <EditPreview
        requestId={1}
        toolName="Edit"
        toolInputJson={{ old_string: 'const x = 1;', new_string: 'const x = 2;' }}
        filePath="/src/x.ts"
      />,
    );
    expect(container.querySelector('[data-tool-preview="edit"]')).not.toBeNull();
    // InlineDiff renders removed lines as <span> (textContent), added lines
    // as <input type=text defaultValue=...> (value, not textContent).
    expect(container.textContent).toContain('const x = 1;');
    const inputs = container.querySelectorAll('input[type="text"]');
    const inputValues = Array.from(inputs).map((el) => (el as HTMLInputElement).defaultValue);
    expect(inputValues).toContain('const x = 2;');
  });

  it('MultiEdit renders HUNK 01/02 and HUNK 02/02 labels for 2 edits', () => {
    const { container } = render(
      <EditPreview
        requestId={1}
        toolName="MultiEdit"
        toolInputJson={{
          file_path: '/src/x.ts',
          edits: [
            { old_string: 'a', new_string: 'b' },
            { old_string: 'c', new_string: 'd' },
          ],
        }}
        filePath="/src/x.ts"
      />,
    );
    expect(container.querySelector('[data-tool-preview="multi-edit"]')).not.toBeNull();
    expect(container.textContent).toContain('HUNK 01 / 02');
    expect(container.textContent).toContain('HUNK 02 / 02');
  });

  it('missing tool_input produces PREIMAGE_LOAD_FAILED error card', () => {
    const { container } = render(
      <EditPreview requestId={1} toolName="Edit" toolInputJson={null} filePath="/src/x.ts" />,
    );
    expect(container.textContent).toContain('PREIMAGE_LOAD_FAILED');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('malformed JSON-string tool_input produces PREIMAGE_LOAD_FAILED', () => {
    const { container } = render(
      <EditPreview
        requestId={1}
        toolName="Edit"
        toolInputJson={'{ not valid json'}
        filePath="/src/x.ts"
      />,
    );
    expect(container.textContent).toContain('PREIMAGE_LOAD_FAILED');
  });

  it('MultiEdit with empty edits array still renders wrapper (no hunks)', () => {
    const { container } = render(
      <EditPreview
        requestId={1}
        toolName="MultiEdit"
        toolInputJson={{ edits: [] }}
        filePath="/src/x.ts"
      />,
    );
    expect(container.querySelector('[data-tool-preview="multi-edit"]')).not.toBeNull();
    expect(container.textContent).not.toContain('HUNK');
  });
});
