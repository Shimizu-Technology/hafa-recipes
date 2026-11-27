import posthog, { type CaptureResult, type PostHogConfig } from 'posthog-js';

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

export const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'code',
  'state',
  'auth',
  'email',
]);

const PLACEHOLDER_KEY_PATTERNS = [
  /^phc_your/i,
  /^phc_placeholder/i,
  /^phc_example/i,
  /^phc_test_placeholder/i,
  /^phc_\.{3,}$/i,
  /^phc_x+$/i,
  /^your[_-]/i,
  /placeholder/i,
  /^changeme$/i,
  /^replace[_-]?me$/i,
  /^<.*>$/,
];

export interface PostHogEnv {
  VITE_PUBLIC_POSTHOG_KEY?: string;
  VITE_PUBLIC_POSTHOG_HOST?: string;
  VITE_ENABLE_ANALYTICS_IN_DEV?: string;
  PROD?: boolean;
}

export interface ResolvedPostHogConfig {
  apiKey: string;
  apiHost: string;
}

export function isPlaceholderPostHogKey(key: string | undefined): boolean {
  const trimmed = key?.trim() ?? '';
  if (!trimmed) {
    return true;
  }
  return PLACEHOLDER_KEY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function resolvePostHogConfig(
  env: PostHogEnv = import.meta.env,
): ResolvedPostHogConfig | null {
  const apiKey = env.VITE_PUBLIC_POSTHOG_KEY?.trim() ?? '';
  if (isPlaceholderPostHogKey(apiKey)) {
    return null;
  }

  const enabled = Boolean(env.PROD) || env.VITE_ENABLE_ANALYTICS_IN_DEV === 'true';
  if (!enabled) {
    return null;
  }

  const apiHost = env.VITE_PUBLIC_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST;
  return { apiKey, apiHost };
}

export function redactUrl(rawUrl: string): string {
  const isRelative = rawUrl.startsWith('/');
  try {
    const parsed = isRelative
      ? new URL(rawUrl, 'https://redact.invalid')
      : new URL(rawUrl);

    const keysToRedact = new Set<string>();
    parsed.searchParams.forEach((_value, key) => {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        keysToRedact.add(key);
      }
    });

    for (const key of keysToRedact) {
      parsed.searchParams.set(key, 'REDACTED');
    }

    if (isRelative) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl;
  }
}

export function sanitizePostHogEvent(
  event: CaptureResult | null,
): CaptureResult | null {
  if (!event || !event.properties) {
    return event;
  }

  const nextProperties = { ...event.properties };
  if (typeof nextProperties.$current_url === 'string') {
    nextProperties.$current_url = redactUrl(nextProperties.$current_url);
  }
  if (typeof nextProperties.$referrer === 'string' && nextProperties.$referrer !== '$direct') {
    nextProperties.$referrer = redactUrl(nextProperties.$referrer);
  }

  return {
    ...event,
    properties: nextProperties,
  };
}

export function buildPostHogInitOptions(apiHost: string): Partial<PostHogConfig> {
  return {
    api_host: apiHost,
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
    },
    before_send: sanitizePostHogEvent,
  };
}

let initialized = false;

export function isPostHogInitialized(): boolean {
  return initialized;
}

export function initPostHog(env: PostHogEnv = import.meta.env): boolean {
  if (initialized) {
    return true;
  }

  const config = resolvePostHogConfig(env);
  if (!config) {
    return false;
  }

  posthog.init(config.apiKey, buildPostHogInitOptions(config.apiHost));
  initialized = true;
  return true;
}

export function capturePageView(url: string): void {
  if (!initialized) {
    return;
  }
  posthog.capture('$pageview', {
    $current_url: redactUrl(url),
  });
}

export function resetPostHogForTests(): void {
  initialized = false;
}
