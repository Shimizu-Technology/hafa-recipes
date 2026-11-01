import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const m = vi.hoisted(() => ({ canGoBack: true, back: vi.fn(), replace: vi.fn(), focused: true }));
function host(name: string) { return (props: any) => React.createElement(name, props, props.children); }
vi.mock('react-native', () => ({
  Pressable: (props: any) => React.createElement('Pressable', props, props.children),
  StatusBar: host('StatusBar'), View: host('View'),
  StyleSheet: { create: (value: any) => value, absoluteFill: {}, hairlineWidth: 0.5 },
  useWindowDimensions: () => ({ width: 400, height: 874, fontScale: 1, scale: 3 }),
}));
vi.mock('react-native-reanimated', () => ({
  default: { View: host('AnimatedView'), ScrollView: host('AnimatedScrollView') },
  Extrapolation: { CLAMP: 'clamp' }, interpolate: () => 0, runOnJS: (fn: any) => fn,
  useAnimatedReaction: () => undefined, useAnimatedScrollHandler: () => () => undefined,
  useAnimatedStyle: () => ({}), useDerivedValue: (fn: () => number) => ({ value: fn() }),
  useSharedValue: (value: number) => ({ value }),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ canGoBack: () => m.canGoBack, back: m.back, replace: m.replace }) }));
vi.mock('expo-router/react-navigation', () => ({ useIsFocused: () => m.focused }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 54, bottom: 34 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: host('Icon') }));
vi.mock('@/components/Themed', () => ({ Text: host('Text'), useColors: () => ({ background: '#FFFFFF', text: '#000000' }) }));

import { RecipeDetailFrame, RecipeDetailScroll, recipeHeaderRanges } from '../components/RecipeDetailChrome';

it('turns the bar opaque as the photo leaves and keeps it opaque without a photo', () => {
  expect(recipeHeaderRanges(300, 106)).toEqual({ solid: [146, 194], title: [218, 250] });
  expect(recipeHeaderRanges(0, 106)).toEqual({ solid: null, title: [24, 56] });
});

it('labels every header circle and returns to the library when there is no history', async () => {
  const share = vi.fn();
  const root = createRoot();
  try {
    await act(async () => root.render(
      <RecipeDetailScroll title="Kelaguen" expectHero hero={null}
        actions={[{ icon: 'share-outline', accessibilityLabel: 'Share recipe', onPress: share }]}>
        <></>
      </RecipeDetailScroll>,
    ));
    const buttons = () => root.container.queryAll(node => node.type === 'Pressable');
    expect(buttons().map(node => node.props.accessibilityLabel)).toEqual(['Back', 'Share recipe']);
    await act(async () => buttons()[1].props.onPress());
    expect(share).toHaveBeenCalled();
    await act(async () => buttons()[0].props.onPress());
    expect(m.back).toHaveBeenCalled();
    m.canGoBack = false;
    await act(async () => buttons()[0].props.onPress());
    expect(m.replace).toHaveBeenCalledWith('/(tabs)/recipes');
    // The duplicate bar title stays out of VoiceOver; the in-page title is the heading.
    const title = root.container.queryAll(node => node.type === 'Text' && node.props.children === 'Kelaguen')[0];
    expect(title.parent?.props.accessibilityElementsHidden).toBe(true);
  } finally { await act(async () => root.unmount()); m.canGoBack = true; }
});

it('sets the status bar only while the recipe is the focused screen', async () => {
  const root = createRoot();
  try {
    await act(async () => root.render(<RecipeDetailFrame><></></RecipeDetailFrame>));
    expect(root.container.queryAll(node => node.type === 'StatusBar')[0].props.barStyle).toBe('dark-content');
    m.focused = false;
    await act(async () => root.render(<RecipeDetailFrame><></></RecipeDetailFrame>));
    expect(root.container.queryAll(node => node.type === 'StatusBar')).toHaveLength(0);
  } finally { await act(async () => root.unmount()); m.focused = true; }
});

it('keeps each header glyph above its shadowed fill on Android', async () => {
  const root = createRoot();
  try {
    await act(async () => root.render(<RecipeDetailFrame><></></RecipeDetailFrame>));
    const button = root.container.queryAll(node => node.type === 'Pressable')[0];
    const flat = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : (style ?? {});
    const fillElevation = Math.max(...button.queryAll((node: any) => node.type === 'AnimatedView').map((node: any) => flat(node.props.style).elevation ?? 0));
    const glyph = button.queryAll((node: any) => node.type === 'Icon')[0];
    expect(fillElevation).toBeGreaterThan(0);
    expect(flat(glyph.parent?.props.style).elevation).toBeGreaterThan(fillElevation);
  } finally { await act(async () => root.unmount()); }
});
