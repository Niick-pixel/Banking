import { NavLink, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useQuickAdd } from './QuickAdd';
import { postDueCuotas } from '../db/repo';
import { Aurora, GlassDefs } from '../design/components';

const NAV = [
  { to: '/transactions', label: 'Transactions', icon: '≡', ready: true },
  { to: '/accounts', label: 'Accounts', icon: '▣', ready: true },
  { to: '/tasa-cero', label: 'Tasa Cero', icon: '%', ready: true },
  { to: '/import', label: 'Import', icon: '⇪', ready: true },
  { to: '/', label: 'Dashboard', icon: '◎', ready: false },
  { to: '/tracker', label: 'Tracker', icon: '▦', ready: false },
  { to: '/pots', label: 'Pots', icon: '◔', ready: false },
  { to: '/debts', label: 'Debts', icon: '◇', ready: false },
  { to: '/net-worth', label: 'Net worth', icon: '△', ready: false },
  { to: '/design', label: 'Design system', icon: '✦', ready: true },
];

export default function Shell() {
  const qa = useQuickAdd();
  useEffect(() => { void postDueCuotas(); }, []);
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
        </nav>
        <main id="main" className="content"><Outlet /></main>
      </div>
      <nav className="glass tabbar" aria-label="Main (mobile)">
        {NAV.slice(0, 4).map((n) => <NavLink key={n.to} to={n.to} className="tab"><span aria-hidden>{n.icon}</span>{n.label}</NavLink>)}
        <NavLink to="/design" className="tab"><span aria-hidden>✦</span>Design</NavLink>
      </nav>
      <button className="fab" aria-label="Quick add (shortcut N)" onClick={() => qa.open()}>+</button>
    </>
  );
}
