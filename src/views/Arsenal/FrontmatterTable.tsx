// Phase 9 ARSENAL — FrontmatterTable (Plan 05 Wave 3).
//
// Two-column key/value table over the tagged ResourceMetadata union. Array
// fields render comma-separated; missing optional fields render as em-dash
// (`—`). Typography matches 09-UI-SPEC §Typography Meta row (JetBrains Mono
// 12px, key in on-surface-variant, value in on-surface).

import type { ResourceMetadata } from '../../bindings';

export interface FrontmatterTableProps {
  metadata: ResourceMetadata;
}

type KV = { key: string; value: string };

function fmtList(v: string[] | null | undefined): string {
  if (!v || v.length === 0) return '—';
  return v.join(', ');
}

function fmtStr(v: string | null | undefined): string {
  if (!v) return '—';
  return v;
}

function rowsFor(metadata: ResourceMetadata): KV[] {
  switch (metadata.kind) {
    case 'skill':
      return [
        { key: 'kind', value: 'skill' },
        { key: 'tools', value: fmtList(metadata.tools) },
        { key: 'allowed_tools', value: fmtList(metadata.allowedTools) },
      ];
    case 'agent':
      return [
        { key: 'kind', value: 'agent' },
        { key: 'tools', value: fmtList(metadata.tools) },
        { key: 'model', value: fmtStr(metadata.model) },
      ];
    case 'plugin':
      return [
        { key: 'kind', value: 'plugin' },
        { key: 'version', value: metadata.version },
        { key: 'marketplace', value: fmtStr(metadata.marketplace) },
        { key: 'install_path', value: fmtStr(metadata.installPath) },
        { key: 'installed_at', value: fmtStr(metadata.installedAt) },
        { key: 'last_updated', value: fmtStr(metadata.lastUpdated) },
        { key: 'git_commit_sha', value: fmtStr(metadata.gitCommitSha) },
      ];
    case 'hook':
      return [
        { key: 'kind', value: 'hook' },
        { key: 'event', value: fmtStr(metadata.event) },
        { key: 'matcher', value: fmtStr(metadata.matcher) },
      ];
    case 'command':
      return [
        { key: 'kind', value: 'command' },
        { key: 'argument_hint', value: fmtStr(metadata.argumentHint) },
        { key: 'allowed_tools', value: fmtList(metadata.allowedTools) },
      ];
    case 'settings':
      return [
        { key: 'kind', value: 'settings' },
        { key: 'hooks_count', value: String(metadata.hooksCount) },
        { key: 'mcp_servers_count', value: String(metadata.mcpServersCount) },
      ];
    case 'mcp':
      return [
        { key: 'kind', value: 'mcp' },
        { key: 'command', value: metadata.command },
        { key: 'args', value: fmtList(metadata.args) },
        { key: 'env_masked', value: metadata.envMasked ? 'true' : 'false' },
      ];
    case 'claudeMd':
      return [
        { key: 'kind', value: 'claudeMd' },
        { key: 'editable', value: metadata.editable ? 'true' : 'false' },
        { key: 'byte_size', value: String(metadata.byteSize) },
      ];
  }
}

export function FrontmatterTable({ metadata }: FrontmatterTableProps) {
  const rows = rowsFor(metadata);
  return (
    <div
      data-testid="arsenal-frontmatter-table"
      className="flex flex-col gap-1 font-mono text-xs"
    >
      {rows.map((r) => (
        <div key={r.key} className="flex gap-4">
          <span className="text-on-surface-variant w-40 shrink-0">
            {r.key}
          </span>
          <span className="text-on-surface break-all">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
