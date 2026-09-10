import { describe, expect, it } from 'vitest';
import type { Recipe } from '@/types/recipe';
import { buildRecipeIssueEdit, getRecipeReviewIssues } from './recipeReviewIssues';

function recipeWithOneIssue(): Recipe {
  return {
    id: 'recipe-1', content_revision: 3, is_public: true, review_state: 'needs_review',
    extracted: {
      title: 'Example', servings: 4, times: { prep: '5 min', cook: '10 min', total: '15 min' },
      tags: ['Dinner'], notes: 'Keep this note',
      components: [{ name: 'Sauce', notes: 'Keep component notes', steps: ['Mix.', 'Serve.'], ingredients: [
        { name: 'Rice', quantity: '2', unit: 'cups', notes: 'Rinsed', estimatedCost: 3 },
        { name: 'Water', quantity: null, unit: 'cups' },
      ] }],
    },
    extraction_evidence: { version: 2, assessment: { issues: [
      { code: 'missing_quantity', path: 'components.0.ingredients.1.quantity', message: 'Amount not stated in the source.' },
    ] } },
  } as unknown as Recipe;
}

describe('optional recipe issue review', () => {
  it('offers one actual issue instead of certifying every populated field', () => {
    expect(getRecipeReviewIssues(recipeWithOneIssue())).toHaveLength(1);
  });
  it('corrects only the selected amount and preserves unrelated content and privacy intent', () => {
    const recipe = recipeWithOneIssue();
    const edit = buildRecipeIssueEdit(recipe, { 'components.0.ingredients.1.quantity': '3' }, new Set());
    expect(edit.verified_paths).toEqual(['components.0.ingredients.1.quantity']);
    expect(edit.components?.[0].ingredients[1].quantity).toBe('3');
    expect(edit.components?.[0].ingredients[0]).toEqual(recipe.extracted.components[0].ingredients[0]);
    expect(edit.components?.[0].notes).toBe('Keep component notes');
    expect(edit.notes).toBe('Keep this note');
    expect(edit.review_content_revision).toBe(3);
    expect(edit).not.toHaveProperty('is_public');
    expect(recipe.extracted.components[0].ingredients[1].quantity).toBeNull();
  });
  it('leaving an issue alone does not claim a human verified it', () => {
    expect(buildRecipeIssueEdit(recipeWithOneIssue(), {}, new Set()).verified_paths).toEqual([]);
  });
  it('accepts an unstated amount only through an explicit action, without inventing a value', () => {
    const edit = buildRecipeIssueEdit(recipeWithOneIssue(), {}, new Set(['components.0.ingredients.1.quantity']));
    expect(edit.verified_paths).toEqual(['components.0.ingredients.1.quantity']);
    expect(edit.components?.[0].ingredients[1].quantity).toBeNull();
  });
  it('never converts unlocated source warnings into a checklist or verifies injected paths', () => {
    const recipe = recipeWithOneIssue();
    (recipe.extraction_evidence!.assessment as { issues: unknown[] }).issues.push({ code: 'source_warning', path: null, message: 'Some text was unclear.' });
    expect(getRecipeReviewIssues(recipe)).toHaveLength(2);
    const edit = buildRecipeIssueEdit(recipe, { title: 'Injected' }, new Set(['components.0.ingredients.0.name']));
    expect(edit.title).toBe('Example');
    expect(edit.verified_paths).toEqual([]);
  });
  it('finds only unresolved missing amounts in older evidence', () => {
    const recipe = recipeWithOneIssue();
    recipe.extraction_evidence = { version: 2, fields: [
      { path: 'title', status: 'supported' },
      { path: 'components.0.ingredients.0.quantity', status: 'user_verified', quantityStatus: 'not_stated' },
      { path: 'components.0.ingredients.1.quantity', status: 'not_stated', quantityStatus: 'not_stated' },
    ] };
    expect(getRecipeReviewIssues(recipe).map(issue => issue.path)).toEqual(['components.0.ingredients.1.quantity']);
  });
});


it('accepts an AI estimate without laundering it into a source amount; corrections remove it', () => {
  const recipe = recipeWithOneIssue();
  const path = 'components.0.ingredients.1.quantity';
  const estimate = { quantity: '3', unit: 'cups', reason: 'For the stated rice amount.' };
  recipe.extracted.components[0].ingredients[1].quantityEstimate = estimate;
  recipe.extraction_evidence = { assessment: { issues: [{ code: 'estimated_quantity', path, message: 'AI estimated this amount from the recipe context.' }] } };
  expect(getRecipeReviewIssues(recipe)).toHaveLength(1);
  const accepted = buildRecipeIssueEdit(recipe, {}, new Set([path]));
  expect(accepted.verified_paths).toEqual([path]);
  expect(accepted.components?.[0].ingredients[1]).toMatchObject({ quantity: null, quantityEstimate: estimate });
  const corrected = buildRecipeIssueEdit(recipe, { [path]: '4' }, new Set());
  expect(corrected.components?.[0].ingredients[1]).toMatchObject({ quantity: '4', quantityEstimate: null });
});
