import { describe, expect, it } from 'vitest';

import {
  getRecipeFieldReviewProgress,
  isRecipePathVerified,
  usesRecipeFieldReview,
} from './recipeFieldReview';

const reviewed = { name: true, quantity: true, unit: true };

describe('recipe field review', () => {
  it('recognizes only versioned field evidence and exact verified paths', () => {
    const evidence = {
      version: 2,
      fields: [
        { path: 'title', status: 'user_verified' },
        { path: 'servings', status: 'supported' },
      ],
    };

    expect(usesRecipeFieldReview(evidence)).toBe(true);
    expect(isRecipePathVerified(evidence, 'title')).toBe(true);
    expect(isRecipePathVerified(evidence, 'servings')).toBe(false);
    expect(usesRecipeFieldReview({ version: 1, fields: [] })).toBe(false);
    // Once the server opts a recipe into v2, malformed fields must fail closed
    // instead of falling back to the legacy whole-form review behavior.
    expect(usesRecipeFieldReview({ version: 2, fields: 'invalid' })).toBe(true);
    expect(isRecipePathVerified({ version: 2, fields: 'invalid' }, 'title')).toBe(false);
  });

  it('maps stable local records to their current canonical paths after deletion', () => {
    const progress = getRecipeFieldReviewProgress({
      title: 'Kelaguen',
      servings: '',
      prepTime: '',
      cookTime: '',
      totalTime: '',
      reviewedScalarPaths: new Set(['title']),
      components: [{ id: 'removed' }, { id: 'main' }],
      ingredients: [
        {
          id: 'lemon',
          componentId: 'main',
          name: 'Lemon',
          quantity: '',
          unit: '',
          reviewedFields: { ...reviewed, quantity: false },
        },
      ],
      steps: [
        { id: 'mix', componentId: 'main', text: 'Mix well', reviewed: true },
      ],
    });

    expect(progress).toEqual({
      total: 4,
      verified: 3,
      remaining: 1,
      verifiedPaths: [
        'title',
        'components.0.ingredients.0.name',
        'components.0.steps.0',
      ],
    });
  });

  it('requires explicit acceptance for a blank quantity but not a blank unit', () => {
    const base = {
      title: 'Rice',
      servings: '',
      prepTime: '',
      cookTime: '',
      totalTime: '',
      reviewedScalarPaths: new Set(['title']),
      components: [{ id: 'main' }],
      steps: [],
    };
    const ingredient = {
      id: 'rice',
      componentId: 'main',
      name: 'Rice',
      quantity: '',
      unit: '',
      reviewedFields: { name: true, quantity: false, unit: false },
    };

    expect(getRecipeFieldReviewProgress({ ...base, ingredients: [ingredient] })).toMatchObject({
      total: 3,
      verified: 2,
      remaining: 1,
    });
    expect(getRecipeFieldReviewProgress({
      ...base,
      ingredients: [{
        ...ingredient,
        reviewedFields: { ...ingredient.reviewedFields, quantity: true },
      }],
    })).toMatchObject({ total: 3, verified: 3, remaining: 0 });
  });

  it('does not include empty rows or transfer review to an unedited new field', () => {
    const progress = getRecipeFieldReviewProgress({
      title: 'Soup',
      servings: '4',
      prepTime: '',
      cookTime: '',
      totalTime: '',
      reviewedScalarPaths: new Set(['title']),
      components: [{ id: 'main' }],
      ingredients: [
        {
          id: 'empty',
          componentId: 'main',
          name: '',
          quantity: '',
          unit: '',
          reviewedFields: { name: false, quantity: false, unit: false },
        },
      ],
      steps: [],
    });

    expect(progress).toEqual({
      total: 2,
      verified: 1,
      remaining: 1,
      verifiedPaths: ['title'],
    });
  });
});
