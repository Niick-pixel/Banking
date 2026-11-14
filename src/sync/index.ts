/**
 * App-level wiring: pick the backend (desktop folder or browser folder), start
 * the engine, expose status to React.
 */
import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { FolderBackend, TauriBackend, isTauri, supportsFolderAccess, type VaultBackend } from './backends';
import { SyncEngine, localKV, type SyncStatus } from './engine';

export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0-dev';

let engine: SyncEngine | null = null;
const listeners = new Set<(e: SyncEngine | null) => void>();
const setEngine = (e: SyncEngine | null) => { engine = e; listeners.forEach((l) => l(e)); };
export const getEngine = () => engine;

function deviceId() {
  let id = localKV.get('colon.deviceId');
  if (!id) { id = crypto.randomUUID(); localKV.set('colon.deviceId', id); }
  return id;
}
async function deviceName() {
  if (isTauri()) { try { const { invoke } = await import('@tauri-apps/api/core'); return await invoke<string>('device_name'); } catch { /* fall through */ } }
  return `${navigator.platform || 'Browser'} browser`;
}

async function savedBackend(): Promise<VaultBackend | null> {
  if (isTauri()) {
    const dir = localKV.get('colon.vault.dir');
    return dir ? new TauriBackend(dir) : null;
  }
  if (supportsFolderAccess()) {
    const rec = await db.settings.get('vaultDirHandle');
    if (rec?.value) {
      const b = new FolderBackend(rec.value as never);
      // Browsers need a click to re-grant access after a restart; Settings shows a "Reconnect" button.
      return (await (rec.value as { queryPermission?(o: object): Promise<string> }).queryPermission?.({ mode: 'readwrite' })) === 'granted' ? b : null;
    }
  }
  return null;
}

async function startWith(backend: VaultBackend) {
  engine?.stop();
  const e = new SyncEngine(db, backend, { deviceId: deviceId(), deviceName: await deviceName(), appVersion: APP_VERSION });
  setEngine(e);
  await e.start();
}

export async function bootSync() {
  const b = await savedBackend();
  if (b) await startWith(b);
}

/** Desktop: suggest %OneDrive%\Colon. */
export async function suggestedFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('suggest_data_dir');
}

/** Ask for a folder (native dialog on desktop, folder picker in Chromium) and start syncing to it. */
export async function chooseFolder(preset?: string): Promise<void> {
  if (isTauri()) {
    let dir = preset ?? null;
    if (!dir) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, title: 'Where should Colón keep your data?', defaultPath: (await suggestedFolder()) ?? undefined });
      dir = typeof picked === 'string' ? picked : null;
    }
    if (!dir) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('ensure_dir', { dir });
    localKV.set('colon.vault.dir', dir);
    await startWith(new TauriBackend(dir));
    return;
  }
  const b = await FolderBackend.pick();
  await db.settings.put({ key: 'vaultDirHandle', value: b.dir });
  await startWith(b);
}

export async function reconnectFolder() {
  const rec = await db.settings.get('vaultDirHandle');
  if (!rec?.value) return chooseFolder();
  const b = new FolderBackend(rec.value as never);
  if (await b.ensurePermission()) await startWith(b);
}

export async function hasSavedFolderNeedingPermission() {
  return !isTauri() && supportsFolderAccess() && !!(await db.settings.get('vaultDirHandle'))?.value && !engine;
}

export async function openDataFolder() {
  const dir = localKV.get('colon.vault.dir');
  if (!isTauri() || !dir) return;
  const { openPath } = await import('@tauri-apps/plugin-opener');
  await openPath(dir);
}

export function useSync(): { engine: SyncEngine | null; status: SyncStatus | null } {
  const [e, setE] = useState(engine);
  const [status, setStatus] = useState<SyncStatus | null>(engine?.status ?? null);
  useEffect(() => { const l = (x: SyncEngine | null) => setE(x); listeners.add(l); return () => void listeners.delete(l); }, []);
  useEffect(() => { if (!e) { setStatus(null); return; } return e.subscribe(setStatus) as () => void; }, [e]);
  return { engine: e, status };
}
