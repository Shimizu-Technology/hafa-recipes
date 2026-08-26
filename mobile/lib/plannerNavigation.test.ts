import { describe, expect, it } from 'vitest';

import { parsePlannerDateParam } from './plannerNavigation';

describe('planner navigation parameters', () => {
  it('parses a valid local calendar date', () => {
    const result = parsePlannerDateParam('2026-08-27');

    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(7);
    expect(result?.getDate()).toBe(27);
  });

  it.each([undefined, '', '08-27-2026', '2026-02-30', '2026-13-01'])(
    'rejects invalid planner date %s',
    (value) => {
      expect(parsePlannerDateParam(value)).toBeNull();
    },
  );
});
