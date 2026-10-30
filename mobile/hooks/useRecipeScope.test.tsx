import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
import { useRecipeScope, recipeScopeKey } from './useRecipeScope';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let current: ReturnType<typeof useRecipeScope>;
function Harness({ owner, requested }: { owner: string | null; requested?: string }) { current = useRecipeScope(owner, requested); return null; }
describe('account recipe scope', () => {
  it('defaults guests to Discover and remembers independent stable owners', async () => {
    storage.getItem.mockImplementation(async (key: string) => key === recipeScopeKey('account-a') ? 'discover' : null);
    const root = createRoot();
    try {
      await act(async () => root.render(<Harness owner={null} />));
      expect(current.scope).toBe('discover');
      await act(async () => root.render(<Harness owner="account-a" />));
      expect(current.scope).toBe('discover');
      await act(async () => current.select('library'));
      expect(storage.setItem).toHaveBeenCalledWith(recipeScopeKey('account-a'), 'library');
      await act(async () => root.render(<Harness owner="account-b" />));
      expect(current.scope).toBe('library');
      await act(async () => root.render(<Harness owner={null} />));
      expect(current.scope).toBe('discover');
    } finally { await act(async () => root.unmount()); }
  });
  it('ignores an old account read after switching and honours legacy scope links', async () => {
    let finish!: (value: string) => void;
    storage.getItem.mockImplementation((key: string) => key === recipeScopeKey('account-a') ? new Promise<string>((resolve) => { finish = resolve; }) : Promise.resolve('library'));
    const root = createRoot();
    try {
      await act(async () => root.render(<Harness owner="account-a" />));
      await act(async () => root.render(<Harness owner="account-b" requested="discover" />));
      await act(async () => finish('library'));
      expect(current.scope).toBe('discover');
    } finally { await act(async () => root.unmount()); }
  });
});
