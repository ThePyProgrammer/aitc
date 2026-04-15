import type { ToolPreviewProps } from './registry';

/** Fallback renderer for MCP and unknown tools. Plan 05 fleshes out the
 *  JSON syntax-highlighted body; Plan 01 ships a minimal placeholder that
 *  signals the "unverified tool" banner copy from 08-UI-SPEC. */
export function UnknownToolPreview(_props: ToolPreviewProps) {
  return (
    <div data-tool-preview="unknown">
      UNVERIFIED_TOOL — AITC has no renderer for this tool; raw input shown below.
    </div>
  );
}
UnknownToolPreview.displayName = 'UnknownToolPreview';
