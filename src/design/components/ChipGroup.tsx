/**
 * Chip menu: a soft tray of pill options under a small uppercase label.
 * Single or multi-select, optional "up to N", "required" and an info hint.
 */
import { Info } from 'lucide-react';
import { motion } from 'motion/react';
import { useId } from 'react';
import { useTheme } from '../../app/theme';

export interface ChipOption<T extends string | number> { value: T; label: string; hint?: string; disabled?: boolean }

interface Base<T extends string | number> {
  label: string;
  options: ChipOption<T>[];
  /** Small text after the label, e.g. "any". */
  note?: string;
  required?: boolean;
  /** ⓘ tooltip next to the label. */
  info?: string;
  /** Optional text at the top right, e.g. a count. */
  aside?: string;
  /** Spread chips evenly across the row (like a segmented tray) instead of packing them left. */
  spread?: boolean;
  size?: 'md' | 'sm';
  className?: string;
}
type Single<T extends string | number> = Base<T> & { multi?: false; value: T | null; onChange: (v: T | null) => void; allowNone?: boolean };
type Multi<T extends string | number> = Base<T> & { multi: true; value: T[]; onChange: (v: T[]) => void; max?: number };

export function ChipGroup<T extends string | number>(props: Single<T> | Multi<T>) {
  const id = useId();
  const { dur } = useTheme();
  const { label, options, note, required, info, aside, spread = true, size = 'md' } = props;
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
  const missing = required && (props.multi ? props.value.length === 0 : props.value === null);
  return (
    <fieldset className={`chipgroup chipgroup-${size} ${props.className ?? ''}`} aria-describedby={info ? `${id}-info` : undefined}>
      <legend className="chipgroup-head">
        {required && <span className={`chipgroup-dot ${missing ? 'missing' : ''}`} aria-hidden />}
        <span className="chipgroup-label">{label}</span>
        {(note || required || (props.multi && max && max > 1)) && (
          <span className="chipgroup-note">· {required ? 'required' : note ?? `up to ${max}`}{props.multi && max && max > 1 && required ? ` · up to ${max}` : ''}</span>
        )}
        {info && <span className="chipgroup-info" title={info} id={`${id}-info`} role="note" aria-label={info}><Info size={13} /></span>}
        {aside && <span className="chipgroup-aside">{aside}</span>}
      </legend>
      <div className={`chipgroup-tray ${spread ? 'spread' : ''}`} role={props.multi ? 'group' : 'radiogroup'} aria-label={label}>
        {options.map((o) => {
          const on = isOn(o.value);
          const disabled = o.disabled || (!on && full && max !== 1);
          return (
            <button key={String(o.value)} type="button" className={`chipopt ${on ? 'on' : ''}`} disabled={disabled} title={o.hint}
              role={props.multi ? undefined : 'radio'} aria-checked={props.multi ? undefined : on} aria-pressed={props.multi ? on : undefined}
              onClick={() => toggle(o.value)}>
              {on && <motion.span layoutId={props.multi ? undefined : `${id}-pill`} className="chipopt-bg" initial={props.multi ? { opacity: 0, scale: 0.9 } : false} animate={{ opacity: 1, scale: 1 }} transition={{ duration: dur(0.28), ease: [0.2, 0.8, 0.2, 1] }} />}
              <span className="chipopt-label">{o.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
