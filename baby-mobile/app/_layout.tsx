import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack, ThemeProvider, DarkTheme, DefaultTheme } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Platform, useColorScheme } from "react-native";
import { ShareIntentProvider } from "expo-share-intent";
import { configuration, checkAuthConfiguration } from "@/lib/config";
import { BabyProvider } from "@/lib/context";
import { SignupGate } from "@/components/signup-gate";
import { AccountGate } from "@/components/account-gate";
import { NotificationResponseHandler } from "@/components/notification-response-handler";
import { ShareSessionGuard } from "@/lib/use-share-session";
import { StockShareBoundary } from "@/components/stock-share-boundary";
import { ShareCapture } from "@/components/share-capture";
import { Copy, Loading, Notice, Screen, ToastProvider, NativeHeaderContext, fonts, useColors } from "@/components/ui";
import { LookProvider } from "@/components/look-provider";
import { useLook } from "@/lib/look-context";
import { uiFace } from "@/lib/looks";
function Routes() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth(),
    c = useColors(), { look } = useLook(), custom = !look.fonts.system;
  if (!isLoaded)
    return (
      <Screen brand title="Håfa Baby">
        <Loading />
      </Screen>
    );
  const stack = (
    // Native push and sheet transitions, as the system draws them.
    // Keyed on the look: choosing another design remounts the navigator so every screen picks it up at once.
    <Stack key={look.id} screenOptions={{ headerShown: false, headerBackTitle: "Back", headerBackButtonDisplayMode: "minimal", headerShadowVisible: false, headerTintColor: c.action,
      headerStyle: Platform.OS === "ios" ? undefined : { backgroundColor: c.background },
      headerBlurEffect: "systemChromeMaterial", headerLargeStyle: { backgroundColor: "transparent" },
      headerTitleStyle: { color: c.text, ...(custom ? { fontFamily: uiFace(look, "semibold").fontFamily } : {}) },
      headerLargeTitleStyle: custom ? { color: c.text, fontFamily: look.fonts.largeTitle.fontFamily, fontSize: look.fonts.largeTitle.fontSize }
        : { color: c.text, fontFamily: fonts.regular, fontSize: 34, fontWeight: "700" },
      contentStyle: { backgroundColor: c.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="privacy" />
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="(tabs)" options={{ title: "Back" }} />
        <Stack.Screen name="add" options={{ presentation: "modal", headerShown: true, title: "What’s on your mind?" }} />
        <Stack.Screen name="edit" />
        <Stack.Screen name="record/[id]" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="child" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="sync" />
        <Stack.Screen name="routines" />
        <Stack.Screen name="care-history" />
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
export default function Root() {
  return <LookProvider><ThemedRoot /></LookProvider>;
}
function ThemedRoot() {
  const scheme = useColorScheme(), { look } = useLook(), c = useColors(), base = scheme === "dark" ? DarkTheme : DefaultTheme;
  // Looks paint their sand / warm-dark ground behind navigation too; `current` keeps the stock themes.
  const theme = look.fonts.system ? base : { ...base, colors: { ...base.colors, background: c.background, card: c.background, text: c.text, border: c.tabBarBorder, primary: c.action } };
  const error = checkAuthConfiguration(
    configuration.clerkKey,
    configuration.clerkEnvironment,
    configuration.environment
  );
  return (
    <ThemeProvider value={theme}>
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
