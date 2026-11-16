import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useTheme } from '../app/theme';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Bottom sheet on mobile, centered panel on desktop. Esc closes; focus moves in and is restored. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const { dur } = useTheme();
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
  // Rendered at the top of the page: a dialog opened from inside a glass card would otherwise be
  // positioned (and clipped) by that card, because backdrop-filter makes it the containing block.
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="sheet-root">
          <motion.div className="sheet-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: dur(0.35) } }} exit={{ opacity: 0, transition: { duration: dur(0.25) } }} />
          {/* Only opacity + a small slide: no scale, so the blur and text don't shimmer while it opens. */}
          <motion.div
            ref={ref} role="dialog" aria-modal="true" aria-label={title}
            className={`glass glass-strong sheet ${wide ? 'sheet-wide' : ''}`}
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1, transition: { duration: dur(0.4), ease: [0.2, 0.8, 0.2, 1] } }}
            exit={{ y: 12, opacity: 0, transition: { duration: dur(0.22), ease: [0.4, 0, 1, 1] } }}
          >
            <div className="sheet-head">
              <h2>{title}</h2>
              <button type="button" className="sheet-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
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
