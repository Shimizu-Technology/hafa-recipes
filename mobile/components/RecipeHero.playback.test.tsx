import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ StyleSheet: { create: (styles: unknown) => styles }, View: 'View', TouchableOpacity: 'TouchableOpacity' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({ tint: '#155C52', textSecondary: '#666', card: '#fff', cardBorder: '#ddd' }) }));
vi.mock('@/components/RecipeThumbnail', () => ({ RecipeThumbnail: 'RecipeThumbnail' }));
vi.mock('./SourcePlaybackModal', () => ({ SourcePlaybackModal: 'SourcePlaybackModal' }));
vi.mock('../lib/sourcePlaybackConfig', () => ({ getSourcePlaybackMode: () => 'embedded' }));

import { RecipeHero } from './RecipeHero';
const props = { recipeTitle: 'Kelaguen', sourceUrl: 'https://www.youtube.com/watch?v=abcDEF_1234', onOpenSource: vi.fn() };

describe('recipe cover updates during source playback', () => {
  it('preserves an open embedded player when a pending cover finishes and rejects old image failures', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    const modals = () => renderer.container.queryAll((instance) => instance.type === 'SourcePlaybackModal');
    const images = () => renderer.container.queryAll((instance) => instance.type === 'RecipeThumbnail');
    try {
      await act(async () => renderer.render(<RecipeHero {...props} thumbnailUrl={null} thumbnailPending />));
      const play = renderer.container.queryAll((instance) => instance.props.accessibilityLabel === 'Play YouTube video for Kelaguen')[0];
      await act(async () => play.props.onPress());
      expect(modals()).toHaveLength(1);
      await act(async () => renderer.render(<RecipeHero {...props} thumbnailUrl="https://images/first.webp" thumbnailPending={false} />));
      expect(modals()).toHaveLength(1);
      expect(modals()[0].props.visible).toBe(true);
      const oldImage = images()[0];
      await act(async () => renderer.render(<RecipeHero {...props} thumbnailUrl="https://images/selected.webp" />));
      await act(async () => oldImage.props.onError());
      expect(images()[0].props.uri).toBe('https://images/selected.webp');
      expect(modals()).toHaveLength(1);
      await act(async () => renderer.render(<RecipeHero {...props} thumbnailUrl="https://images/first.webp" />));
      await act(async () => oldImage.props.onError());
      expect(images()[0].props.uri).toBe('https://images/first.webp');
      expect(modals()).toHaveLength(1);
      await act(async () => images()[0].props.onError());
      expect(images()).toHaveLength(0);
      expect(modals()).toHaveLength(1);
      await act(async () => modals()[0].props.onClose());
      expect(modals()).toHaveLength(0);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('closes the prior player when the actual source changes', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    try {
      await act(async () => renderer.render(<RecipeHero {...props} thumbnailUrl="https://images/food.webp" />));
      await act(async () => renderer.container.queryAll((instance) => instance.props.accessibilityLabel === 'Play YouTube video for Kelaguen')[0].props.onPress());
      expect(renderer.container.queryAll((instance) => instance.type === 'SourcePlaybackModal')).toHaveLength(1);
      await act(async () => renderer.render(<RecipeHero {...props} sourceUrl="https://www.youtube.com/watch?v=changed_123" thumbnailUrl="https://images/food.webp" />));
      expect(renderer.container.queryAll((instance) => instance.type === 'SourcePlaybackModal')).toHaveLength(0);
    } finally { await act(async () => renderer.unmount()); }
  });
});
