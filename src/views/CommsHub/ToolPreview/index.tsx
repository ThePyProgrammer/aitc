import type { ToolPreviewProps } from './registry';
import { resolveRenderer } from './registry';

/** Dispatcher: routes a pretool_use approval row to its per-tool renderer.
 *  Plan 05 wires this into RequestDetail as the InlineDiff replacement slot. */
export function ToolPreview(props: ToolPreviewProps) {
  const Renderer = resolveRenderer(props.toolName);
  return <Renderer {...props} />;
}
ToolPreview.displayName = 'ToolPreview';
