import { useEffect, useState } from 'react';
import { Glass, Pill } from '../design/components';
import { PageHeader } from '../ui/Sheet';
import { APP_VERSION, chooseFolder, hasSavedFolderNeedingPermission, openDataFolder, reconnectFolder, suggestedFolder, useSync } from '../sync';
import { isTauri, supportsFolderAccess } from '../sync/backends';
import { checkForUpdate, type UpdateInfo } from '../sync/updater';
import { useTheme, type ThemePref } from '../app/theme';
import { Segmented } from '../design/components';
import { Link } from 'react-router-dom';
import { useHealth } from '../app/data';
import { backupFileText, backupIsEncrypted, restoreFromFileText } from '../sync/backup';
import { EncryptionPanel } from './EncryptionPanel';
import { LockPanel } from './LockPanel';
import { saveFile } from '../export/download';
import { todayISO } from '../lib/dates';
import { usePref } from '../app/prefs';
import { notificationsAllowed } from '../app/reminders';

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const ago = (ms?: number) => {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString('es-CR');
};

function backupLabel(n: string) {
  const m = /^(\d{4}-\d{2}-\d{2})\.aufwind$/.exec(n);
  if (m) return `Daily · ${m[1]!.split('-').reverse().join('/')}`;
  const e = /^(pre-update|pre-import|pre-restore|pre-merge|merged|corrupt)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/.exec(n);
  if (e) return `${{ 'pre-update': 'Before update', 'pre-import': 'Before import', 'pre-restore': 'Before restore', 'pre-merge': 'Before merge', merged: 'Merged copy', corrupt: 'Damaged copy' }[e[1]!]} · ${e[2]!.split('-').reverse().join('/')} ${e[3]}:${e[4]} UTC`;
  return n;
}

