import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLedger } from '../app/data';
import { Glass, Pill } from '../design/components';
import { PageHeader } from '../ui/Sheet';
import { gridFromXlsx } from '../import/grid';
import { openingFunds, parseWorkbook, remapCategory, withOpeningFunds, type ImportPlan } from '../import/workbook';
import { ChipGroup } from '../design/components/ChipGroup';
import { commitImport, newId, undoImport, UndoBlockedError } from '../db/repo';
import { formatMoney } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';
import { getEngine } from '../sync';
import type { ImportBatch } from '../domain/schemas';

type Step = 'pick' | 'review' | 'done';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Import() {
  const l = useLedger();
  const [step, setStep] = useState<Step>('pick');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [opening, setOpening] = useState<Record<string, string>>({});

  async function onFile(file: File) {
    setErr(''); setBusy(true);
    try {
      const grid = await gridFromXlsx(await file.arrayBuffer());
      setPlan(parseWorkbook(grid, { fileName: file.name, today: todayISO(), now: Date.now(), newId, existingCategories: l.categories, existingAccounts: l.accounts }));
      setStep('review');
    } catch (e) { setErr(`Couldn't read this file: ${e instanceof Error ? e.message : e}`); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!plan) return;
    setBusy(true);
    const offers = openingFunds(plan, todayISO(), new Set(l.accounts.map((a) => a.id)));
    const choices = Object.fromEntries(offers.map((o) => [o.accountId, opening[o.accountId] ?? o.suggestion]));
    try { await getEngine()?.backupNow('pre-import'); setBatch(await commitImport(withOpeningFunds(plan, choices, newId, Date.now()))); setStep('done'); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  async function undo(id: string) {
    setErr('');
    try { await undoImport(id); } catch (e) { setErr(e instanceof UndoBlockedError ? e.message : String(e)); }
  }

  const offers = plan ? openingFunds(plan, todayISO(), new Set(l.accounts.map((a) => a.id))) : [];
  const errors = plan?.issues.filter((i) => i.level === 'error') ?? [];
  const reconOk = plan?.reconciliation.every((r) => r.imported.income === r.tracker.income && r.imported.expenses === r.tracker.expenses && r.imported.saved === r.tracker.saved);
  const alreadyImported = l.batches.some((b) => b.status === 'committed' && b.kind === 'workbook');

  return (
    <>
      <PageHeader title="Import" sub="Bring in your Excel workbook. Every import is one batch you can undo." />
      <ol className="steps" aria-label="Import steps">
        {['Pick file', 'Review & map', 'Done'].map((s, i) => <li key={s} aria-current={['pick', 'review', 'done'][i] === step ? 'step' : undefined}>{s}</li>)}
      </ol>
      {err && <Glass strong pad={16} style={{ marginBottom: 16, color: 'var(--expense)', fontWeight: 600 }} role="alert">{err}</Glass>}

      {step === 'pick' && (
        <Glass pad={28} style={{ display: 'grid', gap: 14, justifyItems: 'start' }}>
          <h2 style={{ margin: 0 }}>Financial Tracker workbook (.xlsx)</h2>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>The file is read on this device only. It is matched by headers and section titles, never by cell positions, and nothing is saved until you confirm.</p>
          {alreadyImported && <Pill tone="debt">A workbook is already imported. Undo it below before importing again, or you'll get duplicates.</Pill>}
          <label className="btn btn-primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? 'Reading…' : 'Choose file'}
            <input type="file" accept=".xlsx" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          </label>
        </Glass>
      )}

      {step === 'review' && plan && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Glass strong>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>What I found in {plan.fileName}</h2>
            <table className="table"><thead><tr><th>Sheet</th><th>Used as</th><th>Detail</th></tr></thead>
              <tbody>{plan.detected.map((d) => <tr key={d.sheet}><td>{d.sheet}</td><td>{d.role === 'Ignored' ? <span className="muted">Ignored</span> : d.role}</td><td className="muted">{d.detail}</td></tr>)}</tbody></table>
          </Glass>

          <Glass strong>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Check against your Tracker</h2>
            <p className="small muted" style={{ marginTop: 0 }}>The imported movements, totalled by the app's own rules, compared with your Tracker sheet's formulas.</p>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>Month</th><th className="num">Income</th><th className="num">Expenses</th><th className="num">Saved</th><th></th></tr></thead>
                <tbody>{plan.reconciliation.map((r) => {
                  const ok = r.imported.income === r.tracker.income && r.imported.expenses === r.tracker.expenses && r.imported.saved === r.tracker.saved;
                  const cell = (a: number, b: number) => <td className="num">{formatMoney(a, 'CRC')}{a !== b && <div className="small" style={{ color: 'var(--expense)' }}>Tracker {formatMoney(b, 'CRC')}</div>}</td>;
                  return <tr key={r.month}><td>{MONTHS[Number(r.month.slice(5)) - 1]} {r.month.slice(0, 4)}</td>{cell(r.imported.income, r.tracker.income)}{cell(r.imported.expenses, r.tracker.expenses)}{cell(r.imported.saved, r.tracker.saved)}<td>{ok ? <Pill tone="income">✓ exact</Pill> : <Pill tone="expense">differs</Pill>}</td></tr>;
                })}</tbody>
              </table>
            </div>
            {reconOk && <p style={{ margin: '12px 0 0', color: 'var(--income)', fontWeight: 600 }}>Every month matches to the céntimo.</p>}
          </Glass>

          <Glass strong>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Category mapping</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>In workbook</th><th>Rows</th><th>Goes to</th></tr></thead>
                <tbody>{plan.categoryMap.map((m) => {
                  const options = [...plan.categories, ...l.categories];
                  return (
                    <tr key={m.source}>
                      <td>{m.source}</td><td className="num">{m.rows}</td>
                      <td>
                        <select className="input" style={{ height: 36 }} aria-label={`Category for ${m.source}`} value={m.categoryId}
                          onChange={(e) => { const t = options.find((c) => c.id === e.target.value); if (t) setPlan(remapCategory(plan, m.source, t)); }}>
                          {options.map((c) => <option key={c.id} value={c.id}>{c.group} · {c.name}{plan.categories.includes(c) ? ' (new)' : ''}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </Glass>

          {offers.map((o) => {
            const pots = plan.pots.filter((p) => p.accountId === o.accountId && !p.archived);
            return (
              <Glass strong key={o.accountId} style={{ display: 'grid', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>Starting balance of {o.accountName}</h2>
                <p className="small muted" style={{ margin: 0, maxWidth: 720 }}>Your Net Worth sheet says this account had {formatMoney(o.amount, 'CRC')} when the app starts counting it ({formatDateCR(o.date)}). The workbook doesn't say whose money that was, so without an answer it would show as "not in a fund". {o.why}</p>
                <ChipGroup<string> label={`Where do those ${formatMoney(o.amount, 'CRC')} belong?`} value={opening[o.accountId] ?? o.suggestion} onChange={(v) => v && setOpening((x) => ({ ...x, [o.accountId]: v }))}
                  options={[...pots.map((p) => ({ value: p.id, label: `In ${p.name}` })), { value: 'drop', label: 'Already in my savings rows: leave it out' }, { value: 'leave', label: 'Not sure: keep it outside the funds' }]} />
              </Glass>
            );
          })}

          <Glass strong>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Validation report</h2>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
              {plan.issues.map((x, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <Pill tone={x.level === 'error' ? 'expense' : x.level === 'warning' ? 'debt' : 'neutral'}>{x.level}</Pill>
                  <span>{x.row && <span className="muted">{x.sheet} row {x.row}: </span>}{x.message}</span>
                </li>
              ))}
            </ul>
          </Glass>

          <Glass strong style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Will create <b>{plan.transactions.length}</b> movements, <b>{plan.accounts.length}</b> accounts, <b>{plan.pots.length}</b> funds, <b>{plan.categories.length}</b> categories, <b>{plan.budgets.length}</b> budgets, <b>{plan.debts.length}</b> debts, <b>{plan.snapshots.length}</b> statement balances.</span>
            <span style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => { setPlan(null); setStep('pick'); }}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || errors.length > 0} onClick={() => void confirm()}>{errors.length ? `Fix ${errors.length} error(s) first` : 'Import'}</button>
            </span>
          </Glass>
        </div>
      )}

      {step === 'done' && batch && (
        <Glass pad={28} style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ margin: 0, color: 'var(--income)' }}>Imported ✓</h2>
          <p style={{ margin: 0 }}>{batch.counts.transactions} movements, {batch.counts.accounts} accounts, {batch.counts.budgets} budgets, {batch.counts.snapshots} statement balances.</p>
          <div style={{ display: 'flex', gap: 10 }}><Link to="/transactions" className="btn btn-primary">See transactions</Link><Link to="/accounts" className="btn">Check accounts</Link></div>
        </Glass>
      )}

      {l.batches.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 15, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Import history</h2>
          <Glass pad={8}>
            <table className="table"><tbody>{l.batches.map((b) => (
              <tr key={b.id}>
                <td>{b.fileName}</td><td className="muted small">{new Date(b.importedAt).toLocaleString('es-CR')}</td>
                <td className="small">{b.counts.transactions ?? 0} movements</td>
                <td>{b.status === 'committed' ? <button className="btn btn-sm btn-danger" onClick={() => void undo(b.id)}>Undo import</button> : <Pill>undone</Pill>}</td>
              </tr>
            ))}</tbody></table>
          </Glass>
        </section>
      )}
    </>
  );
}
