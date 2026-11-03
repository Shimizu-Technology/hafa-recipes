/**
 * Design preview "looks": three candidate designs for Håfa Baby that Leon and Kami can compare on a phone before
 * one is chosen. `current` is the shipped design and must render exactly as `main` does. Production builds never
 * offer the switcher and always use `current`.
 *
 * Pure data and helpers only (no React Native), so the gate, persistence parsing, deep link and tokens are unit tested.
 */
import type { TextStyle } from "react-native";

export const LOOK_IDS = ["current", "soft", "scrapbook", "warm"] as const;
export type LookId = (typeof LOOK_IDS)[number];
export const LOOK_STORAGE_KEY = "@hafa/look-preview";

export function isLookId(value: unknown): value is LookId {
  return typeof value === "string" && (LOOK_IDS as readonly string[]).includes(value);
}

/** The switcher, the deep link and stored choices exist only outside production builds. */
export function lookPreviewEnabled(appEnvironment: string | undefined) {
  return appEnvironment !== "production";
}

/** What to render: a stored or linked look when previews are allowed, otherwise the shipped design. */
export function resolveLook(stored: unknown, enabled: boolean): LookId {
  return enabled && isLookId(stored) ? stored : "current";
}

/**
 * `hafababy://design-preview?look=<id>`; `look=current` resets. Returns null for any other link or an unknown look,
 * so ordinary links (sign-in callbacks, shares) are never mistaken for a preview switch.
 */
export function parseLookLink(url: string | null | undefined): LookId | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const path = (parsed.hostname + parsed.pathname).replace(/^\/+|\/+$/g, "");
    if (parsed.protocol !== "hafababy:" || path !== "design-preview") return null;
    const look = parsed.searchParams.get("look");
    return isLookId(look) ? look : null;
  } catch {
    return null;
  }
}

export interface Palette {
  background: string; groupedBackground: string; surface: string; soft: string; tile: string; hero: string;
  text: string; muted: string; action: string; onAction: string; border: string; outline: string;
  accent: string; accentText: string; error: string; errorBg: string; accentTint: string; scrim: string;
  tabBar: string; tabBarBorder: string; headerFill: string;
  /** Selected tab backing (pill, tint or tape) and its icon/label ink. */
  tabIndicator: string; tabInk: string;
  /** The centre Add: the one accent-filled object in the bar. */
  addFill: string; onAdd: string;
  /** A hairline around cards and header buttons; transparent where the look uses tonal fills instead. */
  cardBorder: string;
  /** Pregnancy progress bar or arc. */
  progressTrack: string; progressFill: string;
  /** Source tile without a thumbnail. */
  placeholder: string; placeholderInk: string;
  /** Muted topic colours: `wash` behind dark ink, `fill` for tape, icons and decoration only. */
  topics: { wash: string; fill: string; ink: string }[];
  /** Print frame around photos (Scrapbook): white by day, warm bone at night so it never glares. */
  frame: string;
}

/** Baby's warm light palette and neutral, true-black dark palette (main, unchanged). */
const currentLight: Palette = {
  background: "#FFFFFF", groupedBackground: "#F2F2F7", surface: "#FAF7F4",
  soft: "#F1E8E1", tile: "#F6EFE9", hero: "#F6EFE9",
  text: "#2D2420", muted: "#6E625B", action: "#5A4740", onAction: "#F8F3EE",
  border: "rgba(60,60,67,0.29)", outline: "rgba(60,60,67,0.29)",
  accent: "#C9907E", accentText: "#8C5443", error: "#B3261E", errorBg: "#FBE3DE",
  // Tonal fill behind a selected text link; accentText on it stays ≥4.5:1.
  accentTint: "rgba(201,144,126,0.2)",
  scrim: "rgba(45,36,32,0.42)",
  // JS-drawn chrome: the same solid bar and tonal header buttons on iOS 18, iOS 26 and Android.
  tabBar: "#FFFFFF", tabBarBorder: "rgba(60,60,67,0.18)", headerFill: "rgba(118,118,128,0.12)",
  tabIndicator: "rgba(201,144,126,0.2)", tabInk: "#5A4740", addFill: "#5A4740", onAdd: "#F8F3EE",
  cardBorder: "transparent", progressTrack: "#F1E8E1", progressFill: "#5A4740",
  placeholder: "#F6EFE9", placeholderInk: "#5A4740", frame: "#FFFFFF", topics: [],
};
const currentDark: Palette = {
  background: "#000000", groupedBackground: "#000000", surface: "#1C1C1E",
  soft: "#2C2522", tile: "#2A2320", hero: "#2A2320",
  text: "#FFFFFF", muted: "rgba(235,235,245,0.60)", action: "#E3C9B8", onAction: "#2D2420",
  border: "rgba(84,84,88,0.65)", outline: "rgba(84,84,88,0.65)",
  accent: "#E3C9B8", accentText: "#E3C9B8", error: "#FF5148", errorBg: "#3A1F1C",
  accentTint: "rgba(227,201,184,0.2)",
  scrim: "rgba(0,0,0,0.6)",
  tabBar: "#0C0C0C", tabBarBorder: "rgba(84,84,88,0.5)", headerFill: "rgba(118,118,128,0.24)",
  tabIndicator: "rgba(227,201,184,0.2)", tabInk: "#E3C9B8", addFill: "#E3C9B8", onAdd: "#2D2420",
  cardBorder: "transparent", progressTrack: "#2C2522", progressFill: "#E3C9B8",
  placeholder: "#2A2320", placeholderInk: "#E3C9B8", frame: "#FFFFFF", topics: [],
};

