import { describe, expect, it } from 'vitest';
import { createGuestRecipeIntent } from './guestRecipeIntent';

describe('guest recipe intent', () => {
  it('holds only one bounded intent and consumes it exactly once on the recipe', () => {
    const intent = createGuestRecipeIntent();
    intent.start('recipe-a', 'chat');
    intent.start('recipe-b', 'save');
    expect(intent.bind('session-a')).toMatchObject({ recipeId: 'recipe-b', action: 'save' });
    expect(intent.take('recipe-a', 'session-a')).toBeNull();
    expect(intent.take('recipe-b', 'session-a')).toBe('save');
    expect(intent.take('recipe-b', 'session-a')).toBeNull();
    expect(() => intent.start('https://example.com/private-content', 'save')).toThrow();
  });
  it('expires and clears on cancel, sign-out or a different account session', () => {
    let time = 0;
    const intent = createGuestRecipeIntent(() => time);
    intent.start('recipe-a', 'plan');
    time = 15 * 60_000;
    expect(intent.bind('session-a')).toBeNull();
    intent.start('recipe-a', 'collection');
    intent.bind('session-a');
    expect(intent.take('recipe-a', 'session-b')).toBeNull();
    intent.start('recipe-a', 'save');
    intent.bind('session-a');
    expect(intent.bind(null)).toBeNull();
    intent.start('recipe-a', 'save');
    intent.clear();
    expect(intent.bind('session-a')).toBeNull();
  });
});
