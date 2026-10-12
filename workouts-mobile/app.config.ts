import type { ExpoConfig } from "expo/config";

// Independent Workouts identities. Provisioning values must never fall back to Recipes.
const projectId = "c520b94d-aac7-49a2-be2b-838a6b992001";
const config: ExpoConfig = {
  name: "Håfa Workouts",
  slug: "hafa-workouts",
  owner: "shimizutechnology",
  version: "1.0.0",
  icon: "./assets/icon.png",
  scheme: "hafaworkouts",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.shimizutechnology.hafaworkouts",
    appleTeamId: "4T358A5S74",
    supportsTablet: false,
    usesAppleSignIn: true,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: { package: "com.shimizutechnology.hafaworkouts", predictiveBackGestureEnabled: true, adaptiveIcon: { foregroundImage: "./assets/adaptive-foreground.png", backgroundColor: "#172820" } },
  web: { bundler: "metro", output: "single" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-apple-authentication",
    "@clerk/expo",
    "expo-web-browser",
    "expo-font",
    "expo-system-ui",
    ["expo-splash-screen", { image: "./assets/splash.png", imageWidth: 180, resizeMode: "contain", backgroundColor: "#172820" }],
    ["@kingstinct/react-native-healthkit", { background: false }],
    "react-native-health-connect",
    ["expo-share-intent", { iosActivationRules: { NSExtensionActivationSupportsWebURLWithMaxCount: 1, NSExtensionActivationSupportsText: true, NSExtensionActivationSupportsImageWithMaxCount: 4, NSExtensionActivationSupportsFileWithMaxCount: 1 }, androidIntentFilters: ["text/*", "image/*", "application/pdf"] }],
    ["expo-image-picker", { photosPermission: "Choose workout screenshots or photos to review and import.", cameraPermission: "Photograph workout instructions for an optional private import.", microphonePermission: false }],
    "expo-document-picker",
    "expo-sharing",
    "expo-notifications",
    ["expo-build-properties", { ios: { deploymentTarget: "17.0" }, android: { minSdkVersion: 26 } }],
    "./plugins/with-workouts-health.cjs",
  ],
  experiments: { typedRoutes: true },
  ...(projectId ? { extra: { eas: { projectId } } } : {}),
};
export default config;
