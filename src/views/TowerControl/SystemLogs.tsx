import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../../stores/agentStore';

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

const levelColors: Record<string, string> = {
  INFO: 'text-on-surface-variant',
  WARN: 'text-tertiary',
  ERROR: 'text-error',
};

function parseLogLine(line: string): LogEntry {
  // Try to parse structured log lines like "[timestamp] (LEVEL) message"
  const match = line.match(/^\[([^\]]+)\]\s*\((\w+)\)\s*(.*)$/);
  if (match) {
    return {
      timestamp: match[1],
      level: (match[2] as LogEntry['level']) || 'INFO',
      message: match[3],
    };
  }
  // Fall back to INFO with current time
  return {
    timestamp: new Date().toLocaleTimeString(),
    level: 'INFO',
    message: line,
  };
}

export function SystemLogs() {
  const agents = useAgentStore((s) => s.agents);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (agents.length === 0) return;

    const fetchLogs = async () => {
      const allLogs: LogEntry[] = [];
      for (const agent of agents) {
        try {
          const lines = await invoke<string[]>('get_agent_logs', { agentId: agent.id });
          for (const line of lines) {
            allLogs.push(parseLogLine(line));
          }
        } catch {
          // Agent may no longer exist
        }
      }
      setLogs(allLogs.slice(-200)); // Keep last 200 entries
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [agents]);

  return (
    <div className="bg-surface-container-low p-6">
      <h3 className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-4">
        SYSTEM_LOGS
      </h3>

      <div
        ref={scrollRef}
        className="max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-surface-container-high scrollbar-w-1"
      >
        {logs.length === 0 ? (
          <p className="font-mono text-[10px] text-on-surface-variant/40">
            No log entries. Logs appear when agents are active.
          </p>
        ) : (
          <div className="flex flex-col">
            {logs.map((entry, i) => (
              <div key={i} className="leading-5 font-mono text-[10px]">
                <span className="text-on-surface-variant/60">[{entry.timestamp}]</span>{' '}
                <span className={levelColors[entry.level] ?? 'text-on-surface-variant'}>
                  ({entry.level})
                </span>{' '}
                <span className="text-on-surface-variant">{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
