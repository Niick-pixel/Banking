/**
 * First-launch guided tour. Spotlights each part of the app in turn (navigating
 * to it), explains it in one or two sentences, and can be replayed from
 * Settings → Help. Keyboard: → / Enter next, ← back, Esc to skip.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { localKV } from '../sync/engine';
import { useTheme } from './theme';

interface Step { route?: string; target?: string; title: string; body: string }

export const TOUR_STEPS: Step[] = [
  { title: 'Welcome to Aufwind', body: 'A one-minute tour of where everything lives. Use → or Enter to continue, Esc to skip. You can replay it any time from Settings → Help.' },
  { route: '/', target: '[data-tour="sidebar"]', title: 'Five sections', body: 'Everything is grouped into Home, Activity, Budget, Debts & cards and Wealth. Related pages appear as tabs at the top of each section.' },
  { route: '/', target: '[data-tour="kpis"]', title: 'Home: your month at a glance', body: 'Income, spending, what you saved and the free cash left. Below: what happened in plain words, what\'s coming in the next 30 days, and charts you can hover and click. ‹ › switches months.' },
  { route: '/', target: '[data-tour="fab"]', title: 'Add anything in seconds', body: 'Click + or press N anywhere. Amount first, today\'s date is filled in. Paid in dollars? Switch to $ and Aufwind converts it with that day\'s BCCR rate.' },
  { route: '/transactions', target: '[data-tour="nav-activity"]', title: 'Activity', body: 'Every movement, grouped by month, with search and filters. The Bills & calendar tab holds your recurring pay and bills; reminders wait there for you to confirm.' },
  { route: '/tracker', target: '[data-tour="nav-budget"]', title: 'Budget', body: 'Your workbook\'s Tracker, live: budget vs actual for every category and month. Click any budget to change it. Reports exports to Excel, CSV or PDF.' },
  { route: '/debts', target: '[data-tour="nav-debts"]', title: 'Debts & cards', body: 'Payoff plans and what-if scenarios, Tasa Cero cuotas, and pots: money set aside inside an account (Her money / My money).' },
  { route: '/net-worth', target: '[data-tour="nav-wealth"]', title: 'Wealth', body: 'Net worth month by month, your emergency fund in months, savings goals, and calculators for CDPs, programmed savings and loans.' },
  { route: '/net-worth', target: '[data-tour="search"]', title: 'Search & commands', body: 'Press Ctrl K to jump to any page or run an action (export, lock, switch theme) without the mouse.' },
  { route: '/settings', target: '[data-tour="settings"]', title: 'Settings', body: 'Themes, layout, animations, dashboard cards, exchange rates, data folder, encryption, app lock, reminders: all here, by category.' },
  { title: 'You\'re set', body: 'Rise on what you already have. Tip: the dashboard\'s "to check" badge lists anything in your data that needs a look.' },
];

const DONE_KEY = 'aufwind.tourDone';
export const startTour = () => window.dispatchEvent(new Event('aufwind:tour'));

export function GuidedTour() {
  const [i, setI] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const nav = useNavigate();
  const loc = useLocation();
  const { dur } = useTheme();

  useEffect(() => {
    const open = () => setI(0);
    window.addEventListener('aufwind:tour', open);
    // First launch on this device: start after the app settles.
    const t = localKV.get(DONE_KEY) ? null : setTimeout(open, 1400);
    return () => { window.removeEventListener('aufwind:tour', open); if (t) clearTimeout(t); };
  }, []);

  const step = i === null ? null : TOUR_STEPS[i]!;
  const finish = useCallback(() => { localKV.set(DONE_KEY, '1'); setI(null); }, []);
  const go = useCallback((d: number) => setI((x) => (x === null ? x : Math.max(0, Math.min(TOUR_STEPS.length - 1, x + d)))), []);

  useEffect(() => { if (step?.route && loc.pathname !== step.route) nav(step.route); }, [step, loc.pathname, nav]);

  // Follow the target: it may move while pages animate in, or when the window resizes.
  useLayoutEffect(() => {
    if (!step?.target) { setRect(null); return; }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(step.target!);
      if (el) { const r = el.getBoundingClientRect(); setRect((old) => (old && Math.abs(old.x - r.x) < 0.5 && Math.abs(old.y - r.y) < 0.5 && Math.abs(old.width - r.width) < 0.5 && Math.abs(old.height - r.height) < 0.5 ? old : r)); }
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useEffect(() => {
    if (i === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); if (i === TOUR_STEPS.length - 1) finish(); else go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [i, go, finish]);

  if (i === null || !step) return null;
  const z = 1;
  const pad = 8;
  const r = rect ? { x: rect.x / z - pad, y: rect.y / z - pad, w: rect.width / z + pad * 2, h: rect.height / z + pad * 2 } : null;
  const vw = window.innerWidth / z, vh = window.innerHeight / z;
  const cardW = 380;
  let cardPos: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (r) {
    if (r.x + r.w + cardW + 24 < vw) cardPos = { left: r.x + r.w + 20, top: Math.min(Math.max(16, r.y), vh - 260) };
    else if (r.y + r.h + 240 < vh) cardPos = { left: Math.min(Math.max(16, r.x), vw - cardW - 16), top: r.y + r.h + 16 };
    else cardPos = { left: Math.max(16, r.x - cardW - 20), top: Math.min(Math.max(16, r.y), vh - 260) };
  }
  const last = i === TOUR_STEPS.length - 1;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <motion.div className="tour-spot" initial={false}
        animate={r ? { left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 18, opacity: 1 } : { left: vw / 2, top: vh / 2, width: 0, height: 0, borderRadius: 18, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 170, damping: 26, duration: dur(0.7) }} />
      <AnimatePresence mode="wait">
        <motion.div key={i} className="glass glass-strong tour-card" style={{ position: 'fixed', width: cardW, ...cardPos }}
          initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: dur(0.45), delay: dur(0.15) } }} exit={{ opacity: 0, transition: { duration: dur(0.18) } }}>
          <div className="small muted" style={{ marginBottom: 4 }}>{i + 1} of {TOUR_STEPS.length}</div>
          <h2 id="tour-title" style={{ margin: '0 0 8px', fontSize: 20, letterSpacing: '-0.02em' }}>{step.title}</h2>
          <p id="tour-body" style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.5 }}>{step.body}</p>
          <div className="tour-dots" aria-hidden>{TOUR_STEPS.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 14 }}>
            <button className="btn btn-ghost btn-sm" onClick={finish}>{last ? 'Close' : 'Skip tour'}</button>
            <span style={{ display: 'flex', gap: 8 }}>
              {i > 0 && <button className="btn btn-sm" onClick={() => go(-1)}>Back</button>}
              <button className="btn btn-primary btn-sm" autoFocus onClick={() => (last ? finish() : go(1))}>{last ? 'Start using Aufwind' : 'Next'}</button>
            </span>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
