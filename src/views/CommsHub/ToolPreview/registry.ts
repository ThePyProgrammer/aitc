/**
 * Phase 8 Plan 05: real renderer registry.
 *
 * Dispatch rules:
 *   - Edit / MultiEdit            → EditPreview (delegates to InlineDiff)
 *   - Write                        → WritePreview (shiki-highlighted code block)
 *   - NotebookEdit                 → NotebookPreview (like Write + cell header)
 *   - Bash                         → BashPreview (DESCRIPTION/COMMAND/METADATA)
 *   - Read/LS/Grep/Glob/WebFetch/WebSearch/Task → ProtectedPathPreview (KV table)
 *   - mcp__* / anything else       → UnknownToolPreview (UNVERIFIED_TOOL banner)
 *
 * Interface shape is FROZEN by Plan 01 contract-lock tests. Do NOT change
 * ToolPreviewProps / ToolRenderer / resolveRenderer signatures.
 */
import type { FC } from 'react';
import { EditPreview } from './EditPreview';
import { WritePreview } from './WritePreview';
import { BashPreview } from './BashPreview';
import { NotebookPreview } from './NotebookPreview';
import { ProtectedPathPreview } from './ProtectedPathPreview';
import { UnknownToolPreview } from './UnknownToolPreview';

export interface ToolPreviewProps {
  requestId: number;
  toolName: string;
  toolInputJson: unknown;
  filePath: string | null;
}

export type ToolRenderer = FC<ToolPreviewProps>;

const RENDERERS: Record<string, ToolRenderer> = {
  Edit: EditPreview,
  MultiEdit: EditPreview,
  Write: WritePreview,
  NotebookEdit: NotebookPreview,
  Bash: BashPreview,
  Read: ProtectedPathPreview,
  LS: ProtectedPathPreview,
  Grep: ProtectedPathPreview,
  Glob: ProtectedPathPreview,
  WebFetch: ProtectedPathPreview,
  WebSearch: ProtectedPathPreview,
  Task: ProtectedPathPreview,
};

/** Resolve a renderer for the given tool_name. MCP tools (`mcp__*`) and
 *  unknown tools fall back to UnknownToolPreview. Null/undefined also
 *  fall back (defensive, for abandoned or malformed rows). */
export function resolveRenderer(toolName: string | null | undefined): ToolRenderer {
  if (!toolName) return UnknownToolPreview;
  if (toolName.startsWith('mcp__')) return UnknownToolPreview;
  return RENDERERS[toolName] ?? UnknownToolPreview;
}
