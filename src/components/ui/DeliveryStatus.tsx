// Phase 10: extended from 3 to 4 variants (D-10).
// Adds `consumed` — "Claude's turn began against this outbound message",
// rendered with Lucide CheckCheck + primary green (iMessage double-tick read
// analog). Preserves Phase 4 variants verbatim.

import { Check, CheckCheck, Clock, X } from 'lucide-react';

export type DeliveryStatusType = 'delivered' | 'queued' | 'consumed' | 'unsupported';

interface DeliveryStatusProps {
  status: DeliveryStatusType;
}

const statusConfig: Record<
  DeliveryStatusType,
  { icon: typeof Check; color: string; label: string }
> = {
  delivered: { icon: Check, color: '#8eff71', label: 'DELIVERED' },
  queued: { icon: Clock, color: '#ffd16f', label: 'QUEUED' },
  consumed: { icon: CheckCheck, color: '#8eff71', label: 'CONSUMED' },
  unsupported: { icon: X, color: '#ff7351', label: 'UNSUPPORTED' },
};

export function DeliveryStatus({ status }: DeliveryStatusProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span
      className="inline-flex items-center gap-1 font-mono"
      style={{ fontSize: '10px', color: config.color }}
    >
      <Icon size={16} strokeWidth={1.5} />
      {config.label}
    </span>
  );
}
