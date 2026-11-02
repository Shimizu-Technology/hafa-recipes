import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const alert = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({
  useWindowDimensions: () => ({ fontScale: 1 }),
  View: 'View', TouchableOpacity: 'TouchableOpacity', Alert: { alert },
  StyleSheet: { create: (styles: any) => styles, hairlineWidth: 0.5 },
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }));
vi.mock('@/components/Themed', async () => ({ TextInput: 'TextInput', TextScaleContext: (await import('react')).createContext(1),  Card: 'Card', Text: 'Text', useColors: () => ({ text: '#000', textSecondary: '#666', actionText: '#166456', border: '#ccc', warning: '#b70' }) }));
import { RecipeIngredientGroup } from './RecipeIngredientGroup';
const ingredients = [
  { name: 'filling of choice', quantity: null, unit: null, estimatedCost: 4, notes: 'Use homemade halva or a thick chocolate spread; cool fully before assembling.', quantityEstimate: { quantity: '1.5', unit: 'cups', reason: 'Enough to fill twelve sandwich cookies.' } },
  { name: 'powdered sugar', quantity: null, unit: null },
];

it('keeps grouped names, notes, scaled estimates and costs available when checking ingredients', async () => {
  const root = createRoot({ textComponentTypes: ['Text'] });
  const toggle = vi.fn();
  const page = (checked = false) => <RecipeIngredientGroup title="Filling and Assembly" ingredients={ingredients}
    scaleFactor={2} isScaled scaleFontSize={n => n} showCosts checked={() => checked} onToggle={toggle} />;
  try {
    await act(async () => root.render(page()));
    const buttons = () => root.container.queryAll(n => n.type === 'TouchableOpacity');
    const text = () => root.container.queryAll(n => n.type === 'Text').flatMap(n => n.props.children ?? []).filter(v => typeof v === 'string').join(' ');
    expect(text()).toContain('Filling and Assembly');
    expect(text()).toContain('3 cups');
    expect(text()).toContain('8.00');
    expect(text()).toContain('AI estimate');
    expect(text()).toContain('Amount not stated');
    expect(text()).toContain(ingredients[0].notes);
    const check = buttons().find(n => n.props.accessibilityRole === 'checkbox')!;
    expect(check.props.accessibilityState.checked).toBe(false);
    await act(async () => check.props.onPress());
    expect(toggle).toHaveBeenCalledWith(0);
    await act(async () => buttons().find(n => n.props.accessibilityRole === 'button')!.props.onPress());
    expect(alert).toHaveBeenCalledWith('AI estimate', ingredients[0].quantityEstimate!.reason);
    await act(async () => root.render(page(true)));
    expect(buttons().find(n => n.props.accessibilityRole === 'checkbox')!.props.accessibilityState.checked).toBe(true);
    expect(text()).toContain(ingredients[0].notes);
    expect(text()).toContain('AI estimate');
  } finally { await act(async () => root.unmount()); }
});

it('supports read-only Cook rows without costs while retaining estimate explanations', async () => {
  const root = createRoot();
  try {
    await act(async () => root.render(<RecipeIngredientGroup ingredients={ingredients} scaleFactor={1} isScaled={false} scaleFontSize={n => n * 1.4} />));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')).toHaveLength(0);
    expect(root.container.queryAll(n => n.type === 'TouchableOpacity' && n.props.accessibilityRole === 'button')).toHaveLength(1);
  } finally { await act(async () => root.unmount()); }
});
