import React, { act, useState } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ owner: 'a', scope: 'library', focused: true }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: true, isLoaded: true }) }));
vi.mock('expo-router/react-navigation', () => ({ useIsFocused: () => state.focused }));
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ setParams() {} }) }));
vi.mock('react-native', () => ({ View: 'View', ActivityIndicator: 'Loading' }));
vi.mock('@/components/Themed', () => ({ Chip: 'Chip', Text: 'Text', useColors: () => ({}) }));
vi.mock('@/hooks/useRecipes', () => ({ useCurrentUserIdentity: () => ({ data: { id: state.owner } }) }));
vi.mock('@/hooks/useRecipeScope', () => ({ useRecipeScope: () => ({ scope: state.scope, ready: true, select: (scope: string) => { state.scope = scope; } }) }));
vi.mock('@/app/(tabs)/history', () => ({ HistoryScreen: ({ active }: { active: boolean }) => {
  const [context, set] = useState(''); return React.createElement('ScopeProbe', { name: 'library', value: context, active, onChange: set });
} }));
vi.mock('@/app/(tabs)/discover', () => ({ DiscoverScreen: ({ active }: { active: boolean }) => {
  const [context, set] = useState(''); return React.createElement('ScopeProbe', { name: 'discover', value: context, active, onChange: set });
} }));
import RecipesScreen from '@/app/(tabs)/recipes';
it('retains each scope context while hiding and pausing the inactive screen; account change resets both', async () => {
  let root!: ReactTestRenderer;
  const render = async () => { await act(async () => { if (root) root.update(<RecipesScreen />); else root = create(<RecipesScreen />); }); };
  const scope = (name: string) => root.root.findByProps({ name });
  try {
    await render();
    await act(async () => scope('library').props.onChange('rice / private filter / selected / scroll 120'));
    state.scope = 'discover'; await render();
    await act(async () => scope('discover').props.onChange('fish / newest / scroll 480'));
    state.scope = 'library'; await render();
    expect(scope('library').props.value).toContain('rice');
    expect(scope('discover').props.value).toContain('fish');
    expect(scope('library').props.active).toBe(true); expect(scope('discover').props.active).toBe(false);
    const hidden = root.root.findAll(node => node.type === ('View' as any) && node.props.accessibilityElementsHidden === true);
    expect(hidden).toHaveLength(1); expect(hidden[0].props.importantForAccessibility).toBe('no-hide-descendants');
    state.focused = false; await render();
    expect(scope('library').props.active).toBe(false);
    state.owner = 'b'; await render();
    expect(scope('library').props.value).toBe(''); expect(scope('discover').props.value).toBe('');
  } finally { await act(async () => root?.unmount()); }
});
