import { formatMoney, minor } from '../../lib/money';
import type { Ctx } from '../context';
import type { Insight, RuleId } from '../types';

export interface RuleDef<P extends Record<string, number>> {
  id: RuleId;
  name: string;
  trigger: string;
  defaults: P;
  labels?: Partial<Record<keyof P, string>>;
  evaluate(ctx: Ctx, p: P & { on: boolean }): Insight[];
}
/** Define a rule; its thresholds are typed from `defaults`. */
export function rule<P extends Record<string, number>>(r: RuleDef<P>): Rule { return r as unknown as Rule; }

export interface Rule {
  id: RuleId;
  name: string;
  /** One line for Settings: what triggers it. */
  trigger: string;
  /** Editable thresholds (shown in Settings → Coach). Money thresholds are in céntimos. */
  defaults: Record<string, number>;
  /** Labels for the thresholds in Settings. */
  labels?: Record<string, string>;
  evaluate(ctx: Ctx, p: Record<string, number> & { on: boolean }): Insight[];
}

/** ₡ with no decimals, for sentences. */
export const crc = (n: number) => formatMoney(minor(Math.round(n)), 'CRC', { decimals: 0 });
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const ddmm = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

export function make(i: Omit<Insight, 'id'> & { id?: string }): Insight {
  return { ...i, id: i.id ?? i.dedupeKey, impactCRC: Math.max(0, Math.round(i.impactCRC)) };
}
