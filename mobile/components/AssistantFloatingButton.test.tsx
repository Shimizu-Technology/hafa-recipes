import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({ Pressable: 'Pressable', StyleSheet: { create: (styles: unknown) => styles } }));
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: (style: () => object) => style(),
  withTiming: (value: number) => value,
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({ tint: '#1E7F6E', onTint: '#FFFFFF' }) }));
vi.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => true }));
vi.mock('@/lib/bottomOverlay', () => ({ ASK_PILL_HEIGHT: 48 }));
vi.mock('@/utils/haptics', () => ({ haptics: { medium: vi.fn() } }));

import { AskHafaPill } from './AssistantFloatingButton';
import { askPillCollapseFor, showsAskPill } from '@/lib/askPill';

describe('AskHafaPill', () => {
  it('names itself by its label, fills with the accent and opens chat', async () => {
    const r = createRoot();
    const onPress = vi.fn();
    try {
      await act(async () => r.render(<AskHafaPill label="Ask about this" onPress={onPress} />));
      const button = r.container.queryAll(n => n.props.accessibilityLabel === 'Ask about this')[0];
      expect(button.props.accessibilityRole).toBe('button');
      expect(r.container.queryAll(n => n.type === 'Text')[0].props.children).toBe('Ask about this');
      expect(r.container.queryAll(n => n.type === 'AnimatedView')[0].props.style[1].backgroundColor).toBe('#1E7F6E');
      await act(async () => button.props.onPress());
      expect(onPress).toHaveBeenCalledOnce();
    } finally { await act(async () => r.unmount()); }
  });

  it('folds the label away while collapsed but keeps the accessible name', async () => {
    const r = createRoot();
    try {
      await act(async () => r.render(<AskHafaPill collapsed onPress={vi.fn()} />));
      const label = r.container.queryAll(n => n.type === 'AnimatedView')[1];
      expect(label.props.style[1]).toEqual(expect.objectContaining({ maxWidth: 0, opacity: 0 }));
      expect(r.container.queryAll(n => n.props.accessibilityLabel === 'Ask Håfa')).toHaveLength(1);
    } finally { await act(async () => r.unmount()); }
  });
});

describe('Ask pill placement', () => {
  it('folds on scroll down, unfolds on scroll up and at the top', () => {
    expect(askPillCollapseFor(0, 200)).toBe(true);
    expect(askPillCollapseFor(200, 150)).toBe(false);
    expect(askPillCollapseFor(200, 204)).toBeNull();
    expect(askPillCollapseFor(200, 10)).toBe(false);
  });

  it('shows on signed-in Library, Discover and Plan only', () => {
    expect(['recipes', 'discover', 'planner', 'grocery'].map(tab => showsAskPill(['(tabs)', tab], true))).toEqual([true, true, true, false]);
    expect(showsAskPill(['(tabs)', 'recipes'], false)).toBe(false);
    expect(showsAskPill(['recipe', '[id]'], true)).toBe(false);
  });
});
