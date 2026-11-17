import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { StackActions, StackRouter } from 'expo-router/build/react-navigation/routers/StackRouter';
import { ImportCloseButton } from './ImportCloseButton';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ dismissTo: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => mocks }));
vi.mock('@/components/chrome/HeaderButton', () => ({ HeaderIconButton: 'HeaderIconButton' }));

describe('Import escape to tabs', () => {
  const router = StackRouter({ initialRouteName: '(tabs)' });
  const options = { routeNames: ['(tabs)', 'index'], routeParamList: {}, routeGetIdList: {} };

  it.each(['tab action', 'share replacement', 'restored import'])('closes %s even without Back history', async entry => {
    let state = router.getInitialState(options);
    if (entry === 'restored import') {
      state = router.getRehydratedState({ stale: true, routes: [{ name: 'index', params: { captureToken: 'pending' } }] }, options);
    } else {
      state = router.getRehydratedState(router.getStateForAction(state, entry === 'tab action'
        ? StackActions.push('index') : StackActions.replace('index', { inboxCaptureId: 'saved-share' }), options)!, options);
    }
    // Reproduces the trap: share replacement (also on a plain launch with a
    // queued native capture) removes tabs, so the automatic Back cannot exist.
    expect(state.routes.map(route => route.name)).toEqual(entry === 'tab action' ? ['(tabs)', 'index'] : ['index']);
    mocks.dismissTo.mockImplementation(href => {
      expect(href).toBe('/(tabs)/recipes');
      state = router.getRehydratedState(router.getStateForAction(state, StackActions.popTo('(tabs)', { screen: 'recipes' }), options)!, options);
    });
    const renderer = createRoot();
    try {
      await act(async () => renderer.render(<ImportCloseButton />));
      const close = renderer.container.queryAll(node => node.type === 'HeaderIconButton')[0];
      expect(close.props.accessibilityLabel).toBe('Close Import and open Library');
      await act(async () => close.props.onPress());
      expect(state.routes.map(route => route.name)).toEqual(['(tabs)']);
      expect(state.routes[state.index].params).toMatchObject({ screen: 'recipes' });
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});
