import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';

const a11y = vi.hoisted(() => ({
  listener: null as null | ((value: boolean) => void),
  resolveQuery: null as null | ((value: boolean) => void),
}));
vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: (_event: string, listener: (value: boolean) => void) => {
      a11y.listener = listener;
      return { remove: vi.fn() };
    },
    isReduceMotionEnabled: () => new Promise<boolean>((resolve) => { a11y.resolveQuery = resolve; }),
  },
}));

import { useReduceMotion } from './useReduceMotion';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps a newer change event over a late initial query result', async () => {
  let value = false;
  function Harness() { value = useReduceMotion(); return null; }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<Harness />); });

  await act(async () => { a11y.listener!(true); });
  expect(value).toBe(true);
  // The stale query (made before the event) must not undo the newer setting.
  await act(async () => { a11y.resolveQuery!(false); });
  expect(value).toBe(true);

  await act(async () => tree.unmount());
});
