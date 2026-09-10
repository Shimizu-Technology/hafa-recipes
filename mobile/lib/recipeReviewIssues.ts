import type { Recipe } from '@/types/recipe';
import type { api } from '@/lib/api';

export interface RecipeReviewIssue {
  code: 'missing_quantity' | 'estimated_quantity' | 'source_warning';
  id?: string;
  path: string | null;
  message: string;
}

/** Keep the optional review focused on actual issues, including older evidence. */
export function getRecipeReviewIssues(recipe: Recipe): RecipeReviewIssue[] {
  const evidence = recipe.extraction_evidence;
  const assessment = evidence?.assessment as { issues?: unknown } | undefined;
  if (Array.isArray(assessment?.issues)) {
    return assessment.issues.filter((issue): issue is RecipeReviewIssue => Boolean(
      issue && typeof issue === 'object'
      && typeof issue.message === 'string'
      && ((issue.code === 'source_warning' && issue.path === null)
        || (['missing_quantity', 'estimated_quantity'].includes(issue.code) && typeof issue.path === 'string'
          && /^components\.\d+\.ingredients\.\d+\.quantity$/.test(issue.path))),
    ));
  }
  const fields = Array.isArray(evidence?.fields) ? evidence.fields : [];
  const issues: RecipeReviewIssue[] = fields.flatMap(field => {
    if (!field || typeof field !== 'object') return [];
    const value = field as { path?: unknown; status?: unknown; quantityStatus?: unknown };
    return ['not_stated', 'estimated'].includes(String(value.quantityStatus)) && value.status !== 'user_verified'
      && typeof value.path === 'string'
      && /^components\.\d+\.ingredients\.\d+\.quantity$/.test(value.path)
      ? [{ code: value.quantityStatus === 'estimated' ? 'estimated_quantity' as const : 'missing_quantity' as const, path: value.path, message: value.quantityStatus === 'estimated' ? 'AI estimated this amount from the recipe context.' : 'Amount not stated in the source.' }]
      : [];
  });
  if (recipe.review_state === 'needs_review' && issues.length === 0) {
    issues.push({ code: 'source_warning', path: null, message: 'Compare any unclear details with the original source. Checking is optional.' });
  }
  return issues;
}

export function getIssueIngredient(recipe: Recipe, path: string | null) {
  const match = path?.match(/^components\.(\d+)\.ingredients\.(\d+)\.quantity$/);
  if (!match) return null;
  return recipe.extracted.components?.[Number(match[1])]?.ingredients?.[Number(match[2])] ?? null;
}

/** Submit only corrections or explicit acceptance of the displayed missing amounts. */
export function buildRecipeIssueEdit(
  recipe: Recipe,
  quantities: Readonly<Record<string, string>>,
  acceptedMissing: ReadonlySet<string>,
  resolvedIssues: ReadonlySet<string> = new Set(),
): Parameters<typeof api.editRecipe>[1] {
  if (!Number.isInteger(recipe.content_revision) || Number(recipe.content_revision) < 1) {
    throw new Error('Reload this recipe before saving changes.');
  }
  const allowed = new Set(getRecipeReviewIssues(recipe)
    .filter(issue => ['missing_quantity', 'estimated_quantity'].includes(issue.code) && getIssueIngredient(recipe, issue.path))
    .map(issue => issue.path!));
  const verifiedPaths: string[] = [];
  const components = recipe.extracted.components.map((component, ci) => ({
    ...component,
    ingredients: component.ingredients.map((ingredient, ii) => {
      const path = `components.${ci}.ingredients.${ii}.quantity`;
      if (!allowed.has(path)) return { ...ingredient };
      const quantity = quantities[path]?.trim();
      if (quantity) {
        verifiedPaths.push(path);
        return { ...ingredient, quantity, quantityEstimate: null };
      }
      if (acceptedMissing.has(path)) verifiedPaths.push(path);
      return { ...ingredient };
    }),
    steps: [...component.steps],
  }));
  return {
    title: recipe.extracted.title,
    servings: recipe.extracted.servings,
    prep_time: recipe.extracted.times?.prep,
    cook_time: recipe.extracted.times?.cook,
    total_time: recipe.extracted.times?.total,
    components,
    ingredients: components.flatMap(component => component.ingredients),
    steps: components.flatMap(component => component.steps),
    notes: recipe.extracted.notes,
    tags: recipe.extracted.tags,
    // Omit visibility: an optional correction must not undo a concurrent privacy change.
    review_content_revision: Number(recipe.content_revision),
    verified_paths: verifiedPaths,
    ...(resolvedIssues.size ? { resolved_issue_ids: getRecipeReviewIssues(recipe)
      .filter(issue => issue.code === 'source_warning' && issue.id && resolvedIssues.has(issue.id))
      .map(issue => issue.id!) } : {}),
  };
}
