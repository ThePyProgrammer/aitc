import { motion } from 'motion/react';

type StatusVariant =
  | 'deployed'
  | 'conflict'
  | 'idle'
  // Phase 3 agent status variants
  | 'running'
  | 'waiting'
  | 'error';

interface StatusBadgeProps {
  variant: StatusVariant;
  children: string;
}

const variantStyles: Record<StatusVariant, string> = {
  deployed: 'bg-primary/10 text-primary border border-primary/20',
  conflict: 'bg-[#ff7351] text-white',
  idle: 'bg-[#ffd16f]/10 text-[#ffd16f] border border-[#ffd16f]/20',
  running: 'bg-[#8eff71]/10 text-[#8eff71] border border-[#8eff71]/20',
  waiting: 'bg-[#ffd16f]/10 text-[#ffd16f] border border-[#ffd16f]/20',
  error: 'bg-[#ff7351]/10 text-[#ff7351] border border-[#ff7351]/20',
};

export function StatusBadge({ variant, children }: StatusBadgeProps) {
  const isWaiting = variant === 'waiting';

  return (
    <motion.span
      className={`inline-flex items-center px-2 py-0.5 text-[8px] font-mono font-bold uppercase relative ${variantStyles[variant]}`}
      animate={{ color: variantStyles[variant] }}
      transition={{ duration: 0.3 }}
      aria-label={`${variant} status`}
    >
      {children}
      {/* Waiting pulse indicator */}
      {isWaiting && (
        <motion.span
          className="absolute inset-0 bg-[#ffd16f]/30"
          animate={{ scale: [1, 1.15, 1] }}
          transition={{
            repeat: Infinity,
            duration: 3,
            ease: 'easeInOut',
          }}
          style={{ originX: 0.5, originY: 0.5 }}
          // Respect reduced motion preference via CSS
          // @media (prefers-reduced-motion: reduce) disables this via opacity
        />
      )}
    </motion.span>
  );
}
