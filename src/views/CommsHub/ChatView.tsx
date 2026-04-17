// Phase 10 — CHAT tab top-level component (D-19, D-20).
// Wave 0 (Plan 01) renders the MasterDetailShell hierarchy with the
// AgentChannelList master and ChatTranscript list; Plan 06 wires URL
// routing (`?tab=chat&agent={agent_id}`), the sticky input, archive
// collapsible, and detail-pane chrome.

import { useChatStore } from '../../stores/chatStore';
import { MasterDetailShell } from '../../components/layout/MasterDetailShell';
import { AgentChannelList, ChatTranscript } from '../../components/chat';

export function ChatView() {
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);

  return (
    <div style={{ animation: 'phosphor-in 150ms ease' }}>
      <MasterDetailShell
        rail={<AgentChannelList />}
        list={<ChatTranscript agentId={selectedAgentId} />}
        railWidth={280}
        detailWidth="flex"
      />
    </div>
  );
}
