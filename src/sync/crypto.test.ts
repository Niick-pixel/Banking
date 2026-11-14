import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptText, deriveVaultKey, encryptText, passwordStrength, WrongPasswordError } from './crypto';
import { emptySnapshot, parseVault, peekHeader, serializeVault, VaultError } from './vault';
import { ColonDBCompat } from './testdb';
import { MemoryBackend } from './backends';
import { SyncEngine, type KV } from './engine';
import { VAULT_FILE } from './vault';
import { account, crc, tx } from '../test/factories';

const FAST = 1_000; // fewer KDF rounds in tests only
const meta = { revision: 1, deviceId: 'd', deviceName: 'PC', appVersion: 't' };

describe('crypto', () => {
  it('round-trips; wrong password and tampering fail loudly', async () => {
    const k = await deriveVaultKey('correct horse battery staple', undefined, FAST);
    const { header, ciphertext } = await encryptText(k, 'hola ₡');
    expect(await decryptText(k, header, ciphertext)).toBe('hola ₡');
    const wrong = await deriveVaultKey('wrong', k.salt, FAST);
    await expect(decryptText(wrong, header, ciphertext)).rejects.toBeInstanceOf(WrongPasswordError);
    const flipped = ciphertext.slice(0, 10) + (ciphertext[10] === 'A' ? 'B' : 'A') + ciphertext.slice(11);
    await expect(decryptText(k, header, flipped)).rejects.toBeInstanceOf(WrongPasswordError);
  });
  it('a fresh IV every save', async () => {
    const k = await deriveVaultKey('pw-pw-pw-pw', undefined, FAST);
    const a = await encryptText(k, 'x'), b = await encryptText(k, 'x');
    expect(a.header.iv).not.toBe(b.header.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
  it('strength hints', () => {
    expect(passwordStrength('short').score).toBe(0);
    expect(passwordStrength('cuatro palabras faciles juntas').score).toBe(3);
  });
});

describe('encrypted vault file', () => {
  it('contains no readable data, opens only with the right key, and still detects partial syncs without it', async () => {
    const s = emptySnapshot();
    s.tables.transactions = [{ id: 'secret-id', updatedAt: 1, description: 'Rent to landlord' }];
    const k = await deriveVaultKey('my data password', undefined, FAST);
    const text = await serializeVault(s, meta, k);
    expect(text).not.toContain('Rent to landlord');
    expect(text).not.toContain('secret-id');
    expect(peekHeader(text)!.encryption?.alg).toBe('AES-256-GCM');
    expect(peekHeader(text)!.counts).toEqual({});
    await expect(parseVault(text)).rejects.toMatchObject({ kind: 'locked' });
    await expect(parseVault(text, await deriveVaultKey('nope', k.salt, FAST))).rejects.toMatchObject({ kind: 'wrong-password' });
    expect((await parseVault(text, k)).data.tables.transactions[0]!.description).toBe('Rent to landlord');
    await expect(parseVault(text.slice(0, -40))).rejects.toBeInstanceOf(VaultError);
  });
});

const memKV = (): KV => { const m = new Map<string, string>(); return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) }; };
const engines: SyncEngine[] = [];
afterEach(() => engines.splice(0).forEach((e) => e.stop()));
let n = 0;
async function device(name: string, cloud: MemoryBackend) {
  const db = new ColonDBCompat(`enc-${name}-${++n}`); await db.open();
  const e = new SyncEngine(db, cloud, { deviceId: name, deviceName: name, appVersion: 't', kv: memKV(), debounceMs: 60_000 });
  engines.push(e); await e.start();
  return { db, e };
}

describe('encryption across two devices', () => {
  it('PC encrypts; laptop is locked until the password; never overwrites what it cannot read', async () => {
    const cloud = new MemoryBackend();
    const pc = await device('pc', cloud);
    await pc.db.accounts.add(account('c', 'checking'));
    await pc.db.transactions.add({ ...tx({ kind: 'expense', date: '2026-11-01', from: { accountId: 'c' }, amount: crc(100), categoryId: 'g' }), id: 't1', description: 'Super secret' });
    await pc.e.setPassword('una frase larga y secreta');
    expect(cloud.files.get(VAULT_FILE)).not.toContain('Super secret');
    expect(pc.e.status.encrypted).toBe(true);

    const laptop = await device('laptop', cloud);
    expect(laptop.e.status.phase).toBe('locked');
    const before = cloud.files.get(VAULT_FILE);
    await laptop.db.transactions.add({ ...tx({ kind: 'expense', date: '2026-11-02', from: { accountId: 'c' }, amount: crc(5), categoryId: 'g' }), id: 't2' });
    await laptop.e.syncNow();
    expect(cloud.files.get(VAULT_FILE)).toBe(before); // untouched while locked
    expect(await laptop.e.unlock('wrong password here')).toBe(false);
    expect(await laptop.e.unlock('una frase larga y secreta')).toBe(true);
    expect((await laptop.db.transactions.toArray()).map((t) => t.id).sort()).toEqual(['t1', 't2']);
    await pc.e.syncNow();
    expect(await pc.db.transactions.get('t2')).toBeTruthy();
    // Changing the password: the laptop (old key) gets locked out until it enters the new one.
    await pc.e.setPassword('otra frase nueva y larga');
    await laptop.e.syncNow();
    expect(laptop.e.status.phase).toBe('locked');
    expect(await laptop.e.unlock('otra frase nueva y larga')).toBe(true);
    // Turning it off rewrites plain JSON.
    await pc.e.removePassword();
    expect(cloud.files.get(VAULT_FILE)).toContain('Super secret');
  }, 60_000);
});
