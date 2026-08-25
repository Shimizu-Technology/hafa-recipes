import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TouchableOpacity, View as RNView } from 'react-native';
import { useAuth, useClerk, useUser } from '@clerk/expo';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { BrandMark } from '@/components/BrandMark';
import { Button, Text, View, useColors } from '@/components/Themed';
import { fontFamily, fontSize, radius, spacing } from '@/constants/Colors';
import { recipeKeys } from '@/hooks/useRecipes';
import {
  canUseVerifiedAccountOffline,
  classifyAccountAccessError,
  clerkErrorMessage,
  hasDurableSignInMethod,
} from '@/lib/accountAccess';
import {
  beginAccountOnboarding,
  clearAccountOnboarding,
  clearVerifiedAccountOwner,
  failAccountOnboarding,
  getAccountOnboardingState,
  hasVerifiedAccountOwner,
  rememberVerifiedAccountOwner,
  restoreAccountOnboarding,
  subscribeToAccountOnboarding,
} from '@/lib/accountOnboarding';
import { api } from '@/lib/api';
import {
  CLERK_ENVIRONMENT,
  getOrCreateInstallationId,
  markMigrationSignedOut,
  onboardProductionAccount,
} from '@/lib/clerkMigration';
import { clearGroceryWidgetSession } from '@/lib/groceryWidget';
import { clearAllOfflineGroceryData } from '@/lib/offlineStorage';
import { captureError } from '@/lib/sentry';
import { verifiedOAuthCallbackNonce } from '@/lib/socialAuthentication';

