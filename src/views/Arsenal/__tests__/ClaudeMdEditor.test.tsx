// Phase 9 ARSENAL — ClaudeMdEditor tests (Plan 05 Wave 3, Task 2).
//
// Covers D-12 / D-14 / D-15 behaviors, the BLOCKER 3 cwd prop threading, and
// the BLOCKER 5 SAVE_FAILED + RESTORED toast flow. Uses the same invoke mock
// seam as useClaudeResourcesChannel.test.ts.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => {
  const invoke = vi.fn();
  class FakeChannel {}
  return { invoke, Channel: FakeChannel, __invokeMock: invoke };
});

import * as tauriCore from '@tauri-apps/api/core';
import { ClaudeMdEditor } from '../ClaudeMdEditor';
import { useClaudeResourcesStore } from '../../../stores/claudeResourcesStore';
import { ContentPreview } from '../ContentPreview';

const invokeMock = (tauriCore as unknown as { __invokeMock: ReturnType<typeof vi.fn> })
  .__invokeMock;

beforeEach(() => {
  invokeMock.mockReset();
  useClaudeResourcesStore.setState({
    resourcesById: {},
    loaded: false,
    droppedBatches: 0,
    externalEdits: {},
  });
});

const EDITABLE_PATH = '/repo/CLAUDE.md';
const GLOBAL_PATH = '/home/u/.claude/CLAUDE.md';

function setReadWrite(initial = 'hello') {
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'readClaudeMd') {
      return { content: initial, editable: true, path: EDITABLE_PATH };
    }
    if (cmd === 'writeClaudeMd') {
      return null;
    }
    throw new Error(`unexpected invoke ${cmd}`);
  });
}

describe('ClaudeMdEditor — load + save + undo', () => {
  it('load_populates_textarea', async () => {
    setReadWrite('initial body');
    render(<ClaudeMdEditor path={EDITABLE_PATH} cwd={'/repo'} />);
    const ta = (await screen.findByTestId(
      'arsenal-editor-textarea',
    )) as HTMLTextAreaElement;
    expect(ta.value).toBe('initial body');
    expect(invokeMock).toHaveBeenCalledWith('readClaudeMd', {
      path: EDITABLE_PATH,
      cwd: '/repo',
    });
  });

  it('edit_then_save_calls_writeClaudeMd_with_content_and_cwd', async () => {
    setReadWrite('aa');
    render(<ClaudeMdEditor path={EDITABLE_PATH} cwd={'/repo'} />);
    const ta = (await screen.findByTestId(
      'arsenal-editor-textarea',
    )) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'aa-modified' } });
    fireEvent.click(screen.getByTestId('arsenal-save-button'));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('writeClaudeMd', {
        path: EDITABLE_PATH,
        content: 'aa-modified',
        cwd: '/repo',
      }),
    );
  });

  it('save_shows_undo_toast_with_filename', async () => {
    setReadWrite('x');
    render(<ClaudeMdEditor path={EDITABLE_PATH} cwd={null} />);
    const ta = (await screen.findByTestId(
      'arsenal-editor-textarea',
    )) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'xy' } });
    fireEvent.click(screen.getByTestId('arsenal-save-button'));
    await screen.findByText(/SAVED — CLAUDE.md/);
  });

  it('undo_click_calls_writeClaudeMd_with_snapshot_and_renders_restored_toast', async () => {
    setReadWrite('orig');
    render(<ClaudeMdEditor path={EDITABLE_PATH} cwd={'/repo'} />);
    const ta = (await screen.findByTestId(
      'arsenal-editor-textarea',
    )) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'modified' } });
    fireEvent.click(screen.getByTestId('arsenal-save-button'));
    await screen.findByText(/SAVED — CLAUDE.md/);

    fireEvent.click(screen.getByRole('button', { name: /Undo save/ }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('writeClaudeMd', {
        path: EDITABLE_PATH,
        content: 'orig',
        cwd: '/repo',
      }),
    );
    await screen.findByText(/RESTORED — CLAUDE.md/);
  });

  it('discard_requires_two_clicks_when_dirty', async () => {
    setReadWrite('a');
    render(<ClaudeMdEditor path={EDITABLE_PATH} cwd={null} />);
    const ta = (await screen.findByTestId(
      'arsenal-editor-textarea',
    )) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'b' } });

    const discard = screen.getByTestId('arsenal-discard-button');
    // First click — label flips to CONFIRM DISCARD, buffer unchanged.
    fireEvent.click(discard);
    expect(discard.textContent).toBe('CONFIRM DISCARD');
    expect(ta.value).toBe('b');
    // Second click — buffer reverts to initial.
    fireEvent.click(discard);
    expect(ta.value).toBe('a');
  });
});

