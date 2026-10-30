import { RemindersProvider } from "@/components/reminders-provider";
import { router } from "expo-router";
import { pendingShare } from "@/lib/sharing";
import { ShareIntentProvider } from "expo-share-intent";
import { ShareCapture } from "@/components/share-capture";
import { NativeShareAccountGuard } from "@/components/native-share-session";
import { DamagedCleanupRecordError, recoverPrivateDeviceCleanup } from "@/lib/private-device";
import { useEffect, useRef, useState } from "react";
import { ClerkProvider, useAuth, useClerk } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { ActivityIndicator, View, Platform } from "react-native";
import { configuration, checkAuthConfiguration } from "@/lib/config";
import { TrainingProvider } from "@/lib/context";
import { Screen, Copy, Notice, Button, ToastProvider, useColors } from "@/components/ui";
import { LogoutRecoveryBoundary } from "@/components/logout-recovery-boundary";
import { SignupGate } from "@/components/signup-gate";
import { AccountIdentityProvider } from "@/components/account-identity";
import { logoutRecovery } from "@/lib/logout-recovery-native";
import { logoutBinding, clearLogoutQueries } from "@/lib/logout-recovery";

// Screens share cached reads for 30 seconds instead of refetching on every mount.
// Saves still invalidate or refetch the data they change.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });
function AccountLogoutRecovery() {
  const { isLoaded, userId, sessionId } = useAuth();
  const clerk = useClerk();
  const cache = useQueryClient();
  return <LogoutRecoveryBoundary
    controller={logoutRecovery}
    auth={{ loaded: isLoaded, subject: userId ?? null, sessionId: sessionId ?? null,
      binding: userId ? logoutBinding(configuration.clerkEnvironment, configuration.clerkKey, userId) : null }}
    signOut={(options) => clerk.signOut(options)}
    clearPrivate={(record) => clearLogoutQueries(cache, record)}
    renderRecovery={({ checking, loading, busy, error, retry }) => <Screen title={checking ? "Checking your account" : "Finish signing out"}>
      <Copy>{checking ? "Checking this device for account recovery before opening private training." :
        "Your server account was deleted. Private training stays closed while this device finishes cleanup and sign-out. Retrying does not delete the account again."}</Copy>
      {!!error && <Notice error>{error}</Notice>}
      {loading ? <ActivityIndicator accessibilityLabel="Checking account recovery" /> :
        <Button title="Retry cleanup and sign-out" busy={busy} onPress={retry} />}
    </Screen>}
  ><Routes /></LogoutRecoveryBoundary>;
}
function Routes() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const c = useColors();
  const previousOwner = useRef<string | null>(null);
  useEffect(() => {
    if (previousOwner.current && previousOwner.current !== userId) {
      const previous = previousOwner.current;
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === previous });
    }
    previousOwner.current = userId ?? null;
    if (isLoaded && isSignedIn && pendingShare())
      router.replace({ pathname: "/shared/[token]", params: { token: pendingShare()! } });
  }, [userId, isLoaded, isSignedIn]);
  if (!isLoaded)
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: "center" }}>
        <ActivityIndicator color={c.action} accessibilityLabel="Loading your account" />
      </View>
    );
  const stack = (
    <Stack
      initialRouteName="index"
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="shared/[token]" />
      <Stack.Screen name="health-rationale" />
      <Stack.Screen name="privacy" />
      <Stack.Screen name="invalid-link" />
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="add-workout" />
        <Stack.Screen name="workout/[id]" />
        <Stack.Screen name="discover/[id]" />
        <Stack.Screen name="discover/share" />
        <Stack.Screen name="hafa-apps" />
        <Stack.Screen name="training" />
        <Stack.Screen name="capture" />
        <Stack.Screen name="import/[id]" />
        <Stack.Screen name="edit-workout/[id]" />
        <Stack.Screen name="recover-workout/[id]" />
        {/* Coach opens as a sheet over whatever you were looking at. */}
        <Stack.Screen name="coach" options={{ presentation: "modal" }} />
        <Stack.Screen name="coach-action/[id]" />
        <Stack.Screen name="build-plan" />
        <Stack.Screen name="review-plan" />
        <Stack.Screen name="share" />
        <Stack.Screen name="sharing-links" />
        <Stack.Screen name="reminders" />
        <Stack.Screen name="measurements" />
        <Stack.Screen name="measurement" />
        <Stack.Screen name="collections" />
        <Stack.Screen name="collection/[id]" />
        <Stack.Screen name="organize/[id]" />
        <Stack.Screen name="connections" />
        <Stack.Screen name="recipes-connection" />
        <Stack.Screen name="account-data" />
        <Stack.Screen name="activity-log" />
        <Stack.Screen name="activity" options={{ presentation: "modal" }} />
        <Stack.Screen name="ai-preferences" />
        <Stack.Screen name="session/[id]" />
      </Stack.Protected>
    </Stack>
  );
  return isSignedIn ? (
    <SignupGate key={sessionId}><TrainingProvider key={userId}>
      <AccountIdentityProvider>
        <RemindersProvider>
          <ShareCapture />
          {stack}
        </RemindersProvider>
      </AccountIdentityProvider>
    </TrainingProvider></SignupGate>
  ) : (
    stack
  );
}
export default function Root() {
  const c = useColors();
  const [cleanupReady, setCleanupReady] = useState(false);
  const [cleanupError, setCleanupError] = useState("");
  const [cleanupDamaged, setCleanupDamaged] = useState(false);
  async function recoverCleanup(repairDamaged = false) {
    setCleanupError("");
    try {
      await recoverPrivateDeviceCleanup({ repairDamaged });
      setCleanupDamaged(false);
      setCleanupReady(true);
    } catch (e) {
      const damaged = e instanceof DamagedCleanupRecordError;
      setCleanupDamaged(damaged);
      setCleanupError(damaged ?
        "A device cleanup record is damaged. Finishing cleanup removes this device's data only for the account that was being cleaned up; other accounts and your saved server data are not changed." :
        "Private device cleanup needs another attempt. Your saved server data has not been changed by this recovery.");
    }
  }
  useEffect(() => {
    void recoverCleanup();
  }, []);
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular: require("@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf"),
    DMSans_600SemiBold: require("@expo-google-fonts/dm-sans/600SemiBold/DMSans_600SemiBold.ttf"),
    DMSans_700Bold: require("@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf"),
    Fraunces_600SemiBold: require("@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf"),
    Fraunces_700Bold: require("@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf"),
  });
  const error = checkAuthConfiguration(
    configuration.clerkKey,
    configuration.clerkEnvironment,
    configuration.environment
  );
  return (
    <SafeAreaProvider>
      <ToastProvider>
      <StatusBar style="auto" />
      {!cleanupReady ? (
        <Screen title="Restoring this device">
          {cleanupError ? (
            <>
              <Notice error>{cleanupError}</Notice>
              <Button
                title={cleanupDamaged ? "Finish device cleanup" : "Retry device cleanup"}
                onPress={() => {
                  void recoverCleanup(cleanupDamaged);
                }}
              />
            </>
          ) : (
            <ActivityIndicator accessibilityLabel="Checking private device cleanup" />
          )}
        </Screen>
      ) : !fontsLoaded && !fontError ? (
        <View style={{ flex: 1, backgroundColor: c.background, justifyContent: "center" }}>
          <ActivityIndicator accessibilityLabel="Loading Håfa Workouts" />
        </View>
      ) : error ? (
        <Screen title="Håfa Workouts">
          <Notice>{error} Ask support for the configured build.</Notice>
          <Copy>One Håfa account for Recipes, Workouts, and Baby. Each app’s data stays separate unless you connect them.</Copy>
        </Screen>
      ) : (
        <ShareIntentProvider
          options={{ resetOnBackground: false, scheme: "hafaworkouts", debug: false, disabled: Platform.OS === "web" }}
        >
          <ClerkProvider publishableKey={configuration.clerkKey} tokenCache={tokenCache}>
            <QueryClientProvider client={queryClient}>
              <AccountLogoutRecovery />
              <NativeShareAccountGuard />
            </QueryClientProvider>
          </ClerkProvider>
        </ShareIntentProvider>
      )}
      </ToastProvider>
    </SafeAreaProvider>
  );
}
