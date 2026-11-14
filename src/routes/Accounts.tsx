import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLedger } from '../app/data';
import { Glass, Money, Pill } from '../design/components';
import { PageHeader, Sheet } from '../ui/Sheet';
import { ACCOUNT_TYPES, type Account, type Pot } from '../domain/schemas';
import { accountBalances, debtStatus } from '../domain/ledger';
import { newId, saveAccount, saveCategory, savePot } from '../db/repo';
import { DEFAULT_CATEGORIES } from '../domain/defaults';
import { formatDateCR, todayISO } from '../lib/dates';
import { formatMoney, parseAmountInput } from '../lib/money';

const TYPE_LABEL: Record<Account['type'], string> = {
  checking: 'Checking', savings: 'Savings', goal_savings: 'Goal savings', cash: 'Cash', credit_card: 'Credit card',
  association_voluntary: 'Association savings plan', association_cesantia: 'Cesantía reserve', investment: 'Investments', loan_fund: 'Loan fund',
};
const GROUPS: [string, Account['type'][]][] = [
  ['Everyday', ['checking', 'cash']], ['Savings', ['savings', 'goal_savings', 'loan_fund']],
  ['Asociación Solidarista', ['association_voluntary', 'association_cesantia']], ['Credit cards', ['credit_card']], ['Investments', ['investment']],
];

export function StartFresh() {
  async function go() {
    const now = Date.now();
    let i = 0;
    for (const [name, group, disc] of DEFAULT_CATEGORIES) {
      await saveCategory({ id: newId(), name, group, discretionary: !!disc, sortOrder: i++, archived: false, createdAt: now, updatedAt: now });
    }
    await saveAccount({ id: newId(), name: 'BAC Colones (checking)', institution: 'BAC Credomatic', type: 'checking', currency: 'CRC', openingBalance: 0, openingDate: todayISO(), isLiquid: true, archived: false, createdAt: now, updatedAt: now });
  }
  return <button className="btn" onClick={() => void go()}>Start fresh</button>;
}

