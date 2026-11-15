import { describe, expect, it } from 'vitest';
import { guessCategory } from './autocat';
import { ex } from './fixtures';

describe('auto-categorization', () => {
  const hist = [ex('2026-10-01', 'groc', 1, 'Walmart quick run'), ex('2026-10-05', 'groc', 1, 'Walmart second run'), ex('2026-10-09', 'groc', 1, 'Walmart'), ex('2026-10-09', 'food', 1, 'Pizza day'), ex('2026-10-11', 'food', 1, 'Pizza night'), ex('2026-10-12', 'unn', 1, 'Pizza oven toy')];
  it('applies with high confidence after enough consistent history', () => {
    expect(guessCategory(hist, 'Walmart', 'expense')).toMatchObject({ categoryId: 'groc', mode: 'auto', similar: 3 });
  });
  it('suggests when history is mixed, asks when unknown', () => {
    expect(guessCategory(hist, 'Pizza', 'expense')).toMatchObject({ categoryId: 'food', mode: 'suggest' });
    expect(guessCategory(hist, 'Dentist', 'expense')).toBeNull();
  });
});
