import { describe, expect, it } from 'vitest';

import {
  formatPublishDisclosure,
  getPublishDisclosure,
  PUBLISHING_DISCLOSURE_MESSAGE,
  PUBLISHING_DISCLOSURE_VERSION,
} from './recipePublishing';

describe('recipe publishing disclosure', () => {
  it('versions a reusable account-level disclosure without claiming private data is shared', () => {
    expect(PUBLISHING_DISCLOSURE_VERSION).toBe(1);
    expect(PUBLISHING_DISCLOSURE_MESSAGE).toContain('can appear in Discover and search');
    expect(PUBLISHING_DISCLOSURE_MESSAGE).toContain('Personal notes and extraction details stay private');
  });
  it('counts every component without exposing private extraction details', () => {
    const disclosure = getPublishDisclosure({
      extracted: {
        title: 'Chicken Kelaguen',
        components: [
          { name: 'Chicken', ingredients: [{ name: 'chicken', quantity: null, unit: null }], steps: ['Grill'] },
          { name: 'Finish', ingredients: [{ name: 'lemon', quantity: null, unit: null }], steps: ['Mix', 'Rest'] },
        ],
      },
      thumbnail_url: 'https://example.com/photo.jpg',
      source_url: 'https://example.com/recipe',
      extractor_display_name: 'Leon',
    } as any);

    expect(disclosure).toMatchObject({ ingredientCount: 2, instructionCount: 3, hasPhoto: true });
    const message = formatPublishDisclosure(disclosure);
    expect(message).toContain('attribution to Leon');
    expect(message).toContain('personal notes and extraction details stay private');
  });

  it('does not claim a manual-only source link will be public', () => {
    const disclosure = getPublishDisclosure({
      extracted: { title: 'Family Soup', components: [] },
      thumbnail_url: null,
      source_url: 'manual://user-created',
      extractor_display_name: null,
    } as any);

    expect(formatPublishDisclosure(disclosure)).not.toContain('original source link');
  });
});
