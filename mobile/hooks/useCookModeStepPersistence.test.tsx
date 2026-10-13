import React, { act, useState } from 'react';
import { createRoot } from 'test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

import { useCookModeStepPersistence } from './useCookModeStepPersistence';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.clearAllMocks());

function deferred() {
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>((r) => { resolve = r; });
  return { promise, resolve };
}

let step = 0;
let setStep!: (index: number) => void;
function Harness({ id, stepCount }: { id: string; stepCount: number }) {
  const [current, setCurrent] = useState(0);
  step = current;
  setStep = setCurrent;
  useCookModeStepPersistence(id, stepCount, current, setCurrent);
  return null;
}

describe('cook mode step persistence', () => {
  it('does not overwrite the saved step before the recipe steps load (cold open)', async () => {
    const read = deferred();
    storage.getItem.mockReturnValue(read.promise);
    const root = createRoot();
    try {
      // Recipe still loading: id is known but there are no steps yet.
      await act(async () => root.render(<Harness id="r1" stepCount={0} />));
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.getItem).not.toHaveBeenCalled();

      await act(async () => root.render(<Harness id="r1" stepCount={6} />));
      expect(storage.getItem).toHaveBeenCalledWith('cook_mode_step_r1');
      expect(storage.setItem).not.toHaveBeenCalled();

      await act(async () => { read.resolve('3'); });
      expect(step).toBe(3);
      expect(storage.setItem).toHaveBeenCalledTimes(1);
      expect(storage.setItem).toHaveBeenLastCalledWith('cook_mode_step_r1', '3');
      expect(storage.setItem).not.toHaveBeenCalledWith('cook_mode_step_r1', '0');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('saves later step changes once restored and ignores out-of-range saved steps', async () => {
    storage.getItem.mockResolvedValue('99');
    const root = createRoot();
    try {
      await act(async () => root.render(<Harness id="r2" stepCount={4} />));
      expect(step).toBe(0);
      expect(storage.setItem).toHaveBeenLastCalledWith('cook_mode_step_r2', '0');
      await act(async () => setStep(2));
      expect(storage.setItem).toHaveBeenLastCalledWith('cook_mode_step_r2', '2');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
