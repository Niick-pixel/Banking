/**
 * A card that holds several views stacked behind each other. Scroll the mouse
 * wheel over it (or click the dots on its right edge, or use ↑/↓) to flip through
 * them; it wraps around, so it never ends. The view you left it on is remembered.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { usePersisted } from '../../app/persist';
import { useTheme } from '../../app/theme';

export interface DeckView { key: string; label: string; render: () => ReactNode }

export function Deck({ id, label, views, className = '', style }: { id: string; label: string; views: DeckView[]; className?: string; style?: React.CSSProperties }) {
  const [stored, setStored] = usePersisted<string>(`dash.deck.${id}`, views[0]?.key ?? '');
  const { dur } = useTheme();
  const ref = useRef<HTMLElement>(null);
  const dir = useRef(1);
  const lock = useRef(0);
  const idx = Math.max(0, views.findIndex((v) => v.key === stored));
  const go = (step: number) => {
    if (views.length < 2) return;
    dir.current = step > 0 ? 1 : -1;
    setStored(views[(idx + step + views.length) % views.length]!.key);
  };
  const goRef = useRef(go);
  goRef.current = go;

  // Wheel flips views (non-passive so the page itself never scrolls from here).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 4 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = Date.now();
      if (now < lock.current) return;
      lock.current = now + 420;
      goRef.current(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  if (!views.length) return null;
  const view = views[idx]!;
  return (
    <section ref={ref} className={`glass glass-strong deck ${className}`} style={style} aria-roledescription="card stack" aria-label={`${label}: ${view.label} (${idx + 1} of ${views.length})`}
      tabIndex={0} onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); go(1); } if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(-1); } }}>
      <AnimatePresence mode="popLayout" initial={false} custom={dir.current}>
        <motion.div key={view.key} className="deck-view" custom={dir.current}
          initial={{ opacity: 0, y: dir.current * 26 }} animate={{ opacity: 1, y: 0, transition: { duration: dur(0.32), ease: [0.2, 0.8, 0.2, 1] } }}
          exit={{ opacity: 0, y: dir.current * -26, transition: { duration: dur(0.2) } }}>
          {view.render()}
        </motion.div>
      </AnimatePresence>
      {views.length > 1 && (
        <nav className="deck-dots" aria-label={`${label} views`}>
          {views.map((v, i) => (
            <button key={v.key} className={i === idx ? 'on' : ''} aria-label={v.label} aria-current={i === idx ? 'true' : undefined} title={v.label}
              onClick={() => { dir.current = i > idx ? 1 : -1; setStored(v.key); }} />
          ))}
        </nav>
      )}
    </section>
  );
}
