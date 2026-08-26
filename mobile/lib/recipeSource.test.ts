import { describe, expect, it } from 'vitest';

import { getRecipeSourcePresentation } from './recipeSource';

describe('recipe source presentation', () => {
  it('distinguishes pasted text from photo and manual recipes', () => {
    expect(getRecipeSourcePresentation('text')).toEqual({
      icon: 'document-text-outline',
      label: 'Text import',
    });
    expect(getRecipeSourcePresentation('photo').label).toBe('Photo import');
    expect(getRecipeSourcePresentation('manual').label).toBe('Manual');
  });

  it('uses a safe fallback for future source types', () => {
    expect(getRecipeSourcePresentation('future')).toEqual({
      icon: 'globe-outline',
      label: 'Source',
    });
  });
});
