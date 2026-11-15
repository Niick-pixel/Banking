/** Robust statistics: median and MAD, so one huge month doesn't move a baseline. */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
/** Median absolute deviation (raw; multiply by 1.4826 for a σ-like spread). */
export function mad(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
