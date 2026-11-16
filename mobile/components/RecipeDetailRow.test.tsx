import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ fontScale: 1 }));
vi.mock('react-native', () => ({
  Pressable: 'Pressable', TouchableOpacity: 'TouchableOpacity', View: 'View',
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 }, useWindowDimensions: () => ({ fontScale: m.fontScale }),
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', async () => ({ Text: 'Text', TextScaleContext: (await import('react')).createContext(1), useColors: () => ({}) }));

import { RecipeDetailRow } from './RecipeDetailRow';

async function render(props: Partial<React.ComponentProps<typeof RecipeDetailRow>>) {
  const root = createRoot();
  await act(async () => root.render(<RecipeDetailRow icon="play-circle-outline" title="Original" onPress={() => {}} stacked {...props} />));
  return root;
}
const text = (root: any, label: string) => root.container.queryAll((n: any) => n.type === 'Text' && n.children.includes(label))[0];

describe('stacked action rows', () => {
  it('centers icon, text and chevron, with the detail left-aligned on one line under the title', async () => {
    const root = await render({ value: 'Instagram post by @a_really_long_creator_handle_here' });
    const row = root.container.queryAll((n: any) => n.type === 'TouchableOpacity')[0];
    expect(row.props.style[0].alignItems).toBe('center');
    const value = text(root, 'Instagram post by @a_really_long_creator_handle_here');
    expect(value.props.numberOfLines).toBe(1);
    expect(value.props.ellipsizeMode).toBe('tail');
    expect(value.props.style[0]).toMatchObject({ textAlign: 'left' });
    expect(value.props.style[0].marginLeft).toBeUndefined();
    // A growing title would push the detail down, away from it.
    expect(text(root, 'Original').props.style[0].flexGrow).toBeUndefined();
    expect(root.container.queryAll((n: any) => n.type === 'Ionicons' && n.props.name === 'chevron-forward')).toHaveLength(1);
  });

  it('allows two lines of detail at accessibility text sizes', async () => {
    m.fontScale = 2;
    try {
      const root = await render({ value: 'TikTok video by @thecoreyb' });
      expect(text(root, 'TikTok video by @thecoreyb').props.numberOfLines).toBe(2);
    } finally { m.fontScale = 1; }
  });

  it('gives a row without detail the same minimum height as a row with detail', async () => {
    const plain = await render({ title: 'Copy link' });
    const detailed = await render({ value: 'TikTok video by @thecoreyb' });
    const height = (root: any) => root.container.queryAll((n: any) => n.type === 'TouchableOpacity')[0].props.style[1].minHeight;
    expect(height(plain)).toBe(68);
    expect(height(detailed)).toBe(height(plain));
  });

  it('draws no separator under the last row of a group', async () => {
    const separators = (root: any) => root.container.queryAll((n: any) => n.type === 'View' && n.props.pointerEvents === 'none');
    expect(separators(await render({ value: 'x' }))).toHaveLength(1);
    expect(separators(await render({ value: 'x', last: true }))).toHaveLength(0);
  });

  it('keeps the same anatomy for a row without detail', async () => {
    const root = await render({ title: 'Copy link' });
    expect(root.container.queryAll((n: any) => n.type === 'Text')).toHaveLength(1);
    expect(root.container.queryAll((n: any) => n.type === 'Ionicons' && n.props.name === 'chevron-forward')).toHaveLength(1);
  });

  it('keeps the normal 12 pt icon gap at accessibility sizes for stacked rows only', async () => {
    const gap = (root: any) => root.container.queryAll((n: any) => n.type === 'TouchableOpacity')[0].props.style.at(-1).gap;
    m.fontScale = 3.1;
    try {
      expect(gap(await render({ value: 'Ingredients and steps' }))).toBe(12);
      // Recipe detail's side-by-side rows keep their tighter large-text gap.
      expect(gap(await render({ stacked: false, value: 'Ingredients and steps' }))).toBe(4);
    } finally { m.fontScale = 1; }
    expect(gap(await render({}))).toBe(12);
  });

  it('reads the title and detail together to screen readers', async () => {
    const root = await render({ value: 'TikTok video by @thecoreyb' });
    expect(root.container.queryAll((n: any) => n.type === 'TouchableOpacity')[0].props.accessibilityLabel).toBe('Original, TikTok video by @thecoreyb');
    const plain = await render({ title: 'Copy link' });
    expect(plain.container.queryAll((n: any) => n.type === 'TouchableOpacity')[0].props.accessibilityLabel).toBe('Copy link');
    const custom = await render({ value: 'x', accessibilityLabel: 'Send the original' });
    expect(custom.container.queryAll((n: any) => n.type === 'TouchableOpacity')[0].props.accessibilityLabel).toBe('Send the original');
  });
});
