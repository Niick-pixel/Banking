/**
 * Keeps the local working database (IndexedDB) and the vault file in your folder in step.
 *
 *   local edit ─▶ mark dirty ─(2 s)─▶ sync()
 *   app start / window focus / every 60 s ─▶ sync()
 *
 * sync():
 *   vault missing              → write local as revision 1 (or next)
 *   vault unchanged since ours → write local if dirty
 *   vault changed elsewhere    → not dirty: load it · dirty: merge, then write
 * Before the first write each day the previous vault is copied to backups/.
 */
import type { AufwindDB } from '../db/db';
import type { VaultBackend } from './backends';
import { deriveVaultKey, type VaultKey } from './crypto';
import {
  SYNCED_TABLES, VaultError, backupsToPrune, dailyBackupName, emptySnapshot, eventBackupName, isConflictedCopy,
  mergeSnapshots, parseVault, peekHeader, serializeVault, type Snapshot, type VaultFile,
} from './vault';

export interface KV { get(k: string): string | null; set(k: string, v: string): void }
export const localKV: KV = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

interface SyncState { revision: number; checksum: string; syncedAt: number }

export interface SyncStatus {
  phase: 'off' | 'idle' | 'syncing' | 'error' | 'locked';
  /** The file in the folder is encrypted (as last read or written). */
  encrypted?: boolean;
  location?: string;
  revision?: number;
  lastSyncedAt?: number;
  lastRemoteDevice?: string;
  message?: string;
  conflicts: { table: string; id: string; kept: 'local' | 'remote' }[];
  conflictedCopies: string[];
  dirty: boolean;
}

export interface EngineOptions { deviceId: string; deviceName: string; appVersion: string; kv?: KV; now?: () => number; debounceMs?: number; key?: VaultKey | null; onKeyChange?: (k: VaultKey | null) => void }

export class SyncEngine {
  private kv: KV;
  private now: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private applyingRemote = false;
  private unhook: (() => void)[] = [];
  private listeners = new Set<(s: SyncStatus) => void>();
  private key: VaultKey | null;
  status: SyncStatus;

  constructor(private db: AufwindDB, private backend: VaultBackend, private opts: EngineOptions) {
    this.kv = opts.kv ?? localKV;
    this.now = opts.now ?? Date.now;
    this.key = opts.key ?? null;
    this.status = { phase: 'idle', location: backend.label, conflicts: [], conflictedCopies: [], dirty: this.dirty };
  }

  // ── state ────────────────────────────────────────────────────────────────
  private get state(): SyncState | null { const s = this.kv.get('aufwind.sync.state'); return s ? JSON.parse(s) : null; }
  private set state(s: SyncState | null) { this.kv.set('aufwind.sync.state', JSON.stringify(s)); }
  get dirty() { return this.kv.get('aufwind.sync.dirty') === '1'; }
  private set dirty(v: boolean) { this.kv.set('aufwind.sync.dirty', v ? '1' : '0'); }
  private emit(p: Partial<SyncStatus>) { this.status = { ...this.status, ...p, dirty: this.dirty }; this.listeners.forEach((l) => l(this.status)); }
  subscribe(fn: (s: SyncStatus) => void) { this.listeners.add(fn); fn(this.status); return () => this.listeners.delete(fn); }

  // ── lifecycle ────────────────────────────────────────────────────────────
  async start() {
    this.installHooks();
    await this.flushPendingTombs();
    await this.syncNow();
    this.poll = setInterval(() => void this.syncNow(), 60_000);
    if (typeof window !== 'undefined') window.addEventListener('focus', this.onFocus);
  }
  stop() {
    this.unhook.forEach((u) => u()); this.unhook = [];
    if (this.poll) clearInterval(this.poll);
    if (this.timer) clearTimeout(this.timer);
    if (typeof window !== 'undefined') window.removeEventListener('focus', this.onFocus);
  }
  private onFocus = () => void this.syncNow();

  private installHooks() {
    for (const name of SYNCED_TABLES) {
      const t = this.db.table(name);
      const mark = () => { if (!this.applyingRemote) this.markDirty(); };
      const onDelete = (primKey: unknown) => {
        if (this.applyingRemote) return;
        this.addPendingTomb({ table: name, id: String(primKey), at: this.now() });
        this.markDirty();
      };
      t.hook('creating', mark); t.hook('updating', mark); t.hook('deleting', onDelete);
      this.unhook.push(() => { t.hook('creating').unsubscribe(mark); t.hook('updating').unsubscribe(mark); t.hook('deleting').unsubscribe(onDelete); });
    }
  }

  /** Deletions are written to localStorage synchronously, then into the DB, so none is lost on a crash. */
  private addPendingTomb(t: { table: string; id: string; at: number }) {
    const list = JSON.parse(this.kv.get('aufwind.sync.pendingTombs') ?? '[]');
    list.push(t); this.kv.set('aufwind.sync.pendingTombs', JSON.stringify(list));
  }
  private async flushPendingTombs() {
    const list = JSON.parse(this.kv.get('aufwind.sync.pendingTombs') ?? '[]');
    if (!list.length) return;
    await this.db.tombstones.bulkPut(list);
    this.kv.set('aufwind.sync.pendingTombs', '[]');
  }

