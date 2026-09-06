export const RECIPE_FIELD_REVIEW_VERSION = 2;

export interface IngredientFieldReview {
  name: boolean;
  quantity: boolean;
  unit: boolean;
}

export interface ReviewableIngredientInput {
  id: string;
  componentId: string;
  name: string;
  quantity: string;
  unit: string;
  reviewedFields: IngredientFieldReview;
}

export interface ReviewableStepInput {
  id: string;
  componentId: string;
  text: string;
  reviewed: boolean;
}

export interface ReviewableComponentInput {
  id: string;
}

export interface RecipeFieldReviewProgress {
  total: number;
  verified: number;
  remaining: number;
  verifiedPaths: string[];
}

type ExtractionEvidence = {
  version?: unknown;
  fields?: unknown;
};

function hasValue(value: string): boolean {
  return value.trim().length > 0;
}

export function usesRecipeFieldReview(evidence: unknown): boolean {
  return Boolean(
    evidence
      && typeof evidence === 'object'
      && (evidence as ExtractionEvidence).version === RECIPE_FIELD_REVIEW_VERSION,
  );
}

export function isRecipePathVerified(evidence: unknown, path: string): boolean {
  if (
    !usesRecipeFieldReview(evidence)
      || !Array.isArray((evidence as ExtractionEvidence).fields)
  ) return false;

  return ((evidence as ExtractionEvidence).fields as unknown[]).some(
    field => Boolean(
      field
        && typeof field === 'object'
        && (field as { path?: unknown }).path === path
        && (field as { status?: unknown }).status === 'user_verified',
    ),
  );
}

export function getRecipeFieldReviewProgress({
  title,
  servings,
  prepTime,
  cookTime,
  totalTime,
  reviewedScalarPaths,
  components,
  ingredients,
  steps,
}: {
  title: string;
  servings: string;
  prepTime: string;
  cookTime: string;
  totalTime: string;
  reviewedScalarPaths: ReadonlySet<string>;
  components: ReviewableComponentInput[];
  ingredients: ReviewableIngredientInput[];
  steps: ReviewableStepInput[];
}): RecipeFieldReviewProgress {
  const reviewable: Array<{ path: string; reviewed: boolean }> = [];
  const scalars: Array<[string, string]> = [
    ['title', title],
    ['servings', servings],
    ['times.prep', prepTime],
    ['times.cook', cookTime],
    ['times.total', totalTime],
  ];

  for (const [path, value] of scalars) {
    if (hasValue(value)) {
      reviewable.push({ path, reviewed: reviewedScalarPaths.has(path) });
    }
  }

  const populatedComponents = components.filter(component =>
    ingredients.some(ingredient => ingredient.componentId === component.id && hasValue(ingredient.name))
      || steps.some(step => step.componentId === component.id && hasValue(step.text)),
  );

  populatedComponents.forEach((component, componentIndex) => {
    ingredients
      .filter(ingredient => ingredient.componentId === component.id && hasValue(ingredient.name))
      .forEach((ingredient, ingredientIndex) => {
        const prefix = `components.${componentIndex}.ingredients.${ingredientIndex}`;
        reviewable.push({ path: `${prefix}.name`, reviewed: ingredient.reviewedFields.name });
        // A missing quantity is itself a reviewable source fact. Keeping this
        // path lets someone explicitly accept that the source stated no amount.
        reviewable.push({ path: `${prefix}.quantity`, reviewed: ingredient.reviewedFields.quantity });
        if (hasValue(ingredient.unit)) {
          reviewable.push({ path: `${prefix}.unit`, reviewed: ingredient.reviewedFields.unit });
        }
      });

    steps
      .filter(step => step.componentId === component.id && hasValue(step.text))
      .forEach((step, stepIndex) => {
        reviewable.push({
          path: `components.${componentIndex}.steps.${stepIndex}`,
          reviewed: step.reviewed,
        });
      });
  });

  const verifiedPaths = reviewable
    .filter(field => field.reviewed)
    .map(field => field.path);

  return {
    total: reviewable.length,
    verified: verifiedPaths.length,
    remaining: reviewable.length - verifiedPaths.length,
    verifiedPaths,
  };
}
