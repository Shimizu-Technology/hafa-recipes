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

import { NATIVE_NETWORK_PRIVACY, redactBreadcrumb, redactEvent, redactTransaction, sentryOptions, setSentryUser } from './sentry';

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

describe('recipe link performance events and native options', () => {
  const key = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

  it('turns off native network breadcrumbs and spans, which no JS hook can redact', () => {
    (globalThis as any).__DEV__ = false;
    const options = sentryOptions('https://key@o0.ingest.sentry.io/1') as Record<string, unknown>;
    expect(NATIVE_NETWORK_PRIVACY).toEqual({ enableNetworkBreadcrumbs: false, enableNetworkTracking: false });
    expect(options).toMatchObject({ enableNetworkBreadcrumbs: false, enableNetworkTracking: false });
    expect(typeof options.beforeSendTransaction).toBe('function');
    expect(typeof options.beforeBreadcrumb).toBe('function');
  });

  it('redacts transaction names, span descriptions and span data', () => {
    const event = redactTransaction({
      transaction: `/r/${key}`,
      spans: [
        { description: `GET https://api.test/public/r/${key}/data`, data: { url: `https://api.test/public/r/${key}/data`, 'http.response.status_code': 200 } },
        { description: 'app start' },
      ],
      breadcrumbs: [{ data: { url: `https://api.test/public/r/${key}/save` } }],
    });
    expect(JSON.stringify(event)).not.toContain(key);
    expect(event.spans?.[0]).toEqual({ description: 'GET https://api.test/public/r/[redacted]/data', data: { url: 'https://api.test/public/r/[redacted]/data', 'http.response.status_code': 200 } });
    expect(event.spans?.[1]).toEqual({ description: 'app start' });
    const viaOptions = (sentryOptions('https://key@o0.ingest.sentry.io/1') as any).beforeSendTransaction({ transaction: `/r/${key}` });
    expect(viaOptions.transaction).toBe('/r/[redacted]');
  });
});
