/**
 * Over-the-air updates (desktop only). Checks GitHub Releases' latest.json,
 * verifies the signature (done by the plugin with the public key baked into
 * the app), backs up your data, installs, and relaunches.
 */
import { isTauri } from './backends';
import { getEngine } from './index';

export interface UpdateInfo { version: string; notes: string; date?: string; install: (onProgress?: (pct: number) => void) => Promise<void> }

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const u = await check();
  if (!u) return null;
  return {
    version: u.version, notes: u.body ?? '', date: u.date,
    async install(onProgress) {
      await getEngine()?.syncNow();
      await getEngine()?.backupNow('pre-update');
      let total = 0, got = 0;
      await u.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        if (ev.event === 'Progress') { got += ev.data.chunkLength; if (total) onProgress?.(Math.round((got / total) * 100)); }
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}
