/**
 * Sentry error monitoring and performance tracking.
 * 
 * Captures crashes, errors, and performance data in production.
 * Integrates with Clerk to attach user context to events.
 */

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { redactRecipeLinks } from './recipeLinkRoute';

// Get DSN from environment or Expo config
// Set this in your .env file: EXPO_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';

/** Remove recipe-link keys from a breadcrumb's message and string data (URLs, routes). */
export function redactBreadcrumb<T extends { message?: string; data?: Record<string, unknown> }>(breadcrumb: T): T {
  const data = breadcrumb.data && Object.fromEntries(Object.entries(breadcrumb.data)
    .map(([key, value]) => [key, typeof value === 'string' ? redactRecipeLinks(value) : value]));
  return { ...breadcrumb, ...(breadcrumb.message ? { message: redactRecipeLinks(breadcrumb.message) } : {}), ...(data ? { data } : {}) };
}

/**
 * beforeBreadcrumb never sees breadcrumbs the native SDK records (its network layer, for one); they are
 * merged into the event. Redact every breadcrumb and the request URL on the way out.
 */
export function redactEvent<T extends { breadcrumbs?: { message?: string; data?: Record<string, unknown> }[]; request?: { url?: string } }>(event: T): T {
  return {
    ...event,
    ...(event.breadcrumbs ? { breadcrumbs: event.breadcrumbs.map(redactBreadcrumb) } : {}),
    ...(event.request?.url ? { request: { ...event.request, url: redactRecipeLinks(event.request.url) } } : {}),
  };
}

type SpanLike = { description?: string; data?: Record<string, unknown> };

/** Performance events: redact the transaction name and every span's description and string data too. */
export function redactTransaction<T extends Parameters<typeof redactEvent>[0] & { transaction?: string; spans?: SpanLike[] }>(event: T): T {
  const redacted = redactEvent(event);
  return {
    ...redacted,
    ...(event.transaction ? { transaction: redactRecipeLinks(event.transaction) } : {}),
    ...(event.spans ? { spans: event.spans.map(span => ({
      ...span,
      ...(span.description ? { description: redactRecipeLinks(span.description) } : {}),
      ...(span.data ? { data: Object.fromEntries(Object.entries(span.data)
        .map(([key, value]) => [key, typeof value === 'string' ? redactRecipeLinks(value) : value])) } : {}),
    })) } : {}),
  };
}

/**
 * Native options the JS hooks can't cover. The iOS SDK records URLSession requests (the app's
 * fetches to /public/r/<key> and expo-image's og.jpg loads) as breadcrumbs and spans on its own,
 * and native crash and app-hang reports never pass through beforeSend. Unlisted link keys are
 * passwords, so the native layer records no network breadcrumbs or spans at all. @sentry/react-native
 * 7.11 forwards these keys to sentry-cocoa 8.58's initWithDict (enableNetworkBreadcrumbs,
 * enableNetworkTracking) even though its TypeScript options don't declare them.
 */
export const NATIVE_NETWORK_PRIVACY = { enableNetworkBreadcrumbs: false, enableNetworkTracking: false } as const;

/**
 * Initialize Sentry SDK.
 * Call this once at app startup, before any other code runs.
 */
export function initSentry() {
  if (!SENTRY_DSN) {
    if (__DEV__) {
      console.log('Sentry: No DSN configured, skipping initialization');
    }
    return;
  }

  Sentry.init(sentryOptions(SENTRY_DSN));

  if (__DEV__) {
    console.log('Sentry: Initialized (disabled in development)');
  }
}

/** The options initSentry passes to Sentry.init (exported for tests). */
export function sentryOptions(dsn: string): Parameters<typeof Sentry.init>[0] {
  return {
    dsn,
    ...NATIVE_NETWORK_PRIVACY,
    
    // Only enable in production builds
    enabled: !__DEV__,
    
    // Environment tag
    environment: __DEV__ ? 'development' : 'production',
    
    // App version from app.json
    release: `hafa-recipes@${Constants.expoConfig?.version || '1.0.0'}`,
    dist: Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode?.toString() || '1',
    
    // Sample 100% of errors, 20% of transactions for performance
    tracesSampleRate: 0.2,
    
    // Enable automatic session tracking
    enableAutoSessionTracking: true,
    
    // Attach stack traces to all messages
    attachStacktrace: true,
    
    // Don't send PII by default (we'll add user context explicitly)
    sendDefaultPii: false,
    
    // Ignore common non-actionable errors
    ignoreErrors: [
      // Network errors when user is offline
      'Network request failed',
      'Network Error',
      // Clerk token refresh (handled gracefully)
      'Token fetch timeout',
      // User cancelled actions
      'User cancelled',
      'The user canceled the sign-in',
    ],
    
    // Unlisted recipe links work like passwords: drop their keys from request and navigation breadcrumbs.
    beforeBreadcrumb: redactBreadcrumb,

    // Before sending, enrich with extra context
    beforeSend(event, hint) {
      // Add extra debugging info
      if (hint.originalException instanceof Error) {
        // Don't send if it's a user-initiated cancellation
        if (hint.originalException.message?.includes('cancel')) {
          return null;
        }
      }
      return redactEvent(event);
    },

    // Sampled performance traces carry request URLs in span descriptions and data.
    beforeSendTransaction: event => redactTransaction(event),
  };
}

/**
 * Set the current user context for Sentry.
 * Call this when user signs in or auth state changes.
 */
export function setSentryUser(user: {
  id: string;
} | null) {
  if (user) {
    Sentry.setUser({ id: user.id });
  } else {
    Sentry.setUser(null);
  }
}

/**
 * Add a breadcrumb for tracking user actions.
 * Breadcrumbs show up in error reports as "what happened before the error".
 */
export function addBreadcrumb(
  category: 'navigation' | 'auth' | 'api' | 'user' | 'ui',
  message: string,
  data?: Record<string, any>,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info'
) {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Capture an error manually.
 * Use this for caught errors that you want to track.
 */
export function captureError(
  error: Error,
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, any>;
  }
) {
  Sentry.captureException(error, {
    tags: context?.tags,
    extra: context?.extra,
  });
}

/**
 * Capture a message (non-error event).
 * Use this for warnings or notable events.
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, any>;
  }
) {
  Sentry.captureMessage(message, {
    level,
    tags: context?.tags,
    extra: context?.extra,
  });
}

/**
 * Set a tag that will be attached to all future events.
 * Useful for filtering in the Sentry dashboard.
 */
export function setTag(key: string, value: string) {
  Sentry.setTag(key, value);
}

/**
 * Wrap a component with Sentry error boundary.
 * Re-exported for convenience.
 */
export const withSentry: typeof Sentry.wrap = SENTRY_DSN
  ? Sentry.wrap
  : ((Component) => Component);

/**
 * Export Sentry for advanced usage.
 */
export { Sentry };