/** Kami's Sand & Cocoa. Every look keeps sand behind the whole app (it is also the splash) and cocoa for actions. */
export const sand = "#F8F3EE", cocoa = "#5A4740", clay = "#C9907E", deepClay = "#9A5744", darkGround = "#14110F";

/** Topic washes for light mode: dark ink on every wash is ≥ 11:1; `fill` is decoration (tape, icon chips). */
const topicsLight = [
  { wash: "#F4E4DD", fill: "#C9907E", ink: "#8E4F3D" }, // clay
  { wash: "#E7ECE4", fill: "#A9B8A5", ink: "#4D6349" }, // sage
  { wash: "#F8EEDA", fill: "#E8CF9C", ink: "#7A5A1F" }, // butter
  { wash: "#E4ECF1", fill: "#A9C1CF", ink: "#3F5C6E" }, // sky
  { wash: "#EEE9F3", fill: "#C7B8D6", ink: "#5E4B73" }, // lilac
];
const topicsDark = [
  { wash: "#3A2822", fill: "#9C6B5C", ink: "#E6B7A6" },
  { wash: "#262C24", fill: "#6E7D6A", ink: "#C3D0BF" },
  { wash: "#362E1E", fill: "#9C8A5E", ink: "#EBD5A6" },
  { wash: "#222B31", fill: "#647C8A", ink: "#BCD0DC" },
  { wash: "#2C2733", fill: "#7E708F", ink: "#D4C8E2" },
];

