import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet } from '../ui/Sheet';
import { useQuickAdd } from './QuickAdd';
import { useLock } from './LockGate';
import { useTheme } from './theme';
import { getEngine } from '../sync';
import { lockEnabled } from './lock';

interface Cmd { id: string; label: string; hint?: string; keywords?: string; run: () => void }

/** Ctrl/Cmd+K: jump anywhere or run an action without the mouse. */
export function CommandPalette({ pages }: { pages: { to: string; label: string; ready: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const qa = useQuickAdd();
  const { lockNow } = useLock();
  const { setTheme, theme } = useTheme();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); setQ(''); setSel(0); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cmds: Cmd[] = useMemo(() => {
    const close = (fn: () => void) => () => { setOpen(false); fn(); };
    return [
      { id: 'add', label: 'Add a movement', hint: 'N', keywords: 'new expense income quick', run: close(() => qa.open()) },
      ...pages.filter((p) => p.ready).map((p) => ({ id: `go${p.to}`, label: `Go to ${p.label}`, keywords: p.to, run: close(() => nav(p.to)) })),
      { id: 'export', label: 'Export to Excel / CSV / PDF', keywords: 'reports download print', run: close(() => nav('/reports')) },
      { id: 'confirm', label: 'Confirm pending bills & pay', keywords: 'reminders recurring', run: close(() => nav('/bills')) },
      { id: 'statement', label: 'Enter statement balances', keywords: 'reconcile net worth bank', run: close(() => nav('/net-worth')) },
      { id: 'save', label: 'Save to data folder now', keywords: 'sync onedrive', run: close(() => void getEngine()?.syncNow()) },
      { id: 'theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`, keywords: 'theme appearance', run: close(() => setTheme(theme === 'dark' ? 'light' : 'dark')) },
      ...(lockEnabled() ? [{ id: 'lock', label: 'Lock Aufwind now', keywords: 'pin security', run: close(lockNow) }] : []),
    ];
  }, [pages, qa, nav, lockNow, setTheme, theme]);

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const results = cmds.filter((c) => terms.every((t) => `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(t)));
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Go to or do…">
      <input
        className="input" data-autofocus role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-activedescendant={results[sel] ? `cmd-${results[sel]!.id}` : undefined}
        aria-label="Search commands" placeholder="Type a page or an action…" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === 'Enter') { e.preventDefault(); results[sel]?.run(); }
        }}
      />
      <ul id="cmd-list" ref={listRef} role="listbox" aria-label="Commands" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, maxHeight: 360, overflow: 'auto', display: 'grid', gap: 2 }}>
        {results.length === 0 && <li className="muted small" style={{ padding: 10 }}>Nothing matches “{q}”.</li>}
        {results.map((c, i) => (
          <li key={c.id} id={`cmd-${c.id}`} data-i={i} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={c.run}
            style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', background: i === sel ? 'var(--accent-soft)' : undefined }}>
            <span>{c.label}</span>{c.hint && <kbd className="small muted">{c.hint}</kbd>}
          </li>
        ))}
      </ul>
      <p className="small muted" style={{ margin: '10px 0 0' }}>↑ ↓ to move · Enter to run · Esc to close · Ctrl/⌘ K anywhere</p>
    </Sheet>
  );
}
