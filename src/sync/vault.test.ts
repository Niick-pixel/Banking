import { describe, expect, it } from 'vitest';
import { backupsToPrune, emptySnapshot, isConflictedCopy, mergeSnapshots, parseVault, serializeVault, VaultError, type Snapshot } from './vault';

const meta = { revision: 3, deviceId: 'd1', deviceName: 'PC', appVersion: '0.3.0' };
const snap = (tx: { id: string; updatedAt: number; v?: string }[], tombstones: Snapshot['tombstones'] = []): Snapshot => {
  const s = emptySnapshot();
  s.tables.transactions = tx.map((t) => ({ ...t }));
  s.tombstones = tombstones;
  return s;
};

describe('vault file', () => {
  it('round-trips with checksum', async () => {
    const s = snap([{ id: 'a', updatedAt: 1, v: 'ñ ₡' }]);
    const text = await serializeVault(s, meta);
    const v = await parseVault(text);
    expect(v.revision).toBe(3);
    expect(v.data.tables.transactions).toEqual(s.tables.transactions);
  });
  it('detects a truncated sync', async () => {
    const text = await serializeVault(snap([{ id: 'a', updatedAt: 1 }]), meta);
    await expect(parseVault(text.slice(0, text.length - 20))).rejects.toMatchObject({ kind: 'corrupt' });
  });
  it('detects tampering / bit rot', async () => {
    const text = (await serializeVault(snap([{ id: 'a', updatedAt: 1, v: 'x' }]), meta)).replace('"v":"x"', '"v":"y"');
    await expect(parseVault(text)).rejects.toBeInstanceOf(VaultError);
  });
  it('refuses files from a newer format', async () => {
    const text = (await serializeVault(emptySnapshot(), meta)).replace('"formatVersion": 1', '"formatVersion": 99');
    await expect(parseVault(text)).rejects.toMatchObject({ kind: 'newer' });
  });
});

describe('merge', () => {
  it('newer edit wins; reports true conflicts only', () => {
    const local = snap([{ id: 'a', updatedAt: 200, v: 'pc' }, { id: 'b', updatedAt: 50 }]);
    const remote = snap([{ id: 'a', updatedAt: 300, v: 'laptop' }, { id: 'c', updatedAt: 120 }]);
    const m = mergeSnapshots(local, remote, 100);
    expect(m.data.tables.transactions.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
    expect(m.data.tables.transactions.find((r) => r.id === 'a')!.v).toBe('laptop');
    expect(m.conflicts).toEqual([{ table: 'transactions', id: 'a', kept: 'remote' }]);
    expect(m.changedLocal && m.changedRemote).toBe(true);
  });
  it('deletions propagate unless edited later', () => {
    const now = 1_000_000;
    const local = snap([{ id: 'a', updatedAt: 10 }, { id: 'b', updatedAt: 500 }]);
    const remote = snap([], [{ table: 'transactions', id: 'a', at: 20 }, { table: 'transactions', id: 'b', at: 400 }]);
    const m = mergeSnapshots(local, remote, 0, now);
    expect(m.data.tables.transactions.map((r) => r.id)).toEqual(['b']);
  });
  it('identical sides → no changes', () => {
    const a = snap([{ id: 'a', updatedAt: 1 }]);
    const m = mergeSnapshots(a, snap([{ id: 'a', updatedAt: 1 }]), 0);
    expect([m.changedLocal, m.changedRemote, m.conflicts.length]).toEqual([false, false, 0]);
  });
});

describe('backups', () => {
  it('retention keeps 30 daily + monthly firsts + 20 events', () => {
    const names: string[] = [];
    for (let i = 0; i < 400; i++) { const d = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000); names.push(`${d.toISOString().slice(0, 10)}.colon`); }
    for (let i = 0; i < 25; i++) names.push(`pre-update-2026-01-${String(i + 1).padStart(2, '0')}.colon`);
    const prune = new Set(backupsToPrune(names));
    const kept = names.filter((n) => !prune.has(n));
    expect(kept.filter((n) => n.startsWith('pre-'))).toHaveLength(20);
    expect(kept.filter((n) => /^\d/.test(n)).length).toBeLessThanOrEqual(42);
    expect(kept).toContain('2027-02-04.colon'); // newest
    expect(kept).toContain('2026-06-01.colon'); // a month's first, within 12 months
  });
  it('recognises OneDrive conflict copies', () => {
    expect(isConflictedCopy('colon-data-LAPTOP-7.colon')).toBe(true);
    expect(isConflictedCopy('colon-data (1).colon')).toBe(true);
    expect(isConflictedCopy('colon-data.colon')).toBe(false);
  });
});