export default function Settings() {
  const { engine, status } = useSync();
  const { theme, setTheme, transparency, setTransparency } = useTheme();
  const [backups, setBackups] = useState<string[]>([]);
  const [suggest, setSuggest] = useState<string | null>(null);
  const [needsPerm, setNeedsPerm] = useState(false);
  const [msg, setMsg] = useState('');
  const [upd, setUpd] = useState<UpdateInfo | null | 'none' | 'checking'>(null);
  const [pct, setPct] = useState<number | null>(null);
  const health = useHealth();
  const [notify, setNotify] = usePref('notifyBills');

  useEffect(() => { void suggestedFolder().then(setSuggest); void hasSavedFolderNeedingPermission().then(setNeedsPerm); }, []);
  useEffect(() => { if (engine) void engine.listBackups().then(setBackups); }, [engine, status?.revision]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setMsg('');
    try { await fn(); setMsg(label); } catch (e) { setMsg(`Failed: ${e instanceof Error ? e.message : e}`); }
  }

  return (
    <>
      <PageHeader title="Settings" sub={`Aufwind ${APP_VERSION}${isTauri() ? ' · Windows app' : ' · web'}`} />
      {msg && <Glass strong pad={14} style={{ marginBottom: 16 }} role="status">{msg}</Glass>}

      <div style={{ display: 'grid', gap: 16 }}>
        <Glass strong style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Data folder</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Your data is saved as one file, <code>aufwind-data.aufwind</code>, in a folder you choose. Put it in OneDrive and it's backed up and shared between your PCs. Daily backups live in its <code>backups</code> subfolder.
          </p>
          {!engine && !needsPerm && (
            isTauri() || (supportsFolderAccess() && !isIOS()) ? (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {suggest && <button className="btn btn-primary" onClick={() => void run('Data folder set', () => chooseFolder(suggest))}>Use {suggest}</button>}
                <button className={`btn ${suggest ? '' : 'btn-primary'}`} onClick={() => void run('Data folder set', () => chooseFolder())}>Choose folder…</button>
              </div>
            ) : isIOS() ? (
              <p className="small" style={{ margin: 0 }}>On iPhone, a web app can't keep a OneDrive folder in sync by itself. For now, move data between devices with <b>Backup file</b> below: save it to OneDrive from the Windows app, then <b>Restore from file</b> here and pick it in the Files app. It works the other way too.</p>
            ) : <Pill tone="debt">This browser can't save to a folder. Use the Windows app, or Chrome/Edge.</Pill>
          )}
          {needsPerm && <button className="btn btn-primary" onClick={() => void run('Reconnected', reconnectFolder)}>Reconnect data folder</button>}
          {engine && status && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px' }} className="small">
                <span className="muted">Location</span><code style={{ wordBreak: 'break-all' }}>{status.location}</code>
                <span className="muted">Status</span>
                <span>{status.phase === 'locked' ? <Pill tone="debt">Encrypted: enter the password below</Pill> : status.phase === 'error' ? <Pill tone="expense">{status.message}</Pill> : status.phase === 'syncing' ? 'Saving…' : status.dirty ? 'Changes waiting to save' : <Pill tone="income">✓ Saved {ago(status.lastSyncedAt)}</Pill>}</span>
                <span className="muted">Revision</span><span>{status.revision ?? '—'}{status.lastRemoteDevice && <span className="muted"> · last change from {status.lastRemoteDevice}</span>}</span>
              </div>
              {status.conflicts.length > 0 && <Pill tone="debt">{status.conflicts.length} record(s) were edited on two devices. The newer edit was kept, and the vault before the merge is in backups.</Pill>}
              {status.conflictedCopies.map((c) => (
                <div key={c} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Pill tone="debt">OneDrive made a conflict copy: {c}</Pill>
                  <button className="btn btn-sm" onClick={() => void run('Copy merged', () => engine.mergeConflictedCopy(c))}>Merge it in</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => void run('Saved', () => engine.syncNow())}>Save now</button>
                {isTauri() && <button className="btn" onClick={() => void openDataFolder()}>Open folder</button>}
                <button className="btn btn-ghost" onClick={() => void run('Data folder changed', () => chooseFolder())}>Change folder…</button>
              </div>
            </>
          )}
        </Glass>

        {engine && status && <EncryptionPanel />}

        {engine && (
          <Glass strong style={{ display: 'grid', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Backups</h2>
            <p className="muted small" style={{ margin: 0 }}>Kept: the last 30 days, the first of each month for a year, and the last 20 safety copies (before imports, updates, restores). Restoring makes that backup the data on every device; the current data is backed up first.</p>
            {backups.length === 0 ? <p className="muted" style={{ margin: 0 }}>None yet. The first daily backup appears tomorrow.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, maxHeight: 320, overflow: 'auto' }}>
                {backups.map((b) => (
                  <li key={b} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span>{backupLabel(b)}</span>
                    <button className="btn btn-sm" onClick={() => { if (confirm(`Restore "${backupLabel(b)}" on all devices? Your current data is backed up first.`)) void run('Restored', () => engine.restore(b)); }}>Restore</button>
                  </li>
                ))}
              </ul>
            )}
          </Glass>
        )}

        {isTauri() && (
          <Glass strong style={{ display: 'grid', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Updates</h2>
            <p className="muted small" style={{ margin: 0 }}>Aufwind checks for updates on start and every 6 hours. Updates are signed; anything that fails the signature check is discarded. Your data is backed up before installing.</p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn" disabled={upd === 'checking'} onClick={async () => { setUpd('checking'); try { setUpd((await checkForUpdate()) ?? 'none'); } catch (e) { setUpd(null); setMsg(`Update check failed: ${e}`); } }}>Check now</button>
              {upd === 'none' && <Pill tone="income">You're on the latest version</Pill>}
              {upd && typeof upd === 'object' && (
                <>
                  <Pill tone="savings">Version {upd.version} available</Pill>
                  <button className="btn btn-primary" disabled={pct !== null} onClick={() => void upd.install(setPct)}>{pct === null ? 'Install & restart' : `Installing ${pct}%`}</button>
                </>
              )}
            </div>
            {upd && typeof upd === 'object' && upd.notes && <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', margin: 0 }} className="small">{upd.notes}</pre>}
          </Glass>
        )}

        {!isTauri() && !standalone() && (
          <Glass strong style={{ display: 'grid', gap: 8 }} id="install">
            <h2 style={{ margin: 0, fontSize: 18 }}>Install Aufwind</h2>
            {isIOS() ? (
              <ol className="small" style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 4, listStyle: 'decimal' }}>
                <li>Open this page in <b>Safari</b>.</li>
                <li>Tap the <b>Share</b> button (square with an arrow).</li>
                <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
                <li>Open Aufwind from your Home Screen: full screen, works offline, and Face ID can unlock it (App lock below).</li>
              </ol>
            ) : <p className="small" style={{ margin: 0 }}>In Chrome or Edge, use the install icon in the address bar (or menu → <b>Install Aufwind</b>). On Windows, the desktop app from GitHub Releases is better: it syncs with your OneDrive folder.</p>}
          </Glass>
        )}

        <LockPanel />

        <Glass strong style={{ display: 'grid', gap: 10 }} id="health">
          <h2 style={{ margin: 0, fontSize: 18 }}>Data health</h2>
          {health.length === 0 ? <Pill tone="income">✓ Nothing to check. Totals, pots, debts and statements agree.</Pill> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
              {health.map((h) => (
                <li key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <Pill tone={h.level === 'error' ? 'expense' : h.level === 'warn' ? 'debt' : 'neutral'}>{h.level === 'error' ? 'fix' : h.level === 'warn' ? 'check' : 'info'}</Pill>
                  <span><b>{h.title}</b><br /><span className="small muted">{h.detail}</span> <Link className="small" to={h.to}>Go →</Link></span>
                </li>
              ))}
            </ul>
          )}
        </Glass>

        <Glass strong style={{ display: 'grid', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Backup file</h2>
          <p className="muted small" style={{ margin: 0 }}>A complete copy of your data in one file, the same format as the data folder. Restoring replaces the data on every synced device; your current data is backed up first when a folder is set.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => void run('Backup saved', async () => saveFile(`Aufwind_backup_${todayISO()}.aufwind`, await backupFileText(), 'application/json'))}>Download backup</button>
            <label className="btn">Restore from file…<input type="file" accept=".aufwind,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && confirm(`Replace all current data with "${f.name}"?`)) void run('Restored from file', async () => { const text = await f.text(); const pw = backupIsEncrypted(text) ? prompt('This backup is encrypted. Enter its data password:') ?? '' : undefined; return restoreFromFileText(text, pw); }); e.target.value = ''; }} /></label>
          </div>
        </Glass>

        <Glass strong style={{ display: 'grid', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Reminders</h2>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={notify} onChange={async (e) => { if (e.target.checked) { const ok = await notificationsAllowed(true); if (!ok) { setMsg('Notifications are blocked. Allow them for Aufwind in your system settings.'); return; } } await setNotify(e.target.checked); }} />
            Notify me about bills, card due dates and pay due today or tomorrow, and about items waiting for confirmation
          </label>
          <p className="small muted" style={{ margin: 0 }}>{isTauri() ? 'Shown in the Windows notification center while Aufwind is open or minimized.' : 'In the browser, notifications only appear while Aufwind is open in a tab.'}</p>
        </Glass>

        <Glass strong style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Appearance</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Segmented<ThemePref> label="Theme" value={theme} onChange={setTheme} options={[{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
            <Segmented label="Transparency" value={transparency} onChange={setTransparency} options={[{ value: 'auto', label: 'Glass' }, { value: 'reduced', label: 'Solid' }]} />
          </div>
        </Glass>
      </div>
    </>
  );
}
