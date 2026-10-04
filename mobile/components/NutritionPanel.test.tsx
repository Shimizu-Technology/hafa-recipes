import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ textScale: 1, dark: false }));
vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', View: 'View', TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 } }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({
  text: state.dark ? '#F8F0E7' : '#17120E', textSecondary: state.dark ? '#B8AEA2' : '#6D5D50', textMuted: '#756659',
  background: state.dark ? '#101411' : '#FFF7EC', backgroundSecondary: state.dark ? '#171D1A' : '#F8EFE3',
  border: '#ddd', error: '#c00', warning: '#960', tint: '#347D73', actionText: state.dark ? '#69C8BA' : '#155C52',
}) }));
vi.mock('@/hooks/useTextSize', () => ({ useTextSize: () => ({ scaleFontSize: (size: number) => Math.round(size * state.textScale) }) }));
import { NutritionPanel } from './NutritionPanel';
import { formatNutritionAsText, normalizeNutritionValues } from '@/lib/nutritionPresentation';

const nutrition = { servingBasis: 'recipe_servings' as const, servingsUsed: 4,
  perServing: normalizeNutritionValues({ calories: 100, protein: 0, fat: 1.25, fiber: 0.2 }),
  total: normalizeNutritionValues({ calories: 400, protein: 0, fat: 5, fiber: 0.8 }),
  assumptions: ['Assumed 2 tablespoons of cooking oil.', 'Assumed the whole batch serves four people.'],
};
const metadata = { source: 'ai_estimate', status: 'current' as const, assumptions: [] };

function renderPanel(props: Partial<React.ComponentProps<typeof NutritionPanel>> = {}) {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  const render = () => renderer.render(<NutritionPanel nutrition={nutrition} metadata={metadata} {...props} />);
  return { renderer, render,
    byLabel: (label: string) => renderer.container.queryAll(node => node.props.accessibilityLabel === label),
    text: () => renderer.container.queryAll(node => node.type === 'Text').map(node => node.props.children).flat().join(' '),
  };
}

