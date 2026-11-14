import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';

/** Bottom sheet on mobile, centered panel on desktop. Esc closes; focus moves in and is restored. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    setTimeout(() => {
      const root = ref.current;
      // Prefer the field marked data-autofocus, then the first form field; the ✕ button only as a last resort.
      (root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>('input, select, textarea') ?? root?.querySelector<HTMLElement>('button'))?.focus();
    }, 30);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="sheet-root">
          <motion.div className="sheet-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            ref={ref} role="dialog" aria-modal="true" aria-label={title}
            className={`glass glass-strong sheet ${wide ? 'sheet-wide' : ''}`}
            initial={reduce ? { opacity: 0 } : { y: 40, opacity: 0, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="sheet-head">
              <h2>{title}</h2>
              <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function Toast({ message, action, onAction, onDone }: { message: string; action?: string; onAction?: () => void; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 6000); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="glass glass-strong toast" role="status">
      <span>{message}</span>
      {action && <button className="btn btn-sm" onClick={() => { onAction?.(); onDone(); }}>{action}</button>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="glass" style={{ padding: 32, textAlign: 'center', display: 'grid', gap: 12, justifyItems: 'center' }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
      {children}
    </div>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 34, letterSpacing: '-0.03em', fontWeight: 800 }}>{title}</h1>
        {sub && <p style={{ margin: '4px 0 0', color: 'var(--text-2)' }}>{sub}</p>}
      </div>
      {children && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{children}</div>}
    </header>
  );
}
