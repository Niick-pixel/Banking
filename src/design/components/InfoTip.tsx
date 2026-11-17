/**
 * A small "?" that explains a number or a card in plain words. Hover, focus or
 * click it; Escape or clicking elsewhere closes it. Used everywhere a figure
 * might not be obvious.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function InfoTip({ text, label = 'What is this?' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!pinned) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !btn.current?.contains(e.target as Node)) { setPinned(false); setOpen(false); } };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [pinned]);
  const r = btn.current?.getBoundingClientRect();
  const left = r ? Math.min(Math.max(12, r.left + r.width / 2 - 150), window.innerWidth - 312) : 0;
  const below = r ? r.bottom + 220 < window.innerHeight : true;
  return (
    <>
      <button ref={btn} type="button" className="infotip" aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => !pinned && setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => !pinned && setOpen(false)}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPinned(!pinned); setOpen(!pinned); }}>i</button>
      {open && r && createPortal(
        <div id={id} role="tooltip" className="infotip-pop" style={{ left, ...(below ? { top: r.bottom + 8 } : { bottom: window.innerHeight - r.top + 8 }) }}>{text}</div>,
        document.body)}
    </>
  );
}
