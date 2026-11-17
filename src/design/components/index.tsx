import { animate, useMotionValue, useReducedMotion, motion } from 'motion/react';
import { SPRING } from '../motion';
import { useEffect, useId, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { formatMoney, type Currency, type FormatOptions, type Minor } from '../../lib/money';

export function Aurora() {
  return <div className="aurora" aria-hidden="true"><span /><span /><span /><span /><span /></div>;
}

/** SVG lens filter for hero glass. Only applied via .glass-lens; looks fine without it. */
export function GlassDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <filter id="glass-lens" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="4" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
        <feDisplacementMap in="SourceGraphic" in2="soft" scale="4" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

type GlassProps = ComponentPropsWithoutRef<'div'> & { strong?: boolean; pad?: number; lens?: boolean };
export function Glass({ strong, pad = 24, lens, className = '', style, ...rest }: GlassProps) {
  return (
    <div
      className={`glass ${strong ? 'glass-strong' : ''} ${lens ? 'glass-lens' : ''} ${className}`}
      style={{ padding: `calc(${pad}px * var(--d, 1))`, ...style }}
      {...rest}
    />
  );
}

type Tone = 'income' | 'expense' | 'savings' | 'debt' | 'neutral' | 'hers' | 'mine' | 'shared' | 'auto';

/** Money text. tone="auto" paints negatives red; everything uses tabular numerals. */
export function Money({
  amount, currency = 'CRC', tone = 'neutral', size, weight = 600, ...opts
}: { amount: Minor | number; currency?: Currency; tone?: Tone; size?: number; weight?: number } & FormatOptions) {
  const color = tone === 'auto' ? (amount < 0 ? 'var(--expense)' : 'var(--text)') : tone === 'neutral' ? 'var(--text)' : `var(--${tone})`;
  return (
    <span className="money" style={{ color, fontSize: size && size > 40 ? `clamp(32px, 11vw, ${size}px)` : size, fontWeight: weight, letterSpacing: size && size > 28 ? '-0.03em' : undefined }}>
      {formatMoney(amount, currency, opts)}
    </span>
  );
}

/** Count-up for hero numbers. Still exact on settle; instant under reduced motion. */
export function CountUp({ amount, currency = 'CRC', size = 44, tone = 'neutral' }: { amount: number; currency?: Currency; size?: number; tone?: Tone }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(amount);
  const [shown, setShown] = useState(amount);
  useEffect(() => {
    if (reduce) { setShown(amount); return; }
    const c = animate(mv, amount, { type: 'spring', stiffness: 80, damping: 20, onUpdate: (v) => setShown(Math.round(v)) });
    return () => c.stop();
  }, [amount, reduce, mv]);
  return (
    <span aria-live="polite">
      <Money amount={shown} currency={currency} size={size} weight={700} tone={tone} />
    </span>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: Exclude<Tone, 'auto'>; children: ReactNode }) {
  const bg = tone === 'neutral' ? 'var(--input-bg)' : ['hers', 'mine', 'shared'].includes(tone) ? `color-mix(in srgb, var(--${tone}) 14%, transparent)` : `var(--${tone}-soft)`;
  return <span className="pill" style={{ background: bg, color: tone === 'neutral' ? 'var(--text-2)' : `var(--${tone})` }}>{children}</span>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  const id = useId();
  const rm = useReducedMotion();
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={rm ? undefined : `${id}-seg`} className="seg-pill" transition={SPRING.snappy} />}
          <span style={{ position: 'relative' }}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Pressable card with a gentle spring scale. */
export function PressCard({ children, onClick, label }: { children: ReactNode; onClick?: () => void; label: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button" title={label} onClick={onClick}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      transition={SPRING.snappy}
      className="glass" style={{ padding: 20, textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit', width: '100%' }}
    >
      {children}
    </motion.button>
  );
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ margin: '0 0 16px' }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{children}</h2>
      {sub && <p style={{ margin: '4px 0 0', color: 'var(--text-2)', fontSize: 14 }}>{sub}</p>}
    </div>
  );
}
