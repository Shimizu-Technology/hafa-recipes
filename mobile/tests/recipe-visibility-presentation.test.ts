import { describe, expect, it } from 'vitest';

import { getRecipeVisibilityPresentation } from '../lib/recipeVisibilityPresentation';

describe('getRecipeVisibilityPresentation', () => {
  it('does not claim a moderated public recipe is visible in Discover', () => {
    const presentation = getRecipeVisibilityPresentation(true, 'hidden');

    expect(presentation).toEqual({
      label: 'Public — under review',
      subtitle: 'Hidden from Discover · Tap to review',
      accessibilityHint:
        'A moderation hold is hiding this public recipe. Tap to review or make private.',
      alertTitle: 'Saved as public — under review',
      alertMessage:
        'This recipe will not appear in Discover while a moderation hold is active.',
    });
    expect(presentation.alertMessage).not.toContain('Anyone can');
  });
});
