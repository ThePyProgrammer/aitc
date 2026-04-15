import type { FC } from 'react';
import { UnknownToolPreview } from './UnknownToolPreview';

export interface ToolPreviewProps {
  requestId: number;
  toolName: string;
  toolInputJson: unknown;
  filePath: string | null;
}

export type ToolRenderer = FC<ToolPreviewProps>;

function stubRenderer(name: string): ToolRenderer {
  const c: ToolRenderer = () => null;
  c.displayName = name;
  return c;
}

/** Registered renderers keyed by Claude Code tool_name. Plan 05 fills in
 *  the real EditPreview / WritePreview / BashPreview / NotebookPreview /
 *  ProtectedPathPreview. Plan 01 ships stubs so the registry compiles and
 *  resolveRenderer always returns a component. */
const STUB_RENDERERS: Record<string, ToolRenderer> = {
  Edit: stubRenderer('EditPreviewStub'),
  MultiEdit: stubRenderer('MultiEditPreviewStub'),
  Write: stubRenderer('WritePreviewStub'),
  NotebookEdit: stubRenderer('NotebookPreviewStub'),
  Bash: stubRenderer('BashPreviewStub'),
  Read: stubRenderer('ProtectedPathPreviewStub'),
  LS: stubRenderer('ProtectedPathPreviewStub'),
  Grep: stubRenderer('ProtectedPathPreviewStub'),
  Glob: stubRenderer('ProtectedPathPreviewStub'),
  WebFetch: stubRenderer('ProtectedPathPreviewStub'),
  WebSearch: stubRenderer('ProtectedPathPreviewStub'),
  Task: stubRenderer('ProtectedPathPreviewStub'),
};

/** Resolve a renderer for the given tool_name. MCP tools (mcp__*) and
 *  unknown tools fall back to UnknownToolPreview. Null/undefined also fall
 *  back (defensive, for abandoned or malformed rows). */
export function resolveRenderer(toolName: string | null | undefined): ToolRenderer {
  if (!toolName) return UnknownToolPreview;
  if (toolName.startsWith('mcp__')) return UnknownToolPreview;
  return STUB_RENDERERS[toolName] ?? UnknownToolPreview;
}
