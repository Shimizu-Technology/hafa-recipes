import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: false,
  replace: vi.fn(),
  segments: ['settings'] as string[],
}));

vi.mock('react-native', () => ({ TouchableOpacity: 'TouchableOpacity' }));
vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isLoaded: mocks.isLoaded, isSignedIn: mocks.isSignedIn }),
}));
vi.mock('expo-router', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSegments: () => mocks.segments,
}));

import { TouchableOpacity } from 'react-native';
import { AuthProtection } from './AuthProtection';

describe('AuthProtection', () => {
  beforeEach(() => {
    mocks.isLoaded = true;
    mocks.isSignedIn = false;
    mocks.replace.mockReset();
    mocks.segments = ['settings'];
  });

  it('keeps guest Settings available with its sign-in control', async () => {
    const renderer = createRoot();

    try {
      await act(async () => renderer.render(
        <AuthProtection>
          <TouchableOpacity accessibilityLabel="Guest account. Sign in" />
        </AuthProtection>,
      ));

      expect(mocks.replace).not.toHaveBeenCalled();
      expect(renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Guest account. Sign in',
      )).toHaveLength(1);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('redirects signed-in users away from authentication screens', async () => {
    mocks.isSignedIn = true;
    mocks.segments = ['(auth)'];
    const renderer = createRoot();

    try {
      await act(async () => renderer.render(
        <AuthProtection><TouchableOpacity /></AuthProtection>,
      ));
      expect(mocks.replace).toHaveBeenCalledWith('/(tabs)');
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('redirects signed-out users away from authenticated capture', async () => {
    mocks.segments = ['paste-recipe'];
    const renderer = createRoot();

    try {
      await act(async () => renderer.render(
        <AuthProtection><TouchableOpacity /></AuthProtection>,
      ));
      expect(mocks.replace).toHaveBeenCalledWith('/(tabs)/discover');
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});
