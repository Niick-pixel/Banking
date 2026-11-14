import { NavLink, Outlet } from 'react-router-dom';
import { Aurora, GlassDefs } from '../design/components';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◎', ready: false },
  { to: '/transactions', label: 'Transactions', icon: '≡', ready: false },
  { to: '/tracker', label: 'Tracker', icon: '▦', ready: false },
  { to: '/accounts', label: 'Accounts', icon: '▣', ready: false },
  { to: '/pots', label: 'Pots', icon: '◔', ready: false },
  { to: '/debts', label: 'Debts', icon: '◇', ready: false },
  { to: '/net-worth', label: 'Net worth', icon: '△', ready: false },
  { to: '/import', label: 'Import', icon: '⇪', ready: false },
  { to: '/design', label: 'Design system', icon: '✦', ready: true },
];

export default function Shell() {
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
        {NAV.slice(0, 4).map((n) => <span key={n.to} className="tab disabled" aria-disabled="true"><span aria-hidden>{n.icon}</span>{n.label}</span>)}
        <NavLink to="/design" className="tab"><span aria-hidden>✦</span>Design</NavLink>
      </nav>
      <button className="fab" aria-label="Quick add (coming in Phase 2)" disabled>+</button>
    </>
  );
}
