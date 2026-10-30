import { useState } from "react";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Platform } from "react-native";
import { ShareIntentProvider } from "expo-share-intent";
import { configuration, checkAuthConfiguration } from "@/lib/config";
import { BabyProvider } from "@/lib/context";
import { SignupGate } from "@/components/signup-gate";
import { AccountGate } from "@/components/account-gate";
import { NotificationResponseHandler } from "@/components/notification-response-handler";
import { ShareSessionGuard } from "@/lib/use-share-session";
import { StockShareBoundary } from "@/components/stock-share-boundary";
import { ShareCapture } from "@/components/share-capture";
import { Copy, Loading, Notice, Screen, ToastProvider, useColors } from "@/components/ui";
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
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="privacy" />
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add" options={{ presentation: "modal" }} />
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
          {stack}
          <NotificationResponseHandler />
        </AccountGate>
      </BabyProvider>
    </SignupGate>
  ) : (
    stack
  );
}
export default function Root() {
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular: require("@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf"),
    DMSans_600SemiBold: require("@expo-google-fonts/dm-sans/600SemiBold/DMSans_600SemiBold.ttf"),
    DMSans_700Bold: require("@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf"),
  });
  const error = checkAuthConfiguration(
    configuration.clerkKey,
    configuration.clerkEnvironment,
    configuration.environment
  );
  // Bundled fonts load in a frame or two; a failed load falls back to the system face.
  if (!fontsLoaded && !fontError) return null;
  return (
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
  );
}