const softLight: Palette = {
  background: sand, groupedBackground: sand, surface: "#FFFFFF", soft: "#EFE5DC", tile: "#F3E9E1", hero: "#F1DDD3",
  text: cocoa, muted: "#725F56", action: cocoa, onAction: sand,
  border: "rgba(90,71,64,0.14)", outline: "rgba(90,71,64,0.24)",
  accent: clay, accentText: "#8E4F3D", error: "#B3261E", errorBg: "#FBE3DE", accentTint: "#F1DDD3",
  scrim: "rgba(45,36,32,0.42)", tabBar: "#FFFDFB", tabBarBorder: "#EADFD2", headerFill: "#EFE5DC",
  tabIndicator: "#F1DDD3", tabInk: cocoa, addFill: deepClay, onAdd: "#FFFFFF",
  cardBorder: "transparent", progressTrack: "rgba(154,87,68,0.16)", progressFill: deepClay,
  placeholder: "#F1DDD3", placeholderInk: "#8E4F3D", frame: "#FFFFFF", topics: topicsLight,
};
const softDark: Palette = {
  background: darkGround, groupedBackground: darkGround, surface: "#221B18", soft: "#2E2522", tile: "#2A221F", hero: "#33251F",
  text: "#F3E9E2", muted: "#B5A39A", action: "#EBD7CA", onAction: "#2D2420",
  border: "rgba(243,233,226,0.12)", outline: "rgba(243,233,226,0.22)",
  accent: "#E0A894", accentText: "#E0A894", error: "#FF6B61", errorBg: "#3A1F1C", accentTint: "#3A2A23",
  scrim: "rgba(0,0,0,0.6)", tabBar: "#1C1714", tabBarBorder: "#2E2622", headerFill: "#2A221F",
  tabIndicator: "#3A2A23", tabInk: "#F3E9E2", addFill: "#E0A894", onAdd: "#2A1B16",
  cardBorder: "transparent", progressTrack: "rgba(224,168,148,0.2)", progressFill: "#E0A894",
  placeholder: "#33251F", placeholderInk: "#E0A894", frame: "#D6CAC0", topics: topicsDark,
};
const scrapbookLight: Palette = {
  background: sand, groupedBackground: sand, surface: "#FFFDF9", soft: "#F1E9DF", tile: "#F3ECE3", hero: "#FFFDF9",
  text: "#3F302A", muted: "#725F56", action: cocoa, onAction: "#FBF7F0",
  border: "rgba(90,71,64,0.14)", outline: "#E3D6C8",
  accent: clay, accentText: "#8E4F3D", error: "#B3261E", errorBg: "#FBE3DE", accentTint: "rgba(240,217,168,0.55)",
  scrim: "rgba(45,36,32,0.42)", tabBar: sand, tabBarBorder: "#CDBBAA", headerFill: "#FFFDF9",
  tabIndicator: "#E2B9A6", tabInk: "#3F302A", addFill: cocoa, onAdd: "#FBF7F0",
  cardBorder: "#E6D9CC", progressTrack: "#F0D9A8", progressFill: "#3F302A",
  placeholder: "#F3ECE3", placeholderInk: "#5A4740", frame: "#FFFFFF", topics: topicsLight,
};
const scrapbookDark: Palette = {
  background: darkGround, groupedBackground: darkGround, surface: "#231D1A", soft: "#2E2622", tile: "#2A231F", hero: "#231D1A",
  text: "#F3E9E2", muted: "#B5A39A", action: "#EBD7CA", onAction: "#2D2420",
  border: "rgba(243,233,226,0.12)", outline: "#3A302B",
  accent: "#E0A894", accentText: "#E0A894", error: "#FF6B61", errorBg: "#3A1F1C", accentTint: "rgba(165,143,94,0.3)",
  scrim: "rgba(0,0,0,0.6)", tabBar: darkGround, tabBarBorder: "#4A3E37", headerFill: "#231D1A",
  tabIndicator: "#9C6B5C", tabInk: "#F3E9E2", addFill: "#EBD7CA", onAdd: "#2D2420",
  cardBorder: "#3A302B", progressTrack: "#5A4D35", progressFill: "#F3E9E2",
  placeholder: "#2A231F", placeholderInk: "#E0A894", frame: "#D6CAC0", topics: topicsDark,
};
const warmLight: Palette = {
  background: sand, groupedBackground: sand, surface: "#FFFFFF", soft: "#F1E8E0", tile: "#F3EBE3", hero: "#FFFFFF",
  text: "#2E2420", muted: "#75625A", action: cocoa, onAction: sand,
  border: "rgba(46,36,32,0.10)", outline: "rgba(46,36,32,0.18)",
  accent: clay, accentText: "#8E4F3D", error: "#B3261E", errorBg: "#FBE3DE", accentTint: "rgba(201,144,126,0.22)",
  scrim: "rgba(45,36,32,0.42)", tabBar: "#FFFFFF", tabBarBorder: "#EADFD2", headerFill: "#FFFFFF",
  tabIndicator: "#F3E3DD", tabInk: "#2E2420", addFill: deepClay, onAdd: "#FFFFFF",
  cardBorder: "transparent", progressTrack: "#F1E4DC", progressFill: deepClay,
  placeholder: "#F3EBE3", placeholderInk: "#8E4F3D", frame: "#FFFFFF", topics: topicsLight,
};
const warmDark: Palette = {
  background: darkGround, groupedBackground: darkGround, surface: "#221B18", soft: "#2E2522", tile: "#2A221F", hero: "#221B18",
  text: "#F3E9E2", muted: "#B5A39A", action: "#EBD7CA", onAction: "#2D2420",
  border: "rgba(243,233,226,0.10)", outline: "rgba(243,233,226,0.2)",
  accent: "#E0A894", accentText: "#E0A894", error: "#FF6B61", errorBg: "#3A1F1C", accentTint: "rgba(224,168,148,0.18)",
  scrim: "rgba(0,0,0,0.6)", tabBar: "#1C1714", tabBarBorder: "#2E2622", headerFill: "#221B18",
  tabIndicator: "#3A2A23", tabInk: "#F3E9E2", addFill: "#E0A894", onAdd: "#2A1B16",
  cardBorder: "transparent", progressTrack: "#33281F", progressFill: "#E0A894",
  placeholder: "#2A221F", placeholderInk: "#E0A894", frame: "#D6CAC0", topics: topicsDark,
};

