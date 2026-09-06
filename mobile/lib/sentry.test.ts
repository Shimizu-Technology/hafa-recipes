import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setUser: vi.fn(),
}));

vi.mock('@sentry/react-native', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  init: vi.fn(),
  setTag: vi.fn(),
  setUser: mocks.setUser,
  wrap: vi.fn((component) => component),
}));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.0.0' } },
}));

import { setSentryUser } from './sentry';

describe('Sentry user context', () => {
  beforeEach(() => mocks.setUser.mockReset());

  it('uses only a pseudonymous account identifier', () => {
    setSentryUser({ id: 'clerk_subject_123' });

    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'clerk_subject_123' });
  });

  it('clears user context after sign out', () => {
    setSentryUser(null);

    expect(mocks.setUser).toHaveBeenCalledWith(null);
  });
});
