/**
 * Full JSON backup as a downloadable file (same format as the vault, so a
 * backup file can be dropped into a data folder too) and restore from a file.
 */
import { db, type ColonDB } from '../db/db';
import { SYNCED_TABLES, emptySnapshot, parseVault, serializeVault, type Snapshot } from './vault';
import { getEngine, APP_VERSION } from './index';
import { restoredSnapshot } from './engine';
import { localKV } from './engine';

export async function snapshotOf(d: ColonDB = db): Promise<Snapshot> {
  const s = emptySnapshot();
  for (const t of SYNCED_TABLES) s.tables[t] = await d.table(t).toArray();
  s.tombstones = await d.tombstones.toArray();
  return s;
}

export async function backupFileText(): Promise<string> {
  return serializeVault(await snapshotOf(), { revision: 0, deviceId: localKV.get('colon.deviceId') ?? 'web', deviceName: 'manual backup', appVersion: APP_VERSION });
}

/** Validates the file (format + checksum) before touching anything. */
export async function restoreFromFileText(text: string): Promise<{ counts: Record<string, number> }> {
  const v = await parseVault(text);
  const engine = getEngine();
  if (engine) await engine.restoreSnapshot(v.data);
  else {
    const restored = restoredSnapshot(await snapshotOf(), v.data, Date.now());
    await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.tombstones], async () => {
      for (const t of SYNCED_TABLES) { await db.table(t).clear(); await db.table(t).bulkPut(restored.tables[t]); }
      await db.tombstones.clear(); await db.tombstones.bulkPut(restored.tombstones);
    });
  }
  return { counts: v.counts };
}
