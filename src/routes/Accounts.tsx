import { useState } from 'react';
import { useLedger } from '../app/data';
import { Glass, Pill } from '../design/components';
import { PageHeader, Sheet } from '../ui/Sheet';
import { ACCOUNT_TYPES, type Account, type Pot } from '../domain/schemas';
import { accountBalances, debtStatus } from '../domain/ledger';
import { newId, saveAccount, saveCategory, savePot, saveSnapshot, saveTransaction } from '../db/repo';
import { ChipGroup } from '../design/components/ChipGroup';
import { TransactionSchema } from '../domain/schemas';
import { DEFAULT_CATEGORIES } from '../domain/defaults';
import { formatDateCR, todayISO } from '../lib/dates';
import { formatMoney, parseAmountInput } from '../lib/money';
import { ExplainBalance } from './ExplainBalance';

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
  const [explain, setExplain] = useState<Account | null>(null);
  const [setBal, setSetBal] = useState<Account | null>(null);
  const [sort, setSort] = useState<Account | null>(null);

  const health: { level: 'warn' | 'info'; msg: string }[] = [];
  for (const d of l.debts) {
    const s = debtStatus(d, l.transactions);
    if (s.gapVsConfirmed) health.push({ level: 'warn', msg: `${d.creditor}: the ledger says ${formatMoney(s.balance + 0, 'CRC')} is owed, but you confirmed ${formatMoney(d.confirmedBalance!.amount, 'CRC')} on ${formatDateCR(d.confirmedBalance!.date)}. Difference ${formatMoney(s.gapVsConfirmed, 'CRC')}: log the missing payment, or correct the confirmed balance.` });
  }
  for (const p of l.pots) {
    const b = l.balances.get(p.accountId)?.pots.get(p.id) ?? 0;
    if (b < 0) health.push({ level: 'warn', msg: `Fund "${p.name}" is negative (${formatMoney(b, 'CRC')}).` });
  }

  return (
    <div className="fit">
      <PageHeader title="Accounts" sub="Click a balance to see where it comes from. Set balance makes the app match your bank.">
        <button className="btn btn-primary" onClick={() => setEdit('new')}>+ Account</button>
      </PageHeader>

      {health.length > 0 && (
        <Glass strong pad={12} style={{ flex: 'none', maxHeight: '18vh', overflow: 'auto', borderColor: 'var(--debt)' }} role="region" aria-label="Data health">
          <b style={{ color: 'var(--debt)' }}>Needs attention ({health.length})</b>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 6 }}>{health.map((h, i) => <li key={i}>{h.msg}</li>)}</ul>
        </Glass>
      )}

      <div className="glass glass-strong acc-table-card">
        <div className="acc-row acc-head" aria-hidden>
          <span>Account</span><span className="num">Balance</span><span>Last statement</span><span>Funds inside</span><span />
        </div>
        <div className="scroll-box fill" tabIndex={0} aria-label="Accounts">
        {GROUPS.map(([g, types]) => {
          const accs = l.accounts.filter((a) => types.includes(a.type) && !a.archived);
          if (!accs.length) return null;
          const groupTotal = accs.reduce((s0, a) => s0 + (l.balances.get(a.id)?.total ?? 0), 0);
          return (
            <section key={g}>
              <div className="acc-group"><span className="label">{g}</span><span className="n">n {accs.length}</span><b className="money small" style={{ marginLeft: 'auto' }}>{formatMoney(groupTotal, 'CRC')}</b></div>
              {accs.map((a) => {
                const b = l.balances.get(a.id);
                const snaps = l.snapshots.filter((x) => x.accountId === a.id && x.date <= todayISO());
                const last = snaps.at(-1);
                const ledgerAtSnap = last ? accountBalances(l.accounts, l.transactions, last.date).get(a.id)?.total ?? 0 : 0;
                const diff = last ? last.balance - ledgerAtSnap : 0;
                const pots = l.pots.filter((p) => p.accountId === a.id && !p.archived);
                const unassigned = b?.unassigned ?? 0;
                return (
                  <div key={a.id} className="acc-row">
                    <span className="acc-name"><b>{a.name}</b><span className="small faint">{TYPE_LABEL[a.type]}{a.institution && ` · ${a.institution}`}{!a.isLiquid && ' · not liquid'}</span></span>
                    <button className="acc-bal money" onClick={() => setExplain(a)} title="How is this calculated?">{formatMoney(b?.total ?? 0, a.currency)}<span className="small faint">how? →</span></button>
                    <span className="small">{last ? <>{formatDateCR(last.date)} · {formatMoney(last.balance, a.currency)} {diff === 0 ? <Pill tone="income">✓</Pill> : <Pill tone="debt">{formatMoney(diff, a.currency, { signed: true })}</Pill>}</> : <span className="faint">none yet</span>}</span>
                    <span className="acc-funds small">
                      {pots.map((p) => <span key={p.id}><i style={{ background: `var(--${p.owner})` }} />{p.name} <b className="money">{formatMoney(b?.pots.get(p.id) ?? 0, a.currency)}</b></span>)}
                      {pots.length > 0 && unassigned !== 0 && <button className="btn btn-sm acc-unassigned" onClick={() => setSort(a)} title="Money in this account that isn't in any fund">Unassigned {formatMoney(unassigned, a.currency)} · sort out</button>}
                      {!pots.length && <span className="faint">no funds</span>}
                    </span>
                    <span className="acc-actions">
                      <button className="btn btn-sm" onClick={() => setSetBal(a)}>Set balance</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setPotFor(a)}>+ Fund</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEdit(a)}>Edit</button>
                    </span>
                  </div>
                );
              })}
            </section>
          );
        })}
        </div>
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New account' : 'Edit account'}>
        {edit && <AccountForm account={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Sheet>
      <Sheet wide open={!!explain} onClose={() => setExplain(null)} title={explain ? `Where ${formatMoney(l.balances.get(explain.id)?.total ?? 0, explain.currency)} in ${explain.name} comes from` : ''}>
        {explain && <ExplainBalance account={explain} />}
      </Sheet>
      <Sheet open={!!setBal} onClose={() => setSetBal(null)} title={setBal ? `Set ${setBal.name} to what the bank shows` : ''}>
        {setBal && <SetBalanceForm account={setBal} onDone={() => setSetBal(null)} />}
      </Sheet>
      <Sheet open={!!sort} onClose={() => setSort(null)} title={sort ? `Unassigned money in ${sort.name}` : ''}>
        {sort && <SortUnassignedForm account={sort} onDone={() => setSort(null)} />}
      </Sheet>
      <Sheet open={!!potFor} onClose={() => setPotFor(null)} title={`New fund in ${potFor?.name ?? ''}`}>
        {potFor && <PotForm account={potFor} onDone={() => setPotFor(null)} />}
      </Sheet>
    </div>
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
      {a.type === 'credit_card' && <>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={owed} onChange={(e) => setOwed(e.target.checked)} /> Balance is money owed</label>
        <div className="grid2">
          <div className="field"><label htmlFor="ac-st">Statement closes on day</label><input id="ac-st" className="input" type="number" min={1} max={31} value={a.cardStatementDay ?? ''} onChange={(e) => setA({ ...a, cardStatementDay: e.target.value ? Number(e.target.value) : undefined })} /></div>
          <div className="field"><label htmlFor="ac-due">Payment due on day</label><input id="ac-due" className="input" type="number" min={1} max={31} value={a.cardDueDay ?? ''} onChange={(e) => setA({ ...a, cardDueDay: e.target.value ? Number(e.target.value) : undefined })} /></div>
        </div>
        <span className="small muted">The due date shows in Bills & calendar with what you owe, and can notify you.</span>
      </>}
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
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Create fund</button></div>
    </form>
  );
}

