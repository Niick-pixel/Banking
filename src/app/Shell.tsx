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
import { postDueCuotas, postDueRecurring, fixPaydaySavingsRules } from '../db/repo';
import { Aurora, GlassDefs } from '../design/components';
import { ALL_PAGES, canonicalPath, SECTIONS, SETTINGS_PATHS, sectionFor } from './nav';
import { GuidedTour } from './Tour';
import { NotificationBell } from './Notifications';
import { FxCalc } from './FxCalc';
import { SPRING, reducedMotion } from '../design/motion';
import { readPersisted, writePersisted } from './persist';

/** Page content fades and rises in; the old page fades out first. */
function AnimatedOutlet() {
  const loc = useLocation();
  const outlet = useOutlet();
  const rm = reducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={loc.pathname} className="page-frame"
        initial={rm ? { opacity: 0 } : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: rm ? { duration: 0.12 } : SPRING.base }}
        exit={rm ? { opacity: 0 } : { opacity: 0, y: -6, transition: { duration: 0.13 } }}>
        <div className="page-scroll">{outlet}</div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Tabs for the pages inside the current section, with a sliding highlight. */
function SectionTabs() {
  const loc = useLocation();
  const s = sectionFor(loc.pathname);
  if (!s || s.pages.length < 2) return null;
  return (
    <nav className="section-tabs" aria-label={`${s.label} pages`} data-tour="tabs">
      {s.pages.map((p) => {
        const active = canonicalPath(loc.pathname) === p.to;
        return (
          <Link key={p.to} to={p.to} className={`section-tab ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
            {active && <motion.span layoutId="section-tab-pill" className="section-tab-pill" transition={SPRING.snappy} />}
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
  const { engine, status } = useSync();
  const [suggest, setSuggest] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [notify] = usePref('notifyBills');
  const today = todayISO();
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const weekOut = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const soon = useCalendar(today, weekOut);
  const pending = usePendingReminders();
  useEffect(() => { if (notify) void notifyDue(soon, pending.length, today, tomorrow); }, [notify, soon, pending.length, today, tomorrow]);
  useEffect(() => {
    const catchUp = () => { void postDueCuotas(); void fixPaydaySavingsRules().then(() => postDueRecurring()); };
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
  // Each section reopens on the tab you used last (e.g. Activity → Calendar).
  useEffect(() => { if (current && current.pages.some((p) => p.to === loc.pathname)) writePersisted(`lastPage.${current.id}`, loc.pathname); }, [current, loc.pathname]);
  const entry = (s: (typeof SECTIONS)[number]) => { const last = readPersisted<string>(`lastPage.${s.id}`, s.pages[0]!.to); return s.pages.some((p) => p.to === last) ? last : s.pages[0]!.to; };
  const inSettings = SETTINGS_PATHS.includes(loc.pathname);
  const syncDot = !status ? 'var(--text-3)' : status.phase === 'locked' || status.phase === 'syncing' || status.dirty ? 'var(--debt)' : status.phase === 'error' ? 'var(--expense)' : 'var(--income)';
  // A dot on Settings only when something needs you: a save problem, a locked file, or no data folder in the desktop app.
  const syncAttention = isTauri() ? (!status || status.phase === 'locked' || status.phase === 'error') : false;
  const syncText = !status ? 'Not saving to a folder' : status.phase === 'locked' ? 'Data file locked' : status.phase === 'error' ? 'Sync problem' : status.phase === 'syncing' || status.dirty ? 'Saving…' : `Saved ${ago(status.lastSyncedAt)}`;

  return (
    <>
      <Aurora />
      <GlassDefs />
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="shell">
        <nav className="glass sidebar" aria-label="Main" data-tour="sidebar">
          <Link to="/" className="brand">
            <img src={`${import.meta.env.BASE_URL}icon.png`} alt="" width={26} height={26} style={{ borderRadius: 7 }} />
            <span>Aufwind<small className="brand-tag">Rise on what you already have</small></span>
          </Link>
          <ul className="nav-sections">
            {SECTIONS.map((s) => {
              const active = current?.id === s.id;
              const Icon = s.icon;
              return (
                <li key={s.id}>
                  <NavLink to={entry(s)} end title={s.blurb} className={`nav-item ${active ? 'active' : ''}`} data-tour={`nav-${s.id}`} aria-current={active ? 'page' : undefined}>
                    {active && <motion.span layoutId="nav-pill" className="nav-pill" transition={SPRING.snappy} />}
                    <Icon size={19} strokeWidth={1.9} aria-hidden style={{ position: 'relative' }} />
                    <span style={{ position: 'relative', display: 'grid' }}>{s.label}<small className="nav-blurb">{s.blurb}</small></span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
          <div className="sidebar-bottom">
            <button className="nav-item nav-search" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))} data-tour="search">
              <Search size={18} aria-hidden /> <span>Search</span> <kbd>Ctrl K</kbd>
            </button>
            <Link to="/settings" title={syncText} className={`nav-item ${inSettings ? 'active' : ''}`} data-tour="settings" aria-current={inSettings ? 'page' : undefined}>
              {inSettings && <motion.span layoutId="nav-pill" className="nav-pill" transition={SPRING.snappy} />}
              <SettingsIcon size={19} strokeWidth={1.9} aria-hidden style={{ position: 'relative' }} />
              <span style={{ position: 'relative', display: 'grid' }}>Settings</span>
              {syncAttention && <span className="sync-dot" style={{ background: syncDot }} title={syncText} role="img" aria-label={syncText} />}
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
          <div className="topbar"><SectionTabs /><div className="topbar-tools"><FxCalc /><NotificationBell /></div></div>
          <AnimatedOutlet />
        </main>
      </div>
      <nav className="glass tabbar" aria-label="Main (mobile)">
        {SECTIONS.map((s) => { const Icon = s.icon; return <NavLink key={s.id} to={entry(s)} end className={`tab ${current?.id === s.id ? 'active' : ''}`}><Icon size={18} aria-hidden />{s.label.split(' ')[0]}</NavLink>; })}
        <NavLink to="/settings" className="tab"><SettingsIcon size={18} aria-hidden />Settings</NavLink>
      </nav>
      {update && <Toast message={`Update ${update.version} is ready`} action="Install & restart" onAction={() => void update.install()} onDone={() => setUpdate(null)} />}
      <CommandPalette pages={ALL_PAGES} />
      <GuidedTour />
      <button className="fab" aria-label="Quick add (shortcut N)" data-tour="fab" onClick={() => qa.open()}><Plus size={28} strokeWidth={2.2} /></button>
    </>
  );
}