  markDirty() {
    this.dirty = true;
    this.emit({});
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), this.opts.debounceMs ?? 2000);
  }

  /** Serialised: concurrent calls coalesce into one extra pass. */
  syncNow(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      try {
        do { this.again = false; await this.flushPendingTombs(); await this.syncOnce(); } while (this.again);
      } finally { this.running = null; }
    })();
    return this.running;
  }

  // ── snapshot <-> DB ──────────────────────────────────────────────────────
  async exportLocal(): Promise<Snapshot> {
    const s = emptySnapshot();
    await this.db.transaction('r', [...SYNCED_TABLES.map((t) => this.db.table(t)), this.db.tombstones], async () => {
      for (const t of SYNCED_TABLES) s.tables[t] = await this.db.table(t).toArray();
      s.tombstones = await this.db.tombstones.toArray();
    });
    return s;
  }
  private async replaceLocal(s: Snapshot) {
    this.applyingRemote = true;
    try {
      await this.db.transaction('rw', [...SYNCED_TABLES.map((t) => this.db.table(t)), this.db.tombstones], async () => {
        for (const t of SYNCED_TABLES) { await this.db.table(t).clear(); await this.db.table(t).bulkPut(s.tables[t]); }
        await this.db.tombstones.clear(); await this.db.tombstones.bulkPut(s.tombstones);
      });
    } finally { this.applyingRemote = false; }
  }

  private async write(data: Snapshot, revision: number, previousText: string | null) {
    await this.dailyBackup(previousText);
    const text = await serializeVault(data, { revision, deviceId: this.opts.deviceId, deviceName: this.opts.deviceName, appVersion: this.opts.appVersion, savedAt: this.now() }, this.key);
    await this.backend.writeMain(text);
    const v = await parseVault(text, this.key);
    this.state = { revision, checksum: v.checksum, syncedAt: this.now() };
    this.dirty = false;
  }

  private async syncOnce() {
    this.emit({ phase: 'syncing' });
    try {
      const text = await this.backend.readMain();
      const st = this.state;
      const wasDirty = this.dirty;
      if (text === null) {
        await this.write(await this.exportLocal(), (st?.revision ?? 0) + 1, null);
      } else {
        const remote = await parseVault(text, this.key);
        const unchanged = st && remote.revision === st.revision && remote.checksum === st.checksum;
        if (unchanged) {
          if (wasDirty) await this.write(await this.exportLocal(), remote.revision + 1, text);
        } else if (!wasDirty && st) {
          await this.replaceLocal(remote.data);
          this.state = { revision: remote.revision, checksum: remote.checksum, syncedAt: this.now() };
          this.emit({ lastRemoteDevice: remote.deviceName });
        } else {
          // Both sides may have changed (or first link of this device to an existing vault): merge.
          const local = await this.exportLocal();
          const m = mergeSnapshots(local, remote.data, st?.syncedAt ?? 0, this.now());
          if (m.conflicts.length) await this.backend.writeBackup(eventBackupName('pre-merge', stamp(this.now())), text);
          if (m.changedLocal) await this.replaceLocal(m.data);
          if (m.changedRemote) await this.write(m.data, remote.revision + 1, text);
          else { this.state = { revision: remote.revision, checksum: remote.checksum, syncedAt: this.now() }; this.dirty = false; }
          this.emit({ conflicts: m.conflicts, lastRemoteDevice: remote.deviceName });
        }
      }
      const root = await this.backend.listRoot();
      this.emit({ phase: 'idle', encrypted: !!this.key, message: undefined, revision: this.state?.revision, lastSyncedAt: this.state?.syncedAt, conflictedCopies: root.filter(isConflictedCopy) });
    } catch (e) {
      if (e instanceof VaultError && (e.kind === 'locked' || e.kind === 'wrong-password')) {
        // Never overwrite an encrypted file we can't read: wait for the password.
        this.emit({ phase: 'locked', encrypted: true, message: e.message });
        return;
      }
      const msg = e instanceof VaultError ? e.message : `Couldn't reach the data folder: ${e instanceof Error ? e.message : e}`;
      this.emit({ phase: 'error', message: msg });
    }
  }

  // ── backups ──────────────────────────────────────────────────────────────
  private async dailyBackup(previousText: string | null) {
    if (!previousText) return;
    const name = dailyBackupName(new Date(this.now()).toISOString().slice(0, 10));
    const existing = await this.backend.listBackups();
    if (!existing.includes(name)) {
      await this.backend.writeBackup(name, previousText);
      for (const old of backupsToPrune([...existing, name])) await this.backend.deleteBackup(old);
    }
  }

  /** Snapshot this device's data before something risky (import, update, restore). */
  async backupNow(kind: 'pre-update' | 'pre-import' | 'pre-restore'): Promise<string> {
    const name = eventBackupName(kind, stamp(this.now()));
    const text = await serializeVault(await this.exportLocal(), { revision: this.state?.revision ?? 0, deviceId: this.opts.deviceId, deviceName: this.opts.deviceName, appVersion: this.opts.appVersion, savedAt: this.now() }, this.key);
    await this.backend.writeBackup(name, text);
    return name;
  }

  listBackups() { return this.backend.listBackups().then((l) => l.filter((n) => n.endsWith('.aufwind')).sort().reverse()); }

  /**
   * Make a backup the truth on every device: records are re-stamped "now" so they
   * win merges, and anything not in the backup gets a tombstone.
   */
  async restore(name: string) {
    await this.restoreSnapshot((await this.readBackupWithKey(name)).data);
  }

  /** Make a snapshot the truth on every device (backup first, re-stamp, tombstone extras). */
  async restoreSnapshot(data: Snapshot) {
    await this.backupNow('pre-restore');
    await this.replaceLocal(restoredSnapshot(await this.exportLocal(), data, this.now()));
    this.dirty = true;
    await this.syncNow();
  }

  /** Fold a cloud "conflicted copy" back in, then move it into backups/. */
  async mergeConflictedCopy(name: string) {
    const copy = await parseVault(await this.backend.readRoot(name), this.key);
    const local = await this.exportLocal();
    const m = mergeSnapshots(local, copy.data, 0, this.now());
    await this.replaceLocal(m.data);
    await this.backend.moveRootToBackups(name, `merged-${stamp(this.now())}-${name}`);
    this.dirty = true;
    await this.syncNow();
    return m.conflicts.length;
  }

  /** Read a vault without applying it (for showing what a backup contains). */
  async peekBackup(name: string): Promise<VaultFile> { return this.readBackupWithKey(name); }

  /** Backups made before a password change still open with the old key if this device has it; otherwise ask. */
  private async readBackupWithKey(name: string): Promise<VaultFile> { return parseVault(await this.backend.readBackup(name), this.key); }

  // ── Encryption ───────────────────────────────────────────────────────────
  get hasKey() { return !!this.key; }

  /** A complete backup as text, encrypted with the current key when there is one. */
  async backupText(): Promise<string> {
    return serializeVault(await this.exportLocal(), { revision: this.state?.revision ?? 0, deviceId: this.opts.deviceId, deviceName: 'manual backup', appVersion: this.opts.appVersion }, this.key);
  }

  /** Turn encryption on (or change the password): the file is rewritten with the new key right away. */
  async setPassword(password: string) { await this.rekey(await deriveVaultKey(password)); }

  /** Turn encryption off: the file is rewritten in plain JSON right away. */
  async removePassword() { await this.rekey(null); }

  /**
   * Sync with the CURRENT key first (so nothing from other devices is lost and the
   * file can be read), then write a new revision with the new key (or none).
   */
  private async rekey(next: VaultKey | null) {
    await this.syncNow();
    if (this.status.phase === 'locked') throw new Error('Unlock the data file with its current password first.');
    const text = await this.backend.readMain();
    const current = text ? await parseVault(text, this.key) : null;
    this.key = next;
    this.opts.onKeyChange?.(next);
    await this.write(await this.exportLocal(), (current?.revision ?? this.state?.revision ?? 0) + 1, text);
    this.emit({ phase: 'idle', encrypted: !!next, revision: this.state?.revision, lastSyncedAt: this.state?.syncedAt });
  }

  /** Another device encrypted the file (or changed the password): derive the key from the file's own salt. */
  async unlock(password: string): Promise<boolean> {
    const text = await this.backend.readMain();
    const h = text ? peekHeader(text) : null;
    if (!text || !h?.encryption) return true;
    const k = await deriveVaultKey(password, h.encryption.salt, h.encryption.iterations);
    try { await parseVault(text, k); } catch { return false; }
    this.key = k;
    this.opts.onKeyChange?.(k);
    await this.syncNow();
    return true;
  }
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * Records in `backup` are re-stamped "now" so they win merges on other devices;
 * anything in `current` but not in the backup gets a tombstone.
 */
export function restoredSnapshot(current: Snapshot, backup: Snapshot, now: number): Snapshot {
  const keep = new Set(SYNCED_TABLES.flatMap((tb) => backup.tables[tb].map((r) => `${tb}|${r.id}`)));
  const out = emptySnapshot();
  for (const tb of SYNCED_TABLES) out.tables[tb] = backup.tables[tb].map((r) => ({ ...r, updatedAt: now }));
  out.tombstones = SYNCED_TABLES.flatMap((tb) => current.tables[tb].filter((r) => !keep.has(`${tb}|${r.id}`)).map((r) => ({ table: tb, id: r.id, at: now })));
  return out;
}
