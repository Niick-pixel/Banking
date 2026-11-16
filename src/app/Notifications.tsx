/**
 * The bell (top right): everything that wants your attention, in one place, each
 * with the action to take. Coach warnings, bills in the next 7 days, reminders to
 * confirm, the quincena balance check-in, and data fixes. What you've seen and
 * cleared is remembered on this device.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Bell, CalendarClock, CheckCheck, CircleAlert, Info, Landmark, PiggyBank, X } from 'lucide-react';
import { useHealth, useLedger } from './data';
import { useCalendar, usePendingReminders } from './useRecurring';
import { useCoach } from './coach';
import { usePersisted } from './persist';
import { useTheme } from './theme';
import { checkInStatus, quincenaStart } from '../domain/checkin';
import { useFundMoves } from '../routes/FundMovesFix';
import { formatMoney } from '../lib/money';
import { formatDateCR, todayISO } from '../lib/dates';

type Level = 'critical' | 'warning' | 'info';
interface Note {
  id: string; level: Level; icon: 'alert' | 'bill' | 'bank' | 'savings' | 'info';
  title: string; body?: string;
  primary?: { label: string; to?: string; run?: () => Promise<void> | void };
  onDismiss?: () => void;
}

const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function useNotifications(): Note[] {
  const l = useLedger();
  const coach = useCoach();
  const health = useHealth();
  const pending = usePendingReminders();
  const moves = useFundMoves();
  const today = todayISO();
  const week = useCalendar(plusDays(today, 0), plusDays(today, 7));
  return useMemo(() => {
    const out: Note[] = [];
    // Coach: only what needs action now.
    for (const i of coach?.run?.dispatch.inbox ?? []) {
      if (i.severity !== 'critical' && i.severity !== 'warning') continue;
      out.push({ id: `coach:${i.dedupeKey}`, level: i.severity, icon: 'alert', title: i.title, body: i.body, primary: { label: 'Open in Coach', to: '/coach' }, onDismiss: () => void coach.dismiss(i) });
    }
    // Reminders waiting for the real amount.
    if (pending.length) out.push({ id: `pending:${pending.map((p) => `${p.rule.id}${p.date}`).join(',')}`, level: 'warning', icon: 'bill', title: `${pending.length} bill${pending.length > 1 ? 's' : ''} to confirm`, body: pending.slice(0, 3).map((p) => `${p.rule.name} (${formatDateCR(p.date).slice(0, 5)})`).join(', '), primary: { label: 'Confirm amounts', to: '/bills' } });
    // Everything due in the next 7 days.
    for (const e of week) {
      if (e.status === 'posted' || e.status === 'skipped' || e.status === 'pending' || e.tone === 'info' || e.tone === 'income') continue;
      const days = Math.round((Date.parse(e.date) - Date.parse(today)) / 86_400_000);
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days, ${WEEKDAY[new Date(`${e.date}T12:00:00Z`).getUTCDay()]} ${formatDateCR(e.date).slice(0, 5)}`;
      out.push({ id: `due:${e.date}|${e.title}`, level: days <= 1 ? 'warning' : 'info', icon: e.tone === 'savings' ? 'savings' : 'bill', title: `${e.title} ${e.tone === 'savings' ? 'goes to savings' : 'is due'} ${when}`, body: e.amount ? formatMoney(e.amount, 'CRC') : undefined, primary: { label: 'See calendar', to: e.to } });
    }
    // Quincena balance check-in.
    const due = checkInStatus(l.accounts, l.snapshots, today).filter((s) => s.due);
    if (due.length) out.push({ id: `checkin:${quincenaStart(today)}`, level: 'info', icon: 'bank', title: `Balance check-in: ${due.length} account${due.length > 1 ? 's' : ''} to check`, body: `Type what your bank shows for ${due.slice(0, 3).map((d) => d.account.name).join(', ')}${due.length > 3 ? '…' : ''}, so everything matches your statement.`, primary: { label: 'Check in now', to: '/check-in' } });
    // Moves into funds that the budget can't see.
    if (moves.items.length) out.push({ id: `fundmoves:${moves.items.map((i) => i.tx.id).join(',')}`, level: 'warning', icon: 'savings', title: `${moves.items.length} move${moves.items.length > 1 ? 's' : ''} into savings ${moves.items.length > 1 ? 'are' : 'is'} missing from your budget`, body: moves.items.slice(0, 2).map((i) => `${formatMoney(i.tx.amount, 'CRC')} on ${formatDateCR(i.tx.date)}`).join(', '), primary: { label: 'Count as savings', run: () => moves.fix() } });
    // Data health (errors and warnings; the fund-move one is above).
    for (const h of health) if (h.level !== 'info' && h.id !== 'fund-moves') out.push({ id: `health:${h.id}:${h.title}`, level: h.level === 'error' ? 'critical' : 'warning', icon: 'info', title: h.title, body: h.detail, primary: { label: 'Open', to: h.to } });
    const rank = { critical: 0, warning: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }, [coach, pending, week, l.accounts, l.snapshots, moves, health, today]);
}

const ICONS = { alert: AlertTriangle, bill: CalendarClock, bank: Landmark, savings: PiggyBank, info: Info };

export function NotificationBell() {
  const all = useNotifications();
  const nav = useNavigate();
  const { dur } = useTheme();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = usePersisted<string[]>('notif.seen', []);
  const [hidden, setHidden] = usePersisted<string[]>('notif.hidden', []);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const items = all.filter((n) => !hidden.includes(n.id));
  const unread = items.filter((n) => !seen.includes(n.id));
  const urgent = unread.some((n) => n.level !== 'info');

  // Opening marks everything as seen; ids that no longer exist are forgotten.
  useEffect(() => { if (open && unread.length) setSeen(items.map((n) => n.id)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ids = new Set(all.map((n) => n.id));
    if (hidden.some((h) => !ids.has(h))) setHidden(hidden.filter((h) => ids.has(h)));
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const onDown = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey); window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [open]);

  const dismiss = (n: Note) => { n.onDismiss?.(); setHidden([...hidden, n.id]); };
  const act = async (n: Note) => {
    if (n.primary?.run) { await n.primary.run(); return; }
    if (n.primary?.to) { setOpen(false); nav(n.primary.to); }
  };
  const rect = btn.current?.getBoundingClientRect();

  return (
    <>
      <button ref={btn} className={`bell ${unread.length ? 'has-unread' : ''}`} aria-label={`Notifications${unread.length ? `, ${unread.length} new` : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <Bell size={20} strokeWidth={1.9} aria-hidden />
        {unread.length > 0 && <span className={`bell-badge ${urgent ? 'urgent' : ''}`} aria-hidden>{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div ref={panel} role="dialog" aria-label="Notifications" className="glass glass-strong bell-panel"
              style={{ top: rect.bottom + 10, right: Math.max(12, window.innerWidth - rect.right) }}
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0, transition: { duration: dur(0.22) } }} exit={{ opacity: 0, y: -6, transition: { duration: dur(0.15) } }}>
              <div className="bell-head">
                <b>Notifications</b>
                <span className="small muted">{items.length ? `${items.length} item${items.length > 1 ? 's' : ''}` : ''}</span>
                {items.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setHidden([...hidden, ...items.map((n) => n.id)])}><CheckCheck size={16} aria-hidden /> Clear all</button>}
              </div>
              <div className="bell-list">
                {items.length === 0 && <div className="bell-empty"><CheckCheck size={28} aria-hidden /><div>All clear. Nothing needs you right now.</div><div className="small muted">Bills show up here a week before they're due.</div></div>}
                {items.map((n) => {
                  const Icon = n.level === 'critical' ? CircleAlert : ICONS[n.icon];
                  return (
                    <div key={n.id} className={`bell-item lvl-${n.level} ${seen.includes(n.id) ? '' : 'new'}`}>
                      <span className="bell-ic" aria-hidden><Icon size={18} /></span>
                      <div className="bell-body">
                        <div className="bell-title">{n.title}</div>
                        {n.body && <div className="small muted bell-text">{n.body}</div>}
                        {n.primary && <button className="btn btn-sm bell-act" onClick={() => void act(n)}>{n.primary.label}</button>}
                      </div>
                      <button className="btn btn-ghost btn-sm bell-x" aria-label={`Clear: ${n.title}`} onClick={() => dismiss(n)}><X size={15} /></button>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>, document.body)}
    </>
  );
}
