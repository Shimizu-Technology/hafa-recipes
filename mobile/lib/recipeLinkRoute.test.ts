import { describe, expect, it } from 'vitest';
import { classifyRecipeLinkKey, recipeLinkRoute, redactRecipeLinks } from './recipeLinkRoute';

const ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

describe('universal links', () => {
  it('opens a recipe ID on the recipe screen and an unlisted key on the shared view', () => {
    expect(recipeLinkRoute(`https://hafa-recipes.com/r/${ID}`)).toBe(`/recipe/${ID}`);
    expect(recipeLinkRoute(`https://www.hafa-recipes.com/r/${ID.toUpperCase()}/`)).toBe(`/recipe/${ID}`);
    expect(recipeLinkRoute(`/r/${ID}`)).toBe(`/recipe/${ID}`);
    expect(recipeLinkRoute(`https://hafa-recipes.com/r/${KEY}`)).toBe(`/r/${KEY}`);
    expect(recipeLinkRoute(`https://hafa-recipes.com/r/${KEY}?utm_source=x`)).toBe(`/r/${KEY}`);
  });

  it.each([
    'https://example.com/r/' + ID, 'https://hafa-recipes.com/recipe/' + ID, 'https://hafa-recipes.com/r/short',
    'https://hafa-recipes.com/r/' + ID + '/og.jpg', '/recipe/' + ID, '/?sharedUrl=https%3A%2F%2Fhafa-recipes.com%2Fr%2F' + ID,
  ])('leaves other links alone: %s', path => {
    expect(recipeLinkRoute(path)).toBeNull();
  });

  it('classifies keys strictly', () => {
    expect(classifyRecipeLinkKey(ID)).toEqual({ kind: 'recipe', id: ID });
    expect(classifyRecipeLinkKey(KEY)).toEqual({ kind: 'unlisted', key: KEY });
    expect(classifyRecipeLinkKey(KEY + 'x')).toBeNull();
    expect(classifyRecipeLinkKey('../etc')).toBeNull();
  });

  it('keeps link keys out of logs', () => {
    expect(redactRecipeLinks(`GET https://api.example.com/public/r/${KEY}/data failed`)).toBe('GET https://api.example.com/public/r/[redacted]/data failed');
    expect(redactRecipeLinks(`navigate /r/${KEY}`)).toBe('navigate /r/[redacted]');
    expect(redactRecipeLinks(`/api/recipes/${ID}/share-link`)).toBe(`/api/recipes/${ID}/share-link`);
  });

});
