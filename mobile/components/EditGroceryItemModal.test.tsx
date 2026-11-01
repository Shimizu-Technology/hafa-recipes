import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
import type { GroceryItem } from '@/types/recipe';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ fontScale: 1 }));
vi.mock('react-native', () => ({
  Modal: 'Modal', View: 'View', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' },
  StyleSheet: { create: (s: unknown) => s }, useWindowDimensions: () => ({ fontScale: state.fontScale }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34 }) }));
vi.mock('./Themed', () => ({ Text: 'Text', View: 'View', useColors: () => ({ text: '#000', actionText: '#155c52' }) }));
import EditGroceryItemModal from './EditGroceryItemModal';

it('stacks the title above actions and Quantity/Unit vertically at AX5, preserving cancel and save', async () => {
  const r = createRoot(); const close = vi.fn(), save = vi.fn();
  const item = { id: 'fixture', name: 'Rice', quantity: '2', unit: 'cups', notes: '' } as GroceryItem;
  const render = () => <EditGroceryItemModal visible onClose={close} onSave={save} item={item} />;
  await act(async () => r.render(render()));
  const findText = (value: string) => r.container.queryAll(n => n.type === 'Text' && n.children.includes(value))[0];
  const smallQuantity = findText('Quantity');
  expect(smallQuantity.props.numberOfLines).toBeUndefined();
  state.fontScale = 3.1;
  await act(async () => r.render(render()));
  const views = r.container.queryAll(n => n.type === 'View');
  expect(views.some(n => Array.isArray(n.props.style) && n.props.style.some((s: any) => s?.flexDirection === 'column'))).toBe(true);
  const actions = r.container.queryAll(n => n.type === 'TouchableOpacity');
  expect(views.some(n => Array.isArray(n.props.style) && n.props.style.some((s: any) => s?.minHeight >= 68))).toBe(true);
  expect(actions.map(n => n.props.accessibilityLabel)).toEqual(['Cancel editing item', 'Save item']);
  await act(async () => actions[0].props.onPress()); expect(close).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled();
  const fields = r.container.queryAll(n => n.type === 'TextInput');
  await act(async () => fields[1].props.onChangeText('3'));
  await act(async () => r.container.queryAll(n => n.type === 'TouchableOpacity')[1].props.onPress());
  expect(save).toHaveBeenCalledWith({ name: 'Rice', quantity: '3', unit: 'cups', notes: '' });
  expect(r.container.queryAll(n => n.type === 'ScrollView')).toHaveLength(1);
  await act(async () => r.unmount());
});
