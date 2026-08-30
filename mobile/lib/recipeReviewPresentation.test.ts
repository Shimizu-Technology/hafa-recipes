import { describe, expect, it } from 'vitest';

import {
  canOpenRecipeOriginal,
  getCookDraftPresentation,
  getMissingQuantityLabel,
  getRecipeReviewDetails,
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
    expect(getMissingQuantityLabel('needs_review', { name: 'salt', unit: 'to taste' })).toBeNull();
    expect(getMissingQuantityLabel('ready', { name: 'water' })).toBe(
      'Not stated — verify original',
    );
    expect(getMissingQuantityLabel(null, { name: 'achiote water' })).toBe(
      'Not stated — verify original',
    );
  });

  it('turns owner evidence into a precise amount-review action', () => {
    expect(getRecipeReviewDetails('needs_review', 3, {
      source: {
        modalities: ['audio_transcript', 'video_frames'],
        frames: [
          { timestampSeconds: 0 },
          { timestampSeconds: 15 },
          { timestampSeconds: 65 },
          { timestampSeconds: 90 },
          { timestampSeconds: 120 },
        ],
      },
      assessment: { missingQuantityCount: 2 },
    })).toEqual({
      actionLabel: 'Review 2 amounts',
      heading: '2 ingredient amounts were not stated',
      message: 'Missing amounts stay blank instead of being guessed. Add them only if you can verify them from the source.',
      missingQuantityCount: 2,
      sourceSummary: 'Checked spoken audio and video frames at 0:00, 0:15, 1:05, 1:30, +1 more.',
    });
  });

  it('makes an incomplete source an add-details task without invented evidence', () => {
    expect(getRecipeReviewDetails('source_incomplete', 1, null)).toMatchObject({
      actionLabel: 'Add missing details',
      heading: 'Finish this saved draft',
      sourceSummary: null,
    });
    expect(getRecipeReviewDetails('ready', 0, null)).toBeNull();
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
