import { describe, expect, it } from 'vitest';

import { getOcrPublishDisclosure, hasOcrNutrition } from './ocrReview';

describe('OCR review helpers', () => {
  it('detects nutrition only in the canonical per-serving object', () => {
    const legacyRootNutrition = { nutrition: { calories: 220 } } as unknown as Parameters<
      typeof hasOcrNutrition
    >[0];

    expect(hasOcrNutrition({ nutrition: { perServing: { calories: 220 } } })).toBe(true);
    expect(hasOcrNutrition({ nutrition: { perServing: {} } })).toBe(false);
    expect(hasOcrNutrition(legacyRootNutrition)).toBe(false);
  });

  it('does not claim transient source screenshots are published as recipe photos', () => {
    expect(getOcrPublishDisclosure({
      title: 'Red Rice',
      components: [
        { ingredients: [{}, {}], steps: ['Toast', 'Simmer'] },
        { ingredients: [{}], steps: ['Rest'] },
      ],
    })).toEqual({
      title: 'Red Rice',
      ingredientCount: 3,
      instructionCount: 3,
      hasPhoto: false,
      hasSourceLink: false,
      contributorName: 'your contributor name',
    });
  });
});
