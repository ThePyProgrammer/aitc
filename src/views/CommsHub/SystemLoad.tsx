import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface SystemLoadData {
  cpuPercent: number;
  memoryPercent: number;
}

function barColor(percent: number): string {
  if (percent > 90) return '#ff7351';
  if (percent >= 70) return '#ffd16f';
  return '#8eff71';
}

export function SystemLoad() {
  const [data, setData] = useState<SystemLoadData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const result = await invoke<SystemLoadData>('get_system_load');
        if (active) {
          setData(result);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    };

    poll();
    const interval = setInterval(poll, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const renderBar = (label: string, value: number | null, hasError: boolean) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
          {label}
        </span>
        <span className="font-mono text-xs font-bold text-on-surface">
          {hasError ? (
            <span style={{ color: '#ff7351' }}>ERR</span>
          ) : value !== null ? (
            `${Math.round(value)}%`
          ) : (
            '...'
          )}
        </span>
      </div>
      <div className="h-2 w-full bg-surface-container-low">
        {value !== null && !hasError && (
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${Math.min(value, 100)}%`,
              backgroundColor: barColor(value),
            }}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-headline text-xs font-bold uppercase tracking-widest text-on-surface-variant">
        SYSTEM_LOAD
      </h3>
      {renderBar('CPU_CLUSTER', data?.cpuPercent ?? null, error)}
      {renderBar('MEMORY_SNAP', data?.memoryPercent ?? null, error)}
    </div>
  );
}
