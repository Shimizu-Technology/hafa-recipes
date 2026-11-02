import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const m = vi.hoisted(() => ({ alert: vi.fn(), restore: vi.fn(async () => ({})) }));
vi.mock('react-native', () => ({ Modal: 'Modal', View: 'View', ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator', Alert: { alert: m.alert }, StyleSheet: { create: (v: any) => v } }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }));
vi.mock('./Themed', () => ({ Text: 'Text', View: 'View', useColors: () => ({ backgroundSecondary: '#eee', text: '#000', tint: '#166456' }) }));
vi.mock('@/hooks/useRecipes', () => ({
  useRecipeVersions: () => ({ data: [{ id: 'old-version', version_number: 2, title: 'Slow-Roasted Garlic Butter Chicken Thighs with Crispy Lemon Potatoes', change_type: 'edit', change_summary: 'Added fresh herbs and a longer note.\nKeep the sauce separate for leftovers.', created_at: '2026-11-01T01:00:00Z' }], isLoading: false }),
  useRestoreRecipeVersion: () => ({ mutateAsync: m.restore }),
}));
import VersionHistoryModal from './VersionHistoryModal';
it('keeps the chosen version and restore confirmation intact with long history content', async () => {
  const root = createRoot(); const close = vi.fn();
  try {
    await act(async () => root.render(<VersionHistoryModal visible recipeId="recipe" currentTitle="Chicken" onClose={close} />));
    const restore = root.container.queryAll(n => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Restore version 2')[0];
    expect(restore).toBeDefined();
    await act(async () => restore.props.onPress());
    expect(m.restore).not.toHaveBeenCalled();
    const choices = m.alert.mock.calls[0][2];
    await act(async () => choices.find((c: any) => c.text === 'Restore').onPress());
    expect(m.restore).toHaveBeenCalledWith({ recipeId: 'recipe', versionId: 'old-version' });
    expect(close).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); }
});
