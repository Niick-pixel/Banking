import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { ColonDB } from '../db/db';
import { MemoryBackend } from './backends';
import { SyncEngine, type KV } from './engine';
import { VAULT_FILE } from './vault';
import { account, crc, tx } from '../test/factories';

const memKV = (): KV => { const m = new Map<string, string>(); return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) }; };
let n = 0;
const engines: SyncEngine[] = [];
async function device(name: string, backend: MemoryBackend, clock: { t: number }) {
  const db = new ColonDB(`sync-${name}-${++n}`);
  await db.open();
  const e = new SyncEngine(db, backend, { deviceId: name, deviceName: name, appVersion: 'test', kv: memKV(), now: () => clock.t, debounceMs: 60_000 });
  engines.push(e);
  await e.start();
  return { db, e };
}
afterEach(() => { engines.splice(0).forEach((e) => e.stop()); });

const expense = (id: string, amount: number, at: number) => ({ ...tx({ kind: 'expense', date: '2026-11-10', from: { accountId: 'c' }, amount, categoryId: 'g' }), id, updatedAt: at, createdAt: at });

describe('vault sync between two devices', () => {
  it('first device creates the vault; the second picks it up', async () => {
    const cloud = new MemoryBackend(); const clock = { t: 1000 };
    const pc = await device('pc', cloud, clock);
    await pc.db.accounts.add(account('c', 'checking'));
    await pc.db.transactions.add(expense('t1', crc(5000), 1000));
    await pc.e.syncNow();
    expect(cloud.files.has(VAULT_FILE)).toBe(true);
    const laptop = await device('laptop', cloud, clock);
    expect(await laptop.db.transactions.get('t1')).toBeTruthy();
    expect(laptop.e.status.phase).toBe('idle');
  });

  it('concurrent edits on both devices merge; deletes propagate', async () => {
    const cloud = new MemoryBackend(); const clock = { t: 1000 };
    const pc = await device('pc', cloud, clock);
    await pc.db.accounts.add(account('c', 'checking'));
    await pc.db.transactions.bulkAdd([expense('keep', 100, 1000), expense('gone', 200, 1000)]);
    await pc.e.syncNow();
    const laptop = await device('laptop', cloud, clock);
    clock.t = 2000;
    await laptop.db.transactions.add(expense('fromLaptop', 300, 2000));   // laptop offline edit
    clock.t = 2100;
    await pc.db.transactions.add(expense('fromPc', 400, 2100));           // pc edit
    await pc.db.transactions.delete('gone');
    await pc.e.syncNow();      // pc writes rev 2
    await laptop.e.syncNow();  // laptop sees rev 2 while dirty → merge, writes rev 3
    await pc.e.syncNow();      // pc loads rev 3
    for (const d of [pc, laptop]) {
      const ids = (await d.db.transactions.toArray()).map((t) => t.id).sort();
      expect(ids).toEqual(['fromLaptop', 'fromPc', 'keep']);
    }
  });

  it('a damaged vault never overwrites local data', async () => {
    const cloud = new MemoryBackend(); const clock = { t: 1000 };
    const pc = await device('pc', cloud, clock);
    await pc.db.accounts.add(account('c', 'checking'));
    await pc.e.syncNow();
    cloud.files.set(VAULT_FILE, cloud.files.get(VAULT_FILE)!.slice(0, 50));
    await pc.db.transactions.add(expense('t', 1, 1000));
    await pc.e.syncNow();
    expect(pc.e.status.phase).toBe('error');
    expect(await pc.db.transactions.count()).toBe(1);
  });

  it('daily backup before the first write of a new day; restore makes a backup the truth everywhere', async () => {
    const cloud = new MemoryBackend(); const clock = { t: Date.UTC(2026, 10, 14, 10) };
    const pc = await device('pc', cloud, clock);
    await pc.db.accounts.add(account('c', 'checking'));
    await pc.db.transactions.add(expense('old', 1, clock.t));
    await pc.e.syncNow();
    clock.t = Date.UTC(2026, 10, 15, 10);
    await pc.db.transactions.add(expense('new', 2, clock.t));
    await pc.e.syncNow();
    const backups = await pc.e.listBackups();
    expect(backups).toContain('2026-11-15.colon');
    const laptop = await device('laptop', cloud, clock);
    clock.t += 1000;
    await pc.e.restore('2026-11-15.colon'); // contains only "old"
    await laptop.e.syncNow();
    expect((await laptop.db.transactions.toArray()).map((t) => t.id)).toEqual(['old']);
    expect((await pc.e.listBackups()).some((b) => b.startsWith('pre-restore'))).toBe(true);
  });

  it('merges a OneDrive conflicted copy and files it under backups', async () => {
    const cloud = new MemoryBackend(); const clock = { t: 1000 };
    const pc = await device('pc', cloud, clock);
    await pc.db.accounts.add(account('c', 'checking'));
    await pc.db.transactions.add(expense('a', 1, 1000));
    await pc.e.syncNow();
    // Simulate: another device's write landed as a conflict copy containing an extra record.
    const other = new MemoryBackend(); const oc = { t: 1500 };
    const o = await device('other', other, oc);
    await o.db.accounts.add(account('c', 'checking'));
    await o.db.transactions.add(expense('b', 2, 1500));
    await o.e.syncNow();
    cloud.files.set('colon-data-LAPTOP.colon', other.files.get(VAULT_FILE)!);
    await pc.e.syncNow();
    expect(pc.e.status.conflictedCopies).toEqual(['colon-data-LAPTOP.colon']);
    await pc.e.mergeConflictedCopy('colon-data-LAPTOP.colon');
    expect((await pc.db.transactions.toArray()).map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(pc.e.status.conflictedCopies).toEqual([]);
  });
});