/** Make the app match the bank: records the statement and an adjustment for the difference. */
function SetBalanceForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const l = useLedger();
  const today = todayISO();
  const card = account.type === 'credit_card';
  const app = l.balances.get(account.id)?.total ?? 0;
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState('');
  const v = parseAmountInput(raw, account.currency);
  const target = v === null ? null : card ? -Math.abs(v) : v;
  const diff = target === null ? null : target - app;
  async function save() {
    if (target === null) return setErr("Type the balance the bank shows");
    await saveSnapshot(account.id, today, target);
    if (diff) {
      const now = Date.now();
      await saveTransaction(TransactionSchema.parse({ id: newId(), kind: 'adjustment', date: today, dateEstimated: false, currency: account.currency, side: { accountId: account.id }, signedAmount: diff, reason: 'Set to the bank balance', description: 'Balance set to match the bank', tags: ['check-in'], notes: '', createdAt: now, updatedAt: now }));
    }
    onDone();
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="field"><label htmlFor="sb-v">{card ? 'Owed, as the bank shows it' : 'Balance the bank shows today'}</label>
        <input id="sb-v" data-autofocus className="input input-amount" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={(Math.abs(app) / 100).toLocaleString('en-US')} /></div>
      <div className="group" style={{ display: 'grid', gap: 4, padding: '10px 12px', borderRadius: 'var(--r-chip)' }}>
        <span className="small">In the app now: <b className="money">{formatMoney(app, account.currency)}</b></span>
        {diff !== null && <span className="small">Difference: <b className="money" style={{ color: diff === 0 ? 'var(--income)' : 'var(--debt)' }}>{formatMoney(diff, account.currency, { signed: true })}</b> <span className="derived">· derived</span></span>}
        <span className="small faint">Saves today's statement and one adjustment for the difference. Adjustments change the balance only: they're not counted as income or spending.</span>
      </div>
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">Set balance</button></div>
    </form>
  );
}

