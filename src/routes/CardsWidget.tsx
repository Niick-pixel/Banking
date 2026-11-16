/** All credit cards together, as debt: total owed, each card, due dates, limit used. Pay or edit from here. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLedger } from '../app/data';
import { Glass, Pill } from '../design/components';
import { InfoTip } from '../design/components/InfoTip';
import { Sheet } from '../ui/Sheet';
import { cardsSummary, type CardStatus } from '../domain/cards';
import type { Account } from '../domain/schemas';
import { newId, saveAccount, saveTransaction } from '../db/repo';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

export function useCards() {
  const l = useLedger();
  return useMemo(() => cardsSummary(l.accounts, l.balances, l.snapshots, todayISO()), [l.accounts, l.balances, l.snapshots]);
}

const dueText = (c: CardStatus) => (c.daysToDue === undefined ? 'no due day set' : c.daysToDue === 0 ? 'due today' : c.daysToDue === 1 ? 'due tomorrow' : `due ${formatDateCR(c.nextDue!).slice(0, 5)} · in ${c.daysToDue} days`);

export function CardsWidget({ compact }: { compact?: boolean }) {
  const s = useCards();
  const [pay, setPay] = useState<CardStatus | null>(null);
  const [edit, setEdit] = useState<Account | null>(null);
  if (!s.cards.length) {
    return (
      <Glass strong pad={18} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 240 }}><b>Credit cards</b> <span className="muted">· none yet. Add them in Balance check-in to see what you owe on all of them together.</span></span>
        <Link className="btn btn-sm" to="/check-in">Add cards</Link>
      </Glass>
    );
  }
  const max = Math.max(1, ...s.cards.map((c) => c.owed));
  return (
    <Glass strong pad={compact ? 0 : 20} style={{ display: 'grid', gap: 12, background: compact ? 'transparent' : undefined, border: compact ? 0 : undefined, boxShadow: compact ? 'none' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="card-h" style={{ margin: 0 }}>Credit cards <InfoTip text="What you owe on all your cards together, from your last balance check-in plus anything logged on the cards since. Paying a card moves money from checking to the card: it lowers the debt and isn't counted as spending again (the purchases already were)." /></h2>
          <div className="money" style={{ fontSize: compact ? 24 : 30, fontWeight: 780, color: 'var(--debt)' }}>{formatMoney(s.totalOwed, 'CRC')}</div>
          <div className="small muted">owed on {s.cards.length} card{s.cards.length > 1 ? 's' : ''}{s.utilization !== undefined ? ` · ${Math.round(s.utilization * 100)}% of limits used` : ''}</div>
        </div>
        {s.nextDue && <Pill tone={s.nextDue.daysToDue! <= 3 ? 'expense' : 'debt'}>Next: {s.nextDue.account.name} {dueText(s.nextDue)}</Pill>}
      </div>
      <ul className="card-list">
        {s.cards.map((c) => (
          <li key={c.account.id}>
            <div className="card-row-top">
              <b>{c.account.name}</b>
              <b className="money">{formatMoney(c.owed, c.account.currency)}</b>
            </div>
            <div className="bar" aria-hidden><span style={{ width: `${(c.limit ? Math.min(1, c.utilization!) : c.owed / max) * 100}%`, background: c.utilization !== undefined && c.utilization > 0.7 ? 'var(--expense)' : 'var(--debt)' }} /></div>
            <div className="card-row-sub small">
              <span className="muted">{dueText(c)}{c.limit ? ` · ${Math.round(c.utilization! * 100)}% of ${formatMoney(c.limit, c.account.currency, { decimals: 0 })}` : ''}{c.lastCheckIn ? ` · checked ${formatDateCR(c.lastCheckIn).slice(0, 5)}` : ''}</span>
              {!compact && <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setEdit(c.account)}>Edit</button>
                <button className="btn btn-sm" disabled={c.owed <= 0} onClick={() => setPay(c)}>Pay</button>
              </span>}
            </div>
          </li>
        ))}
      </ul>
      {!compact && <p className="small muted" style={{ margin: 0 }}>Keep these right with a <Link to="/check-in">balance check-in</Link> each quincena.{s.totalLimit === 0 ? ' Add each card\'s credit limit (Edit) to see how much of it you use: banks look at that, and under 30% is healthy.' : ''}</p>}
      <Sheet open={!!pay} onClose={() => setPay(null)} title={pay ? `Pay ${pay.account.name}` : ''}>{pay && <PayCardForm card={pay} onDone={() => setPay(null)} />}</Sheet>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit ? `Edit ${edit.name}` : ''}>{edit && <EditCardForm card={edit} onDone={() => setEdit(null)} />}</Sheet>
    </Glass>
  );
}

function PayCardForm({ card, onDone }: { card: CardStatus; onDone: () => void }) {
  const l = useLedger();
  const sources = l.accounts.filter((a) => !a.archived && a.type !== 'credit_card' && a.currency === card.account.currency);
  const [from, setFrom] = useState(sources.find((a) => a.type === 'checking')?.id ?? sources[0]?.id ?? '');
  const [raw, setRaw] = useState(String(card.owed / 100));
  const [date, setDate] = useState(todayISO());
  const [err, setErr] = useState('');
  async function save() {
    const amount = parseAmountInput(raw, card.account.currency);
    if (!amount) return setErr('Enter an amount');
    if (!from) return setErr('Pick where the money comes from');
    const now = Date.now();
    await saveTransaction({ id: newId(), kind: 'transfer', date, dateEstimated: false, currency: card.account.currency, from: { accountId: from }, to: { accountId: card.account.id }, amount, description: `Payment to ${card.account.name}`, tags: ['card-payment'], notes: '', createdAt: now, updatedAt: now });
    onDone();
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <p className="muted small" style={{ margin: 0 }}>Owed now: <b className="money">{formatMoney(card.owed, card.account.currency)}</b></p>
      <div className="field"><label htmlFor="pc-a">Amount paid</label><input id="pc-a" data-autofocus className="input input-amount" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="pc-f">Paid from</label><select id="pc-f" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{sources.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="field"><label htmlFor="pc-d">Date</label><input id="pc-d" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>This moves money from {l.account.get(from)?.name ?? 'checking'} to the card: the card's debt goes down and it isn't counted as spending, because the purchases on the card already were (or will be, through the check-in).</p>
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Record payment</button></div>
    </form>
  );
}

function EditCardForm({ card, onDone }: { card: Account; onDone: () => void }) {
  const [a, setA] = useState(card);
  const [limit, setLimit] = useState(card.cardLimit ? String(card.cardLimit / 100) : '');
  const [rate, setRate] = useState(card.cardAnnualRateBps !== undefined ? String(card.cardAnnualRateBps / 100) : '');
  const [err, setErr] = useState('');
  const day = (v: string) => { const n = Number(v); return n >= 1 && n <= 31 ? n : undefined; };
  async function save() {
    const lim = limit.trim() ? parseAmountInput(limit, card.currency) : undefined;
    if (lim === null) return setErr("Can't read the limit");
    const r = rate.trim() ? Number(rate.replace(',', '.')) : undefined;
    if (r !== undefined && (Number.isNaN(r) || r < 0 || r > 200)) return setErr('The rate is a yearly percentage, e.g. 48');
    await saveAccount({ ...a, cardLimit: lim ?? undefined, cardAnnualRateBps: r === undefined ? undefined : Math.round(r * 100) });
    onDone();
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="ec-n">Name</label><input id="ec-n" data-autofocus className="input" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="ec-l">Credit limit</label><input id="ec-l" className="input" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="optional, e.g. 500k" /></div>
        <div className="field"><label htmlFor="ec-r">Interest, % a year</label><input id="ec-r" className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="optional, e.g. 48" /></div>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="ec-s">Statement closes on day</label><input id="ec-s" className="input" inputMode="numeric" value={a.cardStatementDay ?? ''} onChange={(e) => setA({ ...a, cardStatementDay: day(e.target.value) })} /></div>
        <div className="field"><label htmlFor="ec-d">Payment due on day</label><input id="ec-d" className="input" inputMode="numeric" value={a.cardDueDay ?? ''} onChange={(e) => setA({ ...a, cardDueDay: day(e.target.value) })} /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={a.archived} onChange={(e) => setA({ ...a, archived: e.target.checked })} /> Closed / archive this card</label>
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Save</button></div>
    </form>
  );
}
