import { useMemo, useState } from 'react';
import { useLedger } from '../app/data';
import { Glass, Money, Pill } from '../design/components';
import { PageHeader, Sheet } from '../ui/Sheet';
import { CardsWidget, useCards } from './CardsWidget';
import { InfoTip } from '../design/components/InfoTip';
import { debtStatus } from '../domain/ledger';
import { accelerate, amortize, debtServiceRatio, nextPaymentDate, payoffStrategy, scenarios, selfLoanProgress } from '../domain/debts';
import { commitmentForMonth } from '../domain/installments';
import { budgetFor } from '../domain/tracker';
import { newId, saveDebt, saveSelfLoan } from '../db/repo';
import type { Debt, SelfLoan } from '../domain/schemas';
import { formatMoney, parseAmountInput } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';
import { PayDebtForm } from './PayDebt';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const dateOrDash = (d?: string) => (d ? formatDateCR(d) : '—');

export function useAvgIncome() {
  const l = useLedger();
  return useMemo(() => {
    const months = [...l.flows.values()].filter((f) => f.income > 0);
    return months.length ? Math.round(months.reduce((s, f) => s + f.income, 0) / months.length) : 0;
  }, [l.flows]);
}

type SheetState = { kind: 'pay'; debt: Debt } | { kind: 'edit'; debt?: Debt } | { kind: 'confirm'; debt: Debt } | { kind: 'adjust'; debt: Debt; gap: number } | { kind: 'loan'; loan?: SelfLoan } | null;