/** Money in an account that isn't in any fund: say where it came from, then move it into a fund or remove it. */
function SortUnassignedForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const l = useLedger();
  const b = l.balances.get(account.id);
  const unassigned = b?.unassigned ?? 0;
  const pots = l.pots.filter((p) => p.accountId === account.id && !p.archived);
  const [choice, setChoice] = useState<string | null>(pots[0]?.id ?? 'remove');
  const [raw, setRaw] = useState(String(Math.abs(unassigned) / 100));
  const [err, setErr] = useState('');
  const amount = parseAmountInput(raw, account.currency);
  const moves = l.transactions.filter((t) => ('from' in t && t.from.accountId === account.id && !t.from.potId) || ('to' in t && t.to.accountId === account.id && !t.to.potId) || (t.kind === 'adjustment' && t.side.accountId === account.id && !t.side.potId)).filter((t) => t.date >= account.openingDate);
  async function save() {
    if (!amount) return setErr('Type an amount');
    const now = Date.now();
    const base = { id: newId(), date: todayISO(), dateEstimated: false, currency: account.currency, tags: [], notes: '', createdAt: now, updatedAt: now };
    if (choice === 'remove') {
      await saveTransaction(TransactionSchema.parse({ ...base, kind: 'adjustment', side: { accountId: account.id }, signedAmount: unassigned > 0 ? -amount : amount, reason: 'Unassigned money that is not in the bank', description: 'Removed unassigned money' }));
    } else if (choice) {
      await saveTransaction(TransactionSchema.parse({ ...base, kind: 'transfer', from: unassigned > 0 ? { accountId: account.id } : { accountId: account.id, potId: choice }, to: unassigned > 0 ? { accountId: account.id, potId: choice } : { accountId: account.id }, amount, description: 'Unassigned money moved into a fund' }));
    }
    onDone();
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 12 }}>
      <div className="group" style={{ display: 'grid', gap: 4, padding: '10px 12px', borderRadius: 'var(--r-chip)' }}>
        <span className="label">Where it came from</span>
        <span className="small">Starting balance on {formatDateCR(account.openingDate)}: <b className="money">{formatMoney(account.openingBalance, account.currency)}</b>{account.openingBalance ? ' (money already in the account when tracking began, never assigned to a fund)' : ''}</span>
        <span className="small">Plus {moves.length} movement{moves.length === 1 ? '' : 's'} in or out of the account without a fund <span className="n">n {moves.length}</span></span>
        <span className="small">Unassigned now: <b className="money">{formatMoney(unassigned, account.currency)}</b> <span className="derived">· derived</span></span>
      </div>
      <ChipGroup<string> label="What to do with it" value={choice} onChange={setChoice}
        info="Move it into a fund if the money is really there (it's yours or hers). Remove it if your bank doesn't have it: the balance goes down, nothing counts as spending."
        options={[...pots.map((p) => ({ value: p.id, label: `Move into ${p.name}` })), { value: 'remove', label: "It isn't there: remove it", tone: 'loss' as const }]} />
      <div className="field"><label htmlFor="su-a">Amount</label><input id="su-a" className="input" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} /></div>
      {err && <p role="alert" style={{ color: 'var(--expense)', margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="submit">{choice === 'remove' ? 'Remove it' : 'Move it'}</button></div>
    </form>
  );
}
