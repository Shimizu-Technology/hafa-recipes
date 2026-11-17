import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotFoundScreen from '../app/+not-found';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ replace: vi.fn(), hasIntent: false }));
const router = { replace: mocks.replace };
vi.mock('expo-router', () => ({ useRouter: () => router, Link: 'Link', Stack: { Screen: 'Screen' } }));
vi.mock('expo-share-intent', () => ({ useShareIntentContext: () => ({ hasShareIntent: mocks.hasIntent }) }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', View: 'View', useColors: () => ({ actionText: '#111' }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.hasIntent = false; });
describe('unknown route recovery', () => {
  it.each([false, true])('recovers to Library tabs (queued share=%s)', async hasIntent => {
    mocks.hasIntent = hasIntent;
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(<NotFoundScreen />));
      if (hasIntent) expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('/(tabs)/recipes');
      else expect(renderer.container.queryAll(node => node.type === 'Link')[0].props.href).toBe('/(tabs)/recipes');
    } finally { await act(async () => renderer.unmount()); }
  });
});
