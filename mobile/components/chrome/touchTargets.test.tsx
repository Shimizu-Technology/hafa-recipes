import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({
  Pressable: 'Pressable', ScrollView: 'ScrollView', TextInput: 'TextInput', View: 'View',
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 },
}));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({ tint: 't', onTint: 'o', text: 'x', error: 'e', surface2: 'f', background: '#FFFFFF', textMuted: 'm', chromeIndicator: 'i', chromeSegment: 's', actionText: 'a' }) }));
import { Chip, ChipRow, CHIP_HEIGHT } from './Chips';
import { SegmentedControl, SEGMENT_HEIGHT } from './SegmentedControl';
import { FilterButton, SearchLauncher, SearchRow } from './SearchField';
import { MIN_TOUCH } from './touch';

const flat = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : typeof style === 'function' ? flat(style({ pressed: false })) : style ?? {};

it('draws 34pt chips inside 44pt pressables, and the row pulls back so spacing is unchanged', async () => {
  const r = createRoot();
  try {
    await act(async () => r.render(<ChipRow><Chip label="Needs a check · 2" selected={false} onPress={vi.fn()} /></ChipRow>));
    const target = r.container.queryAll(n => n.type === 'Pressable')[0];
    expect(flat(target.props.style).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
    expect(flat(target.queryAll(n => n.type === 'View')[0].props.style).minHeight).toBe(CHIP_HEIGHT);
    const row = flat(r.container.queryAll(n => n.type === 'View')[0].props.style);
    expect(row.marginTop).toBe(-(MIN_TOUCH - CHIP_HEIGHT) / 2);
  } finally { await act(async () => r.unmount()); }
});

it('makes each 32pt segment a 44pt touch target over a 36pt track', async () => {
  const r = createRoot();
  try {
    await act(async () => r.render(<SegmentedControl accessibilityLabel="Grocery view" value="toBuy" onChange={vi.fn()}
      options={[{ value: 'toBuy', label: 'To buy' }, { value: 'all', label: 'All' }]} />));
    const segments = r.container.queryAll(n => n.type === 'Pressable');
    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      const target = flat(segment.props.style);
      expect(target.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
      expect(flat(segment.queryAll(n => n.type === 'View')[0].props.style).minHeight).toBe(SEGMENT_HEIGHT);
      expect(SEGMENT_HEIGHT + target.paddingVertical * 2).toBeGreaterThanOrEqual(MIN_TOUCH);
    }
  } finally { await act(async () => r.unmount()); }
});

it('extends the 40pt filter button and search launcher to 44pt inside their padded row', async () => {
  const r = createRoot();
  try {
    await act(async () => r.render(<SearchRow><SearchLauncher /><FilterButton count={2} onPress={vi.fn()} /></SearchRow>));
    const row = flat(r.container.queryAll(n => n.type === 'View')[0].props.style);
    for (const control of r.container.queryAll(n => n.type === 'Pressable')) {
      const slop = control.props.hitSlop;
      expect(40 + slop.top + slop.bottom).toBeGreaterThanOrEqual(MIN_TOUCH);
      // The slop stays inside the row's padding, so Android delivers the touch.
      expect(row.paddingVertical).toBeGreaterThanOrEqual(slop.top);
    }
  } finally { await act(async () => r.unmount()); }
});
