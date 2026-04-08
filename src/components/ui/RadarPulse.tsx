interface RadarPulseProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'primary' | 'error' | 'tertiary';
}

const sizeMap = {
  sm: { dot: 'h-[3px] w-[3px]', ring1: 'h-[18px] w-[18px]', ring2: 'h-[30px] w-[30px]', container: 'h-[40px] w-[40px]' },
  md: { dot: 'h-[6px] w-[6px]', ring1: 'h-[24px] w-[24px]', ring2: 'h-[40px] w-[40px]', container: 'h-[52px] w-[52px]' },
  lg: { dot: 'h-[10px] w-[10px]', ring1: 'h-[36px] w-[36px]', ring2: 'h-[56px] w-[56px]', container: 'h-[72px] w-[72px]' },
};

const colorMap = {
  primary: 'bg-primary',
  error: 'bg-error',
  tertiary: 'bg-tertiary',
};

const ringColorMap = {
  primary: 'border-primary',
  error: 'border-error',
  tertiary: 'border-tertiary',
};

export function RadarPulse({ size = 'md', color = 'primary' }: RadarPulseProps) {
  const sizes = sizeMap[size];
  const dotColor = colorMap[color];
  const ringColor = ringColorMap[color];

  return (
    <div className={`relative inline-flex items-center justify-center ${sizes.container}`}>
      {/* Central dot */}
      <div data-testid="pulse-dot" className={`${sizes.dot} ${dotColor} z-10`} />

      {/* First ping ring - 30% opacity */}
      <div
        data-testid="pulse-ring"
        className={`absolute ${sizes.ring1} border ${ringColor} opacity-30`}
        style={{
          animation: 'ping-scale 2s cubic-bezier(0, 0, 0.2, 1) infinite',
          borderRadius: '50% !important',
        }}
      />

      {/* Second ping ring - 20% opacity, delayed */}
      <div
        data-testid="pulse-ring"
        className={`absolute ${sizes.ring2} border ${ringColor} opacity-20`}
        style={{
          animation: 'ping-scale 2s cubic-bezier(0, 0, 0.2, 1) infinite',
          animationDelay: '0.5s',
          borderRadius: '50% !important',
        }}
      />
    </div>
  );
}
