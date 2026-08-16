import { useAuth, useSignIn } from '@clerk/clerk-expo';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';

import { AppLoadingSkeleton } from '@/components/Skeleton';
import {
  CLERK_ENVIRONMENT,
  clearMigrationGrant,
  getOrCreateInstallationId,
  loadMigrationGrant,
  redeemMigrationGrant,
  requestMigrationGrant,
  saveMigrationGrantForSession,
  shouldRefreshMigrationGrant,
} from '@/lib/clerkMigration';

const JWT_TEMPLATE = 'recipe-extractor-public-metadata';

export function ClerkMigrationBridge({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded: isAuthLoaded, isSignedIn, sessionId } = useAuth();
  const {
    isLoaded: isSignInLoaded,
    setActive,
    signIn,
  } = useSignIn();
  const isNative = Platform.OS === 'ios' || Platform.OS === 'android';
  const shouldGate = isNative && CLERK_ENVIRONMENT === 'production';
  const [isResolved, setIsResolved] = useState(!shouldGate);
  const [foregroundEpoch, setForegroundEpoch] = useState(0);
  const provisionInFlight = useRef(false);
  const redemptionAttempted = useRef(false);

  useEffect(() => {
    if (!isNative) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        redemptionAttempted.current = false;
        setForegroundEpoch((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, [isNative]);

  useEffect(() => {
    if (
      !isNative ||
      CLERK_ENVIRONMENT !== 'development' ||
      !isAuthLoaded ||
      !isSignedIn ||
      !sessionId ||
      provisionInFlight.current
    ) {
      return;
    }

    let cancelled = false;
    provisionInFlight.current = true;

    const provisionGrant = async () => {
      try {
        const storedGrant = await loadMigrationGrant();
        if (!shouldRefreshMigrationGrant(storedGrant)) return;

        const sessionToken = await getToken({ template: JWT_TEMPLATE });
        if (!sessionToken || cancelled) return;

        const installationId = await getOrCreateInstallationId();
        const grant = await requestMigrationGrant(sessionToken, installationId);
        if (!cancelled) await saveMigrationGrantForSession(grant, sessionId);
      } catch {
        // This is deliberately silent and retryable on the next foreground load.
        // Never attach a raw grant or session token to logs or crash reporting.
      } finally {
        provisionInFlight.current = false;
      }
    };

    void provisionGrant();
    return () => {
      cancelled = true;
    };
  }, [foregroundEpoch, getToken, isAuthLoaded, isNative, isSignedIn, sessionId]);

  useEffect(() => {
    if (!shouldGate || !isAuthLoaded || !isSignInLoaded) return;

    if (isSignedIn) {
      void clearMigrationGrant().finally(() => setIsResolved(true));
      return;
    }

    if (redemptionAttempted.current) return;
    redemptionAttempted.current = true;

    let cancelled = false;
    const redeemGrant = async () => {
      try {
        const storedGrant = await loadMigrationGrant();
        if (!storedGrant || Date.parse(storedGrant.expiresAt) <= Date.now()) {
          if (storedGrant) await clearMigrationGrant();
          return;
        }

        const redemption = await redeemMigrationGrant(storedGrant.grant);
        if (redemption.status === 'terminal') {
          await clearMigrationGrant();
          return;
        }
        if (redemption.status !== 'success' || !signIn) return;

        const result = await signIn.create({
          strategy: 'ticket',
          ticket: redemption.ticket,
        });
        if (result.status !== 'complete' || !result.createdSessionId) return;

        await setActive({ session: result.createdSessionId });
        await clearMigrationGrant();
      } catch {
        // The server preserves grants for network/5xx failures. If Clerk ticket
        // consumption fails after redemption, the later 410 response clears it
        // and the normal sign-in screen remains available.
      } finally {
        if (!cancelled) setIsResolved(true);
      }
    };

    void redeemGrant();
    return () => {
      cancelled = true;
    };
  }, [
    foregroundEpoch,
    isAuthLoaded,
    isSignInLoaded,
    isSignedIn,
    setActive,
    shouldGate,
    signIn,
  ]);

  if (!isResolved) {
    return (
      <View style={{ flex: 1, backgroundColor: '#101411' }}>
        <AppLoadingSkeleton />
      </View>
    );
  }

  return <>{children}</>;
}
