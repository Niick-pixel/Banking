import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { checkPin, clearFails, failState, getLockConfig, lockEnabled, recordFail, verifyPlatformAuth } from './lock';
import { Aurora } from '../design/components';
import { db } from '../db/db';

const Ctx = createContext<{ lockNow: () => void }>({ lockNow: () => {} });
export const useLock = () => useContext(Ctx);

/** Renders the app only while unlocked. Locks on start, after inactivity, and on "Lock now". */
export function LockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(lockEnabled());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAt = useRef<number | null>(null);
  const lockNow = useCallback(() => { if (lockEnabled()) setLocked(true); }, []);

  useEffect(() => {
    const minutes = () => getLockConfig()?.autoLockMinutes ?? 0;
    const arm = () => {
      if (timer.current) clearTimeout(timer.current);
      const m = minutes(); if (!m || !lockEnabled()) return;
      timer.current = setTimeout(() => setLocked(true), m * 60_000);
    };
    const onVis = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if (hiddenAt.current && minutes() && Date.now() - hiddenAt.current >= minutes() * 60_000) setLocked(true);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    document.addEventListener('visibilitychange', onVis);
    arm();
    return () => { events.forEach((e) => window.removeEventListener(e, arm)); document.removeEventListener('visibilitychange', onVis); if (timer.current) clearTimeout(timer.current); };
  }, [locked]);

  return <Ctx.Provider value={{ lockNow }}>{locked ? <LockScreen onUnlock={() => setLocked(false)} /> : children}</Ctx.Provider>;
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const cfg = getLockConfig();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [wait, setWait] = useState(failState().waitMs);
  const [forgot, setForgot] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); if (cfg?.webauthn) void bio(); /* offer biometrics right away */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!wait) return; const t = setInterval(() => setWait(failState().waitMs), 1000); return () => clearInterval(t); }, [wait]);

  async function bio() {
    try { if (await verifyPlatformAuth()) { clearFails(); onUnlock(); } } catch { /* cancelled: PIN is still there */ }
  }
  async function submit() {
    if (failState().waitMs) return;
    if (await checkPin(pin)) { clearFails(); onUnlock(); return; }
    recordFail(); setPin(''); const f = failState();
    setWait(f.waitMs); setErr(f.waitMs ? `Too many tries. Wait ${Math.ceil(f.waitMs / 1000)} s.` : 'Wrong PIN'); input.current?.focus();
  }
  async function erase() {
    if (prompt('This deletes the copy of your data on THIS device. Your data folder (OneDrive) and its backups are not touched; the app reloads from them. Type ERASE to continue.') !== 'ERASE') return;
    localStorage.removeItem('aufwind.lock'); localStorage.removeItem('aufwind.sync.state'); localStorage.removeItem('aufwind.sync.dirty'); clearFails();
    await db.delete(); location.reload();
  }

  return (
    <>
      <Aurora />
      <main className="lock" aria-label="Aufwind is locked">
        <div className="glass glass-strong lock-card">
          <img src="/icon.png" alt="" width={72} height={72} style={{ borderRadius: 18 }} />
          <h1 style={{ margin: 0, fontSize: 26 }}>Aufwind is locked</h1>
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: 'grid', gap: 10, width: '100%' }}>
            <label htmlFor="lock-pin" className="small muted">PIN</label>
            <input id="lock-pin" ref={input} className="input input-amount" style={{ textAlign: 'center', letterSpacing: '0.3em' }} type="password" inputMode="numeric" autoComplete="current-password" maxLength={12} value={pin} disabled={!!wait} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErr(''); }} aria-invalid={!!err} aria-describedby="lock-err" />
            <span id="lock-err" role="alert" className="small" style={{ color: 'var(--expense)', minHeight: 18 }}>{wait ? `Too many tries. Wait ${Math.ceil(wait / 1000)} s.` : err}</span>
            <button className="btn btn-primary" disabled={pin.length < 4 || !!wait}>Unlock</button>
          </form>
          {cfg?.webauthn && <button className="btn" onClick={() => void bio()}>Use Windows Hello / Face ID</button>}
          {!forgot ? <button className="btn btn-ghost btn-sm" onClick={() => setForgot(true)}>Forgot PIN?</button> : (
            <div className="small muted" style={{ display: 'grid', gap: 8, textAlign: 'left' }}>
              <span>The PIN can't be recovered. You can erase this device's copy; the app then reloads your data from your data folder (and asks for the data password if the file is encrypted). Without a data folder or a backup file, the data on this device is lost.</span>
              <button className="btn btn-danger btn-sm" onClick={() => void erase()}>Erase this device's copy…</button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
