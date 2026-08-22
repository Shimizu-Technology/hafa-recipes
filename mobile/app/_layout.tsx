import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, ClerkLoaded, useAuth, useUser } from '@clerk/expo';
import { useFonts } from 'expo-font';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import {
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';
import { ShareIntentProvider } from 'expo-share-intent';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { TimerProvider } from '@/contexts/TimerContext';
import { ExtractionProvider } from '@/contexts/ExtractionContext';
import { shouldClearPrivateQueryCache } from '@/lib/authCache';
import { queryClient } from '@/lib/queryClient';
import { tokenCache, CLERK_PUBLISHABLE_KEY } from '@/lib/auth';
import { api } from '@/lib/api';
import { bindOfflineGroceryIdentity, clearAllOfflineGroceryData } from '@/lib/offlineStorage';
import { AppLoadingSkeleton } from '@/components/Skeleton';
import { OfflineBanner } from '@/components/OfflineBanner';
import { EnvironmentBanner } from '@/components/EnvironmentBanner';
import { FloatingTimerOverlay } from '@/components/FloatingTimerOverlay';
import FloatingChatButton from '@/components/FloatingChatButton';
import { ClerkMigrationBridge } from '@/components/ClerkMigrationBridge';
import { initSentry, setSentryUser, addBreadcrumb, captureError, withSentry } from '@/lib/sentry';
import { useHandleShareIntent } from '@/hooks/useShareIntent';

// Initialize Sentry as early as possible
initSentry();

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
    // Håfa Recipes brand typography
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      // Hide splash screen quickly - we'll show our own skeleton
      SplashScreen.hideAsync();
      addBreadcrumb('navigation', 'App loaded, splash screen hidden');
    }
  }, [loaded]);

  // Show skeleton loading instead of blank/splash screen
  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#101411' }}>
        <AppLoadingSkeleton />
      </View>
    );
  }

  return (
    <ThemeProvider>
      <ShareIntentProvider>
        <ClerkProvider 
          publishableKey={CLERK_PUBLISHABLE_KEY} 
          tokenCache={tokenCache}
        >
          <ClerkLoaded>
            <ClerkMigrationBridge>
              <RootLayoutNav />
            </ClerkMigrationBridge>
          </ClerkLoaded>
        </ClerkProvider>
      </ShareIntentProvider>
    </ThemeProvider>
  );
}

// Wrap with Sentry for error boundary and performance tracking
export default withSentry(RootLayout);

/**
 * Handles auth-based routing.
 * 
 * Tab screens handle guest access themselves with SignInBanner.
 * This only handles:
 * - Redirecting signed-in users from auth screens to main app
 * - Protecting add-recipe modal from guests
 */
function AuthProtection({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;

    const inAuthGroup = segments[0] === '(auth)';
    
    // User signed in on auth screen -> redirect to main app
    if (isSignedIn && inAuthGroup) {
      router.replace('/(tabs)');
      return;
    }

    // Only protect add-recipe modal from guests
    // Tab screens handle their own guest access with SignInBanner
    if (!isSignedIn && segments[0] === 'add-recipe') {
      router.replace('/(tabs)/discover');
    }
  }, [isSignedIn, isLoaded, segments]);

  return <>{children}</>;
}

/**
 * Component that syncs auth token with API client.
 * Passes a token getter function so fresh tokens are fetched on each request.
 * Also syncs user context with Sentry for error attribution.
 * 
 * IMPORTANT: Clears the query cache when the user changes to prevent
 * stale data from a previous user showing to a new user.
 */
