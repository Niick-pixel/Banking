import { Link, NavLink, useLocation, useOutlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search, Settings as SettingsIcon, Plus } from 'lucide-react';
import { useSync, chooseFolder, suggestedFolder } from '../sync';
import { isTauri } from '../sync/backends';
import { checkForUpdate, type UpdateInfo } from '../sync/updater';
import { Toast } from '../ui/Sheet';
import { ago } from '../routes/Settings';
import { useCalendar, usePendingReminders } from './useRecurring';
import { usePref } from './prefs';
import { notifyDue } from './reminders';
import { CommandPalette } from './CommandPalette';
import { todayISO } from '../lib/dates';
import { useQuickAdd } from './QuickAdd';
import { postDueCuotas, postDueRecurring } from '../db/repo';
import { Aurora, GlassDefs } from '../design/components';
import { ALL_PAGES, SECTIONS, SETTINGS_PATHS, sectionFor } from './nav';
import { useTheme } from './theme';
import { GuidedTour } from './Tour';

/** Page content fades and rises in; the old page fades out first. */
function AnimatedOutlet() {
  const loc = useLocation();
  const outlet = useOutlet();
  const { dur } = useTheme();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={loc.pathname}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0, transition: { duration: dur(0.55), ease: [0.2, 0.8, 0.2, 1] } }}
        exit={{ opacity: 0, y: -10, transition: { duration: dur(0.28), ease: [0.4, 0, 1, 1] } }}>
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}

/** Tabs for the pages inside the current section, with a sliding highlight. */
function SectionTabs() {
  const loc = useLocation();
  const s = sectionFor(loc.pathname);
  const { dur } = useTheme();
  if (!s || s.pages.length < 2) return null;
  return (
    <nav className="section-tabs" aria-label={`${s.label} pages`} data-tour="tabs">
      {s.pages.map((p) => {
        const active = loc.pathname === p.to;
        return (
          <Link key={p.to} to={p.to} className={`section-tab ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
            {active && <motion.span layoutId="section-tab-pill" className="section-tab-pill" transition={{ type: 'spring', stiffness: 380, damping: 34, duration: dur(0.5) }} />}
            <span style={{ position: 'relative' }}>{p.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function Shell() {
  const qa = useQuickAdd();
  const loc = useLocation();
  const { dur } = useTheme();
  const { engine, status } = useSync();
  const [suggest, setSuggest] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
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
  const current = sectionFor(loc.pathname);
  const inSettings = SETTINGS_PATHS.includes(loc.pathname);
  const syncDot = !status ? 'var(--text-3)' : status.phase === 'locked' || status.phase === 'syncing' || status.dirty ? 'var(--debt)' : status.phase === 'error' ? 'var(--expense)' : 'var(--income)';
  const syncText = !status ? 'Not saving to a folder' : status.phase === 'locked' ? 'Data file locked' : status.phase === 'error' ? 'Sync problem' : status.phase === 'syncing' || status.dirty ? 'Saving…' : `Saved ${ago(status.lastSyncedAt)}`;

  return (
    <>
      <Aurora />
      <GlassDefs />
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="shell">
        <nav className="glass sidebar" aria-label="Main" data-tour="sidebar">
          <Link to="/" className="brand">
            <img src={`${import.meta.env.BASE_URL}icon.png`} alt="" width={38} height={38} style={{ borderRadius: 10 }} />
            <span>Aufwind<small className="brand-tag">Rise on what you already have</small></span>
          </Link>
          <ul className="nav-sections">
            {SECTIONS.map((s) => {
              const active = current?.id === s.id;
              const Icon = s.icon;
              return (
                <li key={s.id}>
                  <NavLink to={s.pages[0]!.to} end className={`nav-item ${active ? 'active' : ''}`} data-tour={`nav-${s.id}`} aria-current={active ? 'page' : undefined}>
                    {active && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 360, damping: 34, duration: dur(0.5) }} />}
                    <Icon size={19} strokeWidth={1.9} aria-hidden style={{ position: 'relative' }} />
                    <span style={{ position: 'relative', display: 'grid' }}>{s.label}<small className="nav-blurb">{s.blurb}</small></span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
          <div className="sidebar-bottom">
            <button className="nav-item nav-search" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))} data-tour="search">
              <Search size={18} aria-hidden /> <span>Search & commands</span> <kbd>Ctrl K</kbd>
            </button>
            <Link to="/settings" className={`nav-item ${inSettings ? 'active' : ''}`} data-tour="settings" aria-current={inSettings ? 'page' : undefined}>
              {inSettings && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 360, damping: 34, duration: dur(0.5) }} />}
              <SettingsIcon size={19} strokeWidth={1.9} aria-hidden style={{ position: 'relative' }} />
              <span style={{ position: 'relative', display: 'grid' }}>Settings<small className="nav-blurb"><span className="dot" style={{ background: syncDot, display: 'inline-block', marginRight: 6 }} />{syncText}</small></span>
            </Link>
          </div>
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
          <SectionTabs />
          <AnimatedOutlet />
        </main>
      </div>
      <nav className="glass tabbar" aria-label="Main (mobile)">
        {SECTIONS.map((s) => { const Icon = s.icon; return <NavLink key={s.id} to={s.pages[0]!.to} end className={`tab ${current?.id === s.id ? 'active' : ''}`}><Icon size={18} aria-hidden />{s.label.split(' ')[0]}</NavLink>; })}
        <NavLink to="/settings" className="tab"><SettingsIcon size={18} aria-hidden />Settings</NavLink>
      </nav>
      {update && <Toast message={`Update ${update.version} is ready`} action="Install & restart" onAction={() => void update.install()} onDone={() => setUpdate(null)} />}
      <CommandPalette pages={ALL_PAGES} />
      <GuidedTour />
      <button className="fab" aria-label="Quick add (shortcut N)" data-tour="fab" onClick={() => qa.open()}><Plus size={28} strokeWidth={2.2} /></button>
    </>
  );
}
