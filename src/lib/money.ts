/**
 * Money primitives.
 *
 * Every amount in Colón is an integer number of MINOR units (céntimos for CRC,
 * cents for USD). Floats never touch stored money. All arithmetic goes through
 * these helpers so overflow or currency mixing throws instead of silently
 * corrupting a total.
 */

export const CURRENCIES = ['CRC', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Integer minor units. Branded so a plain number can't sneak in by accident. */
export type Minor = number & { readonly __minor: unique symbol };

export interface Money {
  amount: Minor;
  currency: Currency;
}

const MINOR_PER_MAJOR: Record<Currency, number> = { CRC: 100, USD: 100 };
const SYMBOL: Record<Currency, string> = { CRC: '₡', USD: '$' };
/** CRC is shown in whole colones, USD with cents. */
const DISPLAY_DECIMALS: Record<Currency, number> = { CRC: 0, USD: 2 };

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function minor(n: number): Minor {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`Not a safe integer amount: ${n}`);
  return n as Minor;
}

export function money(amount: number, currency: Currency): Money {
  return { amount: minor(amount), currency };
}

/** Major units (e.g. 70000 colones) → minor units. Accepts at most 2 decimals. */
export function fromMajor(major: number, currency: Currency): Minor {
  const scaled = Math.round(major * MINOR_PER_MAJOR[currency]);
  if (Math.abs(scaled - major * MINOR_PER_MAJOR[currency]) > 1e-6) {
    throw new MoneyError(`Too many decimals for ${currency}: ${major}`);
  }
  return minor(scaled);
}

export function add(a: Minor, b: Minor): Minor {
  return minor(a + b);
}

export function sub(a: Minor, b: Minor): Minor {
  return minor(a - b);
}

export function neg(a: Minor): Minor {
  return minor(-a);
}

export function sum(values: Iterable<Minor>): Minor {
  let total = 0;
  for (const v of values) {
    total += v;
    if (!Number.isSafeInteger(total)) throw new MoneyError('Sum overflowed safe integer range');
  }
  return total as Minor;
}

export function sumMoney(values: Iterable<Money>, currency: Currency): Minor {
  let total = 0 as Minor;
  for (const v of values) {
    if (v.currency !== currency) {
      throw new MoneyError(`Cannot sum ${v.currency} into ${currency} without a rate`);
    }
    total = add(total, v.amount);
  }
  return total;
}

/**
 * Multiply by a ratio and round half-to-even ("banker's rounding"), so repeated
 * interest/percentage calculations don't drift in one direction.
 */
export function mulRatio(a: Minor, numerator: number, denominator: number): Minor {
  if (denominator === 0) throw new MoneyError('Division by zero');
  const exact = (a * numerator) / denominator;
  return minor(roundHalfEven(exact));
}

export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  const EPS = 1e-9;
  if (diff > 0.5 + EPS) return floor + 1;
  if (diff < 0.5 - EPS) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Exchange rates are stored as integer CRC céntimos per 1 USD
 * (e.g. ₡503.25 → 50325) so conversion stays integer-only.
 */
export type RateCentimosPerUsd = number;

export function convert(
  amount: Minor,
  from: Currency,
  to: Currency,
  rate: RateCentimosPerUsd,
): Minor {
  if (from === to) return amount;
  if (!Number.isSafeInteger(rate) || rate <= 0) throw new MoneyError(`Invalid rate: ${rate}`);
  // USD cents → CRC céntimos: cents * (céntimos per USD) / 100 cents
  if (from === 'USD' && to === 'CRC') return mulRatio(amount, rate, 100);
  // CRC céntimos → USD cents
  return mulRatio(amount, 100, rate);
}

export interface FormatOptions {
  /** Accounting style: (₡1,234) instead of -₡1,234. Used in reports. */
  parens?: boolean;
  /** Force showing a + sign on positive values. */
  signed?: boolean;
  /** Override the default display decimals. */
  decimals?: number;
}

/** ₡1,234,567 · $1,234.56 · -₡5,000 · (₡5,000) */
export function formatMoney(amount: Minor | number, currency: Currency, opts: FormatOptions = {}): string {
  const decimals = opts.decimals ?? DISPLAY_DECIMALS[currency];
  const per = MINOR_PER_MAJOR[currency];
  const negative = amount < 0;
  const abs = Math.abs(amount);
  // Round in integer space to the display precision, half-even.
  const step = per / 10 ** decimals;
  const roundedMinor = roundHalfEven(abs / step) * step;
  const whole = Math.floor(roundedMinor / per);
  const frac = roundedMinor - whole * per;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = decimals > 0 ? '.' + Math.round(frac / step).toString().padStart(decimals, '0') : '';
  const body = `${SYMBOL[currency]}${wholeStr}${fracStr}`;
  const isZero = roundedMinor === 0;
  if (negative && !isZero) return opts.parens ? `(${body})` : `-${body}`;
  if (opts.signed && !isZero) return `+${body}`;
  return body;
}

/**
 * Natural amount entry. The user never types negatives: direction comes from
 * the movement kind. Accepts:
 *   "70k" → 70,000 · "1.5m" / "1.5M" → 1,500,000 · "70,000" · "70 000"
 *   "₡70.000"? — NO: comma is the thousands separator, dot is the decimal.
 *   "12.50" → 12.50
 * Returns null when the input can't be read unambiguously.
 */
export function parseAmountInput(raw: string, currency: Currency): Minor | null {
  let s = raw.trim().toLowerCase().replace(/[₡$\s_]/g, '').replace(/^crc|^usd/, '');
  if (s === '') return null;
  if (s.startsWith('-') || s.startsWith('+')) return null;
  let multiplier = 1;
  const suffix = s.at(-1);
  if (suffix === 'k') multiplier = 1_000;
  else if (suffix === 'm') multiplier = 1_000_000;
  if (multiplier !== 1) s = s.slice(0, -1);
  // Thousands separators must be in groups of three.
  if (s.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const [intPart = '0', fracPart = ''] = s.split('.');
  // Work in strings to avoid float error: build the minor-unit integer exactly.
  const per = MINOR_PER_MAJOR[currency];
  const perDigits = Math.log10(per);
  const multDigits = Math.log10(multiplier);
  const totalShift = perDigits + multDigits;
  if (fracPart.length > totalShift) return null; // more precision than a céntimo
  const digits = (intPart || '0') + fracPart.padEnd(totalShift, '0');
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return null;
  return value as Minor;
}

export function toMajor(amount: Minor, currency: Currency): number {
  return amount / MINOR_PER_MAJOR[currency];
}

export function currencySymbol(c: Currency): string {
  return SYMBOL[c];
}