describe('NutritionPanel', () => {
  it('does not describe an accepted known yield as missing when nutrition only supplies batch totals', async () => {
    const panel = renderPanel({ nutrition: { ...nutrition, servingBasis: 'whole_recipe', servingsUsed: null },
      recipeServings: 4, scaleFactor: 2 });
    try {
      await act(async () => panel.render());
      expect(panel.byLabel('Calories: 800 cal')).toHaveLength(1);
      expect(panel.text()).toContain('For the scaled recipe');
      expect(panel.text()).not.toContain('A serving count was not provided.');
    } finally { await act(async () => panel.renderer.unmount()); }
  });
  it('shows one basis at a time and changes totals without losing zero or fractional values', async () => {
    const panel = renderPanel({ scaleFactor: 2 });
    try {
      await act(async () => panel.render());
      expect(panel.byLabel('Calories: 100 cal')).toHaveLength(1);
      expect(panel.byLabel('Calories: 800 cal')).toHaveLength(0);
      expect(panel.byLabel('Protein: 0 g')).toHaveLength(1);
      expect(panel.byLabel('Fat: 1.25 g')).toHaveLength(1);
      expect(panel.byLabel('Fiber: 0.2 g')).toHaveLength(1);
      await act(async () => panel.byLabel('Whole recipe')[0].props.onPress());
      expect(panel.byLabel('Calories: 100 cal')).toHaveLength(0);
      expect(panel.byLabel('Calories: 800 cal')).toHaveLength(1);
      expect(panel.byLabel('Whole recipe')[0].props.accessibilityState).toEqual({ selected: true });
    } finally { await act(async () => panel.renderer.unmount()); }
  });
  it('keeps every assumption behind an explicit disclosure, including metadata-empty fallback', async () => {
    const panel = renderPanel();
    try {
      await act(async () => panel.render());
      expect(panel.text()).not.toContain(nutrition.assumptions[0]);
      const label = 'Calculation details. 2 assumptions';
      expect(panel.byLabel(label)[0].props.accessibilityState).toEqual({ expanded: false });
      await act(async () => panel.byLabel(label)[0].props.onPress());
      expect(panel.text()).toContain(nutrition.assumptions[0]);
      expect(panel.text()).toContain(nutrition.assumptions[1]);
      expect(panel.byLabel(label)[0].props.accessibilityState).toEqual({ expanded: true });
    } finally { await act(async () => panel.renderer.unmount()); }
  });
  it('keeps stale notices and provider errors visible while explanations are collapsed', async () => {
    const panel = renderPanel({ metadata: { ...metadata, status: 'stale' }, error: 'Provider is busy' });
    try {
      await act(async () => panel.render());
      expect(panel.text()).toContain('Ingredients or servings changed');
      expect(panel.text()).toContain('Provider is busy');
      expect(panel.text()).not.toContain(nutrition.assumptions[0]);
      expect(panel.renderer.container.queryAll(node => node.props.accessibilityRole === 'alert')).toHaveLength(1);
    } finally { await act(async () => panel.renderer.unmount()); }
  });
  it('supports root-controlled basis and reports changes for consistent sharing', async () => {
    const onBasisChange = vi.fn();
    const panel = renderPanel({ selectedBasisId: 'whole_recipe', onBasisChange });
    try {
      await act(async () => panel.render());
      expect(panel.byLabel('Calories: 400 cal')).toHaveLength(1);
      await act(async () => panel.byLabel('Per serving')[0].props.onPress());
      expect(onBasisChange).toHaveBeenCalledWith('recipe_serving');
      // A controlled parent owns selection until it supplies the changed value.
      expect(panel.byLabel('Calories: 400 cal')).toHaveLength(1);
    } finally { await act(async () => panel.renderer.unmount()); }
  });
  it('uses the parent default after a mounted controlled selection resets on a recipe revision', async () => {
    const onBasisChange = vi.fn();
    const props: Partial<React.ComponentProps<typeof NutritionPanel>> = { selectedBasisId: undefined, onBasisChange };
    const panel = renderPanel(props);
    try {
      await act(async () => panel.render());
      await act(async () => panel.byLabel('Whole recipe')[0].props.onPress());
      expect(onBasisChange).toHaveBeenCalledWith('whole_recipe');
      props.selectedBasisId = 'whole_recipe';
      await act(async () => panel.render());
      expect(panel.byLabel('Calories: 400 cal')).toHaveLength(1);
      // The parent clears its recipe/revision-scoped selection without unmounting.
      props.selectedBasisId = undefined;
      await act(async () => panel.render());
      expect(panel.byLabel('Calories: 100 cal')).toHaveLength(1);
      expect(panel.byLabel('Calories: 400 cal')).toHaveLength(0);
      const exported = formatNutritionAsText(nutrition, metadata, 1, props.selectedBasisId);
      expect(exported).toContain('NUTRITION — Per serving');
      expect(exported).toContain('Calories: 100 cal');
      expect(exported).not.toContain('Calories: 400 cal');
    } finally { await act(async () => panel.renderer.unmount()); }
  });
  it('does not invent macros for partial or unavailable nutrition and keeps retry explicit', async () => {
    const onRefresh = vi.fn();
    const panel = renderPanel({ nutrition: undefined, metadata: { status: 'unavailable', reason: 'Missing ingredient amounts' }, onRefresh });
    try {
      await act(async () => panel.render());
      expect(panel.text()).toContain('Missing ingredient amounts');
      expect(panel.byLabel('Calories: 0 cal')).toHaveLength(0);
      await act(async () => panel.byLabel('Estimate nutrition')[0].props.onPress());
      expect(onRefresh).toHaveBeenCalledOnce();
    } finally { await act(async () => panel.renderer.unmount()); }
  });
  it('exposes loading and 44-point controls without hiding previous nutrition', async () => {
    const panel = renderPanel({ onRefresh: vi.fn(), isLoading: true });
    try {
      await act(async () => panel.render());
      const refresh = panel.byLabel('Refresh nutrition')[0];
      expect(refresh.props.disabled).toBe(true);
      expect(refresh.props.accessibilityState).toEqual({ disabled: true, busy: true });
      expect(refresh.props.style.minHeight).toBeGreaterThanOrEqual(44);
      expect(panel.byLabel('Calories: 100 cal')).toHaveLength(1);
      expect(panel.byLabel('Whole recipe')[0].props.style[0].minHeight).toBeGreaterThanOrEqual(44);
    } finally { await act(async () => panel.renderer.unmount()); }
  });
  it('uses semantic action color and the app text-size preference', async () => {
    state.dark = true; state.textScale = 1.3;
    const panel = renderPanel({ onRefresh: vi.fn() });
    try {
      await act(async () => panel.render());
      const refreshText = panel.renderer.container.queryAll(node => node.type === 'Text' && node.props.children === 'Refresh')[0];
      expect(refreshText.props.style[1].color).toBe('#69C8BA');
      expect(refreshText.props.style[0].fontSize).toBe(17);
    } finally { state.dark = false; state.textScale = 1; await act(async () => panel.renderer.unmount()); }
  });
});
