import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));
vi.mock('expo-router', () => ({ usePathname: () => '/recipes' }));
vi.mock('@react-native-async-storage/async-storage', () => { const values = new Map<string, string>(); return { default: {
  getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); },
  getAllKeys: async () => [...values.keys()], multiRemove: async (keys: string[]) => keys.forEach(key => values.delete(key)),
} }; });
import { offlineRecipes } from '@/lib/offlineRecipes';
import { TimerProvider, useTimerContext } from './TimerContext';
it('clears the private cooking shadow and refuses retired callbacks after owner change', async () => {
  await offlineRecipes.bindSubject('subject'); await offlineRecipes.verify('subject', 'a');
  let shown!: ReturnType<typeof useTimerContext>;
  function Probe() { shown = useTimerContext(); return null; }
  const root = createRoot();
  try {
    await act(async () => root.render(<TimerProvider><Probe /></TimerProvider>));
    const old = shown;
    const session = { recipeId: 'a', recipeTitle: 'A private title', totalSteps: 2, currentStep: 0, scaleFactor: 1 };
    await act(async () => old.startSession(session));
    expect(shown.session?.recipeTitle).toBe('A private title');
    await act(async () => { await offlineRecipes.verify('subject', 'b'); });
    expect(shown.session).toBeNull(); expect(shown.timers.size).toBe(0);
    await act(async () => old.startSession(session));
    expect(shown.session).toBeNull();
  } finally { await act(async () => root.unmount()); await offlineRecipes.clear(); }
});
