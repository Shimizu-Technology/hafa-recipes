import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi, afterEach } from 'vitest';
const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn().mockResolvedValue(undefined), removeItem: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
import { useScaledServings } from './useScaledServings';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.clearAllMocks());
function deferred() { let resolve!: (value: string | null) => void; const promise = new Promise<string | null>(r => { resolve = r; }); return { promise, resolve }; }

describe('recipe serving persistence', () => {
  it('does not carry scaling into another recipe or accept a late load for the previous one', async () => {
    const first = deferred(), second = deferred();
    storage.getItem.mockImplementation((key: string) => key.endsWith('a') ? first.promise : second.promise);
    let value!: ReturnType<typeof useScaledServings>;
    function Harness({ id, servings }: { id: string; servings: number }) { value = useScaledServings(id, servings); return null; }
    const root = createRoot();
    try {
      await act(async () => root.render(<Harness id="a" servings={4} />));
      await act(async () => { await value.setScaledServings(8); });
      expect(value.scaleFactor).toBe(2);
      await act(async () => root.render(<Harness id="b" servings={3} />));
      expect(value.currentServings).toBe(3);
      await act(async () => { first.resolve('12'); });
      expect(value.currentServings).toBe(3);
      await act(async () => { second.resolve(null); });
      expect(value.isScaled).toBe(false);
      expect(value.currentServings).toBe(3);
    } finally { await act(async () => root.unmount()); }
  });
  it('preserves a new user choice when storage hydration finishes later', async () => {
    const read = deferred(); storage.getItem.mockReturnValue(read.promise);
    let value!: ReturnType<typeof useScaledServings>;
    function Harness() { value = useScaledServings('a', 4); return null; }
    const root = createRoot();
    try {
      await act(async () => root.render(<Harness />));
      await act(async () => { await value.setScaledServings(6); read.resolve('8'); });
      expect(value.currentServings).toBe(6);
      expect(storage.setItem).toHaveBeenCalledWith('scaled_servings_a', '6');
    } finally { await act(async () => root.unmount()); }
  });
});
