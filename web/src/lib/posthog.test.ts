import { afterEach, describe, expect, it, vi } from 'vitest';
import posthog from 'posthog-js';
import {
  DEFAULT_POSTHOG_HOST,
  buildPostHogInitOptions,
  capturePageView,
  initPostHog,
  isPlaceholderPostHogKey,
  isPostHogInitialized,
  redactUrl,
  resetPostHogForTests,
  resolvePostHogConfig,
  sanitizePostHogEvent,
} from './posthog';

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
  },
}));

describe('posthog config and privacy helpers', () => {
  afterEach(() => {
    resetPostHogForTests();
    vi.clearAllMocks();
  });

  it('disables PostHog when key is missing or a placeholder', () => {
    expect(isPlaceholderPostHogKey(undefined)).toBe(true);
    expect(isPlaceholderPostHogKey('')).toBe(true);
    expect(isPlaceholderPostHogKey('   ')).toBe(true);
    expect(isPlaceholderPostHogKey('phc_placeholder')).toBe(true);
    expect(isPlaceholderPostHogKey('phc_your_project_key')).toBe(true);
    expect(isPlaceholderPostHogKey('phc_...')).toBe(true);
    expect(isPlaceholderPostHogKey('phc_realKey123456')).toBe(false);

    expect(
      resolvePostHogConfig({ PROD: true, VITE_PUBLIC_POSTHOG_KEY: undefined }),
    ).toBeNull();
    expect(
      resolvePostHogConfig({ PROD: true, VITE_PUBLIC_POSTHOG_KEY: 'phc_placeholder' }),
    ).toBeNull();
    expect(initPostHog({ PROD: true, VITE_PUBLIC_POSTHOG_KEY: '' })).toBe(false);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(isPostHogInitialized()).toBe(false);
  });

  it('disables PostHog in dev unless VITE_ENABLE_ANALYTICS_IN_DEV is true', () => {
    expect(
      resolvePostHogConfig({
        PROD: false,
        VITE_PUBLIC_POSTHOG_KEY: 'phc_realKey123456',
      }),
    ).toBeNull();

    expect(
      resolvePostHogConfig({
        PROD: false,
        VITE_ENABLE_ANALYTICS_IN_DEV: 'false',
        VITE_PUBLIC_POSTHOG_KEY: 'phc_realKey123456',
      }),
    ).toBeNull();

    expect(
      resolvePostHogConfig({
        PROD: false,
        VITE_ENABLE_ANALYTICS_IN_DEV: 'true',
        VITE_PUBLIC_POSTHOG_KEY: 'phc_realKey123456',
      }),
    ).toEqual({
      apiKey: 'phc_realKey123456',
      apiHost: DEFAULT_POSTHOG_HOST,
    });
  });

  it('uses default host or custom VITE_PUBLIC_POSTHOG_HOST and initializes with replay input masking', () => {
    const initialized = initPostHog({
      PROD: true,
      VITE_PUBLIC_POSTHOG_KEY: 'phc_realKey123456',
      VITE_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
    });

    expect(initialized).toBe(true);
    expect(isPostHogInitialized()).toBe(true);
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init).toHaveBeenCalledWith(
      'phc_realKey123456',
      expect.objectContaining({
        api_host: 'https://eu.i.posthog.com',
        capture_pageview: false,
        capture_pageleave: true,
        autocapture: true,
        disable_session_recording: false,
        session_recording: { maskAllInputs: true },
      }),
    );

    const defaults = buildPostHogInitOptions(DEFAULT_POSTHOG_HOST);
    expect(defaults.api_host).toBe('https://us.i.posthog.com');
  });

  it('redacts sensitive query parameters from captured URLs while preserving safe params', () => {
    const raw =
      'https://hafa-recipes.com/support?token=abc&code=123&state=xyz&auth=bearer&email=user%40example.com&utm_source=ios#faq';
    const redacted = redactUrl(raw);

    expect(redacted).toContain('token=REDACTED');
    expect(redacted).toContain('code=REDACTED');
    expect(redacted).toContain('state=REDACTED');
    expect(redacted).toContain('auth=REDACTED');
    expect(redacted).toContain('email=REDACTED');
    expect(redacted).toContain('utm_source=ios');
    expect(redacted).toContain('#faq');
    expect(redacted).not.toContain('abc');
    expect(redacted).not.toContain('123');
    expect(redacted).not.toContain('xyz');
    expect(redacted).not.toContain('bearer');
    expect(redacted).not.toContain('example.com');
  });

  it('redacts case-insensitive sensitive params and sanitizes event properties', () => {
    expect(redactUrl('/delete-account?Token=secret&EMAIL=a@b.com&step=2')).toBe(
      '/delete-account?Token=REDACTED&EMAIL=REDACTED&step=2',
    );

    const sanitized = sanitizePostHogEvent({
      uuid: 'evt-1',
      event: '$pageview',
      properties: {
        $current_url: 'https://hafa-recipes.com/privacy?token=secret&ref=app',
        $referrer: 'https://hafa-recipes.com/?email=test@example.com',
      },
    });

    expect(sanitized?.properties?.$current_url).toBe(
      'https://hafa-recipes.com/privacy?token=REDACTED&ref=app',
    );
    expect(sanitized?.properties?.$referrer).toBe(
      'https://hafa-recipes.com/?email=REDACTED',
    );
  });

  it('captures pageviews only after initialization with redacted URLs', () => {
    capturePageView('https://hafa-recipes.com/?token=secret');
    expect(posthog.capture).not.toHaveBeenCalled();

    initPostHog({
      PROD: true,
      VITE_PUBLIC_POSTHOG_KEY: 'phc_realKey123456',
    });

    capturePageView('https://hafa-recipes.com/support?code=secret&from=app');
    expect(posthog.capture).toHaveBeenCalledWith('$pageview', {
      $current_url: 'https://hafa-recipes.com/support?code=REDACTED&from=app',
    });
  });
});
