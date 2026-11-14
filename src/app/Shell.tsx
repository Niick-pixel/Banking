import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSync, chooseFolder, suggestedFolder } from '../sync';
import { isTauri } from '../sync/backends';
import { checkForUpdate, type UpdateInfo } from '../sync/updater';
import { Sheet, Toast } from '../ui/Sheet';
import { ago } from '../routes/Settings';
import { useCalendar, usePendingReminders } from './useRecurring';
import { usePref } from './prefs';
import { notifyDue } from './reminders';
import { CommandPalette } from './CommandPalette';
import { todayISO } from '../lib/dates';
import { useQuickAdd } from './QuickAdd';
import { postDueCuotas, postDueRecurring } from '../db/repo';
import { Aurora, GlassDefs } from '../design/components';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◎', ready: true },
  { to: '/transactions', label: 'Transactions', icon: '≡', ready: true },
  { to: '/bills', label: 'Bills & calendar', icon: '◷', ready: true },
  { to: '/tracker', label: 'Tracker', icon: '▦', ready: true },
  { to: '/accounts', label: 'Accounts', icon: '▣', ready: true },
  { to: '/pots', label: 'Pots', icon: '◐', ready: true },
  { to: '/debts', label: 'Debts', icon: '◇', ready: true },
  { to: '/net-worth', label: 'Net worth', icon: '△', ready: true },
  { to: '/goals', label: 'Savings & goals', icon: '★', ready: true },
  { to: '/tasa-cero', label: 'Tasa Cero', icon: '%', ready: true },
  { to: '/calculators', label: 'Calculators', icon: '∑', ready: true },
  { to: '/reports', label: 'Reports', icon: '▤', ready: true },
  { to: '/import', label: 'Import', icon: '⇪', ready: true },
  { to: '/settings', label: 'Settings', icon: '⚙', ready: true },
  { to: '/design', label: 'Design system', icon: '✦', ready: true },
];

export default function Shell() {
  const qa = useQuickAdd();
  const { engine, status } = useSync();
  const [suggest, setSuggest] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [more, setMore] = useState(false);
  const [notify] = usePref('notifyBills');
  const today = todayISO();
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const soon = useCalendar(today, tomorrow);
  const pending = usePendingReminders();
  useEffect(() => { if (notify) void notifyDue(soon, pending.length, today, tomorrow); }, [notify, soon, pending.length, today, tomorrow]);
  useEffect(() => {
    const catchUp = () => { void postDueCuotas(); void postDueRecurring(); };
    catchUp(); void suggestedFolder().then(setSuggest);
    const t = setInterval(catchUp, 3600_000); // also catches up when the app stays open past midnight
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    const run = () => void checkForUpdate().then(setUpdate).catch(() => {});
    const first = setTimeout(run, 8000);
    const every = setInterval(run, 6 * 3600_000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);
  return (
    <>
      <Aurora />
      <GlassDefs />
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="shell">
        <nav className="glass sidebar" aria-label="Main">
          <div className="brand"><img src={`${import.meta.env.BASE_URL}icon.png`} alt="" width={34} height={34} style={{ borderRadius: 9 }} /><span>Aufwind<small className="brand-tag">Rise on what you already have</small></span></div>
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                {n.ready ? (
                  <NavLink to={n.to} end={n.to === '/'} className="nav-item"><span aria-hidden>{n.icon}</span>{n.label}</NavLink>
                ) : (
                  <span className="nav-item disabled" aria-disabled="true" title="Coming in a later phase"><span aria-hidden>{n.icon}</span>{n.label}</span>
                )}
              </li>
            ))}
          </ul>
          <button className="sync-badge small" style={{ background: 'none', border: 0, font: 'inherit', cursor: 'pointer', marginTop: 'auto' }} onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}><span aria-hidden>⌘</span> Search & commands <kbd className="small muted" style={{ marginLeft: 'auto' }}>Ctrl K</kbd></button>
          <Link to="/settings" className="sync-badge small">
            {!status ? <><span className="dot" style={{ background: 'var(--text-3)' }} />Not saving to a folder</>
              : status.phase === 'locked' ? <><span className="dot" style={{ background: 'var(--debt)' }} />Data file locked: enter password</>
              : status.phase === 'error' ? <><span className="dot" style={{ background: 'var(--expense)' }} />Sync problem</>
              : status.phase === 'syncing' || status.dirty ? <><span className="dot" style={{ background: 'var(--debt)' }} />Saving…</>
              : <><span className="dot" style={{ background: 'var(--income)' }} />Saved {ago(status.lastSyncedAt)}</>}
          </Link>
        </nav>
        <main id="main" className="content">
          {isTauri() && !engine && !dismissed && (
            <div className="glass glass-strong" style={{ padding: 18, marginBottom: 18, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240 }}><b>Where should Aufwind keep your data?</b><div className="small muted">Pick a folder in OneDrive so it's backed up and shared between your PCs.</div></div>
              {suggest && <button className="btn btn-primary" onClick={() => void chooseFolder(suggest)}>Use {suggest}</button>}
              <button className="btn" onClick={() => void chooseFolder()}>Choose…</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)}>Later</button>
            </div>
          )}
          <Outlet />
        </main>
      </div>
      <nav className="glass tabbar" aria-label="Main (mobile)">
        {['/', '/transactions', '/tracker', '/debts'].map((to) => { const n = NAV.find((x) => x.to === to)!; return <NavLink key={to} to={to} end={to === '/'} className="tab"><span aria-hidden>{n.icon}</span>{n.label.split(' ')[0]}</NavLink>; })}
        <button className="tab" style={{ background: 'none', border: 0, fontFamily: 'inherit', cursor: 'pointer' }} onClick={() => setMore(true)} aria-haspopup="dialog"><span aria-hidden>⋯</span>More</button>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="All sections">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {NAV.filter((n) => n.ready).map((n) => <li key={n.to}><NavLink to={n.to} className="nav-item" onClick={() => setMore(false)}><span aria-hidden>{n.icon}</span>{n.label}</NavLink></li>)}
        </ul>
      </Sheet>
      {update && <Toast message={`Update ${update.version} is ready`} action="Install & restart" onAction={() => void update.install()} onDone={() => setUpdate(null)} />}
      <CommandPalette pages={NAV} />
      <button className="fab" aria-label="Quick add (shortcut N)" onClick={() => qa.open()}>+</button>
    </>
  );
}
