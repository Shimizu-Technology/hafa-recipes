import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { GrocerySection } from '@/lib/grocerySections';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
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
  it('opens its source recipe while keeping collapse and clear as separate actions', async () => {
    const onOpenRecipe = vi.fn();
    const onToggle = vi.fn();
    const onClearSection = vi.fn();
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(GrocerySectionHeader, {
        section: section(),
        isCollapsed: false,
        onOpenRecipe,
        onToggle,
        onClearSection,
      }));
    });

    const buttons = renderer!.root.findAllByType(
      'TouchableOpacity' as unknown as React.ComponentType,
    );
    await act(async () => buttons.find(
      (button) => button.props.accessibilityLabel === 'Open Chicken Kelaguen recipe',
    )!.props.onPress());
    await act(async () => buttons.find(
      (button) => button.props.accessibilityLabel === 'Collapse Chicken Kelaguen grocery section',
    )!.props.onPress());
    await act(async () => buttons.find(
      (button) => button.props.accessibilityLabel === 'Clear Chicken Kelaguen grocery items',
    )!.props.onPress());

    expect(onOpenRecipe).toHaveBeenCalledWith('recipe-1');
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onClearSection).toHaveBeenCalledOnce();
  });

  it('keeps a legacy title non-linking and expands only from the chevron', async () => {
    const onToggle = vi.fn();
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(GrocerySectionHeader, {
        section: section({
          key: 'recipe-title:old recipe',
          title: 'Old Recipe',
          recipeId: null,
        }),
        isCollapsed: true,
        onToggle,
      }));
    });

    const buttons = renderer!.root.findAllByType(
      'TouchableOpacity' as unknown as React.ComponentType,
    );
    expect(buttons).toHaveLength(1);
    expect(buttons.some(
      (button) => button.props.accessibilityLabel?.startsWith('Open '),
    )).toBe(false);
    const toggleButton = buttons.find(
      (button) => button.props.accessibilityLabel === 'Expand Old Recipe grocery section',
    );
    await act(async () => toggleButton!.props.onPress());

    expect(onToggle).toHaveBeenCalledOnce();
  });
});
