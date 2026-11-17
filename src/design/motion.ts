/**
 * Every movement is a spring. Five feels:
 *  base   340/25   (ζ≈0.68) general entrances
 *  snappy 520/30   presses, toggles, the selected pill
 *  bouncy 420/22.5 checks and badges
 *  soft   240/21.5 panels and dialogs
 *  size   260/30.5 (ζ≈0.95, no overshoot) anything that changes height or width
 * With reduced motion (system setting or Settings → Animations → Off) only opacity changes.
 */
import type { Transition } from 'motion/react';

export const SPRING = {
  base: { type: 'spring', stiffness: 340, damping: 25 },
  snappy: { type: 'spring', stiffness: 520, damping: 30 },
  bouncy: { type: 'spring', stiffness: 420, damping: 22.5 },
  soft: { type: 'spring', stiffness: 240, damping: 21.5 },
  size: { type: 'spring', stiffness: 260, damping: 30.5 },
} as const satisfies Record<string, Transition>;

export const reducedMotion = () =>
  typeof document !== 'undefined' && (document.documentElement.getAttribute('data-motion') === 'off' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Enter at opacity 0 / y+6, spring in; exit at opacity 0 / y−6 quickly. */
export function enterExit(kind: keyof typeof SPRING = 'base') {
  if (reducedMotion()) return { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.12 } }, exit: { opacity: 0, transition: { duration: 0.1 } } };
  return { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0, transition: SPRING[kind] }, exit: { opacity: 0, y: -6, transition: { duration: 0.13 } } };
}
export const spring = (kind: keyof typeof SPRING = 'base'): Transition => (reducedMotion() ? { duration: 0 } : SPRING[kind]);
