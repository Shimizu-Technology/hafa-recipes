import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';
import Colors from '@/constants/Colors';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ Text: 'Text', View: 'View', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => Array.isArray(s) ? Object.assign({}, ...s) : s } }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('./useColorScheme', () => ({ useColorScheme: () => 'dark' }));
vi.mock('./Animated', () => ({ ScalePressable: 'ScalePressable' }));
import { Button, Card, Chip, IconButton, Input, Text } from './Themed';

describe('shared controls', () => {
  it('allows primary text, inputs, buttons and chips to scale without a cap', async () => {
    const r = createRoot();
    await act(async () => r.render(<><Text>Recipe</Text><Input value="" onChangeText={vi.fn()} /><Chip label="A long choice" onPress={vi.fn()} /><Button title="Apply filters" onPress={vi.fn()} /></>));
    const labels = r.container.queryAll(n => n.type === 'Text' || n.type === 'TextInput');
    expect(labels.length).toBe(4);
    labels.forEach(n => expect(n.props.maxFontSizeMultiplier).toBeUndefined());
    await act(async () => r.unmount());
  });

  it('centres multiline chip labels and gives body overrides proportional leading', async () => {
    const r = createRoot();
    await act(async () => r.render(<><Text style={{ fontSize: 28 }}>A long recipe</Text><Chip label="Under thirty minutes" selected onPress={vi.fn()} /></>));
    const labels = r.container.queryAll(n => n.type === 'Text');
    expect(labels[0].props.style[0].lineHeight).toBe(34);
    expect(labels[1].props.style).toMatchObject({ lineHeight: 18, textAlign: 'center', includeFontPadding: false });
    await act(async () => r.unmount());
  });

  it('keeps short chips and small buttons at least 44pt in both dimensions', async () => {
    const r = createRoot();
    await act(async () => r.render(<><Chip label="A" size="sm" onPress={vi.fn()} /><Button title="+" size="sm" onPress={vi.fn()} /></>));
    const chip = r.container.queryAll(n => n.type === 'View')[0];
    const button = r.container.queryAll(n => n.type === 'ScalePressable')[1];
    expect(chip.props.style[0]).toMatchObject({ minHeight: 44, minWidth: 44 });
    expect(button.props.style[0]).toMatchObject({ minHeight: 44, minWidth: 44 });
    await act(async () => r.unmount());
  });

  it('names clear actions, preserves the field label, and clears only that field', async () => {
    const change = vi.fn(); const r = createRoot();
    await act(async () => r.render(<Input value="rice" accessibilityLabel="Search recipes" onChangeText={change} />));
    const field = r.container.queryAll(n => n.type === 'TextInput')[0];
    const clear = r.container.queryAll(n => n.type === 'ScalePressable')[0];
    expect(field.props.accessibilityLabel).toBe('Search recipes');
    expect(clear.props.accessibilityLabel).toBe('Clear Search recipes');
    expect(clear.props.style[0]).toMatchObject({ minWidth: 44, minHeight: 44 });
    await act(async () => clear.props.onPress());
    expect(change).toHaveBeenCalledWith('');
    await act(async () => r.unmount());
  });

  it.each(['radio', 'checkbox'] as const)('announces a selected %s with a neutral fill and 44pt target', async (role) => {
    const r = createRoot(); const press = vi.fn();
    await act(async () => r.render(<Chip label="Breakfast" selected onPress={press} accessibilityRole={role} size="sm" />));
    const chip = r.container.queryAll(n => n.type === 'ScalePressable')[0];
    expect(chip.props.accessibilityLabel).toBe('Breakfast');
    expect(chip.props.accessibilityRole).toBe(role);
    expect(chip.props.accessibilityState).toEqual({ selected: true, checked: true });
    const surface = r.container.queryAll(n => n.type === 'View')[0];
    expect(surface.props.style[0]).toMatchObject({ minHeight: 44, backgroundColor: Colors.dark.text });
    await act(async () => chip.props.onPress());
    expect(press).toHaveBeenCalledOnce();
    await act(async () => r.unmount());
  });

  it('keeps busy buttons disabled and icon names explicit', async () => {
    const r = createRoot();
    await act(async () => r.render(<><Button title="Save" onPress={vi.fn()} loading /><IconButton icon="refresh-outline" accessibilityLabel="Refresh grocery list" onPress={vi.fn()} /></>));
    const controls = r.container.queryAll(n => n.type === 'ScalePressable');
    expect(controls[0].props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(controls[0].props.disabled).toBe(true);
    expect(controls[1].props.accessibilityLabel).toBe('Refresh grocery list');
    expect(controls[1].props.style[0]).toMatchObject({ minHeight: 44, minWidth: 44 });
    await act(async () => r.unmount());
  });

  it('gives resting cards no border, reserving shadows for elevated layers', async () => {
    const r = createRoot();
    await act(async () => r.render(<><Card>Resting</Card><Card elevated>Floating</Card></>));
    const cards = r.container.queryAll(n => n.type === 'View');
    expect(cards[0].props.style[0].borderWidth).toBeUndefined();
    expect(cards[0].props.style[0].shadowOpacity).toBeUndefined();
    expect(cards[1].props.style[0].shadowOpacity).toBeGreaterThan(0);
    await act(async () => r.unmount());
  });
});