function AuthTokenSync({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();
  
  // `undefined` means Clerk has not produced the first loaded identity yet.
  const previousUserIdRef = useRef<string | null | undefined>(undefined);
  const identityEpochRef = useRef(0);
  const [boundOfflineIdentity, setBoundOfflineIdentity] = useState<string | null | undefined>(
    undefined,
  );

  // Use useLayoutEffect to set token getter BEFORE children render/effects run
  // This ensures token is available before any API calls
  useLayoutEffect(() => {
    if (!isLoaded) return;
    
    if (isSignedIn) {
      // Pass the getToken function - it will be called on each request
      // to get a fresh token (Clerk tokens expire in ~60 seconds)
      // Use our custom JWT template that includes public_metadata (for admin role)
      api.setTokenGetter(async () => {
        return await getToken({ template: "recipe-extractor-public-metadata" });
      });
    } else {
      api.setTokenGetter(null);
    }
  }, [isSignedIn, isLoaded, getToken]);

  // Clear before descendants run effects for every loaded identity boundary:
  // user -> signed out, signed out -> user, and direct account switches.
  useLayoutEffect(() => {
    if (!isLoaded) return;

    const currentUserId = user?.id ?? null;
    const previousUserId = previousUserIdRef.current;

    if (shouldClearPrivateQueryCache(previousUserId, currentUserId)) {
      void queryClient.cancelQueries();
      queryClient.clear();
      addBreadcrumb('auth', 'Query cache cleared due to user change', {
        previousUserId: previousUserId ?? 'signed-out',
        newUserId: currentUserId,
      });
    }

    previousUserIdRef.current = currentUserId;
  }, [user?.id, isLoaded]);

  // Bind private on-device grocery data before descendants can query it.
  useLayoutEffect(() => {
    if (!isLoaded) return;
    const currentUserId = user?.id ?? null;
    const epoch = ++identityEpochRef.current;

    void bindOfflineGroceryIdentity(currentUserId)
      .catch(async (error) => {
        captureError(error instanceof Error ? error : new Error(String(error)), {
          tags: { operation: 'bindOfflineGroceryIdentity' },
        });
        await clearAllOfflineGroceryData();
      })
      .then(() => {
        if (identityEpochRef.current === epoch) setBoundOfflineIdentity(currentUserId);
      });
  }, [isLoaded, user?.id]);

  // Sync user context with Sentry
  useEffect(() => {
    if (!isLoaded) return;
    
    if (isSignedIn && user) {
      setSentryUser({
        id: user.id,
        email: user.primaryEmailAddress?.emailAddress,
        username: user.username,
      });
      addBreadcrumb('auth', 'User signed in', { userId: user.id });
    } else {
      setSentryUser(null);
      if (isLoaded) {
        addBreadcrumb('auth', 'User signed out or not authenticated');
      }
    }
  }, [isSignedIn, isLoaded, user]);

  const currentUserId = isLoaded ? user?.id ?? null : undefined;
  if (boundOfflineIdentity !== currentUserId) return null;

  return <>{children}</>;
}

/**
 * Component that handles incoming share intents.
 * Must be rendered within ShareIntentProvider and after navigation is ready.
 */
function ShareIntentHandler({ children }: { children: React.ReactNode }) {
  useHandleShareIntent();
  return <>{children}</>;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <QueryClientProvider client={queryClient}>
      <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <TimerProvider>
          <AuthTokenSync>
            <ExtractionProvider>
              <AuthProtection>
                <ShareIntentHandler>
                  <EnvironmentBanner />
                  {/* Global offline indicator */}
                  <OfflineBanner />
                  {/* Floating timer when leaving cook mode with active timers */}
                  <FloatingTimerOverlay />
                  {/* Floating chat button for cooking assistant */}
                  <FloatingChatButton />
                  <Stack
                    screenOptions={{
                      headerStyle: { backgroundColor: colors.background },
                      headerTintColor: colors.tint,
                      headerTitleStyle: { color: colors.text, fontWeight: '600', fontFamily: 'DMSans_600SemiBold' },
                      headerShadowVisible: false,
                      headerBackTitle: 'Back',
                    }}
                  >
                    <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen
                      name="recipe/[id]"
                      options={{
                        headerTitle: 'Recipe',
                      }}
                    />
                    <Stack.Screen
                      name="add-recipe"
                      options={{
                        headerTitle: 'Add Recipe',
                        presentation: 'modal',
                      }}
                    />
                    <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
                  </Stack>
                </ShareIntentHandler>
              </AuthProtection>
            </ExtractionProvider>
          </AuthTokenSync>
        </TimerProvider>
      </NavigationThemeProvider>
    </QueryClientProvider>
  );
}
