/**
 * Sentry error monitoring and performance tracking.
 * 
 * Captures crashes, errors, and performance data in production.
 * Integrates with Clerk to attach user context to events.
 */

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

// Get DSN from environment or Expo config
// Set this in your .env file: EXPO_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';

/**
 * Initialize Sentry SDK.
 * Call this once at app startup, before any other code runs.
 */
export function initSentry() {
  if (!SENTRY_DSN) {
    if (__DEV__) {
      console.log('📊 Sentry: No DSN configured, skipping initialization');
    }
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    
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
    
    // Before sending, enrich with extra context
    beforeSend(event, hint) {
      // Add extra debugging info
      if (hint.originalException instanceof Error) {
        // Don't send if it's a user-initiated cancellation
        if (hint.originalException.message?.includes('cancel')) {
          return null;
        }
      }
      return event;
    },
  });

  if (__DEV__) {
    console.log('📊 Sentry: Initialized (disabled in development)');
  }
}

/**
 * Set the current user context for Sentry.
 * Call this when user signs in or auth state changes.
 */
export function setSentryUser(user: {
  id: string;
  email?: string | null;
  username?: string | null;
} | null) {
  if (user) {
    Sentry.setUser({
      id: user.id,
      email: user.email || undefined,
      username: user.username || undefined,
    });
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
export const withSentry = Sentry.wrap;

/**
 * Export Sentry for advanced usage.
 */
export { Sentry };