/** Keep production private screens and widgets behind one verified owner boundary. */
export function AccountAccessGate({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn, sessionId, userId, getToken } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const { signOut } = useClerk();
  const onboarding = useSyncExternalStore(
    subscribeToAccountOnboarding,
    getAccountOnboardingState,
    getAccountOnboardingState,
  );
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [restoredSessionId, setRestoredSessionId] = useState<string | null>(null);
  const [verifiedOwner, setVerifiedOwner] = useState<string | null>(null);
  const [restorationError, setRestorationError] = useState<unknown>(null);
  const [restorationAttempt, setRestorationAttempt] = useState(0);
  const production = CLERK_ENVIRONMENT === 'production';
  const signedInProduction = production && isLoaded && !!isSignedIn;
  const correctOnboardingOwner = onboarding.status === 'idle' ||
    (onboarding.sessionId === sessionId && onboarding.userId === userId);

  useEffect(() => {
    if (!signedInProduction || !sessionId || !userId) return;
    let active = true;
    setRestorationError(null);
    void restoreAccountOnboarding(sessionId, userId)
      .then(async () => {
        const previouslyVerified = await hasVerifiedAccountOwner(sessionId, userId);
        if (active) {
          setVerifiedOwner(previouslyVerified ? `${sessionId}:${userId}` : null);
          setRestoredSessionId(sessionId);
        }
      })
      .catch((error: unknown) => {
        if (active) setRestorationError(error);
      });
    return () => { active = false; };
  }, [signedInProduction, sessionId, userId, restorationAttempt]);

  const accountAccess = useQuery({
    queryKey: recipeKeys.count(),
    queryFn: () => api.getRecipeCount(),
    enabled: signedInProduction && restoredSessionId === sessionId && onboarding.status === 'idle',
    staleTime: 30_000,
  });

  useEffect(() => {
    if (
      !signedInProduction || !sessionId || !userId || !accountAccess.isSuccess ||
      !userLoaded || !hasDurableSignInMethod(user)
    ) return;
    let active = true;
    void rememberVerifiedAccountOwner(sessionId, userId)
      .then(() => {
        if (active) setVerifiedOwner(`${sessionId}:${userId}`);
      })
      .catch((error: unknown) => {
        captureError(error instanceof Error ? error : new Error(String(error)), {
          tags: { operation: 'persistVerifiedAccountOwner' },
        });
      });
    return () => { active = false; };
  }, [signedInProduction, sessionId, userId, accountAccess.isSuccess, userLoaded, user]);

  const securelySignOut = useCallback(async () => {
    if (!sessionId) throw new Error('The current account session is unavailable');
    await markMigrationSignedOut(sessionId);
    await clearVerifiedAccountOwner();
    await clearGroceryWidgetSession(true).catch((error: unknown) => {
      captureError(error instanceof Error ? error : new Error(String(error)), {
        tags: { operation: 'clearGroceryWidgetOnAccountRecoverySignOut' },
      });
    });
    api.setTokenGetter(null);
    await queryClient.cancelQueries();
    queryClient.clear();
    await clearAllOfflineGroceryData();
    await clearAccountOnboarding();
    await signOut();
  }, [queryClient, sessionId, signOut]);

  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Sign out of this account?',
      'Your recipes stay safe, but you will need the original connected sign-in method to return.',
      [
        { text: 'Stay Signed In', style: 'cancel' },
        {
          text: 'Sign Out Anyway',
          style: 'destructive',
          onPress: () => {
            void securelySignOut().catch((error: unknown) => {
              Alert.alert('Could Not Sign Out', clerkErrorMessage(error, 'Please try again.'));
            });
          },
        },
      ],
    );
  }, [securelySignOut]);

  const retryOnboarding = useCallback(async () => {
    if (onboarding.status !== 'failed' || !sessionId || !userId) return;
    if (onboarding.sessionId !== sessionId || onboarding.userId !== userId) return;

    try {
      await beginAccountOnboarding(sessionId, userId);
      const token = await getToken({ template: 'recipe-extractor-public-metadata' });
      if (!token) throw new Error('The account session is unavailable');
      await onboardProductionAccount(token, await getOrCreateInstallationId());
      await clearAccountOnboarding(sessionId);
    } catch (error) {
      failAccountOnboarding(sessionId, error);
    }
  }, [getToken, onboarding, sessionId, userId]);

  const connectProvider = useCallback(async (strategy: 'oauth_apple' | 'oauth_google') => {
    if (!user || isLinking) return;
    setLinkError(null);
    setIsLinking(true);

    try {
      const redirectUrl = Linking.createURL('oauth-callback');
      const provider = strategy.replace(/^oauth_/, '');
      const pendingAccount = user.externalAccounts.find((account) =>
        account.provider.replace(/^oauth_/, '') === provider &&
        account.verification?.status !== 'verified',
      );
      const externalAccount = pendingAccount
        ? await pendingAccount.reauthorize({ redirectUrl })
        : await user.createExternalAccount({ strategy, redirectUrl });
      const verificationUrl = externalAccount.verification?.externalVerificationRedirectURL;
      if (!verificationUrl) throw new Error('The provider did not return a secure connection link');

      const browserResult = await WebBrowser.openAuthSessionAsync(
        verificationUrl.toString(),
        redirectUrl,
      );
      if (browserResult.type !== 'success') return;

      const nonce = verifiedOAuthCallbackNonce(browserResult.url, redirectUrl);
      const refreshed = await user.reload({ rotatingTokenNonce: nonce });
      if (!hasDurableSignInMethod(refreshed)) {
        throw new Error('Your sign-in method was not verified. Please try again.');
      }
    } catch (error) {
      setLinkError(clerkErrorMessage(error, 'Could not connect this sign-in method. Please try again.'));
    } finally {
      setIsLinking(false);
    }
  }, [isLinking, user]);

  // Guests and development builds retain their existing navigation behavior.
  if (!signedInProduction) return <>{children}</>;

  const rawFailure = restorationError
    ? classifyAccountAccessError(restorationError)
    : onboarding.status === 'failed'
    ? classifyAccountAccessError(onboarding.error)
    : accountAccess.isError
      ? classifyAccountAccessError(accountAccess.error)
      : null;
  // A previously verified exact session keeps its offline grocery access. Identity
  // rejections are never bypassed, even if this device was verified before.
  const verifiedOfflineOwner = !restorationError && canUseVerifiedAccountOffline(
    rawFailure,
    verifiedOwner === `${sessionId}:${userId}`,
  );
  const failure = verifiedOfflineOwner ? null : rawFailure;

  const loading = onboarding.status === 'pending' ||
    (restoredSessionId !== sessionId && !restorationError) ||
    accountAccess.isPending || !userLoaded;
  const needsConnection = !loading && !failure && !verifiedOfflineOwner &&
    !hasDurableSignInMethod(user);

  if (!correctOnboardingOwner || failure || needsConnection || loading) {
    const recovery = !correctOnboardingOwner || failure?.kind === 'recovery' || failure?.kind === 'identity';

    return (
      <View style={styles.container}>
        <RNView style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <BrandMark size={70} style={{ backgroundColor: colors.backgroundSecondary }} />
          {loading && correctOnboardingOwner && !failure ? (
            <>
              <ActivityIndicator color={colors.tint} size="large" style={styles.loader} />
              <Text style={styles.title}>Preparing your recipe library</Text>
              <Text style={[styles.description, { color: colors.textSecondary }]}>
                We&apos;re checking your account before opening your private recipes.
              </Text>
            </>
          ) : needsConnection && correctOnboardingOwner ? (
            <>
              <Text style={styles.eyebrow}>ONE QUICK SECURITY STEP</Text>
              <Text style={styles.title}>Keep your recipes within reach</Text>
              <Text style={[styles.description, { color: colors.textSecondary }]}>
                Your recipe library is safe. Connect Apple or Google now so signing out can never leave it behind.
              </Text>
              {linkError && <Text style={[styles.error, { color: colors.error }]}>{linkError}</Text>}
              <Button title="Connect Apple" onPress={() => void connectProvider('oauth_apple')} loading={isLinking} />
              <Button title="Connect Google" onPress={() => void connectProvider('oauth_google')} disabled={isLinking} variant="outline" />
              <TouchableOpacity onPress={handleSignOut} style={styles.secondaryAction}>
                <Text style={{ color: colors.textSecondary }}>Sign out anyway</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <RNView style={[styles.icon, { backgroundColor: `${colors.tint}18` }]}>
                <Ionicons name={recovery ? 'shield-checkmark-outline' : 'cloud-offline-outline'} size={30} color={colors.tint} />
              </RNView>
              <Text style={styles.title}>
                {recovery ? 'Your recipe library needs reconnecting' : 'We couldn’t reach your recipes'}
              </Text>
              <Text style={[styles.description, { color: colors.textSecondary }]}>
                {recovery
                  ? 'Your recipes are safe. This sign-in is not connected to the original account. Use your original sign-in method or contact support.'
                  : 'Your account is still here. Check your connection and try again.'}
              </Text>
              {correctOnboardingOwner && (
                <Button
                  title="Try Again"
                  onPress={() => {
                    if (restorationError) setRestorationAttempt((attempt) => attempt + 1);
                    else if (onboarding.status === 'failed') void retryOnboarding();
                    else void accountAccess.refetch();
                  }}
                />
              )}
              <Button title="Sign Out" variant="outline" onPress={handleSignOut} />
            </>
          )}
        </RNView>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  card: {
    alignItems: 'stretch',
    gap: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
  },
  loader: { alignSelf: 'flex-start', marginTop: spacing.sm },
  eyebrow: { fontFamily: fontFamily.bold, fontSize: fontSize.xs, letterSpacing: 1.3 },
  title: { fontFamily: fontFamily.display, fontSize: fontSize.xxl, lineHeight: 37 },
  description: { fontSize: fontSize.md, lineHeight: 23 },
  error: { fontSize: fontSize.sm, lineHeight: 19 },
  icon: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: radius.full, height: 52, justifyContent: 'center', width: 52 },
  secondaryAction: { alignItems: 'center', paddingVertical: spacing.sm },
});
