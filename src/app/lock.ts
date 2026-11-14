/**
 * App lock (per device). A PIN, plus Windows Hello / Face ID / Touch ID through
 * WebAuthn where the device supports it. The lock hides the app; the data file in
 * your folder is protected separately by encryption (Settings → Encryption).
 */
import { b64, unb64 } from '../sync/crypto';
import { localKV } from '../sync/engine';

export interface LockConfig {
  pin?: { hash: string; salt: string; iterations: number };
  webauthn?: { credId: string; publicKey: string; alg: number };
  autoLockMinutes: number; // 0 = never
}
const KEY = 'aufwind.lock';
const FAILS = 'aufwind.lock.fails';
export const PIN_ITERATIONS = 210_000;

export function getLockConfig(): LockConfig | null { const s = localKV.get(KEY); return s ? JSON.parse(s) : null; }
export function saveLockConfig(c: LockConfig | null) { localKV.set(KEY, c ? JSON.stringify(c) : ''); }
export const lockEnabled = () => !!getLockConfig()?.pin;

export async function hashPin(pin: string, salt: string, iterations = PIN_ITERATIONS): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations }, base, 256);
  return b64(new Uint8Array(bits));
}

export async function makePin(pin: string, iterations = PIN_ITERATIONS): Promise<LockConfig['pin']> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { hash: await hashPin(pin, salt, iterations), salt, iterations };
}

/** Length-independent comparison so timing doesn't leak how much of the hash matched. */
function sameString(a: string, b: string) { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; }

export async function checkPin(pin: string, cfg = getLockConfig()): Promise<boolean> {
  if (!cfg?.pin) return true;
  return sameString(await hashPin(pin, cfg.pin.salt, cfg.pin.iterations), cfg.pin.hash);
}

/** After 5 wrong PINs, wait 30 s, doubling each further miss (max 15 min). */
export function failState(now = Date.now()): { count: number; waitMs: number } {
  const f = JSON.parse(localKV.get(FAILS) || '{"count":0,"until":0}') as { count: number; until: number };
  return { count: f.count, waitMs: Math.max(0, f.until - now) };
}
export function recordFail(now = Date.now()) {
  const { count } = failState(now);
  const c = count + 1;
  const wait = c >= 5 ? Math.min(15 * 60_000, 30_000 * 2 ** (c - 5)) : 0;
  localKV.set(FAILS, JSON.stringify({ count: c, until: now + wait }));
}
export function clearFails() { localKV.set(FAILS, '{"count":0,"until":0}'); }

// ── WebAuthn (Windows Hello, Face ID, Touch ID) ────────────────────────────
export async function platformAuthAvailable(): Promise<boolean> {
  try { return typeof PublicKeyCredential !== 'undefined' && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}

export async function registerPlatformAuth(): Promise<NonNullable<LockConfig['webauthn']>> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Aufwind' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'aufwind', displayName: 'Aufwind' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000, attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Cancelled');
  const r = cred.response as AuthenticatorAttestationResponse;
  const pk = r.getPublicKey(), alg = r.getPublicKeyAlgorithm();
  if (!pk) throw new Error('This device did not return a public key');
  return { credId: b64(new Uint8Array(cred.rawId)), publicKey: b64(new Uint8Array(pk)), alg };
}

/** ECDSA signatures from authenticators are DER; WebCrypto wants raw r‖s (32 bytes each). */
export function derToRaw(der: Uint8Array): Uint8Array {
  let i = 2; if (der[1]! & 0x80) i += der[1]! & 0x7f;
  const read = () => { i++; const len = der[i++]!; let v = der.slice(i, i + len); i += len; while (v.length > 32 && v[0] === 0) v = v.slice(1); const out = new Uint8Array(32); out.set(v, 32 - v.length); return out; };
  const r = read(), s = read();
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
}

/**
 * Ask the platform authenticator (fingerprint, face, Windows Hello PIN), then verify
 * its signature locally with the public key saved at setup, and that it signed our
 * fresh challenge. No server needed.
 */
export async function verifyPlatformAuth(cfg = getLockConfig()): Promise<boolean> {
  const w = cfg?.webauthn; if (!w) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.get({ publicKey: { challenge, allowCredentials: [{ type: 'public-key', id: unb64(w.credId) }], userVerification: 'required', timeout: 60_000 } })) as PublicKeyCredential | null;
  if (!cred) return false;
  const r = cred.response as AuthenticatorAssertionResponse;
  const client = JSON.parse(new TextDecoder().decode(r.clientDataJSON)) as { type: string; challenge: string };
  const expected = b64(challenge).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (client.type !== 'webauthn.get' || client.challenge !== expected) return false;
  const auth = new Uint8Array(r.authenticatorData);
  if (!(auth[32]! & 0x04)) return false; // user verified flag
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', r.clientDataJSON));
  const signed = new Uint8Array(auth.length + clientHash.length); signed.set(auth); signed.set(clientHash, auth.length);
  const sig = new Uint8Array(r.signature);
  if (w.alg === -7) {
    const key = await crypto.subtle.importKey('spki', unb64(w.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(sig), signed);
  }
  const key = await crypto.subtle.importKey('spki', unb64(w.publicKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
}
