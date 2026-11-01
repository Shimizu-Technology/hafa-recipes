import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ signedIn: true, offlineError: false, lease: { owner: 'owner-a', generation: 'one', epoch: 1 }, rows: [] as any[], jobs: [] as any[], entries: [] as any[], push: vi.fn() }));
const cache = vi.hoisted(() => ({ version: 0, listeners: new Set<() => void>() }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'subject-a', isSignedIn: state.signedIn }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/components/chrome/Chips', () => ({ ChipRow: ({ children }: any) => React.createElement('ChipRow', null, children), Chip: 'Chip' }));
vi.mock('@/hooks/useOfflineLease', () => ({ useOfflineLease: () => state.signedIn ? state.lease : null }));
vi.mock('@/lib/offlineRecipes', () => ({ offlineRecipes: { subscribe: (listener: () => void) => { cache.listeners.add(listener); return () => cache.listeners.delete(listener); }, version: () => cache.version, list: async () => { if (state.offlineError) throw new Error('fixture cache read failed'); return state.rows; } } }));
vi.mock('@/hooks/useRecipes', () => ({ useExtractionJobs: () => ({ data: state.jobs }) }));
vi.mock('@/hooks/useImportInbox', () => ({ useImportInbox: () => ({ entries: state.entries }) }));
import { LibraryStatus } from './LibraryStatus';
beforeEach(() => { state.signedIn = true; state.offlineError = false; state.rows = []; state.jobs = []; state.entries = []; state.push.mockReset(); });
const chips = (r: ReturnType<typeof createRoot>) => r.container.queryAll(n => n.type === 'Chip');
const labels = (r: ReturnType<typeof createRoot>) => chips(r).map(n => n.props.label);
it('shows only relevant status chips, offers Offline once cached recipes exist, and keeps What can I make visible', async () => {
  const r = createRoot();
  const check = vi.fn();
  const render = (needsCheck = 0) => <LibraryStatus active checking={false} needsCheck={needsCheck} onNeedsCheck={check} />;
  try {
    await act(async () => r.render(render()));
    expect(labels(r)).toEqual(['What can I make?']);
    state.rows = [{ recipe: { id: 'one' } }];
    await act(async () => { cache.version++; cache.listeners.forEach(listener => listener()); });
    expect(labels(r)).toEqual(['Offline · 1', 'What can I make?']);
    await act(async () => r.render(render(2)));
    expect(labels(r)).toEqual(['Needs a check · 2', 'Offline · 1', 'What can I make?']);
    for (const chip of chips(r)) await act(async () => chip.props.onPress());
    expect(check).toHaveBeenCalledOnce();
    expect(state.push.mock.calls).toEqual([['/offline-recipes'], ['/ingredient-search']]);
  } finally { await act(async () => r.unmount()); }
});
it('collapses concurrent imports into one quiet progress row and clears private links on sign-out', async () => {
  const r = createRoot();
  const props = { active: true, checking: false, needsCheck: 0, onNeedsCheck: vi.fn() };
  try {
    state.jobs = [{ status: 'processing' }, { status: 'queued' }];
    await act(async () => r.render(<LibraryStatus {...props} />));
    const progress = r.container.queryAll(n => n.props.accessibilityLabel === 'Import in progress, view progress');
    expect(progress).toHaveLength(1);
    await act(async () => progress[0].props.onPress()); expect(state.push).toHaveBeenCalledWith('/');
    state.signedIn = false; state.jobs = [];
    await act(async () => r.render(<LibraryStatus {...props} />));
    expect(r.container.queryAll(n => n.type === 'Chip')).toHaveLength(0);
    expect(r.container.queryAll(n => n.props.accessibilityLabel === 'Import in progress, view progress')).toHaveLength(0);
  } finally { await act(async () => r.unmount()); }
});

it.each([
  [{ status: 'failed' }, null, 'Imports need attention, view options'],
  [{ status: 'expired' }, null, 'Imports need attention, view options'],
  [null, { state: 'error' }, 'Imports need attention, view options'],
  [null, { state: 'waiting' }, 'Import ready to review, view options'],
])('keeps unresolved imports visible in one actionable quiet row (%j)', async (job, entry, label) => {
  const r = createRoot();
  const props = { active: true, checking: false, needsCheck: 0, onNeedsCheck: vi.fn() };
  try {
    state.jobs = [{ status: 'processing' }, ...(job ? [job] : [])]; state.entries = entry ? [entry] : [];
    await act(async () => r.render(<LibraryStatus {...props} />));
    const row = r.container.queryAll(n => n.props.accessibilityLabel === label);
    expect(row).toHaveLength(1);
    expect(r.container.queryAll(n => n.props.accessibilityLabel === 'Import in progress, view progress')).toHaveLength(0);
    await act(async () => row[0].props.onPress()); expect(state.push).toHaveBeenCalledWith('/');
    state.signedIn = false;
    await act(async () => r.render(<LibraryStatus {...props} />));
    expect(r.container.queryAll(n => n.props.accessibilityLabel === label)).toHaveLength(0);
  } finally { await act(async () => r.unmount()); }
});
it('does not call a saved partial recipe an unresolved failed import', async () => {
  state.jobs = [{ status: 'failed', recipe_id: 'saved-draft' }];
  const r = createRoot();
  try {
    await act(async () => r.render(<LibraryStatus active checking={false} needsCheck={1} onNeedsCheck={vi.fn()} />));
    expect(r.container.queryAll(n => n.props.accessibilityLabel === 'Imports need attention, view options')).toHaveLength(0);
    expect(r.container.queryAll(n => n.props.label === 'Needs a check · 1')).toHaveLength(1);
  } finally { await act(async () => r.unmount()); }
});
it('surfaces an offline-cache failure with its existing recovery destination', async () => {
  state.offlineError = true;
  const r = createRoot();
  try {
    await act(async () => r.render(<LibraryStatus active checking={false} needsCheck={0} onNeedsCheck={vi.fn()} />));
    const row = r.container.queryAll(n => n.props.accessibilityLabel === 'Offline recipes unavailable, view offline recipes')[0];
    await act(async () => row.props.onPress()); expect(state.push).toHaveBeenCalledWith('/offline-recipes');
  } finally { await act(async () => r.unmount()); }
});
it('marks Needs a check selected while it filters the library', async () => {
  const r = createRoot();
  const render = (checking: boolean) => <LibraryStatus active checking={checking} needsCheck={3} onNeedsCheck={vi.fn()} />;
  try {
    await act(async () => r.render(render(false)));
    const chip = () => r.container.queryAll(n => n.type === 'Chip' && n.props.label === 'Needs a check · 3')[0];
    expect(chip().props.selected).toBe(false);
    expect(r.container.queryAll(n => n.type === 'Chip' && n.props.label === 'What can I make?')[0].props.selected).toBeUndefined();
    await act(async () => r.render(render(true)));
    expect(chip().props.selected).toBe(true);
  } finally { await act(async () => r.unmount()); }
});

it('keeps Needs a check available without a count while the total is unknown', async () => {
  const r = createRoot();
  const check = vi.fn();
  try {
    await act(async () => r.render(<LibraryStatus active checking={false} needsCheck={undefined} onNeedsCheck={check} />));
    const chip = r.container.queryAll(n => n.type === 'Chip' && n.props.label === 'Needs a check')[0];
    expect(chip).toBeDefined();
    await act(async () => chip.props.onPress());
    expect(check).toHaveBeenCalledOnce();
    await act(async () => r.render(<LibraryStatus active checking={false} needsCheck={0} onNeedsCheck={check} />));
    expect(r.container.queryAll(n => n.type === 'Chip' && String(n.props.label).startsWith('Needs a check'))).toHaveLength(0);
  } finally { await act(async () => r.unmount()); }
});
