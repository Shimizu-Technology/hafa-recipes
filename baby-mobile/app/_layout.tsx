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
    <Stack screenOptions={{ headerShown: false, headerBackButtonDisplayMode: "minimal", headerShadowVisible: false, headerTintColor: c.action,
      headerStyle: Platform.OS === "ios" ? undefined : { backgroundColor: c.background },
      headerBlurEffect: "systemChromeMaterial", headerLargeStyle: { backgroundColor: "transparent" },
      headerTitleStyle: { color: c.text }, headerLargeTitleStyle: { color: c.text, fontFamily: fonts.regular, fontSize: 34, fontWeight: "700" },
      contentStyle: { backgroundColor: c.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="privacy" />
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add" options={{ presentation: "formSheet", sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true }} />
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
  const scheme = useColorScheme();
  const error = checkAuthConfiguration(
    configuration.clerkKey,
    configuration.clerkEnvironment,
    configuration.environment
  );
  return (
    <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
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
