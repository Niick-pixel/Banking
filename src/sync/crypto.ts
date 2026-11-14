/**
 * Password-based encryption for the data file (WebCrypto only):
 *   password ─PBKDF2-SHA256 (600,000 rounds, random 16-byte salt)→ AES-256-GCM key
 * Each save uses a fresh random 12-byte IV. GCM authenticates the ciphertext, so a
 * wrong password or any tampering fails loudly instead of returning garbage.
 * The derived key is non-extractable: code can use it but can never read it out.
 */
export const KDF_ITERATIONS = 600_000;

export interface VaultKey { key: CryptoKey; salt: string; iterations: number }
export interface EncryptionHeader { alg: 'AES-256-GCM'; kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; iv: string }

export const b64 = (bytes: Uint8Array) => { let s = ''; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function deriveVaultKey(password: string, salt = b64(random(16)), iterations = KDF_ITERATIONS): Promise<VaultKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { key, salt, iterations };
}

export async function encryptText(k: VaultKey, plaintext: string): Promise<{ header: EncryptionHeader; ciphertext: string }> {
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, new TextEncoder().encode(plaintext)));
  return { header: { alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: k.iterations, salt: k.salt, iv: b64(iv) }, ciphertext: b64(ct) };
}

export class WrongPasswordError extends Error { constructor() { super('Wrong password, or the file was changed by something else.'); this.name = 'WrongPasswordError'; } }

export async function decryptText(k: VaultKey, h: EncryptionHeader, ciphertext: string): Promise<string> {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(h.iv) }, k.key, unb64(ciphertext));
    return new TextDecoder().decode(pt);
  } catch { throw new WrongPasswordError(); }
}

/** A key only fits a file if it was derived with the same salt and rounds. */
export const keyMatches = (k: VaultKey | null | undefined, h: EncryptionHeader) => !!k && k.salt === h.salt && k.iterations === h.iterations;

/** Rough password strength: length and variety. Honest guidance, not a guarantee. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; hint: string } {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(pw)).length + (/\s/.test(pw) ? 1 : 0);
  if (pw.length < 10) return { score: 0, hint: 'Too short: use at least 10 characters (a short sentence is great).' };
  if (pw.length < 14 && classes < 3) return { score: 1, hint: 'OK, but longer is much stronger. Try a 4-word phrase.' };
  if (pw.length < 18) return { score: 2, hint: 'Good.' };
  return { score: 3, hint: 'Strong.' };
}
