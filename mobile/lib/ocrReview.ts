import type { PublishDisclosure } from './recipePublishing';

type OcrNutrition = {
  perServing?: Partial<Record<'calories' | 'protein' | 'carbs' | 'fat', number | null>>;
};

type OcrRecipePreview = {
  title?: string | null;
  components?: Array<{ ingredients?: unknown[]; steps?: unknown[] }>;
  nutrition?: OcrNutrition;
};

/** Report whether OCR returned at least one usable canonical per-serving value. */
export function hasOcrNutrition(recipe: OcrRecipePreview | null | undefined): boolean {
  const perServing = recipe?.nutrition?.perServing;
  return ['calories', 'protein', 'carbs', 'fat'].some((field) => {
    const value = perServing?.[field as keyof typeof perServing];
    return typeof value === 'number' && Number.isFinite(value);
  });
}

/** Describe exactly what an OCR recipe would expose when made public. */
export function getOcrPublishDisclosure(recipe: OcrRecipePreview): PublishDisclosure {
  const components = recipe.components || [];
  return {
    title: recipe.title || 'Untitled recipe',
    ingredientCount: components.reduce(
      (count, component) => count + (component.ingredients?.length || 0),
      0,
    ),
    instructionCount: components.reduce(
      (count, component) => count + (component.steps?.length || 0),
      0,
    ),
    // Capture images are transient extraction inputs, not saved recipe photos.
    hasPhoto: false,
    hasSourceLink: false,
    contributorName: 'your contributor name',
  };
}
