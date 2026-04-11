import { type ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: 'primary' | 'ghost' | 'destructive';
  tooltip?: string;
}

const variantStyles = {
  primary:
    'bg-primary text-on-primary font-headline text-xs font-bold uppercase tracking-widest hover:shadow-[0_0_10px_rgba(142,255,113,0.4)] active:bg-primary-container',
  ghost:
    'bg-transparent border border-outline/20 text-secondary font-headline text-xs font-bold uppercase tracking-widest hover:bg-surface-container-high',
  destructive:
    'bg-error text-white font-headline text-xs font-bold uppercase tracking-widest hover:shadow-[0_0_10px_rgba(255,115,81,0.4)]',
};

export function Button({
  variant,
  disabled,
  tooltip,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const baseStyles = 'px-4 py-2 transition-all duration-150';
  const disabledStyles = disabled ? 'opacity-50 cursor-not-allowed hover:shadow-none hover:bg-transparent' : '';

  return (
    <button
      disabled={disabled}
      className={`${baseStyles} ${variantStyles[variant]} ${disabledStyles} ${className}`}
      title={disabled && tooltip ? tooltip : undefined}
      {...props}
    >
      {children}
    </button>
  );
}
