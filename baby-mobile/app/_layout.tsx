import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack, ThemeProvider, DarkTheme, DefaultTheme } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform, useColorScheme } from "react-native";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { ShareIntentProvider } from "expo-share-intent";
import { configuration, checkAuthConfiguration } from "@/lib/config";
import { BabyProvider } from "@/lib/context";
import { SignupGate } from "@/components/signup-gate";
import { AccountGate } from "@/components/account-gate";
import { NotificationResponseHandler } from "@/components/notification-response-handler";
import { ShareSessionGuard } from "@/lib/use-share-session";
import { StockShareBoundary } from "@/components/stock-share-boundary";
import { ShareCapture } from "@/components/share-capture";
import { Copy, Loading, Notice, Screen, ToastProvider, NativeHeaderContext, fonts, palettes, useColors } from "@/components/ui";
import { fontFiles } from "@/lib/fonts";

// The sand splash stays up until Newsreader and DM Sans are ready, so the first frame is already in Soft.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
function Routes() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth(),
    c = useColors();
  if (!isLoaded)
    return (
      <Screen brand title="Håfa Baby">
        <Loading />
      </Screen>
    );
  const stack = (
    // Native push and sheet transitions, as the system draws them.
    <Stack screenOptions={{ headerShown: false, headerBackTitle: "Back", headerBackButtonDisplayMode: "minimal", headerShadowVisible: false, headerTintColor: c.action,
      // Opaque sand (or the warm dark ground) like the tab headers: no system material over the page.
      headerStyle: { backgroundColor: c.background }, headerLargeStyle: { backgroundColor: "transparent" },
      headerTitleStyle: { color: c.text, fontFamily: fonts.semibold }, headerLargeTitleStyle: { color: c.text, fontFamily: fonts.display, fontSize: 36 },
      contentStyle: { backgroundColor: c.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="privacy" />
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="(tabs)" options={{ title: "Back" }} />
        <Stack.Screen name="add" options={{ presentation: "modal", headerShown: true, title: "Add" }} />
        <Stack.Screen name="edit" />
        <Stack.Screen name="record/[id]" />
        <Stack.Screen name="event/[id]" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="child" />
        <Stack.Screen name="what-shows" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="sync" />
        <Stack.Screen name="routines" />
        <Stack.Screen name="care-history" />
        <Stack.Screen name="journal" />
        <Stack.Screen name="help" />
        <Stack.Screen name="contractions" />
        <Stack.Screen name="doctor-summary" />
        <Stack.Screen name="kicks" />
        <Stack.Screen name="milestones" />
        <Stack.Screen name="well-visits" />
        <Stack.Screen name="growth" />
        <Stack.Screen name="ask-entry" />
        <Stack.Screen name="more" />
      </Stack.Protected>
    </Stack>
  );
  return isSignedIn ? (
    <SignupGate key={sessionId}>
      <BabyProvider key={userId}>
        <AccountGate>
          <ShareCapture />
          <NativeHeaderContext.Provider value={true}>{stack}</NativeHeaderContext.Provider>
          <NotificationResponseHandler />
        </AccountGate>
      </BabyProvider>
    </SignupGate>
  ) : (
    stack
  );
}
/** Navigation paints the same sand / warm-dark ground as the screens, so pushes and sheets never flash white or black. */
function navigationTheme(scheme: string | null | undefined) {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme, c = scheme === "dark" ? palettes.dark : palettes.light;
  return { ...base, colors: { ...base.colors, background: c.background, card: c.background, text: c.text, border: c.tabBarBorder, primary: c.action } };
}
export default function Root() {
  const scheme = useColorScheme(), [fontsLoaded, fontError] = useFonts(fontFiles), ready = fontsLoaded || !!fontError;
  useEffect(() => { if (ready) void SplashScreen.hideAsync().catch(() => undefined); }, [ready]);
  const error = checkAuthConfiguration(
    configuration.clerkKey,
    configuration.clerkEnvironment,
    configuration.environment
  );
  // A failed font load falls back to the system face rather than holding the splash.
  if (!ready) return null;
  return (
    <ThemeProvider value={navigationTheme(scheme)}>
    <SafeAreaProvider>
      <ToastProvider>
        <StatusBar style="auto" />
        {error ? (
          <Screen title="Håfa Baby">
            <Notice>{error}</Notice>
            <Copy>Install the configured build to open your private space.</Copy>
          </Screen>
        ) : (
          <ShareIntentProvider
            options={{ resetOnBackground: false, scheme: "hafababy", debug: false, disabled: Platform.OS === "web" }}
          >
            <ClerkProvider publishableKey={configuration.clerkKey} tokenCache={tokenCache}>
              <ShareSessionGuard />
              <StockShareBoundary><Routes /></StockShareBoundary>
            </ClerkProvider>
          </ShareIntentProvider>
        )}
      </ToastProvider>
    </SafeAreaProvider>
    </ThemeProvider>
  );
}
