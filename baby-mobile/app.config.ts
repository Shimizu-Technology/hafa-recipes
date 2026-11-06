import type { ExpoConfig } from "expo/config";
const babyShareActivation = require("./plugins/share-activation.cjs") as string;
const projectId = "12a0a2fa-0a4e-404e-b0d5-62e737eb859d";
// Splash grounds match Baby's Sand & Cocoa app backgrounds (light sand, warm near-black) so launch has no colour jump.
// Icons and splash come from assets/brand/*.svg.
const sand = "#F8F3EE";
const darkGround = "#14110F";
const config: ExpoConfig = {
  name: "Håfa Baby",
  icon: "./assets/icon.png",
  slug: "hafa-baby",
  owner: "shimizutechnology",
  version: "1.2.0",
  scheme: "hafababy",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.shimizutechnology.hafababy",
    appleTeamId: "4T358A5S74",
    supportsTablet: false,
    usesAppleSignIn: true,
    associatedDomains: ["webcredentials:clerk.hafa-recipes.com", "applinks:shimizu-technology.com"],
    entitlements: {
      "com.apple.developer.default-data-protection": "NSFileProtectionComplete",
      // Lets a reminder someone chose come through quiet hours. Apple's App ID needs this capability too.
      "com.apple.developer.usernotifications.time-sensitive": true,
    },
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
    icon: { light: "./assets/icon.png", dark: "./assets/icon-dark.png", tinted: "./assets/icon-tinted.png" },
  },
  // The calendar module's plugin applies by itself and would ask for these. The add-event sheet needs neither.
  android: { package: "com.shimizutechnology.hafababy", allowBackup: false, predictiveBackGestureEnabled: true, blockedPermissions: ["android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR"] },
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
        backgroundColor: sand,
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
    // Its plugin applies by itself if it isn't listed, with usage strings for access this app never asks for.
    // The app only opens the system's add-event sheet and never asks for access. Apple still requires these words because the module can.
    ["expo-calendar", {
      calendarPermission: "Håfa Baby adds an event to your calendar only when you ask it to.",
      writeOnlyCalendarPermission: "Håfa Baby adds an event to your calendar only when you ask it to.",
      writeOnlyAccess: true,
      remindersPermission: "Håfa Baby doesn't use your reminders.",
    }],
    "@react-native-community/datetimepicker",
    ["expo-build-properties", { ios: { deploymentTarget: "17.0" }, android: { minSdkVersion: 26 } }],
    "./plugins/with-baby-share.cjs",
  ],
  experiments: { typedRoutes: true },
  extra: { eas: { projectId } },
};
export default config;