export default function Accounts() {
  const l = useLedger();
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const [potFor, setPotFor] = useState<Account | null>(null);

  const health: { level: 'warn' | 'info'; msg: string }[] = [];
  for (const d of l.debts) {
    const s = debtStatus(d, l.transactions);
    if (s.gapVsConfirmed) health.push({ level: 'warn', msg: `${d.creditor}: the ledger says ${formatMoney(s.balance + 0, 'CRC')} is owed, but you confirmed ${formatMoney(d.confirmedBalance!.amount, 'CRC')} on ${formatDateCR(d.confirmedBalance!.date)}. Difference ${formatMoney(s.gapVsConfirmed, 'CRC')}: log the missing payment, or correct the confirmed balance.` });
  }
  for (const p of l.pots) {
    const b = l.balances.get(p.accountId)?.pots.get(p.id) ?? 0;
    if (b < 0) health.push({ level: 'warn', msg: `Pot "${p.name}" is negative (${formatMoney(b, 'CRC')}).` });
  }

  return (
    <>
      <PageHeader title="Accounts" sub="Balances are derived from your movements. Statements are checked against them.">
        <button className="btn btn-primary" onClick={() => setEdit('new')}>+ Account</button>
      </PageHeader>

      {health.length > 0 && (
        <Glass strong pad={18} style={{ marginBottom: 18, borderColor: 'var(--debt)' }} role="region" aria-label="Data health">
          <b style={{ color: 'var(--debt)' }}>Needs attention ({health.length})</b>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 6 }}>{health.map((h, i) => <li key={i}>{h.msg}</li>)}</ul>
        </Glass>
      )}

      <div style={{ display: 'grid', gap: 22 }}>
        {GROUPS.map(([g, types]) => {
          const accs = l.accounts.filter((a) => types.includes(a.type) && !a.archived);
          if (!accs.length) return null;
          return (
            <section key={g}>
              <h2 style={{ fontSize: 15, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 10px' }}>{g}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 330px), 1fr))', gap: 14 }}>
                {accs.map((a) => {
                  const b = l.balances.get(a.id);
                  const snaps = l.snapshots.filter((s) => s.accountId === a.id);
                  const last = snaps.at(-1);
                  const ledgerAtSnap = last ? accountBalances(l.accounts, l.transactions, last.date).get(a.id)?.total ?? 0 : 0;
                  const diff = last ? last.balance - ledgerAtSnap : 0;
                  const pots = l.pots.filter((p) => p.accountId === a.id);
                  const noOpening = a.openingBalance === 0 && !snaps.length && l.transactions.length > 0;
                  return (
                    <Glass key={a.id} pad={20} style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{a.name}</div>
                          <div className="small muted">{TYPE_LABEL[a.type]}{a.institution && ` · ${a.institution}`}{!a.isLiquid && ' · not liquid'}</div>
                        </div>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEdit(a)}>Edit</button>
                      </div>
                      <Money amount={b?.total ?? 0} size={30} weight={700} tone="auto" />
                      {pots.length > 0 && (
                        <div style={{ display: 'grid', gap: 6 }}>
                          {pots.map((p) => (
                            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span><span aria-hidden style={{ color: `var(--${p.owner})` }}>● </span>{p.name}</span>
                              <Money amount={b?.pots.get(p.id) ?? 0} tone="auto" />
                            </div>
                          ))}
                          <div style={{ display: 'flex', justifyContent: 'space-between' }} className="muted">
                            <span>Unassigned</span><Money amount={b?.unassigned ?? 0} tone="auto" />
                          </div>
                        </div>
                      )}
                      {last && (
                        <div className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="muted">Statement {formatDateCR(last.date)}: {formatMoney(last.balance, 'CRC')}</span>
                          {diff === 0 ? <Pill tone="income">✓ matches</Pill> : <Pill tone="debt">off by {formatMoney(diff, 'CRC', { signed: true })}</Pill>}
                        </div>
                      )}
                      {noOpening && <Pill tone="debt">Set the real opening balance</Pill>}
                      <div><button className="btn btn-sm" onClick={() => setPotFor(a)}>+ Pot</button></div>
                    </Glass>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {l.debts.length > 0 && <p style={{ marginTop: 24 }}><Link to="/debts" className="btn">Debts, payoff plans & self-loans →</Link></p>}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New account' : 'Edit account'}>
        {edit && <AccountForm account={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Sheet>
      <Sheet open={!!potFor} onClose={() => setPotFor(null)} title={`New pot in ${potFor?.name ?? ''}`}>
        {potFor && <PotForm account={potFor} onDone={() => setPotFor(null)} />}
      </Sheet>
      <p className="small muted" style={{ marginTop: 24 }}>Opening balance is the balance at the start of the opening date. Movements before that date don't change the balance but still count in monthly reports.</p>
    </>
  );
}

function AccountForm({ account, onDone }: { account?: Account; onDone: () => void }) {
  const now = Date.now();
  const [a, setA] = useState<Account>(account ?? { id: newId(), name: '', institution: 'BAC Credomatic', type: 'checking', currency: 'CRC', openingBalance: 0, openingDate: todayISO(), isLiquid: true, archived: false, createdAt: now, updatedAt: now });
  const [opening, setOpening] = useState(String(Math.abs(a.openingBalance) / 100));
  const [owed, setOwed] = useState(a.openingBalance < 0);
  const [err, setErr] = useState('');
  async function save() {
    const amt = opening.trim() === '' ? 0 : parseAmountInput(opening, a.currency);
    if (amt === null) { setErr('Can’t read the opening balance'); return; }
    try { await saveAccount({ ...a, openingBalance: owed ? -amt : amt }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="ac-name">Name</label><input id="ac-name" className="input" required value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="ac-type">Type</label>
          <select id="ac-type" className="input" value={a.type} onChange={(e) => { const type = e.target.value as Account['type']; setA({ ...a, type, isLiquid: !['association_cesantia', 'investment', 'credit_card'].includes(type) }); setOwed(type === 'credit_card'); }}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select></div>
        <div className="field"><label htmlFor="ac-cur">Currency</label>
          <select id="ac-cur" className="input" value={a.currency} onChange={(e) => setA({ ...a, currency: e.target.value as Account['currency'] })}><option>CRC</option><option>USD</option></select></div>
      </div>
      <div className="field"><label htmlFor="ac-inst">Institution</label><input id="ac-inst" className="input" value={a.institution} onChange={(e) => setA({ ...a, institution: e.target.value })} /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="ac-open">{owed ? 'Amount owed at start' : 'Opening balance'}</label><input id="ac-open" className="input" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
        <div className="field"><label htmlFor="ac-date">As of</label><input id="ac-date" className="input" type="date" value={a.openingDate} onChange={(e) => setA({ ...a, openingDate: e.target.value })} /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={a.isLiquid} onChange={(e) => setA({ ...a, isLiquid: e.target.checked })} /> Liquid (counts toward the emergency fund)</label>
      {a.type === 'credit_card' && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={owed} onChange={(e) => setOwed(e.target.checked)} /> Balance is money owed</label>}
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        {account && <button type="button" className="btn btn-ghost" onClick={() => void saveAccount({ ...a, archived: true }).then(onDone)}>Archive</button>}
        <button className="btn btn-primary" type="submit">Save</button>
      </div>
    </form>
  );
}

function PotForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const now = Date.now();
  const [p, setP] = useState<Pot>({ id: newId(), accountId: account.id, name: '', owner: 'mine', purpose: '', archived: false, createdAt: now, updatedAt: now });
  return (
    <form onSubmit={(e) => { e.preventDefault(); void savePot(p).then(onDone); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="pot-name">Name</label><input id="pot-name" className="input" required value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="Emergency fund, Marchamo…" /></div>
      <div className="field"><label htmlFor="pot-owner">Whose money</label>
        <select id="pot-owner" className="input" value={p.owner} onChange={(e) => setP({ ...p, owner: e.target.value as Pot['owner'] })}><option value="mine">Mine</option><option value="hers">Hers</option><option value="shared">Shared</option></select></div>
      <div className="field"><label htmlFor="pot-purpose">Purpose</label><input id="pot-purpose" className="input" value={p.purpose} onChange={(e) => setP({ ...p, purpose: e.target.value })} /></div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Create pot</button></div>
    </form>
  );
}
