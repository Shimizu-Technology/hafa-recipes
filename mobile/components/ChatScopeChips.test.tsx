import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ Pressable: 'Pressable', View: 'View', StyleSheet: { create: (s: unknown) => s } }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({ actionText: 'accent', textSecondary: 'muted', chromeIndicator: 'tint', surface2: 'fill' }) }));
import { ChatScopeChips } from './ChatScopeChips';

it('draws 28pt scope chips inside 44pt pressables and switches scope', async () => {
  const onChange = vi.fn();
  const r = createRoot();
  try {
    await act(async () => r.render(<ChatScopeChips scope="recipe" canFocusRecipe onChange={onChange} />));
    const chips = r.container.queryAll(n => n.type === 'Pressable');
    expect(chips.map(n => n.props.accessibilityLabel)).toEqual(['This recipe', 'All recipes']);
    for (const chip of chips) {
      expect(chip.props.style.minHeight).toBeGreaterThanOrEqual(44);
      expect(chip.queryAll(n => n.type === 'View')[0].props.style[0].minHeight).toBe(28);
    }
    await act(async () => chips[1].props.onPress());
    expect(onChange).toHaveBeenCalledWith('all');
  } finally { await act(async () => r.unmount()); }
});
