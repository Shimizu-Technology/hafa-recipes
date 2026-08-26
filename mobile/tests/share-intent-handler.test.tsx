import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    alert: vi.fn(),
    hasShareIntent: true,
    intent: { files: null, type: 'text', webUrl: null, text: 'shared content' },
    isSignedIn: true,
    replace,
    reset: vi.fn(),
    resetShareIntent: vi.fn(),
    resolve: vi.fn(),
    router: { replace },
    stage: vi.fn(() => 'share-token'),
  };
});

vi.mock('react-native', () => ({ Alert: { alert: mocks.alert } }));
vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: mocks.isSignedIn }),
}));
vi.mock('expo-router', () => ({ useRouter: () => mocks.router }));
vi.mock('expo-share-intent', () => ({
  useShareIntentContext: () => ({
    hasShareIntent: mocks.hasShareIntent,
    shareIntent: mocks.intent,
    resetShareIntent: mocks.resetShareIntent,
  }),
}));
vi.mock('@/lib/shareCapture', () => ({
  resolveShareIntent: mocks.resolve,
  stagePendingShareCapture: mocks.stage,
}));

import { useHandleShareIntent } from '../hooks/useShareIntent';

function ShareIntentHarness() {
  useHandleShareIntent();
  return null;
}

async function renderAndAdvance() {
  await act(async () => {
    create(React.createElement(ShareIntentHarness));
  });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

describe('native share intent handler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.alert.mockClear();
    mocks.hasShareIntent = true;
    mocks.isSignedIn = true;
    mocks.replace.mockClear();
    mocks.reset.mockClear();
    mocks.resetShareIntent.mockReset();
    mocks.resetShareIntent.mockImplementation(() => {
      mocks.hasShareIntent = false;
      mocks.reset();
    });
    mocks.resolve.mockReset();
    mocks.stage.mockClear();
  });

  afterEach(() => vi.useRealTimers());

  it('stages shared text and opens the paste screen with only a transient token', async () => {
    mocks.resolve.mockReturnValue({ kind: 'text', text: 'private shared recipe' });

    await renderAndAdvance();

    expect(mocks.stage).toHaveBeenCalledWith({ kind: 'text', text: 'private shared recipe' });
    expect(mocks.replace).toHaveBeenCalledWith({
      pathname: '/paste-recipe',
      params: { captureToken: 'share-token' },
    });
    expect(mocks.reset).toHaveBeenCalledOnce();
  });

  it('stages shared images and opens the existing image gallery path', async () => {
    const images = [{ uri: 'file:///recipe.png', mimeType: 'image/png' }];
    mocks.resolve.mockReturnValue({ kind: 'images', images });

    await renderAndAdvance();

    expect(mocks.stage).toHaveBeenCalledWith({ kind: 'images', images });
    expect(mocks.replace).toHaveBeenCalledWith({
      pathname: '/',
      params: { captureToken: 'share-token' },
    });
  });

  it('routes URL shares without staging a copy of their content', async () => {
    mocks.resolve.mockReturnValue({ kind: 'url', url: 'https://example.com/recipe' });

    await renderAndAdvance();

    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith({
      pathname: '/',
      params: { sharedUrl: 'https://example.com/recipe' },
    });
  });

  it('explains the sign-in boundary for shared text or images', async () => {
    mocks.isSignedIn = false;
    mocks.resolve.mockReturnValue({ kind: 'sign-in-required' });

    await renderAndAdvance();

    expect(mocks.resolve).toHaveBeenCalledWith(mocks.intent, false);
    expect(mocks.alert).toHaveBeenCalledWith(
      'Sign In to Import',
      'Sign in to Håfa Recipes, then share the recipe again.',
    );
    expect(mocks.replace).toHaveBeenCalledWith('/(tabs)/discover');
    expect(mocks.stage).not.toHaveBeenCalled();
  });
});
