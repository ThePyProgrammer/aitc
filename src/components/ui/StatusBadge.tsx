interface StatusBadgeProps {
  variant: 'deployed' | 'conflict' | 'idle';
  children: string;
}

const variantStyles = {
  deployed: 'bg-primary/10 text-primary border border-primary/20',
  conflict: 'bg-error text-on-error',
  idle: 'bg-outline-variant/10 text-on-surface-variant',
};

export function StatusBadge({ variant, children }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[8px] font-mono font-bold uppercase ${variantStyles[variant]}`}
    >
      {children}
    </span>
  );
}
