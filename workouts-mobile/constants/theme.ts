/** Workouts UI: system type, neutral surfaces, coral actions. */
import type { TextStyle, ViewStyle } from "react-native";

/** Legacy artwork palette. App UI uses the neutral surfaces and coral actions below. */
export const hafa = {
  cream: "#FFF7EC",
  bone: "#F8EFE3",
  parchment: "#F3E4D2",
  ink: "#17120E",
  charcoal: "#27211B",
  clay: "#B94722",
  reef: "#155C52",
  reefMid: "#347D73",
  reefBright: "#2F8F83",
  reefHighlight: "#69C8BA",
  reefLight: "#DDF5F1",
  herb: "#4F7A41",
  banana: "#F2B84B",
  border: "#E8D8C8",
} as const;

/** Workouts-only brand colours. */
export const workouts = {
  /** Sunrise coral: graphics, rings, active indicators. 3.1:1 on cream (non-text use only). */
  sunrise: "#E8643C",
  /** Deeper coral for accent text on light surfaces (≥4.5:1). */
  ember: "#AD401C",
  /** Brighter coral for dark surfaces. */
  sunriseNight: "#F07A52",
  sunriseSoft: "#FCE5DA",
  sunriseSoftNight: "#3A241B",
  reefDeep: "#0F4942",
  reefNight: "#173F38",
} as const;

export type ColorTokens = {
  onImage: string;
  imageOverlay: string;
  groupedBackground: string;
  surface2: string;
  secondaryLabel: string;
  tertiaryLabel: string;
  destructive: string;
  dataSuccess: string;
  background: string;
  surface: string;
  elevated: string;
  sunken: string;
  text: string;
  muted: string;
  border: string;
  /** Control boundaries (inputs, chips) — ≥3:1 against surface. */
  borderStrong: string;
  action: string;
  onAction: string;
  /** Low-emphasis action background (secondary buttons, selected chips). */
  actionSoft: string;
  onActionSoft: string;
  accent: string;
  accentText: string;
  onAccent: string;
  accentSoft: string;
  /** Tonal accent fill behind a selected filter link; accent text on it stays ≥4.5:1. */
  accentTint: string;
  hero: string;
  onHero: string;
  heroMuted: string;
  heroAccent: string;
  /** Translucent fill for secondary controls sitting on the hero surface. */
  onHeroSoft: string;
  success: string;
  warning: string;
  error: string;
  errorSoft: string;
  focus: string;
  overlay: string;
  skeleton: string;
  shadow: string;
  /** @deprecated alias of actionSoft kept for existing screens. */
  tint: string;
  /** Solid tab bar and its top hairline (no blur on any OS). */
  tabBar: string;
  tabBarBorder: string;
};

