import { useMemo, useState } from 'react';
import { useLedger } from '../app/data';
import { places } from '../app/QuickAdd';
import { newId, saveTransaction } from '../db/repo';
import { debtStatus } from '../domain/ledger';
import { monthlyInterest } from '../domain/debts';
import type { Debt } from '../domain/schemas';
import { formatMoney, parseAmountInput } from '../lib/money';
import { todayISO } from '../lib/dates';

/**
 * One action: paying a debt from a pot (e.g. her loan fund) takes the money out of
 * the pot AND lowers the debt. It's a single record, so it's counted once.
 */
export function PayDebtForm({ debt, defaultAmount, onDone }: { debt: Debt; defaultAmount?: number; onDone: () => void }) {
  const l = useLedger();
  const plc = useMemo(() => places(l), [l]);
  const st = debtStatus(debt, l.transactions);
  const fundKey = debt.fundPotId ? `${l.pot.get(debt.fundPotId)?.accountId}|${debt.fundPotId}` : '';
  const fundBal = debt.fundPotId ? l.balances.get(l.pot.get(debt.fundPotId)?.accountId ?? '')?.pots.get(debt.fundPotId) ?? 0 : 0;
  const spending = plc.find((p) => !p.savings)?.key ?? '';
  const [from, setFrom] = useState(fundKey && fundBal > 0 ? fundKey : spending);
  const initial = defaultAmount ?? Math.min(debt.plannedMonthlyPayment ?? st.balance, st.balance);
  const [raw, setRaw] = useState(String(initial / 100));
  const amount = parseAmountInput(raw, 'CRC');
  const suggestedInterest = debt.annualRateBps ? Math.min(monthlyInterest(st.balance, debt.annualRateBps), amount ?? 0) : 0;
  const [interestRaw, setInterestRaw] = useState('');
  const interest = interestRaw === '' ? suggestedInterest : parseAmountInput(interestRaw, 'CRC') ?? 0;
  const debtCats = l.categories.filter((c) => c.group === 'Debt Service');
  const [categoryId, setCategoryId] = useState(debt.categoryId ?? debtCats.find((c) => /loan|préstamo/i.test(c.name))?.id ?? debtCats[0]?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const [err, setErr] = useState('');
  const fromPot = from.split('|')[1];
  const potBal = fromPot ? l.balances.get(from.split('|')[0]!)?.pots.get(fromPot) ?? 0 : null;

  async function save() {
    if (!amount) return setErr('Enter an amount');
    if (!categoryId) return setErr('Pick a Debt Service category');
    if (interest > amount) return setErr('Interest can’t exceed the payment');
    const [accountId, potId] = from.split('|');
    const now = Date.now();
    try {
      await saveTransaction({
        id: newId(), kind: 'debt_payment', date, dateEstimated: false, currency: 'CRC', from: potId ? { accountId: accountId!, potId } : { accountId: accountId! },
        amount, debtId: debt.id, categoryId, interestPortion: interest, description: `Payment to ${debt.creditor}`, tags: [], notes: '', createdAt: now, updatedAt: now,
      });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <p className="muted small" style={{ margin: 0 }}>Still owed: <b className="money">{formatMoney(st.balance, 'CRC')}</b></p>
      <div className="field"><label htmlFor="pd-amt">Amount paid</label><input id="pd-amt" data-autofocus className="input input-amount" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="pd-from">Paid from</label>
          <select id="pd-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{plc.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
        <div className="field"><label htmlFor="pd-date">Date</label><input id="pd-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      {potBal !== null && amount !== null && amount > potBal && <p role="alert" style={{ margin: 0, color: 'var(--debt)' }}>The pot only has {formatMoney(potBal, 'CRC')}. It will go negative.</p>}
      {debt.annualRateBps > 0 && (
        <div className="field"><label htmlFor="pd-int">Of which interest</label>
          <input id="pd-int" className="input" inputMode="decimal" placeholder={formatMoney(suggestedInterest, 'CRC')} value={interestRaw} onChange={(e) => setInterestRaw(e.target.value)} />
          <span className="small muted">Suggested: one month at {(debt.annualRateBps / 100).toFixed(2)}% a year on the balance. Only the rest lowers the debt.</span></div>
      )}
      <div className="field"><label htmlFor="pd-cat">Category</label>
        <select id="pd-cat" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Choose…</option>{debtCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      {fromPot && <p className="small muted" style={{ margin: 0 }}>Paying from a pot: the money leaves the pot and the debt drops in one step. It shows as debt service once, and your free cash isn't hit again (it was counted when you set it aside).</p>}
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Record payment</button></div>
    </form>
  );
}
