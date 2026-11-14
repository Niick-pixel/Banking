import { useState } from 'react';
import { Glass, Pill } from '../design/components';
import { useSync } from '../sync';
import { passwordStrength } from '../sync/crypto';

/** Encrypt the data file in your folder with a password (OneDrive then only stores ciphertext). */
export function EncryptionPanel() {
  const { engine, status } = useSync();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [stored, setStored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState<'idle' | 'set'>('idle');
  if (!engine || !status) return null;
  const strength = passwordStrength(pw);
  const locked = status.phase === 'locked';
  const encrypted = engine.hasKey;

  async function go(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg('');
    try { await fn(); setMsg(ok); setPw(''); setPw2(''); setMode('idle'); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <Glass strong style={{ display: 'grid', gap: 10 }} id="encryption">
      <h2 style={{ margin: 0, fontSize: 18 }}>Encryption</h2>
      {locked ? (
        <>
          <Pill tone="debt">Your data file is encrypted. Enter its password to open it on this device.</Pill>
          <form onSubmit={(e) => { e.preventDefault(); void go(async () => { if (!(await engine.unlock(pw))) throw new Error("That password doesn't open the data file."); }, 'Unlocked. This device will remember it.'); }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input className="input" style={{ maxWidth: 320 }} type="password" autoComplete="current-password" aria-label="Data password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button className="btn btn-primary" disabled={busy || !pw}>{busy ? 'Checking…' : 'Unlock'}</button>
          </form>
        </>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {encrypted ? <><Pill tone="income">🔒 Encrypted</Pill> The file in your folder (and its backups) is AES-256 encrypted. OneDrive only stores scrambled data.</>
              : 'Encrypt the file in your folder with a password. OneDrive will only store scrambled data. You type the password once on each device.'}
          </p>
          {mode === 'idle' ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => setMode('set')}>{encrypted ? 'Change password' : 'Encrypt with a password…'}</button>
              {encrypted && <button className="btn btn-ghost" disabled={busy} onClick={() => { if (confirm('Turn encryption off? The file in your folder will be readable again.')) void go(() => engine.removePassword(), 'Encryption turned off.'); }}>Turn off</button>}
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void go(() => engine.setPassword(pw), encrypted ? 'Password changed. Other devices will ask for the new one.' : 'Encrypted. Other devices will ask for this password once.'); }} style={{ display: 'grid', gap: 10, maxWidth: 440 }}>
              <div className="field"><label htmlFor="enc-1">New password</label><input id="enc-1" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                {pw && <span className="small" style={{ color: ['var(--expense)', 'var(--debt)', 'var(--income)', 'var(--income)'][strength.score] }}>{strength.hint}</span>}</div>
              <div className="field"><label htmlFor="enc-2">Repeat it</label><input id="enc-2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={!!pw2 && pw2 !== pw} /></div>
              <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} /> I saved this password somewhere safe. If it's lost, the encrypted file and its backups cannot be opened by anyone, me included.</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" disabled={busy || strength.score === 0 || pw !== pw2 || !stored}>{busy ? 'Encrypting…' : encrypted ? 'Change password' : 'Encrypt'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>Cancel</button>
              </div>
            </form>
          )}
        </>
      )}
      {msg && <p role="status" className="small" style={{ margin: 0 }}>{msg}</p>}
    </Glass>
  );
}
