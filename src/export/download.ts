/**
 * Save a generated file. Desktop app: written to <data folder>/exports and the
 * folder is opened. Browser: a normal download.
 */
import { isTauri } from '../sync/backends';
import { localKV } from '../sync/engine';

export async function saveFile(name: string, data: string | ArrayBuffer, mime: string): Promise<string> {
  const dir = localKV.get('colon.vault.dir');
  if (isTauri() && dir) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('vault_write_bytes', { dir, name: `exports/${name}`, contents: Array.from(bytes) });
    return `${dir}\\exports\\${name}`;
  }
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
