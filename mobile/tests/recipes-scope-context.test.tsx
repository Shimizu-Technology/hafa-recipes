import React, { act, useState } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ generation: 1, scope: undefined as string | undefined, focused: true }));
vi.mock('@/hooks/useOfflineLease', () => ({ useRecipeOwnerGeneration: () => state.generation }));
vi.mock('expo-router/react-navigation', () => ({ useIsFocused: () => state.focused }));
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({ scope: state.scope }), Redirect: 'Redirect' }));
vi.mock('@/app/history', () => ({ HistoryScreen: ({ active }: { active: boolean }) => {
  const [context, set] = useState(''); return React.createElement('LibraryProbe', { value: context, active, onChange: set });
} }));
import RecipesScreen from '@/app/(tabs)/recipes';
it('retains Library context across focus changes and clears it for the next owner', async () => {
  let root!: ReactTestRenderer;
  const render = async () => { await act(async () => { if (root) root.update(<RecipesScreen />); else root = create(<RecipesScreen />); }); };
  const library = () => root.root.findByType('LibraryProbe' as any);
  try {
    await render();
    await act(async () => library().props.onChange('rice / private filter / scroll 120'));
    state.focused = false; await render();
    expect(library().props.active).toBe(false);
    state.focused = true; await render();
    expect(library().props.value).toContain('rice');
    state.generation++; await render();
    expect(library().props.value).toBe('');
    state.scope = 'discover'; await render();
    expect(root.root.findByType('Redirect' as any).props.href).toBe('/(tabs)/discover');
  } finally { state.scope = undefined; await act(async () => root?.unmount()); }
});
