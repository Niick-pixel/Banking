import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { reducedMotion, SPRING } from '../design/motion';

/**
 * A dialog window. Fixed width (narrow 560 / wide 960), a header line (title, a faint step
 * caption, actions on the right), an optional context strip, the body, and an optional
 * footer (status on the left, primary action on the right). It never grows past the
 * window: the body scrolls inside its own box only when it truly can't fit.
 * Esc closes, asking first when something was entered (`dirty`).
 */
export function Sheet({ open, onClose, title, caption, actions, strip, footer, children, wide, dirty }: {
  open: boolean; onClose: () => void; title: string; caption?: ReactNode; actions?: ReactNode; strip?: ReactNode; footer?: ReactNode;
  children: ReactNode; wide?: boolean; dirty?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const close = useRef(onClose);
  close.current = onClose;
  const tryClose = () => { if (!dirtyRef.current || window.confirm('Close without saving? What you entered will be lost.')) close.current(); };
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); tryClose(); } };
    window.addEventListener('keydown', onKey);
    setTimeout(() => {
      const root = ref.current;
      (root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>('input, select, textarea') ?? root?.querySelector<HTMLElement>('button'))?.focus();
    }, 30);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const rm = reducedMotion();
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="sheet-root">
          <motion.div className="sheet-scrim" onClick={tryClose} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: rm ? { duration: 0.1 } : SPRING.soft }} exit={{ opacity: 0, transition: { duration: 0.13 } }} />
          <motion.div
            ref={ref} role="dialog" aria-modal="true" aria-label={title}
            className={`panel sheet ${wide ? 'sheet-wide' : ''}`}
            initial={rm ? { opacity: 0 } : { y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1, transition: rm ? { duration: 0.1 } : SPRING.soft }}
            exit={rm ? { opacity: 0 } : { y: -6, opacity: 0, transition: { duration: 0.14 } }}
          >
            <div className="sheet-head">
              <h2>{title}</h2>
              {caption && <span className="sheet-caption">{caption}</span>}
              <span className="sheet-actions">{actions}<button type="button" className="sheet-close" onClick={tryClose} aria-label="Close (Esc)"><X size={16} /></button></span>
            </div>
            {strip && <div className="sheet-strip">{strip}</div>}
            <div className="sheet-body">{children}</div>
            {footer && <div className="sheet-foot">{footer}</div>}
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
    <div className="glass" style={{ padding: 24, textAlign: 'center', display: 'grid', gap: 10, justifyItems: 'center' }}>
      <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
      {children}
    </div>
  );
}

/** Page title line: title (19px semibold), one quiet line under it, actions on the right. */
export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}
