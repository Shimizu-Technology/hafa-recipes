export interface RecipeVisibilityPresentation {
  label: string;
  subtitle: string;
  accessibilityHint: string;
  alertTitle: string;
  alertMessage: string;
}

/**
 * Describe the saved visibility without overstating moderation-gated Discover access.
 */
export function getRecipeVisibilityPresentation(
  isPublic: boolean,
  moderationStatus: string | null | undefined,
): RecipeVisibilityPresentation {
  if (!isPublic) {
    return {
      label: 'Private recipe',
      subtitle: 'Only you can see it · Tap to publish',
      accessibilityHint: 'Tap to publish in Discover',
      alertTitle: 'Recipe is private',
      alertMessage: 'Only you can open this recipe now.',
    };
  }

  if (moderationStatus === 'hidden') {
    return {
      label: 'Public — under review',
      subtitle: 'Hidden from Discover · Tap to review',
      accessibilityHint:
        'A moderation hold is hiding this public recipe. Tap to review or make private.',
      alertTitle: 'Saved as public — under review',
      alertMessage:
        'This recipe will not appear in Discover while a moderation hold is active.',
    };
  }

  return {
    label: 'Public in Discover',
    subtitle: 'Anyone can find it · Tap to review',
    accessibilityHint: 'Tap to review or make private',
    alertTitle: 'Published to Discover',
    alertMessage: 'Anyone can now find and open this recipe in Discover.',
  };
}
