import { describe, expect, it, beforeEach } from 'vitest';
import { checkPin, clearFails, derToRaw, failState, makePin, recordFail, saveLockConfig } from './lock';

const store = new Map<string, string>();
beforeEach(() => { store.clear(); (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0 } as Storage; });

describe('app lock', () => {
  it('PIN is stored only as a salted slow hash and checks correctly', async () => {
    const pin = await makePin('482916', 1_000);
    expect(JSON.stringify(pin)).not.toContain('482916');
    saveLockConfig({ pin, autoLockMinutes: 5 });
    expect(await checkPin('482916')).toBe(true);
    expect(await checkPin('482917')).toBe(false);
    const again = await makePin('482916', 1_000);
    expect(again!.hash).not.toBe(pin!.hash); // different salt
  });
  it('backs off after 5 wrong PINs, doubling', () => {
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) recordFail(t);
    expect(failState(t).waitMs).toBe(0);
    recordFail(t);
    expect(failState(t).waitMs).toBe(30_000);
    recordFail(t);
    expect(failState(t).waitMs).toBe(60_000);
    clearFails();
    expect(failState(t)).toEqual({ count: 0, waitMs: 0 });
  });
  it('converts DER ECDSA signatures to raw r‖s', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const msg = new TextEncoder().encode('aufwind');
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, msg));
    // Encode raw → DER (with leading-zero handling), then back.
    const int = (b: Uint8Array) => { let v = Array.from(b); while (v.length > 1 && v[0] === 0) v = v.slice(1); if (v[0]! & 0x80) v = [0, ...v]; return [0x02, v.length, ...v]; };
    const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
    const der = new Uint8Array([0x30, body.length, ...body]);
    const back = derToRaw(der);
    expect(Array.from(back)).toEqual(Array.from(raw));
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, back, msg)).toBe(true);
  });
});
