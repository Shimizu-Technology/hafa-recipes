/**
 * Håfa Workouts design tokens.
 *
 * One Håfa family: the shared warm neutrals and reef green come straight from
 * Håfa Recipes (`mobile/constants/Colors.ts` → `brand`), and Workouts adds a
 * sunrise-coral accent for energy. Light is the primary design; dark follows
 * the system setting.
 *
 * This is the ONLY file in workouts-mobile that may contain raw hex colours
 * (enforced by lib/theme.test.ts). Screens use semantic tokens via useTheme()
 * or useColors().
 */
import type { TextStyle, ViewStyle } from "react-native";

/** Values shared with Håfa Recipes. Must stay identical to mobile/constants/Colors.ts `brand`. */
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
};

export const light: ColorTokens = {
  background: hafa.cream,
  surface: "#FFFCF7",
  elevated: "#FFFFFF",
  sunken: hafa.bone,
  text: hafa.ink,
  muted: "#6D5D50",
  border: hafa.border,
  borderStrong: "#8F7D6D",
  action: hafa.reef,
  onAction: hafa.cream,
  actionSoft: hafa.reefLight,
  onActionSoft: hafa.reef,
  accent: workouts.sunrise,
  accentText: workouts.ember,
  onAccent: hafa.ink,
  accentSoft: workouts.sunriseSoft,
  hero: hafa.reef,
  onHero: hafa.cream,
  heroMuted: "#C9E6DF",
  heroAccent: "#FFB596",
  onHeroSoft: "rgba(255, 247, 236, 0.16)",
  success: "#3F6B33",
  warning: "#8A5A00",
  error: "#B3261E",
  errorSoft: "#FBE3DE",
  focus: hafa.reefBright,
  overlay: "rgba(23, 18, 14, 0.42)",
  skeleton: hafa.parchment,
  shadow: "#0B3E38",
  tint: hafa.reefLight,
};

export const dark: ColorTokens = {
  background: "#101411",
  surface: "#1A201C",
  elevated: "#242C26",
  sunken: "#151A17",
  text: "#F8F0E7",
  muted: "#B8AEA2",
  border: "#2D352F",
  borderStrong: "#6A7A70",
  action: hafa.reefHighlight,
  onAction: "#0B2420",
  actionSoft: "#1E3A35",
  onActionSoft: "#8CD8CC",
  accent: workouts.sunriseNight,
  accentText: workouts.sunriseNight,
  onAccent: hafa.ink,
  accentSoft: workouts.sunriseSoftNight,
  hero: workouts.reefNight,
  onHero: "#F8F0E7",
  heroMuted: "#C9E6DF",
  heroAccent: "#FFB596",
  onHeroSoft: "rgba(248, 240, 231, 0.14)",
  success: "#86B875",
  warning: hafa.banana,
  error: "#F07167",
  errorSoft: "#3A1F1C",
  focus: hafa.reefHighlight,
  overlay: "rgba(0, 0, 0, 0.6)",
  skeleton: "#242C26",
  shadow: "#000000",
  tint: "#1E3A35",
};

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radii = { sm: 8, md: 14, lg: 20, xl: 28, full: 999 } as const;
/** Minimum comfortable touch target (pt). */
export const touch = { min: 48, comfortable: 56 } as const;
/** Max readable content width on tablets/web. */
export const contentWidth = 660;

export const fonts = {
  regular: "DMSans_400Regular",
  semibold: "DMSans_600SemiBold",
  bold: "DMSans_700Bold",
} as const;

const tabular: TextStyle["fontVariant"] = ["tabular-nums"];
export const typography = {
  display: { fontFamily: fonts.bold, fontSize: 38, lineHeight: 44, letterSpacing: -1.1 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  heading: { fontFamily: fonts.bold, fontSize: 21, lineHeight: 27, letterSpacing: -0.3 },
  subheading: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, letterSpacing: -0.1 },
  body: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 25 },
  label: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  /** Big numbers: reps, weight, timers. Tabular so digits don't jump. */
  numeric: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -0.6, fontVariant: tabular },
  numericSmall: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, fontVariant: tabular },
} satisfies Record<string, TextStyle>;
export type TypeKind = keyof typeof typography;

export const elevation = {
  none: {},
  card: { shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.07, shadowRadius: 16, elevation: 2 },
  raised: { shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.12, shadowRadius: 22, elevation: 6 },
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
