import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ push: vi.fn(), keyboard: false, inset: 0, listeners: {} as Record<string, () => void> }));
vi.mock('react-native', () => ({
  Keyboard: { isVisible: () => state.keyboard, addListener: (name: string, fn: () => void) => { state.listeners[name] = fn; return { remove: vi.fn() }; } },
  Platform: { OS: 'ios' }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 34 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({ tint: '#1E7F6E', onTint: '#FFFFFF', tabIconDefault: '#68686D', chromeBar: '#FFFFFF', chromeHairline: 'hairline', chromeIndicator: 'indicator' }) }));
vi.mock('@/lib/bottomOverlay', () => ({ reportTabScreenBottomInset: (value: number) => { state.inset = value; } }));
vi.mock('@/utils/haptics', () => ({ lightHaptic: vi.fn() }));
import { HafaTabBar, TAB_BAR_HEIGHT } from '@/components/chrome/HafaTabBar';

const routes = [['recipes', 'Library'], ['discover', 'Discover'], ['planner', 'Plan'], ['grocery', 'Grocery']].map(([name, title]) => ({ key: `${name}-key`, name, title }));
const navigation = { emit: vi.fn(() => ({ defaultPrevented: false })), navigate: vi.fn() };
const props = (index = 0) => ({
  state: { index, routes: routes.map(({ key, name }) => ({ key, name, params: undefined })) },
  descriptors: Object.fromEntries(routes.map(({ key, title }) => [key, { options: { title } }])),
  navigation,
}) as any;
beforeEach(() => { state.push.mockClear(); navigation.navigate.mockClear(); state.keyboard = false; });

it('puts Import between Discover and Plan and announces the selected tab', async () => {
  const r = createRoot();
  try {
    await act(async () => r.render(<HafaTabBar {...props(1)} />));
    const slots = r.container.queryAll(n => n.type === 'Pressable');
    expect(slots.map(n => n.props.accessibilityLabel)).toEqual(['Library', 'Discover', 'Import a recipe', 'Plan', 'Grocery']);
    expect(slots.filter(n => n.props.accessibilityRole === 'tab').map(n => n.props.accessibilityState.selected)).toEqual([false, true, false, false]);
    expect(slots[2].props.accessibilityRole).toBe('button');
    expect(state.inset).toBe(TAB_BAR_HEIGHT + 34);
  } finally { await act(async () => r.unmount()); }
});

it('opens the import screen from the centre action and switches tabs', async () => {
  const r = createRoot();
  try {
    await act(async () => r.render(<HafaTabBar {...props(0)} />));
    const slots = r.container.queryAll(n => n.type === 'Pressable');
    await act(async () => slots[2].props.onPress());
    expect(state.push).toHaveBeenCalledWith('/');
    await act(async () => slots[3].props.onPress());
    expect(navigation.navigate).toHaveBeenCalledWith('planner', undefined);
    await act(async () => slots[0].props.onPress());
    expect(navigation.navigate).toHaveBeenCalledTimes(1);
  } finally { await act(async () => r.unmount()); }
});

it('steps aside while the keyboard is up', async () => {
  const r = createRoot();
  try {
    await act(async () => r.render(<HafaTabBar {...props(0)} />));
    await act(async () => state.listeners.keyboardWillShow());
    expect(r.container.queryAll(n => n.type === 'Pressable')).toHaveLength(0);
    await act(async () => state.listeners.keyboardWillHide());
    expect(r.container.queryAll(n => n.type === 'Pressable')).toHaveLength(5);
  } finally { await act(async () => r.unmount()); }
});
