import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSync, chooseFolder, suggestedFolder } from '../sync';
import { isTauri } from '../sync/backends';
import { checkForUpdate, type UpdateInfo } from '../sync/updater';
import { Sheet, Toast } from '../ui/Sheet';
import { ago } from '../routes/Settings';
import { useQuickAdd } from './QuickAdd';
import { postDueCuotas } from '../db/repo';
import { Aurora, GlassDefs } from '../design/components';

const NAV = [
  { to: '/transactions', label: 'Transactions', icon: '≡', ready: true },
  { to: '/tracker', label: 'Tracker', icon: '▦', ready: true },
  { to: '/accounts', label: 'Accounts', icon: '▣', ready: true },
  { to: '/pots', label: 'Pots', icon: '◐', ready: true },
  { to: '/debts', label: 'Debts', icon: '◇', ready: true },
  { to: '/net-worth', label: 'Net worth', icon: '△', ready: true },
  { to: '/goals', label: 'Savings & goals', icon: '★', ready: true },
  { to: '/tasa-cero', label: 'Tasa Cero', icon: '%', ready: true },
  { to: '/calculators', label: 'Calculators', icon: '∑', ready: true },
  { to: '/import', label: 'Import', icon: '⇪', ready: true },
  { to: '/', label: 'Dashboard', icon: '◎', ready: false },
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
  useEffect(() => { void postDueCuotas(); void suggestedFolder().then(setSuggest); }, []);
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
          <div className="brand"><img src="/icon.svg" alt="" width={32} height={32} /><span>Colón</span></div>
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                {n.ready ? (
                  <NavLink to={n.to} className="nav-item"><span aria-hidden>{n.icon}</span>{n.label}</NavLink>
                ) : (
                  <span className="nav-item disabled" aria-disabled="true" title="Coming in a later phase"><span aria-hidden>{n.icon}</span>{n.label}</span>
                )}
              </li>
            ))}
          </ul>
          <Link to="/settings" className="sync-badge small" aria-label="Data sync status">
            {!status ? <><span className="dot" style={{ background: 'var(--text-3)' }} />Not saving to a folder</>
              : status.phase === 'error' ? <><span className="dot" style={{ background: 'var(--expense)' }} />Sync problem</>
              : status.phase === 'syncing' || status.dirty ? <><span className="dot" style={{ background: 'var(--debt)' }} />Saving…</>
              : <><span className="dot" style={{ background: 'var(--income)' }} />Saved {ago(status.lastSyncedAt)}</>}
          </Link>
        </nav>
        <main id="main" className="content">
          {isTauri() && !engine && !dismissed && (
            <div className="glass glass-strong" style={{ padding: 18, marginBottom: 18, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240 }}><b>Where should Colón keep your data?</b><div className="small muted">Pick a folder in OneDrive so it's backed up and shared between your PCs.</div></div>
              {suggest && <button className="btn btn-primary" onClick={() => void chooseFolder(suggest)}>Use {suggest}</button>}
              <button className="btn" onClick={() => void chooseFolder()}>Choose…</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)}>Later</button>
            </div>
          )}
          <Outlet />
        </main>
      </div>
      <nav className="glass tabbar" aria-label="Main (mobile)">
        {['/transactions', '/tracker', '/debts', '/net-worth'].map((to) => { const n = NAV.find((x) => x.to === to)!; return <NavLink key={to} to={to} className="tab"><span aria-hidden>{n.icon}</span>{n.label.split(' ')[0]}</NavLink>; })}
        <button className="tab" style={{ background: 'none', border: 0, font: 'inherit' }} onClick={() => setMore(true)} aria-haspopup="dialog"><span aria-hidden>⋯</span>More</button>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="All sections">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {NAV.filter((n) => n.ready).map((n) => <li key={n.to}><NavLink to={n.to} className="nav-item" onClick={() => setMore(false)}><span aria-hidden>{n.icon}</span>{n.label}</NavLink></li>)}
        </ul>
      </Sheet>
      {update && <Toast message={`Update ${update.version} is ready`} action="Install & restart" onAction={() => void update.install()} onDone={() => setUpdate(null)} />}
      <button className="fab" aria-label="Quick add (shortcut N)" onClick={() => qa.open()}>+</button>
    </>
  );
}