export default function Debts() {
  const l = useLedger();
  const today = todayISO();
  const avgIncome = useAvgIncome();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [budgetRaw, setBudgetRaw] = useState('');

  const cards = useCards();
  const active = l.debts.filter((d) => d.status !== 'paid');
  const status = new Map(l.debts.map((d) => [d.id, debtStatus(d, l.transactions)]));
  const totalOwed = active.reduce((s, d) => s + Math.max(0, status.get(d.id)!.balance), 0);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const cuotas = commitmentForMonth(l.installments, y, m);
  const planned = active.reduce((s, d) => s + (status.get(d.id)!.balance > 0 ? d.plannedMonthlyPayment ?? 0 : 0), 0);
  const rentCat = l.categories.find((c) => /rent|alquiler/i.test(c.name));
  const rent = rentCat ? budgetFor(l.budgets, rentCat.id, today.slice(0, 7)) : 0;
  const dsti = debtServiceRatio(planned + cuotas, rent, avgIncome);
  const payoffs = active.map((d) => {
    const st = status.get(d.id)!;
    return d.plannedMonthlyPayment && st.balance > 0 ? amortize(st.balance, d.annualRateBps, d.plannedMonthlyPayment, nextPaymentDate(d, today)) : null;
  });
  const debtFreeBy = payoffs.every((p) => !p || !p.never) ? payoffs.map((p) => p?.payoffDate).filter(Boolean).sort().at(-1) : undefined;
  const loans = selfLoanProgress(l.selfLoans ?? [], l.transactions, l.categories);
  // Cards join the plan with their rate (if set) and an estimated minimum payment: 5% of the balance, at least ₡10,000.
  const cardMin = (owed: number) => Math.min(owed, Math.max(Math.round(owed * 0.05), 1_000_000));
  const cardDebts = cards.cards.filter((c) => c.owed > 0 && c.account.currency === 'CRC').map((c) => ({ id: c.account.id, balance: c.owed, annualRateBps: c.account.cardAnnualRateBps ?? 0, minPayment: cardMin(c.owed) }));
  const strategyDebts = [...active.filter((d) => status.get(d.id)!.balance > 0).map((d) => ({ id: d.id, balance: status.get(d.id)!.balance, annualRateBps: d.annualRateBps, minPayment: d.plannedMonthlyPayment ?? 0 })), ...cardDebts];
  const nameOf = (id: string) => l.debts.find((d) => d.id === id)?.creditor ?? l.account.get(id)?.name ?? '';
  const stratBudget = parseAmountInput(budgetRaw, 'CRC') ?? planned + cardDebts.reduce((s, c) => s + c.minPayment, 0);

  return (
    <>
      <PageHeader title="Debts" sub="Loans and credit cards. Balances follow your payments and check-ins.">
        <button className="btn" onClick={() => setSheet({ kind: 'loan' })}>+ Self-loan</button>
        <button className="btn btn-primary" onClick={() => setSheet({ kind: 'edit' })}>+ Debt</button>
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Glass pad={16}><div className="small muted">Total owed <InfoTip text="Your loans plus everything owed on your credit cards." /></div><Money amount={totalOwed + cards.totalOwed} size={26} weight={750} tone="debt" />
          {cards.totalOwed > 0 && <div className="small muted">{formatMoney(totalOwed, 'CRC')} loans + {formatMoney(cards.totalOwed, 'CRC')} cards</div>}</Glass>
        <Glass pad={16}><div className="small muted">Monthly debt service</div><Money amount={planned + cuotas} size={26} weight={750} />
          <div className="small muted">{formatMoney(planned, 'CRC')} planned{cuotas ? ` + ${formatMoney(cuotas, 'CRC')} Tasa Cero` : ''}</div></Glass>
        <Glass pad={16}><div className="small muted">Of your income</div>
          <div style={{ fontSize: 26, fontWeight: 750 }} className="money">{avgIncome ? pct(dsti.ratio) : '—'}</div>
          {avgIncome > 0 && <div className="small"><Pill tone={dsti.level === 'high' ? 'expense' : dsti.level === 'warn' ? 'debt' : 'income'}>{dsti.level === 'ok' ? 'Healthy' : dsti.level === 'warn' ? 'Above 20%' : 'Above 36% with rent'}</Pill> <span className="muted">{pct(dsti.withRent)} incl. rent</span></div>}</Glass>
        <Glass pad={16}><div className="small muted">Debt-free by</div><div style={{ fontSize: 26, fontWeight: 750 }}>{totalOwed === 0 ? 'Now 🎉' : dateOrDash(debtFreeBy)}</div>
          {totalOwed > 0 && !debtFreeBy && <div className="small muted">Set a monthly payment on each debt</div>}</Glass>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <CardsWidget />
        {active.map((d, i) => <DebtCard key={d.id} debt={d} payoff={payoffs[i] ?? null} avgIncome={avgIncome} onSheet={setSheet} />)}
        {active.length === 0 && <Glass><p className="muted" style={{ margin: 0 }}>No active debts.</p></Glass>}

        {strategyDebts.length >= 2 && (
          <Glass strong style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Several debts: which first?</h2>
            <div className="field" style={{ maxWidth: 280 }}><label htmlFor="st-b">Total I can pay per month</label>
              <input id="st-b" className="input" inputMode="decimal" placeholder={formatMoney(planned, 'CRC')} value={budgetRaw} onChange={(e) => setBudgetRaw(e.target.value)} /></div>
            <table className="table"><thead><tr><th>Strategy</th><th>Pays first</th><th className="num">Months</th><th className="num">Total interest</th></tr></thead>
              <tbody>{(['avalanche', 'snowball'] as const).map((k) => { const r = payoffStrategy(strategyDebts, stratBudget, k); return (
                <tr key={k}><td>{k === 'avalanche' ? 'Avalanche (highest rate first)' : 'Snowball (smallest balance first)'}</td>
                  <td>{nameOf(r.order[0] ?? '')}</td>
                  <td className="num">{r.never ? 'never' : r.months}</td><td className="num">{r.never ? '—' : formatMoney(r.totalInterest, 'CRC')}</td></tr>); })}</tbody></table>
            <p className="small muted" style={{ margin: 0 }}>Avalanche always costs the least interest. Snowball clears a debt sooner, which some people find motivating.{cardDebts.length ? ` Credit cards are included with an estimated minimum payment (5% of the balance, at least ₡10,000)${cards.cards.some((c) => c.owed > 0 && c.account.cardAnnualRateBps === undefined) ? '; add each card\'s interest rate (Edit on the card) for a real comparison' : ''}.` : ''}</p>
          </Glass>
        )}

        <Glass strong style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Self-loans to replenish</h2>
          <p className="small muted" style={{ margin: 0 }}>Money borrowed from your own savings. Not counted as debt in net worth, because the savings balance already shows it's gone. Deposits in a "Replenish" savings category count toward the oldest open loan first.</p>
          {loans.length === 0 ? <p className="muted" style={{ margin: 0 }}>None.</p> : (
            <table className="table"><thead><tr><th>What</th><th className="num">Borrowed</th><th className="num">Put back</th><th className="num">To replenish</th><th>Plan</th><th /></tr></thead>
              <tbody>{loans.map((p) => (
                <tr key={p.loan.id}>
                  <td>{p.loan.description}{p.loan.borrowedOn && <div className="small muted">{formatDateCR(p.loan.borrowedOn)}</div>}</td>
                  <td className="num">{formatMoney(p.loan.amount, 'CRC')}</td><td className="num">{formatMoney(p.putBack, 'CRC')}</td>
                  <td className="num">{p.done ? <Pill tone="income">✓ Replenished</Pill> : <b className="money">{formatMoney(p.remaining, 'CRC')}</b>}</td>
                  <td className="small">{p.loan.plannedSource}{p.loan.plannedDate && ` · ${formatDateCR(p.loan.plannedDate)}`}</td>
                  <td><button className="btn btn-sm" onClick={() => setSheet({ kind: 'loan', loan: p.loan })}>Edit</button></td>
                </tr>))}</tbody></table>
          )}
        </Glass>

        {l.debts.some((d) => d.status === 'paid') && (
          <Glass><b>Paid off</b><ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{l.debts.filter((d) => d.status === 'paid').map((d) => <li key={d.id}>{d.creditor} · {formatMoney(d.originalAmount, 'CRC')}</li>)}</ul></Glass>
        )}
      </div>

      <Sheet open={!!sheet} onClose={() => setSheet(null)} title={!sheet ? '' : sheet.kind === 'pay' ? `Pay ${sheet.debt.creditor}` : sheet.kind === 'edit' ? (sheet.debt ? 'Edit debt' : 'New debt') : sheet.kind === 'confirm' ? 'Confirm balance' : sheet.kind === 'adjust' ? 'Adjust balance' : sheet.loan ? 'Edit self-loan' : 'New self-loan'}>
        {sheet?.kind === 'pay' && <PayDebtForm debt={sheet.debt} onDone={() => setSheet(null)} />}
        {sheet?.kind === 'edit' && <DebtForm debt={sheet.debt} onDone={() => setSheet(null)} />}
        {sheet?.kind === 'confirm' && <ConfirmForm debt={sheet.debt} onDone={() => setSheet(null)} />}
        {sheet?.kind === 'adjust' && <AdjustForm debt={sheet.debt} gap={sheet.gap} onDone={() => setSheet(null)} />}
        {sheet?.kind === 'loan' && <SelfLoanForm loan={sheet.loan} onDone={() => setSheet(null)} />}
      </Sheet>
    </>
  );
}

