/**
 * Quincena review: a 5-minute routine for the 1st and the 16th. One list, in order,
 * each step showing whether it still needs you and taking you there.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDot } from 'lucide-react';
import { useHealth, useLedger } from '../app/data';
import { useCalendar, usePendingReminders } from '../app/useRecurring';
import { useCoach } from '../app/coach';
import { usePersisted } from '../app/persist';
import { usePref } from '../app/prefs';
import { Glass, Pill } from '../design/components';
import { PageHeader } from '../ui/Sheet';
import { checkInStatus, quincenaStart } from '../domain/checkin';
import { budgetAlerts, computeTracker } from '../domain/tracker';
import { formatMoney } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

const plus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function useReviewDue() {
  const [doneFor] = usePersisted<string>('review.doneFor', '');
  return doneFor !== quincenaStart(todayISO());
}

export default function Review() {
  const l = useLedger();
  const coach = useCoach();
  const health = useHealth();
  const pending = usePendingReminders();
  const today = todayISO();
  const q = quincenaStart(today);
  const [doneFor, setDoneFor] = usePersisted<string>('review.doneFor', '');
  const [warnAt] = usePref('budgetWarnPct');
  const next = useCalendar(plus(today, 1), plus(today, 15)).filter((e) => e.status === 'upcoming' && e.tone !== 'info' && e.tone !== 'income');
  const checks = checkInStatus(l.accounts, l.snapshots, today).filter((s) => s.due);
  const alerts = useMemo(() => budgetAlerts(computeTracker(Number(today.slice(0, 4)), l.transactions.filter((t) => t.currency === 'CRC'), l.categories, l.budgets, { accountType: (id) => l.account.get(id)?.type }), today, warnAt).filter((a) => a.level !== 'warn'), [l, today, warnAt]);
  const fixes = health.filter((h) => h.level !== 'info');
  const urgent = (coach?.run?.dispatch.inbox ?? []).filter((i) => i.severity === 'critical' || i.severity === 'warning');
  const outNext = next.reduce((s, e) => s + (e.amount ?? 0), 0);

  const steps = [
    { id: 'checkin', title: 'Check your balances', done: checks.length === 0, detail: checks.length ? `${checks.length} account(s) not checked since ${formatDateCR(q)}: ${checks.slice(0, 4).map((c) => c.account.name).join(', ')}` : 'Every account matches your bank for this quincena.', to: '/check-in', cta: 'Check in' },
    { id: 'confirm', title: 'Confirm bills that came in', done: pending.length === 0, detail: pending.length ? `${pending.length} reminder(s) waiting for the real amount.` : 'Nothing waiting.', to: '/bills', cta: 'Confirm' },
    { id: 'fix', title: 'Fix what the app flagged', done: fixes.length === 0, detail: fixes.length ? fixes.slice(0, 3).map((h) => h.title).join(' · ') : 'No data problems.', to: '/settings?c=data', cta: 'Review' },
    { id: 'budget', title: 'Look at categories over budget', done: alerts.length === 0, detail: alerts.length ? alerts.map((a) => `${a.category.name} ${Math.round(a.pct * 100)}%`).join(' · ') : 'Nothing over budget.', to: '/tracker', cta: 'Open Budget' },
    { id: 'coach', title: 'Read the Coach\'s warnings', done: urgent.length === 0, detail: urgent.length ? urgent.slice(0, 3).map((i) => i.title).join(' · ') : 'No warnings.', to: '/coach', cta: 'Open Coach' },
  ];
  const left = steps.filter((s) => !s.done).length;

  return (
    <>
      <PageHeader title="Quincena review" sub={`A five-minute check every 1st and 16th. This quincena started ${formatDateCR(q)}.`}>
        {doneFor === q ? <Pill tone="income">✓ Reviewed</Pill> : <button className="btn btn-primary" onClick={() => setDoneFor(q)}>Mark this quincena as reviewed</button>}
      </PageHeader>
      <div className="review-grid">
        <Glass strong pad={20}>
          <h2 className="card-h" style={{ margin: '0 0 12px' }}>{left ? `${left} step${left > 1 ? 's' : ''} to go` : 'All clear'}</h2>
          <ol className="review-steps">
            {steps.map((s, i) => (
              <li key={s.id} className={s.done ? 'done' : ''}>
                <span className="review-n" aria-hidden>{s.done ? <CheckCircle2 size={22} style={{ color: 'var(--income)' }} /> : <CircleDot size={22} style={{ color: 'var(--debt)' }} />}</span>
                <div><b>{i + 1}. {s.title}</b><div className="small muted">{s.detail}</div></div>
                {!s.done && <Link className="btn btn-sm" to={s.to}>{s.cta}</Link>}
              </li>
            ))}
          </ol>
        </Glass>
        <Glass strong pad={20} style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <h2 className="card-h" style={{ margin: 0 }}>Next 15 days</h2>
          <div className="small muted">Going out: <b className="money" style={{ color: 'var(--expense)' }}>{formatMoney(outNext, 'CRC')}</b></div>
          {next.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing scheduled. <Link to="/bills">Add your recurring bills</Link> to see them here.</p> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {next.map((e, k) => <li key={k} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}><span className="small muted" style={{ width: 44 }}>{formatDateCR(e.date).slice(0, 5)}</span><span style={{ flex: 1 }}>{e.title}</span>{e.amount ? <b className="money small">{formatMoney(e.amount, 'CRC')}</b> : null}</li>)}
            </ul>
          )}
        </Glass>
      </div>
    </>
  );
}
