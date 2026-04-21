// Phase 10 — CHAT tab top-level component (D-19, D-20).
//
// Plan 06 wires the full detail-pane: header (agent ID + StatusBadge +
// optional READ-ONLY_TRANSCRIPT + SESSION pill + CLEAR_THREAD button),
// scrolling transcript, sticky input, deep-link ?agent= selection, and
// URL-sync so selecting a channel updates the query string.

import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { MasterDetailShell } from '../../components/layout/MasterDetailShell';
import {
  AgentChannelList,
  ChatTranscript,
  ChatInput,
  ReadOnlyBadge,
} from '../../components/chat';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useChatStore, type ChatChannel } from '../../stores/chatStore';

type StatusVariant =
  | 'running'
  | 'idle'
  | 'waiting'
  | 'conflict'
  | 'error'
  | 'terminated';

function statusToVariant(status: string): StatusVariant {
  switch (status.toLowerCase()) {
    case 'running':
      return 'running';
    case 'idle':
      return 'idle';
    case 'waiting':
      return 'waiting';
    case 'conflict':
      return 'conflict';
    case 'error':
      return 'error';
    case 'terminated':
      return 'terminated';
    default:
      return 'idle';
  }
}

export function ChatView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectAgent = useChatStore((s) => s.selectAgent);
  const channels = useChatStore((s) => s.channels);

  // Deep-link: on mount (or when channels arrive), select the ?agent if
  // the id actually exists in the current channel list (T-10-32 mitigation).
  useEffect(() => {
    const agentFromQuery = searchParams.get('agent');
    if (!agentFromQuery) return;
    if (!channels.some((c) => c.agentId === agentFromQuery)) return;
    if (selectedAgentId === agentFromQuery) return;
    selectAgent(agentFromQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);

  // Keep URL synced with selection (preserves tab=chat).
  useEffect(() => {
    if (!selectedAgentId) return;
    if (searchParams.get('agent') === selectedAgentId) return;
    setSearchParams(
      (prev) => {
        const np = new URLSearchParams(prev);
        np.set('tab', 'chat');
        np.set('agent', selectedAgentId);
        return np;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentId]);

  const selectedChannel = useMemo<ChatChannel | null>(() => {
    if (!selectedAgentId) return null;
    return channels.find((c) => c.agentId === selectedAgentId) ?? null;
  }, [selectedAgentId, channels]);

  return (
    <MasterDetailShell
      railWidth={280}
      detailWidth="flex"
      rail={<AgentChannelList />}
      list={<DetailPane channel={selectedChannel} />}
    />
  );
}

function DetailPane({ channel }: { channel: ChatChannel | null }) {
  if (!channel) {
    return (
      <div className="flex-1 bg-surface-container-highest flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-5 w-[2px] bg-secondary"
            style={{ animation: 'blink-cursor 1s step-end infinite' }}
          />
          <h2 className="font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
            SELECT_AGENT_CHANNEL
          </h2>
          <p className="font-mono text-xs text-on-surface-variant/60">
            Choose an agent from the left to view transcript.
          </p>
        </div>
      </div>
    );
  }

  const statusVariant = statusToVariant(channel.status);
  const disabledInput = channel.archived || !channel.chatDuplex;
  const disabledTooltip = channel.archived
    ? `${channel.agentId} has terminated. Relaunch from Tower Control to resume this thread.`
    : !channel.chatDuplex
    ? `${channel.agentId} runs via ${channel.adapterType}, which does not expose an inbound message channel. Launch a Claude Code agent to enable chat.`
    : undefined;
  const placeholder = channel.archived
    ? `SESSION_ARCHIVED — relaunch agent to reactivate input.`
    : !channel.chatDuplex
    ? `READ-ONLY — ${channel.agentId} does not accept inbound messages.`
    : undefined;

  return (
    <div className="flex-1 bg-surface-container-highest flex flex-col min-h-0">
      {/* Header */}
      <div className="px-6 py-4 flex items-center gap-3 shrink-0">
        <h2 className="font-mono text-sm font-bold text-on-surface">
          {channel.agentId}
        </h2>
        <StatusBadge variant={statusVariant}>
          {channel.status.toUpperCase()}
        </StatusBadge>
        {!channel.chatDuplex && <ReadOnlyBadge />}
        {channel.currentSessionId && (
          <span className="font-mono text-[10px] text-on-surface-variant tracking-tight">
            SESSION · {channel.currentSessionId.slice(0, 8)}
          </span>
        )}
        <div className="ml-auto">
          <ClearThreadButton agentId={channel.agentId} />
        </div>
      </div>

      {/* Transcript */}
      <div className="flex-1 min-h-0 px-6 pb-2 flex flex-col">
        <ChatTranscript agentId={channel.agentId} />
      </div>

      {/* Sticky input */}
      <div className="px-6 pb-4 shrink-0">
        <ChatInput
          agentId={channel.agentId}
          disabled={disabledInput}
          disabledTooltip={disabledTooltip}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

/**
 * 2-click destructive confirm for CLEAR_THREAD (T-10-35 mitigation).
 * First click flips label + colorway for 3s; second click within window
 * fires chatStore.clearThread(agentId). Auto-reverts on timeout / unmount.
 */
function ClearThreadButton({ agentId }: { agentId: string }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearThread = useChatStore((s) => s.clearThread);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onClick = useCallback(() => {
    if (!confirming) {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), 3000);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setConfirming(false);
    void clearThread(agentId);
  }, [confirming, agentId, clearThread]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        confirming
          ? 'font-headline text-[11px] font-bold uppercase tracking-widest px-3 py-1 bg-error-container text-on-error'
          : 'font-headline text-[11px] font-bold uppercase tracking-widest px-3 py-1 text-on-surface-variant hover:text-on-surface'
      }
    >
      {confirming ? 'CONFIRM_CLEAR' : 'CLEAR_THREAD'}
    </button>
  );
}
