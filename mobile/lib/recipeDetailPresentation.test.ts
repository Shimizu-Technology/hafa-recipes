import { describe, expect, it } from 'vitest';
import { recipeCost, recipeLoadError, canRetainRecipeOnError } from './recipeDetailPresentation';

describe('recipe detail cost and unavailable states', () => {
  it('scales the batch total while keeping the cost of one portion stable', () => {
    expect(recipeCost(12, 4, 2)).toEqual({ total: 24, perServing: 3 });
    expect(recipeCost(0, 4, 2)).toEqual({ total: 0, perServing: 0 });
  });
  it.each([null, undefined, 0, -1, NaN])('never invents a serving cost or batch scaling for %s', servings => {
    expect(recipeCost(12, servings, 2)).toEqual({ total: 12, perServing: null });
  });
  it.each([null, undefined, -1, Infinity, NaN])('keeps unavailable or invalid cost distinct from zero: %s', total => {
    expect(recipeCost(total, 4)).toBeNull();
  });
  it('offers retry for connection/server failures but does not imply a missing or inaccessible recipe will retry', () => {
    expect(recipeLoadError(new Error('offline'))).toMatchObject({ canRetry: true, title: 'Couldn’t load this recipe' });
    expect(recipeLoadError({ response: { status: 503 } })).toMatchObject({ canRetry: true });
    expect(recipeLoadError({ response: { status: 404 } })).toMatchObject({ canRetry: false, title: 'Recipe not found' });
    expect(recipeLoadError({ response: { status: 403 } })).toMatchObject({ canRetry: false, title: 'Recipe unavailable' });
    expect(recipeLoadError({ response: { status: 401 } })).toMatchObject({ title: 'Sign in to open this recipe' });
  });
  it('retains cached content for transient failures and hides it when access is denied or the recipe was removed', () => {
    expect(canRetainRecipeOnError(new Error('offline'))).toBe(true);
    for (const status of [503, 408, 429]) expect(canRetainRecipeOnError({ response: { status } })).toBe(true);
    for (const status of [401, 403, 404, 410]) expect(canRetainRecipeOnError({ response: { status } })).toBe(false);
  });
});
