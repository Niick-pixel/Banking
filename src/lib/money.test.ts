import { describe, expect, it } from 'vitest';
import {
  add, convert, formatMoney, fromMajor, minor, MoneyError, mulRatio, parseAmountInput,
  roundHalfEven, sum, sumMoney, type Minor,
} from './money';

const crc = (colones: number) => fromMajor(colones, 'CRC');

describe('minor units', () => {
  it('rejects non-integers', () => {
    expect(() => minor(1.5)).toThrow(MoneyError);
    expect(() => minor(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });
  it('converts majors exactly', () => {
    expect(crc(70_000)).toBe(7_000_000);
    expect(fromMajor(0.1 + 0.2, 'USD')).toBe(30);
    expect(() => fromMajor(1.005, 'USD')).toThrow(MoneyError);
  });
  it('adds without float drift', () => {
    const tenCents = 10 as Minor;
    let t = 0 as Minor;
    for (let i = 0; i < 1000; i++) t = add(t, tenCents);
    expect(t).toBe(10_000);
  });
  it('refuses to sum mixed currencies', () => {
    expect(() =>
      sumMoney([{ amount: 1 as Minor, currency: 'CRC' }, { amount: 1 as Minor, currency: 'USD' }], 'CRC'),
    ).toThrow(MoneyError);
  });
  it('sums', () => {
    expect(sum([crc(70_000), crc(70_000), crc(35_000)])).toBe(crc(175_000));
  });
});

describe('rounding', () => {
  it('rounds half to even', () => {
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
    expect(roundHalfEven(2.51)).toBe(3);
    expect(roundHalfEven(-2.5)).toBe(-2);
  });
  it('mulRatio: 15% withholding on ₡12,345.67 interest', () => {
    expect(mulRatio(1_234_567 as Minor, 15, 100)).toBe(185_185);
  });
});

describe('exchange', () => {
  // ₡503.25 per USD
  const rate = 50_325;
  it('USD → CRC', () => {
    expect(convert(fromMajor(100, 'USD'), 'USD', 'CRC', rate)).toBe(crc(50_325));
  });
  it('CRC → USD', () => {
    expect(convert(crc(50_325), 'CRC', 'USD', rate)).toBe(10_000);
  });
  it('same currency is identity', () => {
    expect(convert(123 as Minor, 'CRC', 'CRC', rate)).toBe(123);
  });
});

describe('formatMoney', () => {
  it('CRC whole colones with thousands commas', () => {
    expect(formatMoney(crc(1_234_567), 'CRC')).toBe('₡1,234,567');
    expect(formatMoney(0 as Minor, 'CRC')).toBe('₡0');
  });
  it('USD with cents', () => {
    expect(formatMoney(fromMajor(1234.56, 'USD'), 'USD')).toBe('$1,234.56');
  });
  it('negatives: minus or accounting parentheses', () => {
    expect(formatMoney(-crc(5_000), 'CRC')).toBe('-₡5,000');
    expect(formatMoney(-crc(5_000), 'CRC', { parens: true })).toBe('(₡5,000)');
  });
  it('signed', () => {
    expect(formatMoney(crc(10), 'CRC', { signed: true })).toBe('+₡10');
  });
  it('rounds céntimos for CRC display without losing them in storage', () => {
    expect(formatMoney(150 as Minor, 'CRC')).toBe('₡2'); // ₡1.50 → half-even → ₡2
    expect(formatMoney(250 as Minor, 'CRC')).toBe('₡2'); // ₡2.50 → ₡2
  });
});

describe('parseAmountInput', () => {
  const p = (s: string) => parseAmountInput(s, 'CRC');
  it('shorthand', () => {
    expect(p('70k')).toBe(crc(70_000));
    expect(p('70K')).toBe(crc(70_000));
    expect(p('1.5m')).toBe(crc(1_500_000));
    expect(p('2.75k')).toBe(crc(2_750));
  });
  it('plain and grouped', () => {
    expect(p('70000')).toBe(crc(70_000));
    expect(p('70,000')).toBe(crc(70_000));
    expect(p('₡ 185,000')).toBe(crc(185_000));
    expect(p('70 000')).toBe(crc(70_000));
    expect(p('12.50')).toBe(1_250);
  });
  it('rejects ambiguity and negatives', () => {
    expect(p('')).toBeNull();
    expect(p('-500')).toBeNull();
    expect(p('7,00')).toBeNull();
    expect(p('abc')).toBeNull();
    expect(p('1.234')).toBeNull(); // sub-céntimo precision
  });
  it('USD', () => {
    expect(parseAmountInput('$1,234.56', 'USD')).toBe(123_456);
  });
});