function DebtCard({ debt, payoff, avgIncome, onSheet }: { debt: Debt; payoff: ReturnType<typeof amortize> | null; avgIncome: number; onSheet: (s: SheetState) => void }) {
  const l = useLedger();
  const today = todayISO();
  const st = debtStatus(debt, l.transactions);
  const [showScen, setShowScen] = useState(false);
  const [extraRaw, setExtraRaw] = useState('');
  const extra = parseAmountInput(extraRaw, 'CRC');
  const first = nextPaymentDate(debt, today);
  const acc = extra && debt.plannedMonthlyPayment && st.balance > 0 ? accelerate(st.balance, debt.annualRateBps, debt.plannedMonthlyPayment, extra, first) : null;
  const done = Math.max(0, Math.min(1, 1 - st.balance / debt.originalAmount));
  const fund = debt.fundPotId ? l.pot.get(debt.fundPotId) : undefined;
  const fundBal = fund ? l.balances.get(fund.accountId)?.pots.get(fund.id) ?? 0 : 0;
  const ck = debt.checklist ?? {};
  const toggle = (k: 'writtenAgreement' | 'transferOnly') => void saveDebt({ ...debt, checklist: { ...ck, [k]: !ck[k] } });

  return (
    <Glass strong style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 750, fontSize: 18 }}>{debt.creditor}</div>
          <div className="small muted">{{ family: 'Family', bank: 'Bank', credit_card: 'Credit card', financing: 'Financing' }[debt.kind]} · {(debt.annualRateBps / 100).toFixed(2)}% a year{debt.annualRateBps === 0 && ' (no interest)'} · original {formatMoney(debt.originalAmount, 'CRC')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => onSheet({ kind: 'pay', debt })}>Record payment</button>
          <button className="btn btn-sm" onClick={() => onSheet({ kind: 'confirm', debt })}>Confirm balance</button>
          <button className="btn btn-sm btn-ghost" onClick={() => onSheet({ kind: 'edit', debt })}>Edit</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <Money amount={st.balance} size={34} weight={800} tone="debt" />
        <span className="muted small">still owed · {Math.round(done * 100)}% paid</span>
      </div>
      <div className="bar" role="img" aria-label={`${Math.round(done * 100)}% paid`}><span style={{ width: `${done * 100}%`, background: 'var(--debt)' }} /></div>

      {st.gapVsConfirmed !== 0 && debt.confirmedBalance && (
        <div className="glass" style={{ padding: 14, borderColor: 'var(--debt)', display: 'grid', gap: 8 }}>
          <span>You confirmed <b>{formatMoney(debt.confirmedBalance.amount, 'CRC')}</b> on {formatDateCR(debt.confirmedBalance.date)}, but the ledger says <b>{formatMoney(debt.confirmedBalance.amount - st.gapVsConfirmed, 'CRC')}</b>. {formatMoney(Math.abs(st.gapVsConfirmed), 'CRC')} {st.gapVsConfirmed < 0 ? 'of payments is missing' : 'more is owed than the ledger shows'}.</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => onSheet({ kind: 'pay', debt })}>Log the missing payment</button>
            <button className="btn btn-sm" onClick={() => onSheet({ kind: 'adjust', debt, gap: st.gapVsConfirmed })}>It was paid before tracking (no money moved now)</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }} className="small">
        <div><div className="muted">Monthly payment</div><b className="money">{debt.plannedMonthlyPayment ? formatMoney(debt.plannedMonthlyPayment, 'CRC') : 'not set'}</b></div>
        <div><div className="muted">Next payment</div><b>{formatDateCR(first)}</b></div>
        <div><div className="muted">Months left</div><b>{!payoff ? '—' : payoff.never ? 'never: payment ≤ interest' : payoff.months}</b></div>
        <div><div className="muted">Paid off on</div><b>{dateOrDash(payoff?.payoffDate)}</b></div>
        <div><div className="muted">Interest still to pay</div><b className="money">{payoff && !payoff.never ? formatMoney(payoff.totalInterest, 'CRC') : '—'}</b></div>
        {fund && <div><div className="muted">Set aside in {fund.name}</div><b className="money" style={{ color: `var(--${fund.owner})` }}>{formatMoney(fundBal, 'CRC')}</b></div>}
      </div>

      {st.balance > 0 && (
        <details open={showScen} onToggle={(e) => setShowScen((e.target as HTMLDetailsElement).open)}>
          <summary style={{ cursor: 'pointer', fontWeight: 650 }}>How fast can I pay it off? (scenarios & extra payments)</summary>
          <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>Term</th><th className="num">Monthly</th><th className="num">Total repaid</th><th className="num">Interest</th><th className="num">% of income</th><th>Verdict</th></tr></thead>
                <tbody>{scenarios(st.balance, debt.annualRateBps, avgIncome, first).map((s) => (
                  <tr key={s.months}><td>{s.months} months</td><td className="num">{formatMoney(s.payment, 'CRC')}</td><td className="num">{formatMoney(s.totalRepaid, 'CRC')}</td><td className="num">{formatMoney(s.interest, 'CRC')}</td>
                    <td className="num">{avgIncome ? pct(s.pctOfIncome) : '—'}</td><td>{avgIncome ? <Pill tone={s.verdict === 'Too tight' ? 'expense' : s.verdict === 'Aggressive' ? 'debt' : 'income'}>{s.verdict}</Pill> : '—'}</td></tr>))}</tbody>
              </table>
            </div>
            {debt.plannedMonthlyPayment ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
                <div className="field" style={{ width: 200 }}><label htmlFor={`x-${debt.id}`}>Extra per month</label><input id={`x-${debt.id}`} className="input" inputMode="decimal" placeholder="e.g. 20k" value={extraRaw} onChange={(e) => setExtraRaw(e.target.value)} /></div>
                {acc && !acc.faster.never && <p style={{ margin: 0 }}>Paying {formatMoney(debt.plannedMonthlyPayment + extra!, 'CRC')} a month clears it by <b>{dateOrDash(acc.faster.payoffDate)}</b>: <b>{acc.monthsSaved}</b> month(s) sooner{acc.interestSaved > 0 && <>, saving <b className="money">{formatMoney(acc.interestSaved, 'CRC')}</b> in interest</>}.</p>}
              </div>
            ) : <p className="small muted" style={{ margin: 0 }}>Set a monthly payment (Edit) to use the accelerator.</p>}
          </div>
        </details>
      )}

      {debt.kind === 'family' && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }} className="small" role="group" aria-label="Family loan checklist">
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!ck.writtenAgreement} onChange={() => toggle('writtenAgreement')} /> Written agreement</label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!ck.transferOnly} onChange={() => toggle('transferOnly')} /> Pay only by transfer (leaves a record)</label>
          <span>{ck.fixedPaymentDay ? `✓ Fixed payment day: ${ck.fixedPaymentDay}` : <span className="muted">No fixed payment day (set it in Edit)</span>}</span>
        </div>
      )}
    </Glass>
  );
}

