import type { ExpoConfig } from "expo/config";
const babyShareActivation = require("./plugins/share-activation.cjs") as string;
const projectId = "12a0a2fa-0a4e-404e-b0d5-62e737eb859d";
// Brand backgrounds shared with Recipes and Workouts: Håfa cream (the icon ground) and the dark app ground.
// Icons and splash come from assets/brand/*.svg.
const cream = "#FFF7EC";
const darkGround = "#101411";
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
    icon: { light: "./assets/icon.png", dark: "./assets/icon-dark.png", tinted: "./assets/icon-tinted.png" },
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
        image: "./assets/splash.png",
        imageWidth: 128,
        resizeMode: "contain",
        backgroundColor: cream,
        dark: { image: "./assets/splash-dark.png", backgroundColor: darkGround },
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
  extra: { eas: { projectId } },
};
export default config;
