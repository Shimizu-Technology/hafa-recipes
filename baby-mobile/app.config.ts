import type { ExpoConfig } from "expo/config";
const babyShareActivation = require("./plugins/share-activation.cjs") as string;
const projectId = "12a0a2fa-0a4e-404e-b0d5-62e737eb859d";
const config: ExpoConfig = {
  name: "Håfa Baby",
  icon: "./assets/icon.png",
  slug: "hafa-baby",
  owner: "shimizutechnology",
  version: "1.0.0",
  scheme: "hafababy",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.shimizutechnology.hafababy",
    appleTeamId: "4T358A5S74",
    supportsTablet: false,
    usesAppleSignIn: true,
    associatedDomains: ["webcredentials:clerk.hafa-recipes.com"],
    entitlements: { "com.apple.developer.default-data-protection": "NSFileProtectionComplete" },
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: { package: "com.shimizutechnology.hafababy", allowBackup: false, predictiveBackGestureEnabled: true },
  web: { bundler: "metro", output: "single" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-apple-authentication",
    "@clerk/expo",
    "expo-web-browser",
    "expo-font",
    "expo-system-ui",
    [
      "expo-splash-screen",
      {
        image: "./assets/icon.png",
        imageWidth: 160,
        resizeMode: "contain",
        backgroundColor: "#F8F6F0",
        dark: { backgroundColor: "#151D19" },
      },
    ],
    [
      "expo-share-intent",
      {
        iosAppGroupIdentifier: "group.com.shimizutechnology.hafababy",
        iosActivationRules: babyShareActivation,
        androidIntentFilters: ["text/*", "image/*", "application/pdf", "video/*", "audio/*"],
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Choose a photo or video for your private library or journal.",
        cameraPermission: "Capture a photo for your private journal or saved source.",
        microphonePermission: false,
      },
    ],
    "expo-document-picker",
    "expo-sharing",
    "expo-notifications",
    "@react-native-community/datetimepicker",
    ["expo-build-properties", { ios: { deploymentTarget: "17.0" }, android: { minSdkVersion: 26 } }],
    "./plugins/with-baby-share.cjs",
  ],
  experiments: { typedRoutes: true },
  ...(projectId ? { extra: { eas: { projectId } } } : {}),
};
export default config;
