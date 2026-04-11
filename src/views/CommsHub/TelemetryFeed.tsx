import { FileEdit, Eye, Trash2 } from 'lucide-react';
import { usePipelineStore } from '../../stores/pipelineStore';
import type { FileEvent } from '../../bindings';

function eventIcon(kind: FileEvent['kind']) {
  switch (kind.kind) {
    case 'create':
    case 'modify':
      return <FileEdit size={12} strokeWidth={1.5} className="text-primary shrink-0" />;
    case 'remove':
      return <Trash2 size={12} strokeWidth={1.5} className="text-[#ff7351] shrink-0" />;
    case 'rename':
      return <Eye size={12} strokeWidth={1.5} className="text-secondary shrink-0" />;
    default:
      return <Eye size={12} strokeWidth={1.5} className="text-on-surface-variant shrink-0" />;
  }
}

function truncatePath(path: string, maxLen = 30): string {
  if (path.length <= maxLen) return path;
  return '...' + path.slice(-maxLen + 3);
}

export function TelemetryFeed() {
  const events = usePipelineStore((s) => s.events);
  const visible = events.slice(0, 50);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-headline text-xs font-bold uppercase tracking-widest text-on-surface-variant">
        TELEMETRY_FEED
      </h3>
      <div className="flex flex-col gap-1 max-h-[200px] overflow-auto">
        {visible.length === 0 ? (
          <p className="font-mono text-on-surface-variant/60" style={{ fontSize: '10px' }}>
            No recent events.
          </p>
        ) : (
          visible.map((evt, i) => (
            <div key={`${evt.path}-${evt.timestampMs}-${i}`} className="flex items-center gap-1.5">
              {eventIcon(evt.kind)}
              <span
                className="font-mono text-on-surface-variant truncate"
                style={{ fontSize: '10px' }}
                title={evt.path}
              >
                {truncatePath(evt.path)}
              </span>
              <span
                className="font-mono text-on-surface-variant/40 shrink-0 ml-auto"
                style={{ fontSize: '10px' }}
              >
                {new Date(evt.timestampMs).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
