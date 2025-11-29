import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, ClerkLoaded, useAuth } from '@clerk/clerk-expo';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { queryClient } from '@/lib/queryClient';
import { tokenCache, CLERK_PUBLISHABLE_KEY } from '@/lib/auth';

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

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <ClerkProvider 
      publishableKey={CLERK_PUBLISHABLE_KEY} 
      tokenCache={tokenCache}
    >
      <ClerkLoaded>
        <RootLayoutNav />
      </ClerkLoaded>
    </ClerkProvider>
  );
}

/**
 * Handles auth-based routing.
 * Redirects to sign-in if not authenticated.
 */
function AuthProtection({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isSignedIn && !inAuthGroup) {
      // User is not signed in and not on auth screen - redirect to sign-in
      router.replace('/(auth)/sign-in');
    } else if (isSignedIn && inAuthGroup) {
      // User is signed in but on auth screen - redirect to main app
      router.replace('/(tabs)');
    }
  }, [isSignedIn, isLoaded, segments]);

  return <>{children}</>;
}

/**
 * Component that syncs auth token with API client.
 * Passes a token getter function so fresh tokens are fetched on each request.
 */
function AuthTokenSync({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn, isLoaded } = useAuth();

  useEffect(() => {
    const setupTokenGetter = async () => {
      if (!isLoaded) return;
      
      // Import API dynamically to avoid circular deps
      const { api } = await import('@/lib/api');
      
      if (isSignedIn) {
        // Pass the getToken function - it will be called on each request
        // to get a fresh token (Clerk tokens expire in ~60 seconds)
        api.setTokenGetter(async () => {
          return await getToken();
        });
      } else {
        api.setTokenGetter(null);
      }
    };

    setupTokenGetter();
  }, [isSignedIn, isLoaded, getToken]);

  return <>{children}</>;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const colors = colorScheme === 'dark' 
    ? { background: '#000', tint: '#FF6B35', text: '#fff' }
    : { background: '#fff', tint: '#FF6B35', text: '#000' };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthTokenSync>
          <AuthProtection>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.tint,
                headerTitleStyle: { color: colors.text, fontWeight: '600' },
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
              <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
            </Stack>
          </AuthProtection>
        </AuthTokenSync>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
