import { describe, expect, it } from 'vitest';

import { recipeCardAccessibilityLabel } from './recipeCardLabel';

describe('recipe card accessibility label', () => {
  it('reads the title followed by the visible details', () => {
    expect(recipeCardAccessibilityLabel('Chicken Kelaguen', ['30 min', 'Saved'])).toBe(
      'Chicken Kelaguen, 30 min, Saved',
    );
  });

  it('skips missing details and never reads an empty title', () => {
    expect(recipeCardAccessibilityLabel('Red Rice', [null, undefined, false, '  '])).toBe('Red Rice');
    expect(recipeCardAccessibilityLabel('  ')).toBe('Untitled recipe');
  });
});
