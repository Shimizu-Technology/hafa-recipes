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

import { redactBreadcrumb, redactEvent, setSentryUser } from './sentry';

describe('Sentry user context', () => {
  beforeEach(() => mocks.setUser.mockReset());

  it('uses only a pseudonymous account identifier', () => {
    setSentryUser({ id: 'app-stable-user' });

    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'app-stable-user' });
  });

  it('clears user context after sign out', () => {
    setSentryUser(null);

    expect(mocks.setUser).toHaveBeenCalledWith(null);
  });
});

describe('recipe link breadcrumbs', () => {
  it('drops unlisted link keys from request and navigation breadcrumbs', () => {
    const key = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
    const crumb = redactBreadcrumb({ message: `GET /public/r/${key}/data`, data: { url: `https://api.test/public/r/${key}/og.jpg`, status_code: 404, to: `/r/${key}` } });
    expect(JSON.stringify(crumb)).not.toContain(key);
    expect(crumb).toEqual({ message: 'GET /public/r/[redacted]/data', data: { url: 'https://api.test/public/r/[redacted]/og.jpg', status_code: 404, to: '/r/[redacted]' } });
  });
});

describe('recipe link events', () => {
  it('redacts breadcrumbs merged in by the native SDK and the request URL before sending', () => {
    const key = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';
    const event = redactEvent({
      message: 'boom',
      request: { url: `https://api.test/public/r/${key}/save`, method: 'POST' },
      breadcrumbs: [
        { category: 'http', data: { url: `https://api.test/public/r/${key}/data`, status_code: 200 } },
        { category: 'navigation', message: `/r/${key}` },
        { category: 'ui', message: 'tap' },
      ],
    });
    expect(JSON.stringify(event)).not.toContain(key);
    expect(event.breadcrumbs?.[0].data).toEqual({ url: 'https://api.test/public/r/[redacted]/data', status_code: 200 });
    expect(event.breadcrumbs?.[2]).toEqual({ category: 'ui', message: 'tap' });
    expect(event.request).toEqual({ url: 'https://api.test/public/r/[redacted]/save', method: 'POST' });
    expect(event.message).toBe('boom');
  });
});
