import { describe, expect, it } from 'vitest';

import {
  canOpenRecipeOriginal,
  getCookDraftPresentation,
  getMissingQuantityLabel,
  getRecipeReviewLabel,
  isRecipeOwner,
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

  it('labels a genuinely missing imported amount without inventing to taste', () => {
    expect(getMissingQuantityLabel('needs_review', { name: 'soy sauce' })).toBe(
      'Not stated — verify original',
    );
    expect(getMissingQuantityLabel('needs_review', { name: 'salt to taste' })).toBeNull();
    expect(getMissingQuantityLabel('needs_review', { name: 'soy sauce', quantity: 'null' })).toBe(
      'Not stated — verify original',
    );
    expect(getMissingQuantityLabel('needs_review', { name: 'soy sauce', unit: 'tablespoon' })).toBe(
      'Not stated — verify original',
    );
    expect(getMissingQuantityLabel('ready', { name: 'water' })).toBe(
      'Not stated — verify original',
    );
  });

  it('uses the stable API ownership verdict when Clerk and application IDs differ', () => {
    expect(isRecipeOwner({ is_owner: true })).toBe(true);
    expect(isRecipeOwner({ is_owner: false })).toBe(false);
  });

  it('offers the original only for a web source, not a photo marker', () => {
    expect(canOpenRecipeOriginal('https://www.tiktok.com/@cook/video/123')).toBe(true);
    expect(canOpenRecipeOriginal('photo-upload')).toBe(false);
    expect(canOpenRecipeOriginal('manual://user-created')).toBe(false);
  });
});
