/**
 * Activity → a slim strip of Tasa Cero plans still running. A plan isn't one movement:
 * each cuota appears in the list as a card expense on the day it's charged, so before
 * the first cuota this strip is the only place you see the purchase.
 */
import { Link } from 'react-router-dom';
import { useLedger } from '../app/data';
import { planProgress } from '../domain/installments';
import { formatMoney } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

export function TasaCeroStrip() {
  const l = useLedger();
  const today = todayISO();
  const plans = l.installments.filter((p) => p.status === 'active').map((p) => ({ p, g: planProgress(p, today) })).filter((x) => x.g.pending > 0)
    .sort((a, b) => (a.g.nextDate ?? '').localeCompare(b.g.nextDate ?? ''));
  if (!plans.length) return null;
  const pending = plans.reduce((s, x) => s + x.g.pending, 0);
  return (
    <div className="tc-strip" role="region" aria-label="Tasa Cero plans">
      <span className="tc-head"><b>Tasa Cero</b> <span className="small faint">{formatMoney(pending, 'CRC')} still to be charged · each cuota appears here as a card expense on its date</span></span>
      <div className="tc-plans">
        {plans.slice(0, 4).map(({ p, g }) => (
          <Link key={p.id} to="/tasa-cero" className="tc-plan" title="Open the plan">
            <b>{p.description}</b>
            <span className="small faint">{l.account.get(p.cardAccountId)?.name ?? 'Card'} · {g.billedCount}/{p.months} charged</span>
            <span className="small">{g.billedCount === 0 ? '1st' : 'Next'} cuota <b className="money">{formatMoney(g.nextAmount ?? 0, 'CRC')}</b> on {g.nextDate ? formatDateCR(g.nextDate).slice(0, 5) : '—'}</span>
          </Link>
        ))}
        {plans.length > 4 && <Link to="/tasa-cero" className="tc-plan tc-more">+{plans.length - 4} more</Link>}
      </div>
    </div>
  );
}
