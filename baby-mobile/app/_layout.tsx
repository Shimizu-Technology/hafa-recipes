import { useState } from "react";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { ShareIntentProvider } from "expo-share-intent";
import { configuration, checkAuthConfiguration } from "@/lib/config";
import { BabyProvider } from "@/lib/context";
import { AccountGate } from "@/components/account-gate";
import { NotificationResponseHandler } from "@/components/notification-response-handler";
import { ShareCapture } from "@/components/share-capture";
import { Copy, Loading, Notice, Screen, ToastProvider, useColors } from "@/components/ui";
function Routes() {
  const { isLoaded, isSignedIn, userId } = useAuth(),
    c = useColors();
  if (!isLoaded)
    return (
      <Screen title="Håfa Baby">
        <Loading />
      </Screen>
    );
  const stack = (
    <Stack screenOptions={{ headerShown: false, animation: "none", contentStyle: { backgroundColor: c.background } }}>
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
      </Stack.Protected>
    </Stack>
  );
  return isSignedIn ? (
    <BabyProvider key={userId}>
      <AccountGate>
        <ShareCapture />
        {stack}
        <NotificationResponseHandler />
      </AccountGate>
    </BabyProvider>
  ) : (
    stack
  );
}
export default function Root() {
  const error = checkAuthConfiguration(
    configuration.clerkKey,
    configuration.clerkEnvironment,
    configuration.environment
  );
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
              <Routes />
            </ClerkProvider>
          </ShareIntentProvider>
        )}
      </ToastProvider>
    </SafeAreaProvider>
  );
}