// Small text uses contrast-strengthened variants where system colours fall below 4.5:1.
// Semantic UI colours are independent of the retained app-icon artwork palette.
export const light: ColorTokens = {
  onImage: "#FFFFFF", imageOverlay: "rgba(0,0,0,0.6)",
  groupedBackground: "#F2F2F7", surface2: "rgba(118,118,128,0.12)",
  secondaryLabel: "rgba(60,60,67,0.60)", tertiaryLabel: "rgba(60,60,67,0.30)",
  destructive: "#FF3B30", dataSuccess: "#248A3D",
  background: "#FFFFFF", surface: "#F2F2F7", elevated: "#FFFFFF", sunken: "rgba(118,118,128,0.12)",
  text: "#000000", muted: "rgba(60,60,67,0.74)", border: "rgba(60,60,67,0.29)", borderStrong: "#767680",
  action: "#C8471C", onAction: "#FFFFFF", actionSoft: "rgba(118,118,128,0.12)", onActionSoft: "#B53F17",
  accent: "#C8471C", accentText: "#B53F17", onAccent: "#FFFFFF", accentSoft: "rgba(118,118,128,0.12)",
  accentTint: "rgba(200,71,28,0.14)",
  hero: "#F2F2F7", onHero: "#000000", heroMuted: "rgba(60,60,67,0.74)", heroAccent: "#B53F17",
  onHeroSoft: "rgba(118,118,128,0.12)", success: "#207A36", warning: "#765300",
  error: "#BC231A", errorSoft: "#FFF0EF", focus: "#C8471C", overlay: "rgba(0,0,0,0.42)",
  skeleton: "#E5E5EA", shadow: "#000000", tint: "rgba(118,118,128,0.12)",
  tabBar: "#FFFFFF", tabBarBorder: "rgba(60,60,67,0.18)",
};
export const dark: ColorTokens = {
  onImage: "#FFFFFF", imageOverlay: "rgba(0,0,0,0.6)",
  groupedBackground: "#000000", surface2: "rgba(118,118,128,0.24)",
  secondaryLabel: "rgba(235,235,245,0.60)", tertiaryLabel: "rgba(235,235,245,0.30)",
  destructive: "#FF453A", dataSuccess: "#30D158",
  background: "#000000", surface: "#1C1C1E", elevated: "#1C1C1E", sunken: "rgba(118,118,128,0.24)",
  text: "#FFFFFF", muted: "rgba(235,235,245,0.60)", border: "rgba(84,84,88,0.65)", borderStrong: "#8E8E93",
  action: "#FF7A50", onAction: "#2A0D00", actionSoft: "rgba(118,118,128,0.24)", onActionSoft: "#FF7A50",
  accent: "#FF7A50", accentText: "#FF7A50", onAccent: "#2A0D00", accentSoft: "rgba(118,118,128,0.24)",
  accentTint: "rgba(255,122,80,0.2)",
  hero: "#1C1C1E", onHero: "#FFFFFF", heroMuted: "rgba(235,235,245,0.60)", heroAccent: "#FF7A50",
  onHeroSoft: "rgba(118,118,128,0.24)", success: "#30D158", warning: "#FFD60A",
  error: "#FF453A", errorSoft: "#301412", focus: "#FF7A50", overlay: "rgba(0,0,0,0.6)",
  skeleton: "#2C2C2E", shadow: "#000000", tint: "rgba(118,118,128,0.24)",
  tabBar: "#0C0C0C", tabBarBorder: "rgba(84,84,88,0.5)",
};

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 40 } as const;
export const radii = { sm: 10, md: 14, lg: 20, xl: 24, full: 999 } as const;
export const touch = { min: 44, comfortable: 50 } as const;
export const contentWidth = 660;
// Leaving fontFamily unset selects SF Pro on iOS and the system face elsewhere.
const system = undefined;
export const fonts = { regular: system, semibold: system, bold: system, display: system, displaySemibold: system } as const;
const tabular: TextStyle["fontVariant"] = ["tabular-nums"];
export const typography = {
  display: { fontFamily: system, fontWeight: "700", fontSize: 34, lineHeight: 41 },
  title: { fontFamily: system, fontWeight: "700", fontSize: 28, lineHeight: 34 },
  navTitle: { fontFamily: system, fontWeight: "600", fontSize: 17, lineHeight: 22 },
  heading: { fontFamily: system, fontWeight: "700", fontSize: 22, lineHeight: 28 },
  subheading: { fontFamily: system, fontWeight: "600", fontSize: 20, lineHeight: 25 },
  body: { fontFamily: system, fontWeight: "400", fontSize: 17, lineHeight: 22 },
  label: { fontFamily: system, fontWeight: "600", fontSize: 17, lineHeight: 22 },
  small: { fontFamily: system, fontWeight: "400", fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: system, fontWeight: "400", fontSize: 13, lineHeight: 18 },
  caption2: { fontFamily: system, fontWeight: "600", fontSize: 11, lineHeight: 13 },
  callout: { fontFamily: system, fontWeight: "400", fontSize: 16, lineHeight: 21 },
  cardTitle: { fontFamily: system, fontWeight: "600", fontSize: 15, lineHeight: 20 },
  numeric: { fontFamily: system, fontWeight: "700", fontSize: 34, lineHeight: 41, fontVariant: tabular },
  numericSmall: { fontFamily: system, fontWeight: "600", fontSize: 20, lineHeight: 25, fontVariant: tabular },
} satisfies Record<string, TextStyle>;
export type TypeKind = keyof typeof typography;
export const elevation = {
  none: {}, card: {}, raised: {},
  overlay: { shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.2, shadowRadius: 34, elevation: 14 },
} satisfies Record<string, ViewStyle>;

export const motion = {
  /** Press feedback: press in fast, release a little slower. */
  fast: 120,
  pressOut: 160,
  base: 200,
  slow: 320,
  pressScale: 0.97,
} as const;

/** Brand-mark colours (match scripts/brand-geometry.mjs palettes; asserted in lib/theme.test.ts). */
export const markColors = {
  light: { stone: hafa.reef, stoneDeep: workouts.reefDeep, accent: workouts.sunrise },
  dark: { stone: hafa.reefBright, stoneDeep: "#1D6F65", accent: workouts.sunriseNight },
} as const;

export const theme = { light, dark, hafa, workouts, spacing, radii, typography, elevation, motion, fonts, touch, contentWidth, markColors };
