/** Athletic: condensed training type, cream light ground and tonal dark surfaces. */
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
  /** Selected segment of a segmented control, raised off its tonal track. */
  segment: string;
};

// Structural actions stay neutral; coral is reserved for Start and Add.
export const light: ColorTokens = {
  onImage: "#FFFFFF", imageOverlay: "rgba(0,0,0,0.6)",
  background: "#FFF7EC", groupedBackground: "#FFF7EC", surface: "#FFFFFF", elevated: "#FFFFFF",
  surface2: "#F0EFED", sunken: "#F0EFED", text: "#17120F", muted: "#626166",
  secondaryLabel: "#626166", tertiaryLabel: "#626166", border: "#D7D0C9", borderStrong: "#81767C",
  action: "#17120F", onAction: "#FFF7EC", actionSoft: "#F0EFED", onActionSoft: "#17120F",
  accent: "#B63E18", accentText: "#17120F", onAccent: "#FFFFFF", accentSoft: "#F5E5DC", accentTint: "#F5E5DC",
  hero: "#FFFFFF", onHero: "#17120F", heroMuted: "#626166", heroAccent: "#B63E18", onHeroSoft: "#F0EFED",
  success: "#22673B", dataSuccess: "#22673B", warning: "#735019", error: "#A52222", destructive: "#A52222", errorSoft: "#FCE9E6",
  focus: "#B63E18", overlay: "rgba(0,0,0,0.42)", skeleton: "#F0EFED", shadow: "#000000", tint: "#F0EFED",
  tabBar: "#FFF7EC", tabBarBorder: "#DED7CF", segment: "#FFFFFF",
};
export const dark: ColorTokens = {
  onImage: "#FFFFFF", imageOverlay: "rgba(0,0,0,0.6)",
  background: "#0B0B0C", groupedBackground: "#0B0B0C", surface: "#161618", elevated: "#161618",
  surface2: "#222225", sunken: "#222225", text: "#F5F5F2", muted: "#B1B1B8",
  secondaryLabel: "#B1B1B8", tertiaryLabel: "#B1B1B8", border: "#454247", borderStrong: "#A39BA0",
  action: "#F5F5F2", onAction: "#0B0B0C", actionSoft: "#222225", onActionSoft: "#F5F5F2",
  accent: "#FF7A50", accentText: "#F5F5F2", onAccent: "#17120F", accentSoft: "#30241F", accentTint: "#30241F",
  hero: "#161618", onHero: "#F5F5F2", heroMuted: "#B1B1B8", heroAccent: "#FF7A50", onHeroSoft: "#222225",
  success: "#83D7A3", dataSuccess: "#83D7A3", warning: "#EDC784", error: "#FFB2A7", destructive: "#FFB2A7", errorSoft: "#3C2024",
  focus: "#FF7A50", overlay: "rgba(0,0,0,0.6)", skeleton: "#222225", shadow: "#000000", tint: "#222225",
  tabBar: "#161618", tabBarBorder: "#39363B", segment: "#161618",
};

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 40 } as const;
export const radii = { sm: 8, md: 12, lg: 20, xl: 24, full: 999 } as const;
export const touch = { min: 44, comfortable: 50 } as const;
export const contentWidth = 660;
export const fonts = {
  regular: "Inter_400Regular", semibold: "Inter_600SemiBold", bold: "Inter_700Bold",
  display: "BarlowCondensed_700Bold", displaySemibold: "BarlowCondensed_700Bold",
} as const;
const tabular: TextStyle["fontVariant"] = ["tabular-nums"];
export const typography = {
  display: { fontFamily: fonts.display, fontWeight: "400", fontSize: 34, lineHeight: 41 },
  title: { fontFamily: fonts.display, fontWeight: "400", fontSize: 28, lineHeight: 34 },
  navTitle: { fontFamily: fonts.semibold, fontWeight: "400", fontSize: 17, lineHeight: 22 },
  heading: { fontFamily: fonts.display, fontWeight: "400", fontSize: 22, lineHeight: 28 },
  subheading: { fontFamily: fonts.display, fontWeight: "400", fontSize: 20, lineHeight: 25 },
  body: { fontFamily: fonts.regular, fontWeight: "400", fontSize: 17, lineHeight: 22 },
  label: { fontFamily: fonts.semibold, fontWeight: "400", fontSize: 17, lineHeight: 22 },
  small: { fontFamily: fonts.regular, fontWeight: "400", fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontWeight: "400", fontSize: 13, lineHeight: 18 },
  caption2: { fontFamily: fonts.semibold, fontWeight: "400", fontSize: 11, lineHeight: 13 },
  callout: { fontFamily: fonts.regular, fontWeight: "400", fontSize: 16, lineHeight: 21 },
  cardTitle: { fontFamily: fonts.display, fontWeight: "400", fontSize: 15, lineHeight: 20 },
  numeric: { fontFamily: fonts.display, fontWeight: "400", fontSize: 34, lineHeight: 41, fontVariant: tabular },
  numericSmall: { fontFamily: fonts.display, fontWeight: "400", fontSize: 20, lineHeight: 25, fontVariant: tabular },
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
