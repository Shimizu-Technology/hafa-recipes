import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedSearchQuery } from './useDebouncedSearchQuery';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

let value = '';
function Harness({ query }: { query: string }) {
  value = useDebouncedSearchQuery(query, 300);
  return null;
}

describe('useDebouncedSearchQuery', () => {
  it('only publishes the last keystroke after the delay', async () => {
    const root = createRoot();
    try {
      await act(async () => root.render(<Harness query="" />));
      for (const text of ['c', 'ch', 'chi', 'chic']) {
        await act(async () => root.render(<Harness query={text} />));
        await act(async () => { vi.advanceTimersByTime(100); });
      }
      expect(value).toBe('');
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(value).toBe('chic');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('applies a cleared query immediately', async () => {
    const root = createRoot();
    try {
      await act(async () => root.render(<Harness query="adobo" />));
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(value).toBe('adobo');
      await act(async () => root.render(<Harness query="" />));
      expect(value).toBe('');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