export type LookWeight = "regular" | "medium" | "semibold" | "bold";
/** Font families by role. `current` keeps the system face and weights; looks name one family per weight. */
export interface LookFonts {
  system: boolean;
  display: string;
  displayItalic?: string;
  ui: { regular: string; medium: string; semibold: string; bold: string };
  /** Handwriting, only for captions of 20pt and larger. */
  hand?: string;
  /** Large title in the native header. */
  largeTitle: { fontFamily: string; fontSize: number; fontWeight?: TextStyle["fontWeight"] };
}
export interface LookRadii {
  hero: number; card: number; grouped: number; row: number; field: number; notice: number; chip: number;
  header: number; button: number; thumb: number; tile: number; toast: number; composer: number; bubble: number;
}
export interface LookMotion {
  pressScale: number; pressOpacity: number; pressInMs: number; pressOutMs: number;
  /** Slide the selected tab backing; `false` keeps main's jump. */
  tabIndicator: false | { durationMs: number; dampingRatio: number };
  /** First-mount entrance for list rows (≤ 6 rows); `false` for none. */
  entrance: false | { durationMs: number; offset: number; staggerMs: number };
  /** Toast exit: main uses ease-in; looks use the strong ease-out. */
  toastExitEaseOut: boolean;
}
export interface LookVariants {
  tabBar: "current" | "pill" | "tape" | "tint";
  today: "current" | "soft" | "scrapbook" | "warm";
  /** Grouped lists: one inset surface, or separate paper clippings. */
  list: "grouped" | "clippings";
  placeholder: "glyph" | "monogram" | "stamp" | "topic";
  /** Leading row icon: bare glyph, or inside a tinted tile. */
  rowIcon: "plain" | "tile";
  /** Journal and doctor-question rows: kind icon, or a date block. */
  journalRow: "icon" | "date";
  detailHero: "none" | "soft" | "frame" | "band";
  chip: "current" | "soft" | "tag" | "ink";
}
export type TextRole = "title" | "heading" | "body" | "label" | "small";
export type LookText = Record<TextRole, { size: number; line: number; face: "display" | LookWeight }>;
export interface Look {
  id: LookId;
  /** Copy sizes for the looks; `current` keeps main's typeScale and never reads this. */
  text: LookText;
  label: string;
  description: string;
  palette: { light: Palette; dark: Palette };
  fonts: LookFonts;
  radii: LookRadii;
  density: { screen: number; card: number; section: number };
  shadow: null | { color: string; opacity: number; radius: number; y: number };
  motion: LookMotion;
  variants: LookVariants;
}

const systemFonts: LookFonts = {
  system: true, display: "System", ui: { regular: "System", medium: "System", semibold: "System", bold: "System" },
  largeTitle: { fontFamily: "System", fontSize: 34, fontWeight: "700" },
};
const dmSans = { regular: "DMSans_400Regular", medium: "DMSans_500Medium", semibold: "DMSans_600SemiBold", bold: "DMSans_700Bold" };
const lookText = (heading: [number, number], body: [number, number] = [17, 24]): LookText => ({
  title: { size: 32, line: 38, face: "display" }, heading: { size: heading[0], line: heading[1], face: "display" },
  body: { size: body[0], line: body[1], face: "regular" }, label: { size: 17, line: 23, face: "semibold" },
  small: { size: 14, line: 19, face: "regular" },
});
const crisp = { durationMs: 300, dampingRatio: 1 }, snappy = { durationMs: 300, dampingRatio: 0.85 };

