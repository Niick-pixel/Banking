/**
 * "Get set up": the handful of things that make every number in the app right.
 * Shown first on the dashboard until all are done; each step links to where it's done.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle } from 'lucide-react';
import { useLedger } from '../app/data';
import { budgetFor } from '../domain/tracker';
import { checkInStatus } from '../domain/checkin';
import { isTauri } from '../sync/backends';
import { useSync } from '../sync';
import { todayISO } from '../lib/dates';

interface Step { id: string; title: string; why: string; to: string; done: boolean }

export function useSetup() {
  const l = useLedger();
  const { engine } = useSync();
  return useMemo(() => {
    const today = todayISO();
    const month = today.slice(0, 7);
    const spendCats = l.categories.filter((c) => !c.archived && ['Fixed', 'Living', 'Discretionary', 'Debt Service'].includes(c.group));
    const budgeted = spendCats.filter((c) => budgetFor(l.budgets, c.id, month) > 0).length;
    const status = checkInStatus(l.accounts, l.snapshots, today);
    const steps: Step[] = [
      { id: 'accounts', title: 'Add your accounts', why: 'Checking, savings and the association: everything else is built on them.', to: '/accounts', done: l.accounts.some((a) => a.type !== 'credit_card') },
      { id: 'cards', title: 'Add your credit cards', why: 'So what you owe on them counts as debt and their due dates reach the calendar.', to: '/check-in', done: l.accounts.some((a) => a.type === 'credit_card') },
      { id: 'budgets', title: 'Set budgets for what you spend on', why: 'At least 3 categories, so the Budget page and the Coach can warn you in time.', to: '/categories', done: budgeted >= 3 },
      { id: 'bills', title: 'Add your recurring bills', why: 'Rent, phone, salary… they fill the calendar and the bell reminds you a week ahead.', to: '/bills', done: l.recurring.some((r) => r.active) },
      { id: 'checkin', title: 'Do this quincena\'s balance check-in', why: 'Type what your bank shows so the app matches your statement.', to: '/check-in', done: status.length > 0 && status.every((s) => !s.due) },
      ...(isTauri() ? [{ id: 'folder', title: 'Choose where your data is saved', why: 'A OneDrive folder keeps a backup and syncs your PCs.', to: '/settings?c=data', done: !!engine }] : []),
    ];
    return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
  }, [l, engine]);
}

export function SetupChecklist() {
  const { steps, done, total } = useSetup();
  return (
    <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <h2 className="card-h" style={{ margin: 0 }}>Get set up</h2>
        <span className="small muted">{done} of {total} done</span>
      </div>
      <div className="bar" aria-hidden><span style={{ width: `${(done / total) * 100}%`, background: 'var(--income)' }} /></div>
      <ol className="setup-list">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? 'done' : ''}>
            {s.done ? <CheckCircle2 size={20} aria-hidden style={{ color: 'var(--income)' }} /> : <Circle size={20} aria-hidden style={{ color: 'var(--text-3)' }} />}
            <div><b>{s.title}</b>{s.done ? <span className="sr-only"> (done)</span> : null}<div className="small muted">{s.why}</div></div>
            {!s.done && <Link className="btn btn-sm" to={s.to}>Go</Link>}
          </li>
        ))}
      </ol>
    </div>
  );
}
