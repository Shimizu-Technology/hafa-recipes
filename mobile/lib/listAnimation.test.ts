import { describe, expect, it } from 'vitest';

import { listEntranceDelay, MAX_LIST_ENTRANCE_DELAY_MS } from './listAnimation';

describe('listEntranceDelay', () => {
  it('stages the first visible items and caps later cells', () => {
    expect(listEntranceDelay(0, 40)).toBe(0);
    expect(listEntranceDelay(3, 40)).toBe(120);
    expect(listEntranceDelay(40, 40)).toBe(MAX_LIST_ENTRANCE_DELAY_MS);
    expect(listEntranceDelay(100, 40)).toBeLessThanOrEqual(200);
  });

  it('does not produce negative delays', () => {
    expect(listEntranceDelay(-2, 40)).toBe(0);
    expect(listEntranceDelay(2, -40)).toBe(0);
    expect(listEntranceDelay(2, 40, -100)).toBe(0);
  });
});
