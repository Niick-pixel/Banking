/**
 * Dollars ⇄ colones, always one click away (top right, next to the bell).
 * Type on either side; the rate comes from Settings → Exchange rates (BCCR or
 * market) and you can overwrite it. What you typed stays there next time.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownUp, RefreshCw } from 'lucide-react';
import { rateForDay } from './fx';
import { usePersisted } from './persist';
import { useTheme } from './theme';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

interface CalcState { usd: string; crc: string; rate: string; rateNote: string; rateDay: string; edited: 'usd' | 'crc' }
const INIT: CalcState = { usd: '1', crc: '', rate: '', rateNote: '', rateDay: '', edited: 'usd' };
const trim = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2, useGrouping: false });

export function FxCalc() {
  const [s, setS] = usePersisted<CalcState>('fx.calc', INIT);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { dur } = useTheme();
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const rate = parseAmountInput(s.rate, 'CRC'); // céntimos per USD
  const today = todayISO();

  const recompute = (next: CalcState): CalcState => {
    const r = parseAmountInput(next.rate, 'CRC');
    if (!r) return next;
    if (next.edited === 'usd') { const u = parseAmountInput(next.usd, 'USD'); return { ...next, crc: u === null ? '' : trim((u * r) / 10_000) }; }
    const c = parseAmountInput(next.crc, 'CRC'); return { ...next, usd: c === null ? '' : trim(c / r) };
  };
  const fetchRate = async () => {
    setLoading(true);
    try {
      const q = await rateForDay(today);
      if (q) setS((x) => recompute({ ...x, rate: trim(q.rate / 100), rateNote: `${q.source} ${q.side === 'sell' ? 'sell (venta)' : 'buy (compra)'} · ${formatDateCR(q.rateDate)}`, rateDay: today }));
      else setS((x) => ({ ...x, rateNote: x.rate ? `Couldn't refresh; using your last rate` : "Couldn't get a rate. Type one." }));
    } catch { setS((x) => ({ ...x, rateNote: "Couldn't get a rate. Type one." })); }
    finally { setLoading(false); }
  };
  // A fresh rate once a day, the first time you open it.
  useEffect(() => { if (open && s.rateDay !== today && !s.rateNote.startsWith('typed')) void fetchRate(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const onDown = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey); window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [open]);

  const rect = btn.current?.getBoundingClientRect();
  const usdVal = parseAmountInput(s.usd, 'USD');
  return (
    <>
      <button ref={btn} className="bell fx-btn" aria-label="Dollar to colón calculator" aria-expanded={open} aria-haspopup="dialog" title="$ ⇄ ₡" onClick={() => setOpen((o) => !o)}>
        <span aria-hidden>$₡</span>
      </button>
      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div ref={panel} role="dialog" aria-label="Dollar to colón calculator" className="glass glass-strong bell-panel fx-panel"
              style={{ top: rect.bottom + 10, right: Math.max(12, window.innerWidth - rect.right) }}
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0, transition: { duration: dur(0.22) } }} exit={{ opacity: 0, y: -6, transition: { duration: dur(0.15) } }}>
              <div className="bell-head"><b>Dollars ⇄ colones</b></div>
              <div style={{ display: 'grid', gap: 10, padding: 16 }}>
                <div className="field"><label htmlFor="fx-usd">Dollars</label>
                  <input id="fx-usd" className="input input-amount fx-input" inputMode="decimal" data-autofocus value={s.usd} onFocus={(e) => e.target.select()}
                    onChange={(e) => setS(recompute({ ...s, usd: e.target.value, edited: 'usd' }))} /></div>
                <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'center' }} aria-label="Swap" onClick={() => setS(recompute({ ...s, edited: s.edited === 'usd' ? 'crc' : 'usd' }))}><ArrowDownUp size={16} aria-hidden /></button>
                <div className="field"><label htmlFor="fx-crc">Colones</label>
                  <input id="fx-crc" className="input input-amount fx-input" inputMode="decimal" value={s.crc} onFocus={(e) => e.target.select()}
                    onChange={(e) => setS(recompute({ ...s, crc: e.target.value, edited: 'crc' }))} /></div>
                <div className="fx-rate">
                  <label htmlFor="fx-rate" className="small">Rate (₡ per $)</label>
                  <input id="fx-rate" className="input" inputMode="decimal" style={{ height: 36 }} value={s.rate} placeholder="e.g. 505.20"
                    onChange={(e) => setS(recompute({ ...s, rate: e.target.value, rateNote: 'typed by you', rateDay: today }))} />
                  <button className="btn btn-ghost btn-sm" aria-label="Get today's rate" title="Get today's rate" disabled={loading} onClick={() => void fetchRate()}><RefreshCw size={15} aria-hidden className={loading ? 'spin' : ''} /></button>
                </div>
                <span className="small muted">{loading ? 'Getting today’s rate…' : s.rateNote || 'Rate source: Settings → Exchange rates.'}</span>
                {rate && usdVal ? <span className="small">{formatMoney(usdVal, 'USD')} = <b className="money">{formatMoney(Math.round((usdVal * rate) / 100), 'CRC')}</b></span> : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>, document.body)}
    </>
  );
}
