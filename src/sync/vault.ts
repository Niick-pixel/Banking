/**
 * The vault: one self-describing JSON file holding every synced record.
 * It lives in a folder you choose (e.g. OneDrive\Colon) and is the source of
 * truth across devices. Pure functions only. I/O lives in backends.ts.
 */

export const VAULT_FORMAT = 'colon-vault';
export const VAULT_VERSION = 1;
export const VAULT_FILE = 'colon-data.colon';

/** Tables that travel in the vault. The audit log, attachments and local settings stay on the device. */
export const SYNCED_TABLES = [
  'accounts', 'pots', 'categories', 'transactions', 'debts', 'selfLoans', 'recurring', 'snapshots',
  'budgets', 'goals', 'rates', 'importBatches', 'installments', 'prefs',
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export interface Tomb { table: string; id: string; at: number }
export interface VaultRecord { id: string; updatedAt?: number; [k: string]: unknown }
export interface Snapshot { tables: Record<SyncedTable, VaultRecord[]>; tombstones: Tomb[] }

export interface VaultHeader {
  format: typeof VAULT_FORMAT;
  formatVersion: number;
  revision: number;
  savedAt: number;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  checksum: string;
  counts: Record<string, number>;
}
export interface VaultFile extends VaultHeader { data: Snapshot }

export class VaultError extends Error {
  constructor(message: string, readonly kind: 'corrupt' | 'format' | 'newer') { super(message); this.name = 'VaultError'; }
}

export function emptySnapshot(): Snapshot {
  return { tables: Object.fromEntries(SYNCED_TABLES.map((t) => [t, []])) as unknown as Snapshot['tables'], tombstones: [] };
}

/** Stable JSON: object keys sorted, so the checksum doesn't depend on property order. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function serializeVault(data: Snapshot, meta: Pick<VaultHeader, 'revision' | 'deviceId' | 'deviceName' | 'appVersion'> & { savedAt?: number }): Promise<string> {
  const body = canonical(data);
  const header: VaultHeader = {
    format: VAULT_FORMAT, formatVersion: VAULT_VERSION, revision: meta.revision, savedAt: meta.savedAt ?? Date.now(),
    deviceId: meta.deviceId, deviceName: meta.deviceName, appVersion: meta.appVersion, checksum: await sha256(body),
    counts: Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v.length])),
  };
  // Header first and human-readable; data last.
  return `{"header":${JSON.stringify(header, null, 1)},\n"data":${body}}\n`;
}

export async function parseVault(text: string): Promise<VaultFile> {
  let raw: { header?: VaultHeader; data?: Snapshot };
  try { raw = JSON.parse(text); } catch { throw new VaultError('The data file is incomplete or damaged (not valid JSON). It may still be syncing.', 'corrupt'); }
  const h = raw.header;
  if (!h || h.format !== VAULT_FORMAT || !raw.data) throw new VaultError('This is not a Colón data file.', 'format');
  if (h.formatVersion > VAULT_VERSION) throw new VaultError(`This data file was written by a newer version of Colón (format ${h.formatVersion}). Update the app first.`, 'newer');
  const sum = await sha256(canonical(raw.data));
  if (sum !== h.checksum) throw new VaultError('The data file failed its integrity check (checksum mismatch). It may be a partial sync.', 'corrupt');
  const data = emptySnapshot();
  for (const t of SYNCED_TABLES) data.tables[t] = raw.data.tables?.[t] ?? [];
  data.tombstones = raw.data.tombstones ?? [];
  return { ...h, data };
}

export interface MergeResult {
  data: Snapshot;
  /** Records edited on both sides since the last sync; the newer edit was kept. */
  conflicts: { table: string; id: string; kept: 'local' | 'remote' }[];
  changedLocal: boolean;  // remote brought something new
  changedRemote: boolean; // local has something the vault lacks
}

const TOMB_TTL = 180 * 86_400_000;

/**
 * Merge two snapshots record by record. The newer `updatedAt` wins. A tombstone
 * deletes a record unless the record was edited after the deletion.
 * `since` = time of the last successful sync (used only to report true conflicts).
 */