function DebtForm({ debt, onDone }: { debt?: Debt; onDone: () => void }) {
  const l = useLedger();
  const now = Date.now();
  const [d, setD] = useState<Debt>(debt ?? { id: newId(), creditor: '', kind: 'family', currency: 'CRC', originalAmount: 0, annualRateBps: 0, startDate: todayISO(), status: 'active', checklist: {}, notes: '', adjustments: [], createdAt: now, updatedAt: now });
  const [orig, setOrig] = useState(d.originalAmount ? String(d.originalAmount / 100) : '');
  const [rate, setRate] = useState(String(d.annualRateBps / 100));
  const [pay, setPay] = useState(d.plannedMonthlyPayment ? String(d.plannedMonthlyPayment / 100) : '');
  const [err, setErr] = useState('');
  async function save() {
    const o = parseAmountInput(orig, 'CRC');
    if (!o) return setErr('Enter the original amount');
    const r = Number(rate.replace(',', '.'));
    if (!Number.isFinite(r) || r < 0) return setErr('Rate must be a number like 8 or 0');
    const p = pay.trim() ? parseAmountInput(pay, 'CRC') : undefined;
    if (p === null) return setErr('Can’t read the monthly payment');
    try { await saveDebt({ ...d, originalAmount: o, annualRateBps: Math.round(r * 100), plannedMonthlyPayment: p ?? undefined }); onDone(); } catch (e) { setErr(String(e)); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="df-c">Owed to</label><input id="df-c" className="input" required value={d.creditor} onChange={(e) => setD({ ...d, creditor: e.target.value })} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="df-k">Kind</label><select id="df-k" className="input" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Debt['kind'] })}><option value="family">Family / friend</option><option value="bank">Bank loan</option><option value="credit_card">Credit card</option><option value="financing">Store financing</option></select></div>
        <div className="field"><label htmlFor="df-s">Started</label><input id="df-s" className="input" type="date" value={d.startDate} onChange={(e) => setD({ ...d, startDate: e.target.value })} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="df-o">Original amount</label><input id="df-o" className="input" inputMode="decimal" value={orig} onChange={(e) => setOrig(e.target.value)} /></div>
        <div className="field"><label htmlFor="df-r">Annual rate %</label><input id="df-r" className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="df-p">Planned monthly payment</label><input id="df-p" className="input" inputMode="decimal" value={pay} onChange={(e) => setPay(e.target.value)} /></div>
        <div className="field"><label htmlFor="df-day">Fixed payment day</label><input id="df-day" className="input" type="number" min={1} max={31} value={d.checklist?.fixedPaymentDay ?? ''} onChange={(e) => setD({ ...d, checklist: { ...d.checklist, fixedPaymentDay: e.target.value ? Number(e.target.value) : undefined } })} /></div>
      </div>
      <div className="field"><label htmlFor="df-f">Money set aside for it in</label>
        <select id="df-f" className="input" value={d.fundPotId ?? ''} onChange={(e) => setD({ ...d, fundPotId: e.target.value || undefined })}><option value="">No fund</option>{l.pots.map((p) => <option key={p.id} value={p.id}>{l.account.get(p.accountId)?.name} · {p.name}</option>)}</select></div>
      <div className="field"><label htmlFor="df-cat">Payment category</label>
        <select id="df-cat" className="input" value={d.categoryId ?? ''} onChange={(e) => setD({ ...d, categoryId: e.target.value || undefined })}><option value="">Default</option>{l.categories.filter((c) => c.group === 'Debt Service').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={d.status === 'paid'} onChange={(e) => setD({ ...d, status: e.target.checked ? 'paid' : 'active' })} /> Paid off (hide from active debts)</label>
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Save</button></div>
    </form>
  );
}

function ConfirmForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const [raw, setRaw] = useState(debt.confirmedBalance ? String(debt.confirmedBalance.amount / 100) : '');
  const [date, setDate] = useState(todayISO());
  return (
    <form onSubmit={(e) => { e.preventDefault(); const a = parseAmountInput(raw, 'CRC'); if (a !== null) void saveDebt({ ...debt, confirmedBalance: { date, amount: a } }).then(onDone); }} style={{ display: 'grid', gap: 12 }}>
      <p className="small muted" style={{ margin: 0 }}>What does {debt.creditor} (or the statement) say you owe? The app compares this with your logged payments and flags any gap.</p>
      <div className="grid2">
        <div className="field"><label htmlFor="cf-a">Balance owed</label><input id="cf-a" data-autofocus className="input" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} /></div>
        <div className="field"><label htmlFor="cf-d">As of</label><input id="cf-d" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Confirm</button></div>
    </form>
  );
}

function AdjustForm({ debt, gap, onDone }: { debt: Debt; gap: number; onDone: () => void }) {
  const [note, setNote] = useState('Paid before tracking started');
  const amount = -gap; // positive reduces the debt
  return (
    <form onSubmit={(e) => { e.preventDefault(); void saveDebt({ ...debt, adjustments: [...(debt.adjustments ?? []), { id: newId(), date: debt.confirmedBalance?.date ?? todayISO(), amount, note }] }).then(onDone); }} style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0 }}>This {amount > 0 ? 'lowers' : 'raises'} the debt by <b>{formatMoney(Math.abs(amount), 'CRC')}</b> without touching any account, income or expenses. Use it only for payments made before you started tracking, or for amounts that were forgiven or added.</p>
      <div className="field"><label htmlFor="ad-n">Reason</label><input id="ad-n" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Adjust</button></div>
    </form>
  );
}

