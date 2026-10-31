import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ signedIn: true, lease: { owner: 'owner-a', generation: 'one', epoch: 1 }, rows: [] as any[], jobs: [] as any[], entries: [] as any[], push: vi.fn() }));
vi.mock('react-native', () => ({ useWindowDimensions: () => ({ fontScale: 1 }), ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', View: 'View' }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'subject-a', isSignedIn: state.signedIn }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({}) }));
vi.mock('@/hooks/useOfflineLease', () => ({ useOfflineLease: () => state.signedIn ? state.lease : null }));
vi.mock('@/lib/offlineRecipes', () => ({ offlineRecipes: { list: async () => state.rows } }));
vi.mock('@/hooks/useRecipes', () => ({ useExtractionJobs: () => ({ data: state.jobs }) }));
vi.mock('@/hooks/useImportInbox', () => ({ useImportInbox: () => ({ entries: state.entries }) }));
import { LibraryStatus } from './LibraryStatus';
beforeEach(() => { state.signedIn = true; state.rows = []; state.jobs = []; state.entries = []; state.push.mockReset(); });
it('shows a compact link row, only offers Offline when cached recipes exist, and keeps zero out of Needs a check', async () => {
  const r = createRoot();
  const check = vi.fn(), filter = vi.fn();
  const render = (active: boolean, needsCheck = 0) => <LibraryStatus active={active} checking={false} needsCheck={needsCheck} onNeedsCheck={check} onFilter={filter} />;
  try {
    await act(async () => r.render(render(true)));
    const labels = () => r.container.queryAll(n => n.type === 'Text').map(n => n.props.children);
    expect(labels()).toContain('Collections'); expect(labels()).not.toContain('Offline'); expect(labels()).toContain('Needs a check');
    state.rows = [{ recipe: { id: 'one' } }];
    await act(async () => r.render(render(false, 2)));
    expect(labels()).toContain('Offline'); expect(labels()).toContain('Needs a check · 2');
    const buttons = r.container.queryAll(n => n.type === 'Pressable');
    for (const button of buttons) expect(button.props.style).toMatchObject({ minWidth: 44, minHeight: 44 });
    await act(async () => buttons[0].props.onPress());
    await act(async () => buttons[1].props.onPress());
    await act(async () => buttons[2].props.onPress());
    await act(async () => buttons[3].props.onPress());
    expect(state.push.mock.calls).toEqual([['/collections'], ['/offline-recipes']]); expect(check).toHaveBeenCalledOnce(); expect(filter).toHaveBeenCalledOnce();
  } finally { await act(async () => r.unmount()); }
});
it('collapses concurrent imports into one quiet progress row and clears private links on sign-out', async () => {
  const r = createRoot();
  const props = { active: true, checking: false, needsCheck: 0, onNeedsCheck: vi.fn(), onFilter: vi.fn() };
  try {
    state.jobs = [{ status: 'processing' }, { status: 'queued' }];
    await act(async () => r.render(<LibraryStatus {...props} />));
    const progress = r.container.queryAll(n => n.props.accessibilityLabel === 'Import in progress, view progress');
    expect(progress).toHaveLength(1);
    await act(async () => progress[0].props.onPress()); expect(state.push).toHaveBeenCalledWith('/');
    state.signedIn = false; state.jobs = [];
    await act(async () => r.render(<LibraryStatus {...props} />));
    expect(r.container.queryAll(n => n.props.children === 'Collections')).toHaveLength(0);
    expect(r.container.queryAll(n => n.props.children === 'Offline')).toHaveLength(0);
    expect(r.container.queryAll(n => n.props.accessibilityLabel === 'Import in progress, view progress')).toHaveLength(0);
  } finally { await act(async () => r.unmount()); }
});
