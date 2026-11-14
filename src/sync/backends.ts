/**
 * Where the vault physically lives. Three implementations, one interface:
 *  - tauri: Windows desktop app. Rust does atomic writes (tmp → fsync → rename).
 *  - folder: Chromium browsers / installed PWA via the File System Access API.
 *  - memory: tests.
 */
import { BACKUP_DIR, VAULT_FILE } from './vault';

export interface VaultBackend {
  kind: 'tauri' | 'folder' | 'memory';
  /** Human-readable location, e.g. C:\Users\you\OneDrive\Aufwind */
  label: string;
  readMain(): Promise<string | null>;
  /** Must be atomic: readers see the old file or the new file, never half of one. */
  writeMain(text: string): Promise<void>;
  listRoot(): Promise<string[]>;
  readRoot(name: string): Promise<string>;
  moveRootToBackups(name: string, newName: string): Promise<void>;
  writeBackup(name: string, text: string): Promise<void>;
  readBackup(name: string): Promise<string>;
  listBackups(): Promise<string[]>;
  deleteBackup(name: string): Promise<void>;
}

export class MemoryBackend implements VaultBackend {
  kind = 'memory' as const;
  label = 'memory';
  files = new Map<string, string>();
  async readMain() { return this.files.get(VAULT_FILE) ?? null; }
  async writeMain(t: string) { this.files.set(VAULT_FILE, t); }
  async listRoot() { return [...this.files.keys()].filter((k) => !k.includes('/')); }
  async readRoot(n: string) { const v = this.files.get(n); if (v === undefined) throw new Error('missing'); return v; }
  async moveRootToBackups(n: string, nn: string) { const v = await this.readRoot(n); this.files.delete(n); this.files.set(`${BACKUP_DIR}/${nn}`, v); }
  async writeBackup(n: string, t: string) { this.files.set(`${BACKUP_DIR}/${n}`, t); }
  async readBackup(n: string) { const v = this.files.get(`${BACKUP_DIR}/${n}`); if (v === undefined) throw new Error('missing'); return v; }
  async listBackups() { return [...this.files.keys()].filter((k) => k.startsWith(`${BACKUP_DIR}/`)).map((k) => k.slice(BACKUP_DIR.length + 1)); }
  async deleteBackup(n: string) { this.files.delete(`${BACKUP_DIR}/${n}`); }
}

// ── Tauri (desktop) ─────────────────────────────────────────────────────────
export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export class TauriBackend implements VaultBackend {
  kind = 'tauri' as const;
  constructor(readonly label: string) {}
  private async call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, { dir: this.label, ...args });
  }
  readMain() { return this.call<string | null>('vault_read', { name: VAULT_FILE }); }
  writeMain(text: string) { return this.call<void>('vault_write_atomic', { name: VAULT_FILE, contents: text }); }
  listRoot() { return this.call<string[]>('vault_list', { sub: '' }); }
  async readRoot(name: string) { return (await this.call<string | null>('vault_read', { name })) ?? ''; }
  moveRootToBackups(name: string, newName: string) { return this.call<void>('vault_move', { from: name, to: `${BACKUP_DIR}/${newName}` }); }
  writeBackup(name: string, text: string) { return this.call<void>('vault_write_atomic', { name: `${BACKUP_DIR}/${name}`, contents: text }); }
  async readBackup(name: string) { return (await this.call<string | null>('vault_read', { name: `${BACKUP_DIR}/${name}` })) ?? ''; }
  listBackups() { return this.call<string[]>('vault_list', { sub: BACKUP_DIR }); }
  deleteBackup(name: string) { return this.call<void>('vault_delete', { name: `${BACKUP_DIR}/${name}` }); }
}

// ── File System Access API (Chrome/Edge, installed PWA) ─────────────────────
type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
};

export const supportsFolderAccess = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export class FolderBackend implements VaultBackend {
  kind = 'folder' as const;
  constructor(readonly dir: DirHandle) {}
  get label() { return this.dir.name; }
  static async pick(): Promise<FolderBackend> {
    const dir = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ id: 'aufwind-data', mode: 'readwrite' });
    return new FolderBackend(dir);
  }
  async ensurePermission(): Promise<boolean> {
    if ((await this.dir.queryPermission?.({ mode: 'readwrite' })) === 'granted') return true;
    return (await this.dir.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  }
  private async sub(create = true) { return this.dir.getDirectoryHandle(BACKUP_DIR, { create }); }
  private async read(d: FileSystemDirectoryHandle, name: string) {
    try { return await (await (await d.getFileHandle(name)).getFile()).text(); } catch (e) { if ((e as DOMException).name === 'NotFoundError') return null; throw e; }
  }
  // createWritable writes to a swap file and swaps it in on close(): atomic for readers.
  private async write(d: FileSystemDirectoryHandle, name: string, text: string) {
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(text); await w.close();
  }
  private async list(d: DirHandle) { const out: string[] = []; for await (const h of d.values()) if (h.kind === 'file') out.push(h.name); return out; }
  readMain() { return this.read(this.dir, VAULT_FILE); }
  writeMain(text: string) { return this.write(this.dir, VAULT_FILE, text); }
  listRoot() { return this.list(this.dir); }
  async readRoot(name: string) { return (await this.read(this.dir, name)) ?? ''; }
  async moveRootToBackups(name: string, newName: string) { const t = await this.readRoot(name); await this.writeBackup(newName, t); await this.dir.removeEntry(name); }
  async writeBackup(name: string, text: string) { return this.write(await this.sub(), name, text); }
  async readBackup(name: string) { return (await this.read(await this.sub(), name)) ?? ''; }
  async listBackups() { return this.list((await this.sub()) as DirHandle); }
  async deleteBackup(name: string) { return (await this.sub()).removeEntry(name); }
}
