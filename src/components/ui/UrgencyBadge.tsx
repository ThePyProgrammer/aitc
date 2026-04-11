import { motion } from 'motion/react';

interface UrgencyBadgeProps {
  urgency: 'low' | 'medium' | 'high';
}

const urgencyStyles: Record<UrgencyBadgeProps['urgency'], string> = {
  low: 'bg-[#494847]/10 text-[#adaaaa] border border-[#494847]/20',
  medium: 'bg-[#ffd16f]/10 text-[#ffd16f] border border-[#ffd16f]/20',
  high: 'bg-[#ff7351]/10 text-[#ff7351] border border-[#ff7351]/20',
};

const urgencyLabels: Record<UrgencyBadgeProps['urgency'], string> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
};

export function UrgencyBadge({ urgency }: UrgencyBadgeProps) {
  return (
    <motion.span
      className={`inline-flex items-center px-2 py-0.5 font-headline text-[10px] uppercase tracking-widest ${urgencyStyles[urgency]}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      aria-label={`${urgency} urgency`}
    >
      {urgencyLabels[urgency]}
    </motion.span>
  );
}
