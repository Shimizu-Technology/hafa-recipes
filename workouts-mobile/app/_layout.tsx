import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { configuration, checkAuthConfiguration } from "../lib/config";

export default function FoundationLayout() {
  const error = checkAuthConfiguration(configuration.clerkKey, configuration.clerkEnvironment, configuration.environment);
  return <SafeAreaProvider>
    {error ? <SafeAreaView style={{ flex: 1, backgroundColor: "#F6F3EC" }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 20, width: "100%", maxWidth: 660, alignSelf: "center" }}>
        <Text style={{ color: "#172820", fontSize: 15 }}>Håfa Workouts · development foundation</Text>
        <Text accessibilityRole="header" style={{ color: "#172820", fontSize: 30, fontWeight: "700" }}>Configure this development build.</Text>
        <View style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 24, gap: 16 }}>
          <Text accessibilityRole="alert" style={{ color: "#172820", fontSize: 18 }}>{error}</Text>
          <Text style={{ color: "#172820", fontSize: 17, lineHeight: 26 }}>
            Copy .env.example to your local .env, set the matching Clerk public key and explicit Clerk environment,
            then restart the development build. A production build requires production sign-in configuration.
          </Text>
        </View>
        <Text style={{ color: "#172820", fontSize: 17, lineHeight: 26 }}>
          This diagnostic verifies the native foundation. Product screens arrive in the dependent experience slice.
        </Text>
      </ScrollView>
    </SafeAreaView> : <ClerkProvider publishableKey={configuration.clerkKey} tokenCache={tokenCache}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F6F3EC" } }}>
        <Stack.Screen name="index" />
      </Stack>
    </ClerkProvider>}
  </SafeAreaProvider>;
}
