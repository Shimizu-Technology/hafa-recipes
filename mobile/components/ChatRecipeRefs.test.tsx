import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const screen = vi.hoisted(() => ({ width: 393, fontScale: 1 }));
vi.mock('react-native', () => ({ Pressable: 'Pressable', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: (v: any) => v }, useWindowDimensions: () => screen }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }));
vi.mock('@/components/RecipeThumbnail', () => ({ RecipeThumbnail: 'RecipeThumbnail' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({ text: '#000', backgroundSecondary: '#eee' }) }));
import { ChatRecipeRefs } from './ChatRecipeRefs';
it.each([1, 2])('keeps long answer references identifiable and opens the chosen recipe at font scale %s', async fontScale => {
  screen.fontScale = fontScale;
  const root = createRoot();
  const open = vi.fn();
  const refs = [
    { id: 'chicken', title: 'Slow-Roasted Garlic Butter Chicken Thighs with Crispy Lemon Potatoes and Fresh Herbs', image_url: null },
    { id: 'cookies', title: 'Filled Cookies with Chocolate and Homemade Halva', image_url: null },
  ];
  try {
    await act(async () => root.render(<ChatRecipeRefs refs={refs} onOpen={open} />));
    const buttons = root.container.queryAll(n => n.type === 'Pressable');
    expect(buttons.map(n => n.props.accessibilityLabel)).toEqual(refs.map(ref => `Open ${ref.title}`));
    await act(async () => buttons[1].props.onPress());
    expect(open).toHaveBeenCalledWith(refs[1]);
  } finally { await act(async () => root.unmount()); screen.fontScale = 1; }
});
