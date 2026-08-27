import { describe, expect, it } from 'vitest';

import { floatingChatBottom, isFloatingChatPath } from '../lib/floatingChatLayout';

describe('FloatingChatButton layout helpers', () => {
  it('covers every primary tab route, including the renamed planner route', () => {
    for (const pathname of [
      '/',
      '/discover',
      '/history',
      '/planner',
      '/grocery',
      '/(tabs)/planner',
    ]) {
      expect(isFloatingChatPath(pathname)).toBe(true);
    }

    expect(isFloatingChatPath('/recipe/recipe-1')).toBe(false);
    expect(isFloatingChatPath('/cook-mode/recipe-1')).toBe(false);
    expect(isFloatingChatPath('/settings')).toBe(false);
  });

  it('lifts the chat control above the guest account prompt', () => {
    const wrappedPromptHeight = 140;

    expect(floatingChatBottom(false, wrappedPromptHeight)).toBe(
      floatingChatBottom(true, wrappedPromptHeight) + wrappedPromptHeight,
    );
  });
});
