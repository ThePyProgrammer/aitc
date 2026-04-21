// Phase 10 — single master-list row (64px tall).
// Line 1: agent ID (JB Mono 12 bold) + adapter chip + optional READ-ONLY badge.
// Line 2: last-event preview (truncated ~48 chars) + relative timestamp + UnreadBadge.
// Selected: bg-surface-container-highest + border-l-2 border-primary + agent ID
//   text-primary.
// Hover: bg-surface-container-high. Archived: wrapped in opacity-50.

import type { ChatChannel, AgentEvent } from '../../stores/chatStore';
import { ReadOnlyBadge } from './ReadOnlyBadge';
import { UnreadBadge } from '../ui/UnreadBadge';

export interface AgentChannelRowProps {
  channel: ChatChannel;
  selected?: boolean;
  onClick?: () => void;
}

function adapterChipClasses(adapterType: string): string {
  // CLAUDE_CODE → primary chip; others → tertiary chip.
  const isClaude =
    adapterType === 'claude-code' ||
    adapterType === 'claude_code' ||
    adapterType === 'claudeCode';
  return isClaude
    ? 'text-primary bg-primary/10 border border-primary/20'
    : 'text-tertiary bg-tertiary/10 border border-tertiary/20';
}

function adapterLabel(adapterType: string): string {
  return adapterType.replace(/-/g, '_').toUpperCase();
}

function buildPreview(ev: AgentEvent | null): string {
  if (!ev) return '';
  const payload = (ev.payloadJson ?? {}) as Record<string, unknown>;
  const content = (payload.content as string | undefined) ?? '';
  const toolName = (payload.tool_name as string | undefined) ?? '';
  const line = (payload.line as string | undefined) ?? '';
  const trunc = (s: string, n = 48) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
  switch (ev.eventType) {
    case 'user_text':
      return `You: ${trunc(content)}`;
    case 'assistant_text':
      return trunc(content);
    case 'tool_use':
      return `[${toolName.toUpperCase()}]`;
    case 'approval_link':
      return '⇢ APPROVAL_REQUIRED';
    case 'raw_stdout':
      return `${trunc(line)} ·stdout`;
    case 'raw_stderr':
      return `${trunc(line)} ·stderr`;
    default:
      return trunc(String(content || toolName || line || ev.eventType));
  }
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return '';
  try {
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return '';
    const diffMs = Date.now() - then.getTime();
    if (diffMs < 0) return then.toLocaleTimeString();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${Math.max(1, diffMin)}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return then.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return then.toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return '';
  }
}

export function AgentChannelRow({ channel, selected, onClick }: AgentChannelRowProps) {
  const isReadOnly = !channel.chatDuplex;
  const preview = buildPreview(channel.lastEvent);
  const ts = formatRelative(channel.lastEvent?.createdAt);

  return (
    <div
      data-testid="agent-channel-row"
      data-agent-id={channel.agentId}
      role="option"
      aria-selected={!!selected}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`h-16 flex flex-col justify-center px-3 cursor-pointer transition-colors ${
        selected
          ? 'bg-surface-container-highest border-l-2 border-primary'
          : 'border-l-2 border-transparent hover:bg-surface-container-high'
      } ${channel.archived ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`font-mono text-xs font-bold truncate ${
            selected ? 'text-primary' : 'text-on-surface'
          }`}
        >
          {channel.agentId}
        </span>
        <span
          className={`shrink-0 font-headline text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 ${adapterChipClasses(
            channel.adapterType,
          )}`}
        >
          {adapterLabel(channel.adapterType)}
        </span>
        {isReadOnly && <ReadOnlyBadge />}
      </div>
      <div className="flex items-center gap-2 mt-1 min-w-0">
        {preview && (
          <span className="flex-1 font-mono text-xs text-on-surface-variant truncate">
            {preview}
          </span>
        )}
        {ts && (
          <span className="shrink-0 font-mono text-[10px] text-on-surface-variant">
            {ts}
          </span>
        )}
        <UnreadBadge count={channel.unreadCount} />
      </div>
    </div>
  );
}
