/**
 * Balance check-in: every quincena, type what Banca en Línea shows for each card
 * and account. The app saves it as a statement balance and helps you make the
 * ledger match: log the gap as spending, or adjust the balance.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLedger } from '../app/data';
import { rateForDay } from '../app/fx';
import { Glass, Pill } from '../design/components';
import { PageHeader, Sheet } from '../ui/Sheet';
import { checkInStatus, quincenaStart, statementBalance } from '../domain/checkin';
import { accountBalances } from '../domain/ledger';
import { TransactionSchema, type Account } from '../domain/schemas';
import { newId, saveAccount, saveSnapshot, saveTransaction } from '../db/repo';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

type Fix = 'spend' | 'adjust' | 'leave';
interface Result { account: Account; statement: number; ledger: number; diff: number; fix: Fix; categoryId: string; done?: boolean }

export default function CheckIn() {
  const l = useLedger();
  const today = todayISO();
  const rows = useMemo(() => checkInStatus(l.accounts, l.snapshots, today), [l.accounts, l.snapshots, today]);
  const [main, setMain] = useState<Record<string, string>>({});
  const [usd, setUsd] = useState<Record<string, string>>({});
  const [rateRaw, setRateRaw] = useState('');
  const [rateNote, setRateNote] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [err, setErr] = useState('');
  const [addCard, setAddCard] = useState(false);
  const hasCards = rows.some((r) => r.account.type === 'credit_card');

  useEffect(() => {
    if (!hasCards) return;
    void rateForDay(today).then((q) => { if (q) { setRateRaw(String(q.rate / 100)); setRateNote(`${q.source} ${q.side} rate, ${formatDateCR(q.rateDate)}`); } }).catch(() => {});
  }, [hasCards, today]);

  const rate = parseAmountInput(rateRaw, 'CRC');
  const ledgerNow = useMemo(() => accountBalances(l.accounts, l.transactions, today), [l.accounts, l.transactions, today]);
  const spendCats = l.categories.filter((c) => !c.archived && ['Living', 'Discretionary', 'Fixed'].includes(c.group));
  const otherCat = spendCats.find((c) => /^other/i.test(c.name))?.id ?? spendCats[0]?.id ?? '';

  const preview = (a: Account) => {
    const m = parseAmountInput(main[a.id] ?? '', a.currency);
    const u = a.type === 'credit_card' && a.currency === 'CRC' ? parseAmountInput(usd[a.id] ?? '', 'USD') ?? 0 : 0;
    if (m === null && !u) return null;
    if (u && !rate) return null;
    return statementBalance(a, m ?? 0, u, rate);
  };

  async function save() {
    setErr('');
    const out: Result[] = [];
    for (const r of rows) {
      const stmt = preview(r.account);
      if (stmt === null) continue;
      const ledger = ledgerNow.get(r.account.id)?.total ?? 0;
      await saveSnapshot(r.account.id, today, stmt);
      const diff = stmt - ledger;
      out.push({ account: r.account, statement: stmt, ledger, diff, fix: diff < 0 && r.account.type === 'credit_card' ? 'spend' : 'adjust', categoryId: otherCat });
    }
    if (!out.length) return setErr('Type at least one balance.');
    setResults(out);
    setMain({}); setUsd({});
  }

  async function apply() {
    if (!results) return;
    const now = Date.now();
    for (const r of results) {
      if (r.done || r.diff === 0 || r.fix === 'leave') continue;
      const base = { id: newId(), date: today, dateEstimated: false, currency: r.account.currency, tags: ['check-in'], notes: '', createdAt: now, updatedAt: now };
      if (r.fix === 'spend' && r.diff < 0) {
        await saveTransaction(TransactionSchema.parse({ ...base, kind: 'expense', from: { accountId: r.account.id }, amount: -r.diff, categoryId: r.categoryId || undefined, description: 'Not logged yet (balance check-in)' }));
      } else {
        await saveTransaction(TransactionSchema.parse({ ...base, kind: 'adjustment', side: { accountId: r.account.id }, signedAmount: r.diff, reason: 'Balance check-in: match the bank', description: 'Balance check-in adjustment' }));
      }
    }
    setResults(results.map((r) => ({ ...r, done: true })));
  }

  const due = rows.filter((r) => r.due).length;
  return (
    <>
      <PageHeader title="Balance check-in" sub={`Every quincena, type what your bank shows. ${due ? `${due} to check this quincena (since ${formatDateCR(quincenaStart(today))}).` : 'All checked this quincena.'}`}>
        <button className="btn" onClick={() => setAddCard(true)}>+ Add a card</button>
      </PageHeader>
      {!rows.some((r) => r.account.type === 'credit_card') && (
        <Glass pad={18} style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 260 }}><b>No credit cards yet.</b> <span className="muted">Add each card (AMEX, Visa, Mastercard…) with what you owe today; from then on you just update it here every quincena.</span></span>
          <button className="btn btn-primary" onClick={() => setAddCard(true)}>+ Add a card</button>
        </Glass>
      )}
      <Sheet open={addCard} onClose={() => setAddCard(false)} title="Add a credit card">
        {addCard && <AddCardForm rate={rate} onDone={() => setAddCard(false)} />}
      </Sheet>

      {results && (
        <Glass strong pad={20} style={{ marginBottom: 16, display: 'grid', gap: 12 }} role="region" aria-label="Check-in results">
          <h2 style={{ margin: 0, fontSize: 18 }}>Saved. Here's how the app compares</h2>
          {results.map((r, i) => (
            <div key={r.account.id} className="checkin-result">
              <div><b>{r.account.name}</b><div className="small muted">Bank {formatMoney(r.statement, r.account.currency)} · app {formatMoney(r.ledger, r.account.currency)}</div></div>
              {r.diff === 0 ? <Pill tone="income">✓ matches</Pill> : r.done ? <Pill tone="neutral">{r.fix === 'leave' ? 'left as is' : 'fixed'}</Pill> : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Pill tone="debt">off by {formatMoney(r.diff, r.account.currency, { signed: true })}</Pill>
                  <select className="input" style={{ height: 38, width: 'auto' }} aria-label={`What to do about ${r.account.name}`} value={r.fix}
                    onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, fix: e.target.value as Fix } : x)))}>
                    {r.diff < 0 && <option value="spend">Log the gap as spending</option>}
                    <option value="adjust">Adjust the balance (not spending)</option>
                    <option value="leave">Leave it, I'll find the movements</option>
                  </select>
                  {r.fix === 'spend' && (
                    <select className="input" style={{ height: 38, width: 'auto' }} aria-label="Category" value={r.categoryId}
                      onChange={(e) => setResults(results.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))}>
                      {spendCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                </div>
              )}
            </div>
          ))}
          {results.some((r) => !r.done && r.diff !== 0) && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn" onClick={() => setResults(null)}>Done</button>
            <button className="btn btn-primary" onClick={() => void apply()}>Apply</button></div>}
          {results.every((r) => r.done || r.diff === 0) && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={() => setResults(null)}>Close</button></div>}
        </Glass>
      )}

      <Glass strong pad={20} style={{ display: 'grid', gap: 14 }}>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 14 }}>
          {hasCards && (
            <div className="field" style={{ maxWidth: 360 }}><label htmlFor="ci-rate">Dollar rate for card balances in USD</label>
              <input id="ci-rate" className="input" inputMode="decimal" value={rateRaw} onChange={(e) => { setRateRaw(e.target.value); setRateNote('typed by you'); }} placeholder="e.g. 505.20" />
              {rateNote && <span className="small muted">{rateNote}</span>}</div>
          )}
          <div className="checkin-grid" role="table" aria-label="Balances">
            <div className="checkin-head" role="row"><span role="columnheader">Account</span><span role="columnheader">In the app</span><span role="columnheader">Bank shows</span><span role="columnheader">Last check-in</span></div>
            {rows.map(({ account: a, last, due: isDue }) => {
              const card = a.type === 'credit_card';
              const p = preview(a);
              const ledger = ledgerNow.get(a.id)?.total ?? 0;
              return (
                <div key={a.id} className="checkin-row" role="row">
                  <div role="cell"><b>{a.name}</b><div className="small muted">{card ? 'Credit card · type what you owe' : a.type.replace('_', ' ')}</div></div>
                  <div role="cell" className="money">{formatMoney(ledger, a.currency)}</div>
                  <div role="cell" style={{ display: 'grid', gap: 6 }}>
                    <input className="input" inputMode="decimal" aria-label={`${a.name} balance in ${a.currency}`} placeholder={a.currency === 'CRC' ? '₡ e.g. 98,198.45' : '$'} value={main[a.id] ?? ''} onChange={(e) => setMain({ ...main, [a.id]: e.target.value })} />
                    {card && a.currency === 'CRC' && <input className="input" inputMode="decimal" aria-label={`${a.name} dollar part`} placeholder="+ $ part, e.g. 275.30" value={usd[a.id] ?? ''} onChange={(e) => setUsd({ ...usd, [a.id]: e.target.value })} />}
                    {p !== null && <span className="small">{p === ledger ? <Pill tone="income">✓ matches</Pill> : <span className="muted">Difference {formatMoney(p - ledger, a.currency, { signed: true })}</span>}</span>}
                  </div>
                  <div role="cell" className="small">{last ? <>{formatDateCR(last.date)}<div className="muted">{formatMoney(last.balance, a.currency)}</div></> : <span className="muted">Never</span>}
                    {isDue && <div><Pill tone="debt">due</Pill></div>}</div>
                </div>
              );
            })}
          </div>
          <p className="small muted" style={{ margin: 0 }}>Leave a box empty to skip that account. Cards: the colón and dollar parts are added together at the rate above, because your dollar purchases are already logged in colones.</p>
          {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Save check-in</button></div>
        </form>
      </Glass>
    </>
  );
}

/** A card account that starts today with what you owe now, so nothing before today needs fixing. */
function AddCardForm({ rate, onDone }: { rate: number | null; onDone: () => void }) {
  const [name, setName] = useState('');
  const [owedRaw, setOwedRaw] = useState('');
  const [usdRaw, setUsdRaw] = useState('');
  const [due, setDue] = useState('');
  const [stmt, setStmt] = useState('');
  const [err, setErr] = useState('');
  async function save() {
    const n = name.trim();
    if (!n) return setErr('Name the card, e.g. "BAC Visa ··2064"');
    const owed = owedRaw.trim() ? parseAmountInput(owedRaw, 'CRC') : 0;
    const usdPart = usdRaw.trim() ? parseAmountInput(usdRaw, 'USD') : 0;
    if (owed === null || usdPart === null) return setErr("Can't read an amount");
    if (usdPart && !rate) return setErr('Set the dollar rate on the check-in page first');
    const now = Date.now();
    const id = newId();
    const day = (v: string) => { const d = Number(v); return d >= 1 && d <= 31 ? d : undefined; };
    const account: Account = { id, name: n, institution: 'BAC Credomatic', type: 'credit_card', currency: 'CRC', openingBalance: 0, openingDate: todayISO(), isLiquid: false, archived: false, cardDueDay: day(due), cardStatementDay: day(stmt), createdAt: now, updatedAt: now };
    account.openingBalance = statementBalance(account, owed, usdPart, rate);
    await saveAccount(account);
    await saveSnapshot(id, todayISO(), account.openingBalance);
    onDone();
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="ac-n">Card</label><input id="ac-n" data-autofocus className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="BAC Visa ··2064" /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="ac-o">Owed in colones today</label><input id="ac-o" className="input" inputMode="decimal" value={owedRaw} onChange={(e) => setOwedRaw(e.target.value)} placeholder="98,198.45" /></div>
        <div className="field"><label htmlFor="ac-u">Owed in dollars</label><input id="ac-u" className="input" inputMode="decimal" value={usdRaw} onChange={(e) => setUsdRaw(e.target.value)} placeholder="275.30" /></div>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="ac-s">Statement closes on day</label><input id="ac-s" className="input" inputMode="numeric" value={stmt} onChange={(e) => setStmt(e.target.value)} placeholder="optional" /></div>
        <div className="field"><label htmlFor="ac-d">Payment due on day</label><input id="ac-d" className="input" inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value)} placeholder="optional, shows on the calendar" /></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>The card starts today with this balance. Expenses you log on it from now on raise it; payments lower it. The due day puts it on your calendar and in the bell a week ahead.</p>
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Add card</button></div>
    </form>
  );
}
