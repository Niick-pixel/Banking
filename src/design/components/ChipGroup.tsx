/**
 * A question answered by tapping: an uppercase label, then a glass tray of chips.
 * Single or multi-select (with a cap shown in the label). The selected chip is a tinted
 * pill that glides between options. Options that don't apply are hidden, not disabled;
 * `hiddenNote` says why. Keyboard: arrows move, digits 1–9 pick, Space/Enter toggles.
 */
import { motion } from 'motion/react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { InfoTip } from './InfoTip';
import { SPRING, reducedMotion } from '../motion';

export type Tone = 'accent' | 'win' | 'loss' | 'amber' | 'save';
export interface ChipOption<T extends string | number> { value: T; label: ReactNode; hint?: string; disabled?: boolean; hidden?: boolean; tone?: Tone }

interface Base<T extends string | number> {
  label: string;
  options: ChipOption<T>[];
  /** Small text after the label, e.g. "any". */
  note?: string;
  required?: boolean;
  /** One plain line behind an ⓘ next to the label. */
  info?: string;
  /** Text at the right of the label line, e.g. a count. */
  aside?: ReactNode;
  /** Why some options are hidden. */
  hiddenNote?: string;
  /** Kept for older callers: chips always share the row and wrap rather than shrink. */
  spread?: boolean;
  /** Equal-width chips: only for short labels. */
  compact?: boolean;
  /** Label beside the chips instead of above (when height is short). */
  inline?: boolean;
  size?: 'md' | 'sm';
  /** Flash red when a save failed because this is missing. */
  flash?: boolean;
  className?: string;
}
type Single<T extends string | number> = Base<T> & { multi?: false; value: T | null; onChange: (v: T | null) => void; allowNone?: boolean };
type Multi<T extends string | number> = Base<T> & { multi: true; value: T[]; onChange: (v: T[]) => void; max?: number };

const TONE: Record<Tone, string> = { accent: 'var(--accent)', win: 'var(--win)', loss: 'var(--loss)', amber: 'var(--amber)', save: 'var(--save)' };

export function ChipGroup<T extends string | number>(props: Single<T> | Multi<T>) {
  const id = useId();
  const { label, note, required, info, aside, compact, inline, size = 'md', hiddenNote } = props;
  const options = props.options.filter((o) => !o.hidden);
  const tray = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const isOn = (v: T) => (props.multi ? props.value.includes(v) : props.value === v);
  const max = props.multi ? props.max : 1;
  const full = props.multi && max !== undefined && props.value.length >= max;
  const toggle = (v: T) => {
    if (props.multi) {
      if (props.value.includes(v)) props.onChange(props.value.filter((x) => x !== v));
      else if (max === 1) props.onChange([v]);
      else if (!full) props.onChange([...props.value, v]);
    } else props.onChange(props.value === v && props.allowNone ? null : v);
  };
  const missing = required && (props.multi ? props.value.length === 0 : props.value === null || props.value === '');
  const onKey = (e: React.KeyboardEvent) => {
    const btns = [...(tray.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (/^[1-9]$/.test(e.key) && options[Number(e.key) - 1]) { e.preventDefault(); toggle(options[Number(e.key) - 1]!.value); btns[Number(e.key) - 1]?.focus(); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && i >= 0) { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && i >= 0) { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  };
  const rm = reducedMotion();
  const capText = props.multi && max && max > 1 ? `up to ${max}` : undefined;
  return (
    <div className={`chipgroup chipgroup-${size} ${inline ? 'chipgroup-inline' : ''} ${props.flash && missing ? 'missing-flash' : ''} ${live ? 'keys-live' : ''} ${props.className ?? ''}`}
      onFocus={() => setLive(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setLive(false); }}>
      <div className="chipgroup-head" id={`${id}-l`}>
        <span className="chipgroup-label">{label}</span>
        {capText && <span className="chipgroup-note">· {capText}</span>}
        {note && !required && <span className="chipgroup-note">· {note}</span>}
        {required && missing && <span className="req">required</span>}
        {info && <InfoTip text={info} label={`About ${label}`} />}
        {hiddenNote && <span className="chipgroup-note chipgroup-why">· {hiddenNote}</span>}
        {aside !== undefined && <span className="chipgroup-aside">{aside}</span>}
      </div>
      <div ref={tray} className={`segmented chipgroup-tray ${compact ? 'compact' : ''}`} role={props.multi ? 'group' : 'radiogroup'} aria-labelledby={`${id}-l`} onKeyDown={onKey}>
        {options.map((o, n) => {
          const on = isOn(o.value);
          const disabled = o.disabled || (!on && full && max !== 1);
          return (
            <motion.button key={String(o.value)} type="button" className={`chipopt ${on ? 'on' : ''}`} disabled={disabled} title={o.hint}
              style={{ ['--tone' as string]: TONE[o.tone ?? 'accent'] }}
              role={props.multi ? undefined : 'radio'} aria-checked={props.multi ? undefined : on} aria-pressed={props.multi ? on : undefined}
              whileTap={rm ? undefined : { scale: 0.97 }} transition={SPRING.snappy}
              tabIndex={props.multi ? 0 : on || (props.value === null && n === 0) ? 0 : -1}
              onClick={() => toggle(o.value)}>
              {on && <motion.span layoutId={props.multi || rm ? undefined : `${id}-pill`} className="seg-pill"
                initial={props.multi && !rm ? { opacity: 0, scale: 0.85 } : false} animate={{ opacity: 1, scale: 1 }} transition={props.multi ? SPRING.bouncy : SPRING.snappy} />}
              <span className="chipopt-label">{o.label}</span>
              {n < 9 && <kbd className="chip-key" aria-hidden>{n + 1}</kbd>}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
