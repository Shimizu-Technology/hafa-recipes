import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { Platform } from 'react-native';
import type { GrocerySection } from '@/lib/grocerySections';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const menu = vi.hoisted(() => ({ options: null as any, choose: null as any }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' }, Alert: { alert: vi.fn() },
  ActionSheetIOS: { showActionSheetWithOptions: (options: any, choose: any) => { menu.options = options; menu.choose = choose; } },
  useWindowDimensions: () => ({ width: 402, height: 874, fontScale: 1, scale: 3 }),
  StyleSheet: { create: (styles: unknown) => styles },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Text: 'Text',
  useColors: () => ({
    backgroundSecondary: '#fff',
    error: '#f00',
    text: '#111',
    textMuted: '#666',
    tint: '#b44',
  }),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { md: 16, xs: 12 },
  fontWeight: { medium: '500', semibold: '600' },
  radius: { full: 999, md: 12 },
  spacing: { md: 16, sm: 8, xs: 4 },
}));
vi.mock('@/lib/grocerySections', () => ({
  OTHER_GROCERY_SECTION_KEY: 'other-items',
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

describe('GrocerySectionHeader', () => {
  it('keeps all section actions available in the Android menu instead of truncating an Alert', async () => {
    const showMenu = vi.fn();
    const renderer = createRoot();
    const original = Platform.OS;
    Object.assign(Platform, { OS: 'android' });
    try {
      await act(async () => renderer.render(<GrocerySectionHeader section={section()} isCollapsed={false} onToggle={vi.fn()} onOpenRecipe={vi.fn()} onClearSection={vi.fn()} onShowMenu={showMenu} />));
      await act(async () => renderer.container.queryAll(node => node.type === 'TouchableOpacity')[0].props.onPress());
      expect(showMenu.mock.calls[0][0].map((action: any) => action.text)).toEqual(['Open recipe', 'Collapse section', 'Remove recipe items', 'Cancel']);
    } finally { Object.assign(Platform, { OS: original }); await act(async () => renderer.unmount()); }
  });

  it('opens its source recipe while keeping collapse and clear as separate actions', async () => {
    const onOpenRecipe = vi.fn();
    const onToggle = vi.fn();
    const onClearSection = vi.fn();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GrocerySectionHeader, {
          section: section(),
          isCollapsed: false,
          onOpenRecipe,
          onToggle,
          onClearSection,
        }));
      });

      const buttons = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      );
      await act(async () => buttons.find(
        (button) => button.props.accessibilityLabel === 'More actions for Chicken Kelaguen',
      )!.props.onPress());
      expect(buttons).toHaveLength(1);
      expect(menu.options.title).toContain('1/4 checked');
      await act(async () => menu.choose(menu.options.options.indexOf('Open recipe')));
      await act(async () => menu.choose(menu.options.options.indexOf('Collapse section')));
      await act(async () => menu.choose(menu.options.options.indexOf('Remove recipe items')));

      expect(onOpenRecipe).toHaveBeenCalledWith('recipe-1');
      expect(onToggle).toHaveBeenCalledOnce();
      expect(onClearSection).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('keeps a legacy title non-linking and expands only from the chevron', async () => {
    const onToggle = vi.fn();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GrocerySectionHeader, {
          section: section({
            key: 'recipe-title:old recipe',
            title: 'Old Recipe',
            recipeId: null,
          }),
          isCollapsed: true,
          onToggle,
        }));
      });

      const buttons = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      );
      expect(buttons).toHaveLength(1);
      expect(buttons.some(
        (button) => button.props.accessibilityLabel?.startsWith('Open '),
      )).toBe(false);
      const toggleButton = buttons.find(
        (button) => button.props.accessibilityLabel === 'More actions for Old Recipe',
      );
      await act(async () => toggleButton!.props.onPress());
      await act(async () => menu.choose(menu.options.options.indexOf('Expand section')));

      expect(onToggle).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('hides collapse controls while a search is exposing every matching item', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => {
        renderer.render(React.createElement(GrocerySectionHeader, {
          section: section(),
          isCollapsed: false,
          isCollapsible: false,
          onOpenRecipe: vi.fn(),
          onToggle: vi.fn(),
        }));
      });

      const buttons = renderer.container.queryAll(
        (instance) => instance.type === 'TouchableOpacity',
      );
      expect(buttons).toHaveLength(1);
      await act(async () => buttons[0].props.onPress());
      expect(menu.options.options).toEqual(['Open recipe', 'Cancel']);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});
