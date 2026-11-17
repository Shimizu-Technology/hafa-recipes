import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { Platform } from 'react-native';
import type { GrocerySection } from '@/lib/grocerySections';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const menu = vi.hoisted(() => ({ options: null as any, choose: null as any, fontScale: 1 }));
vi.mock('react-native', () => {
  class Value { setValue = vi.fn(); interpolate = () => '0deg'; }
  return {
    Platform: { OS: 'ios' }, Alert: { alert: vi.fn() },
    ActionSheetIOS: { showActionSheetWithOptions: (options: any, choose: any) => { menu.options = options; menu.choose = choose; } },
    Animated: { Value, View: 'AnimatedView', timing: () => ({ start: vi.fn() }) },
    Easing: { out: () => undefined, cubic: undefined },
    useWindowDimensions: () => ({ width: 402, height: 874, fontScale: menu.fontScale, scale: 3 }),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
    Pressable: 'Pressable',
    TouchableOpacity: 'TouchableOpacity',
    View: 'View',
  };
});
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => false }));
vi.mock('@/components/Themed', async () => ({
  Text: 'Text',
  TextScaleContext: (await import('react')).createContext(1),
  useColors: () => ({
    backgroundElevated: '#fff',
    hairline: '#eee',
    surface2: '#f5f5f5',
    text: '#111',
    textSecondary: '#666',
  }),
}));

import { GrocerySectionHeader } from './GrocerySectionHeader';

function section(overrides: Partial<GrocerySection> = {}): GrocerySection {
  return {
    key: 'recipe:recipe-1',
    title: 'Chicken Kelaguen',
    recipeId: 'recipe-1',
    data: [],
    checkedCount: 1,
    totalCount: 4,
    ...overrides,
  };
}

async function render(props: Partial<React.ComponentProps<typeof GrocerySectionHeader>>) {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  await act(async () => renderer.render(<GrocerySectionHeader section={section()} isCollapsed={false} onToggle={vi.fn()} {...props} />));
  const find = (type: string) => renderer.container.queryAll(node => node.type === type);
  const text = () => find('Text').map(node => node.props.children).join(' | ');
  return { renderer, find, text };
}

describe('GrocerySectionHeader', () => {
  it('folds and unfolds from one tap anywhere on the header', async () => {
    const onToggle = vi.fn();
    const { renderer, find, text } = await render({ onToggle, isCollapsed: true });
    try {
      const header = find('Pressable')[0];
      expect(header.props.accessibilityState).toEqual({ expanded: false });
      expect(header.props.accessibilityLabel).toBe('Chicken Kelaguen, 3 of 4 left');
      expect(header.props.accessibilityHint).toBe('Shows these items');
      expect(text()).toContain('3 of 4 left');
      await act(async () => header.props.onPress());
      expect(onToggle).toHaveBeenCalledOnce();
    } finally { await act(async () => renderer.unmount()); }
  });

  it('keeps recipe actions in the menu without a redundant expand option', async () => {
    const onOpenRecipe = vi.fn();
    const onClearSection = vi.fn();
    const onToggle = vi.fn();
    const { renderer, find } = await render({ onOpenRecipe, onClearSection, onToggle });
    try {
      const more = find('TouchableOpacity').find(node => node.props.accessibilityLabel === 'More actions for Chicken Kelaguen')!;
      await act(async () => more.props.onPress());
      expect(menu.options.title).toBe('Chicken Kelaguen · 1 of 4 checked');
      expect(menu.options.options).toEqual(['Open recipe', 'Remove recipe items', 'Cancel']);
      await act(async () => menu.choose(0));
      await act(async () => menu.choose(1));
      expect(onOpenRecipe).toHaveBeenCalledWith('recipe-1');
      expect(onClearSection).toHaveBeenCalledOnce();
      expect(onToggle).not.toHaveBeenCalled();

      // A long press on the header opens the same menu.
      menu.options = null;
      await act(async () => find('Pressable')[0].props.onLongPress());
      expect(menu.options.options).toEqual(['Open recipe', 'Remove recipe items', 'Cancel']);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('keeps every Android action in the in-app sheet', async () => {
    const showMenu = vi.fn();
    const original = Platform.OS;
    Object.assign(Platform, { OS: 'android' });
    const { renderer, find } = await render({ onOpenRecipe: vi.fn(), onClearSection: vi.fn(), onShowMenu: showMenu });
    try {
      await act(async () => find('TouchableOpacity')[0].props.onPress());
      expect(showMenu.mock.calls[0][0].map((action: any) => action.text)).toEqual(['Open recipe', 'Remove recipe items', 'Cancel']);
    } finally { Object.assign(Platform, { OS: original }); await act(async () => renderer.unmount()); }
  });

  it('gives "Other" no menu but keeps its column so the counts line up', async () => {
    const { renderer, find, text } = await render({
      section: section({ key: 'other-items', title: 'Other Items', recipeId: null, checkedCount: 0, totalCount: 3 }),
      onOpenRecipe: vi.fn(), onClearSection: vi.fn(),
    });
    try {
      expect(find('TouchableOpacity')).toHaveLength(0);
      expect(text()).toBe('Other | 3 left');
      expect(find('Pressable')[0].props.onLongPress).toBeUndefined();
    } finally { await act(async () => renderer.unmount()); }
  });

  it('shows a plain heading while a search exposes every match', async () => {
    const { renderer, find } = await render({ isCollapsible: false, isCollapsed: true, onOpenRecipe: vi.fn() });
    try {
      expect(find('Pressable')).toHaveLength(0);
      expect(find('View').some(node => node.props.accessibilityRole === 'header')).toBe(true);
      expect(find('TouchableOpacity')).toHaveLength(1);
    } finally { await act(async () => renderer.unmount()); }
  });

  it('moves the count under the title at accessibility text sizes', async () => {
    menu.fontScale = 2;
    const { renderer, find } = await render({});
    try {
      const labelRow = find('View').find(node => Array.isArray(node.props.style) && node.props.style[1]?.flexDirection === 'column');
      expect(labelRow).toBeDefined();
    } finally { menu.fontScale = 1; await act(async () => renderer.unmount()); }
  });
});