describe('ClaudeMdEditor — external change + read-only', () => {
  it('external_edit_banner_shows_when_dirty_and_externalEdits_stamps_path', async () => {
    setReadWrite('aa');
    render(<ClaudeMdEditor path={EDITABLE_PATH} cwd={null} />);
    const ta = (await screen.findByTestId(
      'arsenal-editor-textarea',
    )) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'dirty' } });

    act(() => {
      useClaudeResourcesStore.setState((s) => ({
        externalEdits: { ...s.externalEdits, [EDITABLE_PATH]: Date.now() },
      }));
    });

    await screen.findByRole('alert');
    expect(
      screen.getByText(/This file changed on disk while you were editing/),
    ).toBeInTheDocument();
  });

  it('external_edit_on_clean_buffer_silently_reloads_and_banner_not_shown', async () => {
    setReadWrite('aa');
    render(<ClaudeMdEditor path={EDITABLE_PATH} cwd={null} />);
    await screen.findByTestId('arsenal-editor-textarea');
    // Update the read response to simulate new disk content.
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'readClaudeMd') {
        return { content: 'new-disk', editable: true, path: EDITABLE_PATH };
      }
      return null;
    });

    act(() => {
      useClaudeResourcesStore.setState((s) => ({
        externalEdits: { ...s.externalEdits, [EDITABLE_PATH]: Date.now() },
      }));
    });

    await waitFor(() => {
      const ta = screen.getByTestId(
        'arsenal-editor-textarea',
      ) as HTMLTextAreaElement;
      expect(ta.value).toBe('new-disk');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('read_only_banner_renders_for_global_claude_md', async () => {
    invokeMock.mockImplementation(async () => ({
      content: '# global',
      editable: false,
      path: GLOBAL_PATH,
    }));
    render(<ClaudeMdEditor path={GLOBAL_PATH} cwd={null} />);
    await screen.findByTestId('arsenal-readonly-banner');
    expect(
      screen.getByText(
        /READ-ONLY — ~\/\.claude\/CLAUDE\.md editing is disabled this phase\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('arsenal-editor-textarea')).toBeNull();
  });
});

describe('ClaudeMdEditor — keyboard + error paths', () => {
  it('ctrl_s_triggers_save', async () => {
    setReadWrite('a');
    render(<ClaudeMdEditor path={EDITABLE_PATH} cwd={null} />);
    const ta = (await screen.findByTestId(
      'arsenal-editor-textarea',
    )) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'a2' } });
    fireEvent.keyDown(ta, { key: 's', ctrlKey: true });
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('writeClaudeMd', {
        path: EDITABLE_PATH,
        content: 'a2',
        cwd: null,
      }),
    );
  });

  it('save_failure_renders_save_failed_toast', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'readClaudeMd') {
        return { content: 'x', editable: true, path: EDITABLE_PATH };
      }
      if (cmd === 'writeClaudeMd') {
        throw new Error('path is not editable: /etc/passwd');
      }
      return null;
    });
    render(<ClaudeMdEditor path={EDITABLE_PATH} cwd={null} />);
    const ta = (await screen.findByTestId(
      'arsenal-editor-textarea',
    )) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'dirty' } });
    fireEvent.click(screen.getByTestId('arsenal-save-button'));

    await screen.findByText(/SAVE_FAILED — CLAUDE.md/);
    expect(
      screen.getByText(/path is not editable: \/etc\/passwd/),
    ).toBeInTheDocument();
  });
});

describe('ContentPreview (WARNING 3: generic reader reuse)', () => {
  it('renders non-CLAUDE.md file content via readClaudeMd', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'readClaudeMd') {
        return {
          content: '---\nname: test\n---\n# skill body',
          editable: false,
          path: '/plugins/x/skills/test/SKILL.md',
        };
      }
      return null;
    });
    render(
      <ContentPreview
        path="/plugins/x/skills/test/SKILL.md"
        cwd={null}
        readOnly
      />,
    );
    const pre = await screen.findByTestId('arsenal-content-preview');
    expect(pre.textContent).toContain('# skill body');
  });
});
