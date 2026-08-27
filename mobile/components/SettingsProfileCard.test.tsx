import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles },
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/Themed', () => ({
  Card: 'Card',
  Text: 'Text',
  useColors: () => ({ text: '#17120E', textMuted: '#78695C', tint: '#155C52' }),
}));
vi.mock('@/constants/Colors', () => ({
  fontSize: { xs: 11, sm: 13, lg: 17 },
  fontWeight: { semibold: '600' },
  spacing: { xs: 4, md: 16 },
}));

import { SettingsProfileCard } from './SettingsProfileCard';

describe('SettingsProfileCard', () => {
  it('renders the primary address when it is not the first email', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(
        <SettingsProfileCard
          isLoaded
          isSignedIn
          profileName="Primary"
          user={{
            firstName: null,
            primaryEmailAddress: { emailAddress: 'primary@example.com' },
            emailAddresses: [
              { emailAddress: 'secondary@example.com' },
              { emailAddress: 'primary@example.com' },
            ],
          }}
          onPress={vi.fn()}
        />,
      ));

      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Text' && instance.props.children === 'primary@example.com',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Text' && instance.props.children === 'secondary@example.com',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('does not expose a false guest action while account restoration is loading', async () => {
    const onPress = vi.fn();
    const renderer = createRoot({ textComponentTypes: ['Text'] });

    try {
      await act(async () => renderer.render(
        <SettingsProfileCard
          isLoaded={false}
          isSignedIn={false}
          profileName="Guest User"
          user={null}
          onPress={onPress}
        />,
      ));

      const account = renderer.container.queryAll(
        (instance) => instance.props.accessibilityLabel === 'Account loading',
      )[0];
      expect(account.props.disabled).toBe(true);
      expect(account.props.accessibilityState).toEqual({ disabled: true, busy: true });
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Text' && instance.props.children === 'Checking your session…',
      )).toHaveLength(1);
      expect(renderer.container.queryAll(
        (instance) => instance.type === 'Text' && instance.props.children === 'Tap to sign in →',
      )).toHaveLength(0);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});
