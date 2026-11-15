/**
 * Auto-categorization (spec §10.5): learn description words → category from your history.
 * ≥ 0.9 confidence: applied for you; 0.6–0.9: suggested; lower: you pick.
 */
import type { Transaction } from '../domain/schemas';
import { merchantTokens } from './rules/r04-impulse-cluster';

export interface CategoryGuess { categoryId: string; confidence: number; similar: number; mode: 'auto' | 'suggest' | 'ask' }

export function guessCategory(txs: Transaction[], description: string, kind: Transaction['kind']): CategoryGuess | null {
  const words = merchantTokens(description);
  if (!words.length) return null;
  const votes = new Map<string, number>();
  let similar = 0;
  for (const t of txs) {
    if (t.kind !== kind || !('categoryId' in t) || !t.categoryId || t.tags.includes('migrated-summary')) continue;
    const tw = merchantTokens(t.description);
    const shared = words.filter((w) => tw.includes(w)).length;
    if (!shared) continue;
    similar++;
    votes.set(t.categoryId, (votes.get(t.categoryId) ?? 0) + shared / Math.max(words.length, tw.length));
  }
  if (!similar) return null;
  const total = [...votes.values()].reduce((a, b) => a + b, 0);
  const [categoryId, top] = [...votes].sort((a, b) => b[1] - a[1])[0]!;
  // Confidence = share of the evidence, discounted when there's little of it.
  const confidence = (top / total) * Math.min(1, similar / 3);
  return { categoryId, confidence, similar, mode: confidence >= 0.9 ? 'auto' : confidence >= 0.6 ? 'suggest' : 'ask' };
}
