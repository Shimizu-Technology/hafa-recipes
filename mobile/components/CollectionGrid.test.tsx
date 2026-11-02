import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const metrics = vi.hoisted(() => ({ width: 393, fontScale: 1 }));
vi.mock('react-native', () => ({ View: 'View', Pressable: 'Pressable', useWindowDimensions: () => metrics, StyleSheet: { create: (v: any) => v } }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({ text: '#000', surface2: '#eee' }) }));
vi.mock('@/components/RecipeThumbnail', () => ({ RecipeThumbnail: 'RecipeThumbnail' }));
import { CollectionGrid } from './CollectionGrid';
it.each([1, 1.4])('keeps long collection names and creation/open actions distinct at text scale %s', async fontScale => {
  metrics.fontScale = fontScale;
  const root = createRoot(); const open = vi.fn(); const create = vi.fn();
  const collection = { id: 'weeknights', name: 'Quick Dinners and Leftovers for Busy School Nights', recipe_count: 24, preview_thumbnails: [], emoji: null, created_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z' };
  try {
    await act(async () => root.render(<CollectionGrid collections={[collection]} onOpen={open} onCreate={create} />));
    expect(root.container.queryAll(n => n.type === 'Text' && n.props.children === collection.name)[0].props.numberOfLines).toBe(fontScale >= 1.3 ? 4 : 2);
    const buttons = root.container.queryAll(n => n.type === 'Pressable');
    expect(buttons.map(n => n.props.accessibilityLabel)).toEqual(['New collection', `${collection.name}, 24 recipes`]);
    await act(async () => buttons[1].props.onPress());
    expect(open).toHaveBeenCalledWith(collection);
    await act(async () => buttons[0].props.onPress());
    expect(create).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); metrics.fontScale = 1; }
});
