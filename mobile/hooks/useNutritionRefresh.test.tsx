import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), refetch: vi.fn(), owner: 'owner-a', recipeId: 'recipe-a' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/hooks/useTextSize', () => ({ useTextSize: () => ({ scaleFontSize: (size: number) => size }) }));
vi.mock('@/lib/api', () => ({ api: { refreshRecipeNutrition: mocks.refresh } }));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const host = (type: string) => (props: Record<string, unknown>) => createElement(type, props, props.children as React.ReactNode);
  return { ActivityIndicator: host('ActivityIndicator'), TouchableOpacity: host('TouchableOpacity'), View: host('View'), StyleSheet: { create: <T,>(styles: T) => styles } };
});
vi.mock('@/components/Themed', async () => {
  const { createElement } = await import('react');
  return { Text: (props: Record<string, unknown>) => createElement('Text', props, props.children as React.ReactNode), useColors: () => ({ text: '#111', textSecondary: '#333', textMuted: '#555', tint: '#155C52', error: '#C00' }) };
});
vi.mock('@/constants/Colors', () => ({ fontFamily: { semibold: 'Sans' }, fontSize: { sm: 14, lg: 18 }, radius: { md: 12 }, spacing: { sm: 8, md: 16, lg: 24 } }));
import { NutritionPanel } from '@/components/NutritionPanel';
import { useNutritionRefresh } from './useNutritionRefresh';
function Harness() {
  const state = useNutritionRefresh(mocks.recipeId, 4, mocks.owner, mocks.refetch);
  return <NutritionPanel metadata={{ status: 'unavailable' }} isLoading={state.isRefreshingNutrition}
    error={state.nutritionError} onRefresh={state.refreshNutrition} />;
}
let renderer: ReactTestRenderer | undefined;
beforeEach(() => { vi.clearAllMocks(); mocks.owner = 'owner-a'; mocks.recipeId = 'recipe-a'; mocks.refetch.mockResolvedValue(undefined); });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });
async function render() { await act(async () => { renderer = create(<Harness />); }); }
const button = () => renderer!.root.findByProps({ accessibilityLabel: 'Estimate nutrition' });
describe('nutrition refresh failure rendering', () => {
  it.each([
    [{ response: { status: 503, data: { detail: { code: 'NUTRITION_PROVIDER_UNAVAILABLE', message: 'Nutrition estimation is temporarily unavailable. Please try again later.' } } } }, 'Nutrition estimation is temporarily unavailable. Please try again later.'],
    [{ response: { data: { detail: 'Check the ingredient quantities.' } } }, 'Check the ingredient quantities.'],
    [{ response: { data: { detail: { code: 'UNKNOWN' } } } }, 'Nutrition could not be estimated. Check the ingredient amounts and try again.'],
  ])('renders a safe error and restores the retry action (%j)', async (failure, message) => {
    mocks.refresh.mockRejectedValueOnce(failure);
    await render();
    await act(async () => { await button().props.onPress(); });
    expect(mocks.refresh).toHaveBeenCalledWith('recipe-a', 4);
    expect(renderer!.root.findByProps({ accessibilityRole: 'alert' }).props.children).toBe(message);
    expect(button().props.disabled).toBe(false);
    expect(mocks.refetch).not.toHaveBeenCalled();
  });
  it('does not display A failure or refetch into B after switching accounts', async () => {
    let reject!: (error: unknown) => void;
    mocks.refresh.mockImplementationOnce(() => new Promise((_, rejectRequest) => { reject = rejectRequest; }));
    await render();
    let request!: Promise<void>;
    await act(async () => { request = button().props.onPress(); });
    mocks.owner = 'owner-b';
    await act(async () => renderer!.update(<Harness />));
    await act(async () => { reject({ response: { data: { detail: { code: '503', message: 'A failure' } } } }); await request; });
    expect(renderer!.root.findAllByProps({ accessibilityRole: 'alert' })).toHaveLength(0);
    expect(button().props.disabled).toBe(false); expect(mocks.refetch).not.toHaveBeenCalled();
  });
});
