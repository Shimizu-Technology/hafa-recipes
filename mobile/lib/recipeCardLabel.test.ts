import { describe, expect, it } from 'vitest';

import { recipeCardAccessibilityLabel } from './recipeCardLabel';

describe('recipe card accessibility label', () => {
  it('reads the title, readiness warning and visible details in card order', () => {
    expect(recipeCardAccessibilityLabel({
      title: 'Chicken Kelaguen',
      reviewState: 'needs_review',
      totalTime: '30 min',
      servings: 4,
      sourceLabel: 'Website',
      author: 'Leon',
      saved: true,
    })).toBe(
      'Chicken Kelaguen, Some recipe details are uncertain, 30 min, 4 servings, Website, by Leon, Saved',
    );
    expect(recipeCardAccessibilityLabel({ title: 'Red Rice', reviewState: 'source_incomplete', servings: 1 }))
      .toBe('Red Rice, Recipe needs source details, 1 serving');
  });

  it('skips ready recipes and missing details and never reads an empty title', () => {
    expect(recipeCardAccessibilityLabel({
      title: 'Red Rice',
      reviewState: 'ready',
      totalTime: '  ',
      servings: null,
      sourceLabel: null,
      saved: false,
    })).toBe('Red Rice');
    expect(recipeCardAccessibilityLabel({ title: '  ' })).toBe('Untitled recipe');
  });
});