function SelfLoanForm({ loan, onDone }: { loan?: SelfLoan; onDone: () => void }) {
  const l = useLedger();
  const now = Date.now();
  const [s, setS] = useState<SelfLoan>(loan ?? { id: newId(), description: '', currency: 'CRC', amount: 0, plannedSource: '', status: 'open', notes: '', createdAt: now, updatedAt: now });
  const [raw, setRaw] = useState(s.amount ? String(s.amount / 100) : '');
  const [err, setErr] = useState('');
  async function save() {
    const a = parseAmountInput(raw, 'CRC');
    if (!a) return setErr('Enter how much you took');
    try { await saveSelfLoan({ ...s, amount: a }); onDone(); } catch (e) { setErr(String(e)); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="sl-d">What was it for?</label><input id="sl-d" data-autofocus className="input" required value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="sl-a">Amount taken</label><input id="sl-a" className="input" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} /></div>
        <div className="field"><label htmlFor="sl-b">Taken on</label><input id="sl-b" className="input" type="date" value={s.borrowedOn ?? ''} onChange={(e) => setS({ ...s, borrowedOn: e.target.value || undefined })} /></div>
      </div>
      <div className="field"><label htmlFor="sl-f">From account</label><select id="sl-f" className="input" value={s.fromAccountId ?? ''} onChange={(e) => setS({ ...s, fromAccountId: e.target.value || undefined })}><option value="">—</option>{l.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <div className="grid2">
        <div className="field"><label htmlFor="sl-p">Planned source</label><input id="sl-p" className="input" placeholder="Quinquenio, aguinaldo…" value={s.plannedSource} onChange={(e) => setS({ ...s, plannedSource: e.target.value })} /></div>
        <div className="field"><label htmlFor="sl-pd">Planned date</label><input id="sl-pd" className="input" type="date" value={s.plannedDate ?? ''} onChange={(e) => setS({ ...s, plannedDate: e.target.value || undefined })} /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={s.status === 'replenished'} onChange={(e) => setS({ ...s, status: e.target.checked ? 'replenished' : 'open' })} /> Already put back in full</label>
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Save</button></div>
    </form>
  );
}
