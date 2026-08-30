import { describe, expect, it } from 'vitest';

import {
  getCookDraftPresentation,
  getRecipeReviewLabel,
} from './recipeReviewPresentation';

describe('recipe review presentation', () => {
  it('uses source-incomplete language instead of blocked language', () => {
    const label = getRecipeReviewLabel('source_incomplete');

    expect(label).toContain('Source incomplete');
    expect(label?.toLowerCase()).not.toContain('blocked');
  });

  it('keeps an incomplete recipe usable when it has instructions', () => {
    const presentation = getCookDraftPresentation('source_incomplete', 2);

    expect(presentation.canCook).toBe(true);
    expect(presentation.buttonLabel).toBe('Cook with draft');
  });

  it('routes a source-only draft toward manual completion', () => {
    const presentation = getCookDraftPresentation('source_incomplete', 0);

    expect(presentation.canCook).toBe(false);
    expect(presentation.buttonLabel).toBe('Add instructions to cook');
  });

  it('keeps ready and legacy recipes on the normal cooking path', () => {
    expect(getCookDraftPresentation('ready', 1).buttonLabel).toBe('Start Cooking');
    expect(getCookDraftPresentation(null, 1).buttonLabel).toBe('Start Cooking');
  });
});
