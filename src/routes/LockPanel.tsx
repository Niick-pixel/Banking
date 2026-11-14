import { useEffect, useState } from 'react';
import { Glass, Pill } from '../design/components';
import { checkPin, getLockConfig, makePin, platformAuthAvailable, registerPlatformAuth, saveLockConfig, type LockConfig } from '../app/lock';
import { useLock } from '../app/LockGate';

export function LockPanel() {
  const [cfg, setCfg] = useState<LockConfig | null>(getLockConfig());
  const [bio, setBio] = useState(false);
  const [pin, setPin] = useState(''); const [pin2, setPin2] = useState(''); const [cur, setCur] = useState('');
  const [msg, setMsg] = useState('');
  const { lockNow } = useLock();
  useEffect(() => { void platformAuthAvailable().then(setBio); }, []);
  const save = (c: LockConfig | null) => { saveLockConfig(c); setCfg(c); };

  async function setNewPin() {
    if (!/^\d{4,12}$/.test(pin)) return setMsg('Use 4–12 digits.');
    if (pin !== pin2) return setMsg("The PINs don't match.");
    if (cfg?.pin && !(await checkPin(cur))) return setMsg('Current PIN is wrong.');
    save({ autoLockMinutes: cfg?.autoLockMinutes ?? 5, webauthn: cfg?.webauthn, pin: await makePin(pin) });
    setPin(''); setPin2(''); setCur(''); setMsg('PIN saved. Aufwind locks on start and after inactivity.');
  }
  async function disable() {
    if (!(await checkPin(cur))) return setMsg('Enter your current PIN to turn the lock off.');
    save(null); setCur(''); setMsg('App lock turned off.');
  }

  return (
    <Glass strong style={{ display: 'grid', gap: 10 }} id="lock">
      <h2 style={{ margin: 0, fontSize: 18 }}>App lock</h2>
      <p className="small muted" style={{ margin: 0 }}>Hides Aufwind behind a PIN on this device{bio ? ', with Windows Hello / Face ID as a shortcut' : ''}. It locks on start and after inactivity. To protect the file in OneDrive, use Encryption above.</p>
      {cfg?.pin && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pill tone="income">🔒 On</Pill>
        <label className="small">Auto-lock after <select className="input" style={{ width: 130, height: 34, display: 'inline-block' }} value={cfg.autoLockMinutes} onChange={(e) => save({ ...cfg, autoLockMinutes: Number(e.target.value) })}>
          {[1, 5, 15, 30, 60, 0].map((m) => <option key={m} value={m}>{m ? `${m} min` : 'Only on start'}</option>)}
        </select></label>
        <button className="btn btn-sm" onClick={lockNow}>Lock now</button>
      </div>}
      <form onSubmit={(e) => { e.preventDefault(); void setNewPin(); }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        {cfg?.pin && <div className="field"><label htmlFor="lp-c">Current PIN</label><input id="lp-c" className="input" style={{ width: 140 }} type="password" inputMode="numeric" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, ''))} /></div>}
        <div className="field"><label htmlFor="lp-1">{cfg?.pin ? 'New PIN' : 'PIN (4–12 digits)'}</label><input id="lp-1" className="input" style={{ width: 140 }} type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></div>
        <div className="field"><label htmlFor="lp-2">Repeat</label><input id="lp-2" className="input" style={{ width: 140 }} type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} /></div>
        <button className="btn btn-primary">{cfg?.pin ? 'Change PIN' : 'Turn on lock'}</button>
        {cfg?.pin && <button type="button" className="btn btn-ghost" onClick={() => void disable()}>Turn off</button>}
      </form>
      {cfg?.pin && bio && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {cfg.webauthn ? <><Pill tone="income">Windows Hello / Face ID on</Pill><button className="btn btn-sm btn-ghost" onClick={() => save({ ...cfg, webauthn: undefined })}>Remove</button></>
            : <button className="btn btn-sm" onClick={async () => { try { save({ ...cfg, webauthn: await registerPlatformAuth() }); setMsg('Windows Hello / Face ID set up.'); } catch (e) { setMsg(`Not set up: ${e instanceof Error ? e.message : e}`); } }}>Also unlock with Windows Hello / Face ID</button>}
        </div>
      )}
      {msg && <p role="status" className="small" style={{ margin: 0 }}>{msg}</p>}
    </Glass>
  );
}