export const LOOKS: Record<LookId, Look> = {
  current: {
    id: "current", label: "Current", description: "The design on main today.", text: lookText([20, 25], [17, 22]),
    palette: { light: currentLight, dark: currentDark }, fonts: systemFonts,
    radii: { hero: 20, card: 14, grouped: 12, row: 12, field: 10, notice: 16, chip: 17, header: 18, button: 999, thumb: 10, tile: 20, toast: 18, composer: 22, bubble: 20 },
    density: { screen: 16, card: 20, section: 20 }, shadow: null,
    motion: { pressScale: 0.97, pressOpacity: 0.82, pressInMs: 120, pressOutMs: 160, tabIndicator: false, entrance: false, toastExitEaseOut: false },
    variants: { tabBar: "current", today: "current", list: "grouped", placeholder: "glyph", rowIcon: "plain", journalRow: "icon", detailHero: "none", chip: "current" },
  },
  soft: {
    text: lookText([24, 30]),
    id: "soft", label: "1 · Soft", description: "Gentle and calm: Newsreader serif titles, blush tinted cards, a soft week bar on Today.",
    palette: { light: softLight, dark: softDark },
    fonts: { system: false, display: "Newsreader_500Medium", displayItalic: "Newsreader_500Medium_Italic", ui: dmSans,
      largeTitle: { fontFamily: "Newsreader_500Medium", fontSize: 36 } },
    radii: { hero: 28, card: 24, grouped: 22, row: 22, field: 16, notice: 20, chip: 18, header: 18, button: 999, thumb: 14, tile: 22, toast: 24, composer: 24, bubble: 22 },
    density: { screen: 16, card: 22, section: 26 }, shadow: null,
    motion: { pressScale: 0.98, pressOpacity: 0.88, pressInMs: 120, pressOutMs: 180, tabIndicator: crisp,
      entrance: { durationMs: 300, offset: 8, staggerMs: 40 }, toastExitEaseOut: true },
    variants: { tabBar: "pill", today: "soft", list: "grouped", placeholder: "monogram", rowIcon: "tile", journalRow: "date", detailHero: "soft", chip: "soft" },
  },
  scrapbook: {
    text: lookText([21, 28]),
    id: "scrapbook", label: "2 · Scrapbook", description: "A keepsake: saved tips as taped clippings, Young Serif titles, one pin-drop when you save.",
    palette: { light: scrapbookLight, dark: scrapbookDark },
    fonts: { system: false, display: "YoungSerif_400Regular", ui: dmSans, hand: "Caveat_600SemiBold",
      largeTitle: { fontFamily: "YoungSerif_400Regular", fontSize: 32 } },
    radii: { hero: 12, card: 12, grouped: 12, row: 12, field: 10, notice: 10, chip: 8, header: 10, button: 12, thumb: 3, tile: 12, toast: 12, composer: 14, bubble: 14 },
    density: { screen: 16, card: 20, section: 24 }, shadow: { color: "#5A4740", opacity: 0.08, radius: 8, y: 2 },
    motion: { pressScale: 0.98, pressOpacity: 0.88, pressInMs: 120, pressOutMs: 180, tabIndicator: crisp,
      entrance: { durationMs: 340, offset: 6, staggerMs: 40 }, toastExitEaseOut: true },
    variants: { tabBar: "tape", today: "scrapbook", list: "clippings", placeholder: "stamp", rowIcon: "plain", journalRow: "date", detailHero: "frame", chip: "tag" },
  },
  warm: {
    text: lookText([22, 28]),
    id: "warm", label: "3 · Warm", description: "Warm and modern: Fraunces headings, a pregnancy progress arc, muted topic colours.",
    palette: { light: warmLight, dark: warmDark },
    fonts: { system: false, display: "Fraunces_600SemiBold", ui: { regular: "PlusJakartaSans_400Regular", medium: "PlusJakartaSans_500Medium",
      semibold: "PlusJakartaSans_600SemiBold", bold: "PlusJakartaSans_700Bold" },
      largeTitle: { fontFamily: "Fraunces_600SemiBold", fontSize: 34 } },
    radii: { hero: 24, card: 20, grouped: 20, row: 20, field: 14, notice: 16, chip: 18, header: 18, button: 16, thumb: 12, tile: 20, toast: 20, composer: 22, bubble: 20 },
    density: { screen: 16, card: 20, section: 24 }, shadow: { color: "#5A4740", opacity: 0.07, radius: 16, y: 6 },
    motion: { pressScale: 0.97, pressOpacity: 0.85, pressInMs: 100, pressOutMs: 160, tabIndicator: snappy,
      entrance: { durationMs: 280, offset: 10, staggerMs: 50 }, toastExitEaseOut: true },
    variants: { tabBar: "tint", today: "warm", list: "grouped", placeholder: "topic", rowIcon: "tile", journalRow: "date", detailHero: "band", chip: "ink" },
  },
};

const systemWeight: Record<LookWeight, TextStyle["fontWeight"]> = { regular: "400", medium: "500", semibold: "600", bold: "700" };
/** A UI face: the system font at a weight in `current`, or the look's family for that weight. */
export function uiFace(look: Look, weight: LookWeight): Pick<TextStyle, "fontFamily" | "fontWeight"> {
  return look.fonts.system ? { fontFamily: "System", fontWeight: systemWeight[weight] } : { fontFamily: look.fonts.ui[weight] };
}
/** The display face for titles and numerals. */
export function displayFace(look: Look, italic = false): Pick<TextStyle, "fontFamily" | "fontWeight"> {
  if (look.fonts.system) return { fontFamily: "System", fontWeight: "700" };
  return { fontFamily: italic && look.fonts.displayItalic ? look.fonts.displayItalic : look.fonts.display };
}

/** A stable topic colour for a topic name, so the same topic always wears the same tint. */
export function topicIndex(topic: string, count: number) {
  if (!count) return 0;
  let hash = 0;
  for (const char of topic.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % count;
}
