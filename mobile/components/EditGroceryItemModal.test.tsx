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
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) }));
const focus = vi.hoisted(() => vi.fn());
vi.mock('./Themed', async () => {
  const { createContext, createElement, forwardRef, useImperativeHandle } = await import('react');
  return {
    // A ref whose focus() records which field Return moved to.
    TextInput: forwardRef((props: any, ref) => {
      useImperativeHandle(ref, () => ({ focus: () => focus(props.accessibilityLabel) }));
      return createElement('TextInput', props);
    }),
    TextScaleContext: createContext(1), Text: 'Text', View: 'View', useColors: () => ({ text: '#000', actionText: '#155c52', destructive: '#c4322a' }),
  };
});
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

it('moves through the fields with Return, deletes from the sheet and adds no top inset', async () => {
  const r = createRoot(); const close = vi.fn(), save = vi.fn(), remove = vi.fn();
  state.fontScale = 1;
  focus.mockClear();
  const item = { id: 'fixture', name: 'Rice', quantity: '2', unit: 'cups', notes: '', recipe_title: 'Red rice' } as GroceryItem;
  await act(async () => r.render(<EditGroceryItemModal visible onClose={close} onSave={save} onDelete={remove} item={item} />));
  const field = (label: string) => r.container.queryAll(n => n.type === 'TextInput' && n.props.accessibilityLabel === label)[0];
  expect(['Name', 'Quantity', 'Unit', 'Notes'].map(label => Boolean(field(label)))).toEqual([true, true, true, true]);
  await act(async () => field('Name').props.onSubmitEditing());
  await act(async () => field('Quantity').props.onSubmitEditing());
  await act(async () => field('Unit').props.onSubmitEditing());
  expect(focus.mock.calls.map(call => call[0])).toEqual(['Quantity', 'Unit', 'Notes']);

  // A page sheet starts below the status bar, so the 59pt inset would be an empty band.
  const container = r.container.queryAll(n => n.type === 'View' && n.props.style && !Array.isArray(n.props.style) && n.props.style.flex === 1)[0];
  expect(container.props.style.paddingTop).toBeUndefined();

  const deleteButton = r.container.queryAll(n => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Delete item')[0];
  await act(async () => deleteButton.props.onPress());
  expect(remove).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();

  // Without onDelete the sheet shows no Delete button.
  await act(async () => r.render(<EditGroceryItemModal visible onClose={close} onSave={save} item={item} />));
  expect(r.container.queryAll(n => n.props.accessibilityLabel === 'Delete item')).toHaveLength(0);
  await act(async () => r.unmount());
});
