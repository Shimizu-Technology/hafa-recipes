import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ Modal: 'Modal', Pressable: 'Pressable', TouchableOpacity: 'TouchableOpacity', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: (s: unknown) => s } }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', View: 'View', useColors: () => ({}) }));
import FilterBottomSheet, { type FilterState } from './FilterBottomSheet';

const initial: FilterState = { sourceFilter: 'all', timeFilter: 'all', selectedTags: [], ownershipFilter: 'all' };
function control(r: ReturnType<typeof createRoot>, label: string) {
  return r.container.queryAll(n => n.type === 'TouchableOpacity' && n.children.some(c => typeof c !== 'string' && c.type === 'Text' && (Array.isArray(c.props.children) ? c.props.children.join('') : c.props.children) === label))[0];
}
function selected(r: ReturnType<typeof createRoot>, label: string) { return control(r, label).props.accessibilityState?.selected; }
async function mount(applied = initial) {
  const r = createRoot(); const onApply = vi.fn(); const onClose = vi.fn();
  async function render(visible = true, filters = applied) { await act(async () => r.render(<FilterBottomSheet visible={visible} onApply={onApply} onClose={onClose} initialFilters={filters} showOwnershipFilter popularTags={[{ tag: 'Guam', count: 3 }]} />)); }
  await render(); return { r, render, onApply, onClose, async close() { await act(async () => r.unmount()); } };
}
describe('filter draft contract', () => {
  it('stages ownership together with the other filters until Apply', async () => {
    const h = await mount();
    await act(async () => control(h.r, 'Saved').props.onPress());
    expect(selected(h.r, 'Saved')).toBe(true); expect(h.onApply).not.toHaveBeenCalled();
    await act(async () => control(h.r, 'Apply (1)').props.onPress());
    expect(h.onApply).toHaveBeenCalledWith(expect.objectContaining({ ownershipFilter: 'saved' }));
    expect(h.onClose).toHaveBeenCalledOnce(); await h.close();
  });
  it('discards a closed draft and snapshots the applied state on reopening', async () => {
    const h = await mount(); await act(async () => control(h.r, 'My Recipes').props.onPress());
    await h.render(false); await h.render(true);
    expect(selected(h.r, 'All')).toBe(true); expect(h.onApply).not.toHaveBeenCalled(); await h.close();
  });
  it('does not erase the draft when the parent refetches while it is open', async () => {
    const h = await mount(); await act(async () => control(h.r, 'Saved').props.onPress());
    await h.render(true, { ...initial, selectedTags: [] });
    expect(selected(h.r, 'Saved')).toBe(true); await h.close();
  });
  it('Clear All resets ownership, source, time, tags, sort, hidden-own and meal choices on Apply', async () => {
    const h = await mount({ sourceFilter: 'youtube', timeFilter: 'quick', selectedTags: ['Guam'], ownershipFilter: 'saved', sortOrder: 'popular', hideMyRecipes: true, mealTypeFilter: 'dinner' });
    await act(async () => control(h.r, 'Clear All').props.onPress());
    expect(h.onApply).not.toHaveBeenCalled();
    await act(async () => control(h.r, 'Apply').props.onPress());
    expect(h.onApply).toHaveBeenCalledWith({ ...initial, sortOrder: 'recent', hideMyRecipes: false, mealTypeFilter: 'all' });
    await h.close();
  });
});