export function mergeSnapshots(local: Snapshot, remote: Snapshot, since: number, now = Date.now()): MergeResult {
  const conflicts: MergeResult['conflicts'] = [];
  let changedLocal = false, changedRemote = false;
  const tombs = new Map<string, Tomb>();
  for (const t of [...local.tombstones, ...remote.tombstones]) {
    if (now - t.at > TOMB_TTL) continue;
    const k = `${t.table}|${t.id}`;
    const prev = tombs.get(k);
    if (!prev || t.at > prev.at) tombs.set(k, t);
  }
  const out = emptySnapshot();
  for (const table of SYNCED_TABLES) {
    const L = new Map(local.tables[table].map((r) => [r.id, r]));
    const R = new Map(remote.tables[table].map((r) => [r.id, r]));
    for (const id of new Set([...L.keys(), ...R.keys()])) {
      const l = L.get(id), r = R.get(id);
      let pick: VaultRecord;
      if (l && r) {
        const lu = l.updatedAt ?? 0, ru = r.updatedAt ?? 0;
        const same = lu === ru && canonical(l) === canonical(r);
        pick = ru > lu ? r : l;
        if (!same) {
          if (ru > lu) changedLocal = true; else changedRemote = true;
          if (lu > since && ru > since) conflicts.push({ table, id, kept: ru > lu ? 'remote' : 'local' });
        }
      } else if (l) { pick = l; changedRemote = true; }
      else { pick = r!; changedLocal = true; }
      const tomb = tombs.get(`${table}|${id}`);
      if (tomb && tomb.at >= (pick.updatedAt ?? 0)) {
        if (L.has(id)) changedLocal = true;
        if (R.has(id)) changedRemote = true;
        continue;
      }
      out.tables[table].push(pick);
    }
  }
  out.tombstones = [...tombs.values()];
  // Tombstones that only one side knew about also count as changes.
  const lt = new Set(local.tombstones.map((t) => `${t.table}|${t.id}|${t.at}`));
  const rt = new Set(remote.tombstones.map((t) => `${t.table}|${t.id}|${t.at}`));
  for (const t of out.tombstones) {
    const k = `${t.table}|${t.id}|${t.at}`;
    if (!lt.has(k)) changedLocal = true;
    if (!rt.has(k)) changedRemote = true;
  }
  return { data: out, conflicts, changedLocal, changedRemote };
}

// ── Backup naming & retention ───────────────────────────────────────────────
export const BACKUP_DIR = 'backups';
export const dailyBackupName = (isoDate: string) => `${isoDate}.colon`;
export const eventBackupName = (kind: 'pre-update' | 'pre-import' | 'pre-restore' | 'pre-merge' | 'corrupt', stamp: string) => `${kind}-${stamp}.colon`;

/** Keep the newest 30 daily backups plus the first backup of each of the last 12 months; event backups: newest 20. */
export function backupsToPrune(names: string[]): string[] {
  const daily = names.filter((n) => /^\d{4}-\d{2}-\d{2}\.colon$/.test(n)).sort().reverse();
  const keep = new Set(daily.slice(0, 30));
  const months = new Map<string, string>();
  for (const n of [...daily].reverse()) if (!months.has(n.slice(0, 7))) months.set(n.slice(0, 7), n);
  [...months.values()].sort().reverse().slice(0, 12).forEach((n) => keep.add(n));
  const events = names.filter((n) => /^(pre-|corrupt-)/.test(n)).sort().reverse();
  events.slice(0, 20).forEach((n) => keep.add(n));
  return names.filter((n) => n.endsWith('.colon') && !keep.has(n));
}

/** OneDrive/Dropbox/Google Drive name their conflict copies like "colon-data-LAPTOP.colon" or "colon-data (1).colon". */
export function isConflictedCopy(name: string): boolean {
  return name !== VAULT_FILE && /^colon-data.*\.colon$/i.test(name) && !name.endsWith('.tmp');
}
