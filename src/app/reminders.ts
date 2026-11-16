/**
 * Bill reminders as system notifications (Windows notification center on the
 * desktop app; browser notifications on the web, only while the app is open).
 * Each event notifies at most once.
 */
import { isTauri } from '../sync/backends';
import { localKV } from '../sync/engine';
import type { CalendarEvent } from '../domain/recurring';
import { formatMoney } from '../lib/money';

export async function notificationsAllowed(ask = false): Promise<boolean> {
  if (isTauri()) {
    const n = await import('@tauri-apps/plugin-notification');
    if (await n.isPermissionGranted()) return true;
    return ask ? (await n.requestPermission()) === 'granted' : false;
  }
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  return ask ? (await Notification.requestPermission()) === 'granted' : false;
}

export async function send(title: string, body: string) {
  if (isTauri()) { const n = await import('@tauri-apps/plugin-notification'); n.sendNotification({ title, body }); }
  else new Notification(title, { body, icon: `${import.meta.env.BASE_URL}icon.png` });
}

/** Notify about bills a week ahead (once), again the day before and on the day, plus reminders waiting for confirmation. */
export async function notifyDue(events: CalendarEvent[], pendingCount: number, today: string, tomorrow: string) {
  if (!(await notificationsAllowed())) return;
  const seen = new Set<string>(JSON.parse(localKV.get('aufwind.notified') ?? '[]'));
  const fresh: string[] = [];
  for (const e of events) {
    if (e.status === 'posted' || e.status === 'skipped' || e.tone === 'info') continue;
    if (e.tone === 'income') continue;
    const near = e.date === today || e.date === tomorrow;
    // Near: the day before and on the day. Further out (up to a week): one heads-up per bill.
    const key = near ? `${e.date}|${e.title}` : `week|${e.date}|${e.title}`;
    if (seen.has(key)) continue;
    const days = Math.round((Date.parse(e.date) - Date.parse(today)) / 86_400_000);
    const when = e.date === today ? 'Today' : e.date === tomorrow ? 'Tomorrow' : `In ${days} days`;
    await send(`${when}: ${e.title}`, e.amount ? formatMoney(e.amount, 'CRC') : 'Open Aufwind for details');
    fresh.push(key);
  }
  const pk = `${today}|pending|${pendingCount}`;
  if (pendingCount > 0 && !seen.has(pk)) { await send('Aufwind', `${pendingCount} item(s) waiting for you to confirm`); fresh.push(pk); }
  if (fresh.length) localKV.set('aufwind.notified', JSON.stringify([...seen, ...fresh].slice(-300)));
}
