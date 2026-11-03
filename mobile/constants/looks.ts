/**
 * Design-preview looks (non-production builds only). `current` is `main` exactly; the other
 * three restyle the same screens through these tokens so Leon can compare them side by side.
 */
import Colors from '@/constants/Colors';

export const LOOK_IDS = ['current', 'cookbook', 'island', 'calm'] as const;
export type LookId = typeof LOOK_IDS[number];

export const isLookId = (value: unknown): value is LookId =>
  typeof value === 'string' && (LOOK_IDS as readonly string[]).includes(value);

/** Values every palette adds on top of the base `Colors` keys. */
type LookExtras = {
  dark: boolean;
  /** Decorative 1pt rules between sections and around sheets. */
  hairline: string;
  /** Filled ink object (selected chip, Cookbook Ask pill) and the text on it. */
  ink: string;
  onInk: string;
  /** Accent glyph on an ink fill (the Cookbook Ask sparkle). */
  onInkAccent: string;
  /** Solid circle behind header buttons over a photo. */
  photoButton: string;
  /** Fallback tile for a recipe with no photo, and the type set on it. */
  placeholder: string;
  placeholderInk: string;
  /** Small warm highlight (Island sun); never used for body text on light grounds. */
  highlight: string;
  /** Text over a darkened photo scrim or the deep-reef band. */
  onPhoto: string;
};

export type LookPalette = typeof Colors.light & LookExtras;

export type LookFonts = {
  /** Body/UI weights; null keeps the system face. */
  ui: { regular: string; medium: string; semibold: string; bold: string } | null;
  /** Screen titles, section heads (replaces `fontFamily.display`). */
  display: string;
  /** Recipe title on detail and Cook mode. */
  detailTitle: string;
  /** Recipe and collection card titles. */
  cardTitle: string;
  /** Cooking step numerals. */
  numeral: string;
};

export type LookVariants = {
  tabBar: 'current' | 'cookbook' | 'dock' | 'calm';
  askPill: 'accent' | 'ink' | 'surface';
  segmented: 'current' | 'underline' | 'pill';
  chip: 'current' | 'outline' | 'tonal';
  card: 'current' | 'flat' | 'raised' | 'sheet';
  placeholder: 'current' | 'type' | 'monogram' | 'quiet';
  hero: 'current' | 'flush' | 'sheet';
  /** The Library "today" moment. */
  home: 'none' | 'lead' | 'feature' | 'continue';
  /** Start cooking area on recipe detail. */
  startBand: boolean;
  /** Cook mode current-step treatment. */
  cookFocus: 'current' | 'numeral' | 'dimmed';
};

export type LookMotion = {
  press: { scale: number; inMs: number; outMs: number; opacity: number };
  entrance: { duration: number; stagger: number; offset: number; max: number };
  /** Tab/segment indicator spring (Reanimated duration mode). */
  indicator: { duration: number; dampingRatio: number };
  signature: 'none' | 'detail-fade-strike' | 'card-stagger-save-pop' | 'cook-crossfade-all-ticked';
};

export type Look = {
  id: LookId;
  label: string;
  description: string;
  palette: { light: LookPalette; dark: LookPalette };
  fonts: LookFonts | null;
  radii: { photo: number; card: number; button: number; chip: number; field: number; sheet: number; tile: number };
  density: { margin: number; gridGap: number; section: number };
  shadows: { card: object | null; float: object };
  variants: LookVariants;
  motion: LookMotion;
};

// Palettes build on first read, so importing this module never touches `Colors` at load time.
const palettes: Partial<Record<LookId, Look['palette']>> = {};
function memo(id: LookId, build: () => Look['palette']) {
  return (palettes[id] ??= build());
}

const CURRENT_MOTION: LookMotion = {
  press: { scale: 0.97, inMs: 120, outMs: 160, opacity: 0.85 },
  entrance: { duration: 200, stagger: 40, offset: 8, max: 8 },
  indicator: { duration: 0, dampingRatio: 1 },
  signature: 'none',
};

const current: Look = {
  id: 'current',
  label: 'Current',
  description: 'What ships on main today.',
  get palette() { return memo('current', () => ({
    light: { ...Colors.light, dark: false, hairline: Colors.light.chromeHairline, ink: Colors.light.tint, onInk: Colors.light.onTint, onInkAccent: Colors.light.onTint,
      photoButton: 'rgba(255,255,255,0.92)', placeholder: `${Colors.light.tint}15`, placeholderInk: Colors.light.actionText, highlight: Colors.light.tint, onPhoto: '#FFFFFF' },
    dark: { ...Colors.dark, dark: true, hairline: Colors.dark.chromeHairline, ink: Colors.dark.tint, onInk: Colors.dark.onTint, onInkAccent: Colors.dark.onTint,
      photoButton: 'rgba(28,28,30,0.92)', placeholder: `${Colors.dark.tint}15`, placeholderInk: Colors.dark.actionText, highlight: Colors.dark.tint, onPhoto: '#FFFFFF' },
  })); },
  fonts: null,
  radii: { photo: 14, card: 14, button: 9999, chip: 17, field: 12, sheet: 28, tile: 16 },
  density: { margin: 16, gridGap: 12, section: 24 },
  shadows: { card: null, float: { shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 6 } },
  variants: { tabBar: 'current', askPill: 'accent', segmented: 'current', chip: 'current', card: 'current', placeholder: 'current',
    hero: 'current', home: 'none', startBand: false, cookFocus: 'current' },
  motion: CURRENT_MOTION,
};

/** Shared dark-mode fill: a deep reef that carries white text (5.6:1) instead of neon mint. */
const DARK_REEF_FILL = '#1B7466';
const DARK_REEF_TEXT = '#8CCFBE';

function palette(base: Partial<LookPalette> & Pick<LookPalette, 'dark' | 'background' | 'text' | 'textSecondary' | 'tint' | 'actionText'>): LookPalette {
  const template = base.dark ? current.palette.dark : current.palette.light;
  return {
    ...template,
    secondaryLabel: base.textSecondary,
    textMuted: base.textSecondary,
    groupedBackground: base.background,
    accent: base.actionText,
    tabIconSelected: base.text,
    tabLabelSelected: base.text,
    tabIconDefault: base.textSecondary,
    onTint: '#FFFFFF',
    onPhoto: '#FFFFFF',
    cardBorder: 'transparent',
    ...base,
  } as LookPalette;
}

const cookbook: Look = {
  id: 'cookbook',
  label: '1 · Cookbook',
  description: 'Paper and ink, Fraunces titles, flat sections ruled by hairlines.',
  get palette() { return memo('cookbook', () => ({
    light: palette({
      dark: false, background: '#FAF6EF', backgroundSecondary: '#F3EDE2', backgroundElevated: '#FFFDF9', card: '#F3EDE2', cardBackground: '#F3EDE2',
      surface2: 'rgba(31,27,22,0.06)', text: '#1F1B16', textSecondary: '#6B6258', tertiaryLabel: 'rgba(31,27,22,0.32)',
      tint: '#17695B', actionText: '#17695B', accentSoft: 'rgba(23,105,91,0.08)', accentTint: 'rgba(23,105,91,0.10)',
      border: '#D9D0C1', borderLight: '#E6DFD3', hairline: '#E6DFD3', success: '#2F6B3A', warning: '#8A5A00', destructive: '#C4322A', error: '#B42318',
      shadowColor: '#1F1B16', chromeBar: '#FAF6EF', chromeHairline: '#E6DFD3', chromeIndicator: 'rgba(23,105,91,0.12)', chromeSegment: '#FFFDF9',
      ink: '#1F1B16', onInk: '#FAF6EF', onInkAccent: '#8CCFBE', photoButton: 'rgba(250,246,239,0.94)', placeholder: '#EFE7DA', placeholderInk: '#4A4239', highlight: '#17695B',
    }),
    dark: palette({
      dark: true, background: '#14110E', backgroundSecondary: '#1E1A16', backgroundElevated: '#1E1A16', card: '#1E1A16', cardBackground: '#1E1A16',
      surface2: 'rgba(242,237,228,0.08)', text: '#F2EDE4', textSecondary: '#A39A8E', tertiaryLabel: 'rgba(242,237,228,0.30)',
      tint: DARK_REEF_FILL, actionText: DARK_REEF_TEXT, accentSoft: 'rgba(140,207,190,0.10)', accentTint: 'rgba(140,207,190,0.14)',
      border: '#3A332B', borderLight: '#2B2620', hairline: '#2B2620', success: '#6FCF8E', onSuccess: '#14110E', warning: '#E8B04A', destructive: '#FF6B5E', error: '#FF7A6E', onError: '#14110E',
      chromeBar: '#14110E', chromeHairline: '#2B2620', chromeIndicator: 'rgba(140,207,190,0.16)', chromeSegment: '#2B2620',
      ink: '#F2EDE4', onInk: '#14110E', onInkAccent: '#17695B', photoButton: 'rgba(30,26,22,0.94)', placeholder: '#221D18', placeholderInk: '#CFC6B8', highlight: DARK_REEF_TEXT,
    }),
  })); },
  fonts: {
    ui: { regular: 'DMSans_400Regular', medium: 'DMSans_500Medium', semibold: 'DMSans_600SemiBold', bold: 'DMSans_700Bold' },
    display: 'Fraunces_600SemiBold', detailTitle: 'Fraunces_600SemiBold', cardTitle: 'Fraunces_500Medium', numeral: 'Fraunces_600SemiBold',
  },
  radii: { photo: 8, card: 8, button: 10, chip: 8, field: 10, sheet: 20, tile: 8 },
  density: { margin: 16, gridGap: 16, section: 32 },
  shadows: { card: null, float: { shadowColor: '#1F1B16', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.16, shadowRadius: 14, elevation: 6 } },
  variants: { tabBar: 'cookbook', askPill: 'ink', segmented: 'underline', chip: 'outline', card: 'flat', placeholder: 'type',
    hero: 'flush', home: 'lead', startBand: false, cookFocus: 'numeral' },
  motion: {
    press: { scale: 0.98, inMs: 100, outMs: 160, opacity: 0.85 },
    entrance: { duration: 280, stagger: 40, offset: 8, max: 6 },
    indicator: { duration: 300, dampingRatio: 1 },
    signature: 'detail-fade-strike',
  },
};

const island: Look = {
  id: 'island',
  label: '2 · Island',
  description: 'Warm sand, rounded photo cards, a floating dock and a reef band behind Start cooking.',
  get palette() { return memo('island', () => ({
    light: palette({
      dark: false, background: '#FBF5EC', backgroundSecondary: '#F3EADD', backgroundElevated: '#FFFFFF', card: '#FFFFFF', cardBackground: '#FFFFFF',
      surface2: 'rgba(42,33,24,0.06)', text: '#2A2118', textSecondary: '#6B6258', tertiaryLabel: 'rgba(42,33,24,0.32)',
      tint: '#0F5F57', actionText: '#0F5F57', accentSoft: 'rgba(15,95,87,0.08)', accentTint: 'rgba(15,95,87,0.10)',
      border: '#E8DDCD', borderLight: '#EFE6D8', hairline: '#EFE6D8', success: '#2F6B3A', warning: '#8A5A00', destructive: '#C4322A', error: '#B42318',
      shadowColor: '#2A2118', chromeBar: '#FFFFFF', chromeHairline: 'transparent', chromeIndicator: '#F3EADD', chromeSegment: '#FFFFFF',
      ink: '#2A2118', onInk: '#FFFFFF', onInkAccent: '#8CCFBE', photoButton: 'rgba(255,255,255,0.94)', placeholder: '#F3E6D3', placeholderInk: '#0F5F57', highlight: '#F2B84B',
    }),
    dark: palette({
      dark: true, background: '#12100D', backgroundSecondary: '#1D1A16', backgroundElevated: '#26221D', card: '#1D1A16', cardBackground: '#1D1A16',
      surface2: 'rgba(244,238,230,0.08)', text: '#F4EEE6', textSecondary: '#A69C90', tertiaryLabel: 'rgba(244,238,230,0.30)',
      tint: DARK_REEF_FILL, actionText: DARK_REEF_TEXT, accentSoft: 'rgba(140,207,190,0.10)', accentTint: 'rgba(140,207,190,0.14)',
      border: '#3A332B', borderLight: '#2B2620', hairline: '#2B2620', success: '#6FCF8E', onSuccess: '#12100D', warning: '#E8B04A', destructive: '#FF6B5E', error: '#FF7A6E', onError: '#12100D',
      shadowColor: '#000000', chromeBar: '#1D1A16', chromeHairline: 'transparent', chromeIndicator: '#2E2923', chromeSegment: '#3A342C',
      ink: '#F4EEE6', onInk: '#12100D', onInkAccent: '#17695B', photoButton: 'rgba(29,26,22,0.94)', placeholder: '#241F19', placeholderInk: DARK_REEF_TEXT, highlight: '#F2B84B',
    }),
  })); },
  fonts: {
    ui: { regular: 'PlusJakartaSans_400Regular', medium: 'PlusJakartaSans_500Medium', semibold: 'PlusJakartaSans_600SemiBold', bold: 'PlusJakartaSans_700Bold' },
    display: 'Fraunces_700Bold', detailTitle: 'Fraunces_700Bold', cardTitle: 'PlusJakartaSans_700Bold', numeral: 'Fraunces_700Bold',
  },
  radii: { photo: 24, card: 24, button: 18, chip: 17, field: 16, sheet: 28, tile: 24 },
  density: { margin: 16, gridGap: 12, section: 28 },
  shadows: {
    card: { shadowColor: '#2A2118', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 2 },
    float: { shadowColor: '#2A2118', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 16, elevation: 8 },
  },
  variants: { tabBar: 'dock', askPill: 'surface', segmented: 'pill', chip: 'tonal', card: 'raised', placeholder: 'monogram',
    hero: 'sheet', home: 'feature', startBand: true, cookFocus: 'numeral' },
  motion: {
    press: { scale: 0.97, inMs: 100, outMs: 160, opacity: 0.9 },
    entrance: { duration: 300, stagger: 50, offset: 12, max: 6 },
    indicator: { duration: 300, dampingRatio: 0.85 },
    signature: 'card-stagger-save-pop',
  },
};

const calm: Look = {
  id: 'calm',
  label: '3 · Calm',
  description: 'White sheets on a barely tinted page, Figtree on a strict 8pt rhythm.',
  get palette() { return memo('calm', () => ({
    light: palette({
      dark: false, background: '#F7F7F5', backgroundSecondary: '#FFFFFF', backgroundElevated: '#FFFFFF', card: '#FFFFFF', cardBackground: '#FFFFFF',
      surface2: 'rgba(34,34,34,0.05)', text: '#222222', textSecondary: '#6A6A66', tertiaryLabel: 'rgba(34,34,34,0.30)',
      tint: '#17695B', actionText: '#17695B', accentSoft: 'rgba(23,105,91,0.08)', accentTint: 'rgba(23,105,91,0.10)',
      border: '#DCDCD7', borderLight: '#E7E7E3', hairline: '#E7E7E3', success: '#2F6B3A', warning: '#8A5A00', destructive: '#C4322A', error: '#B42318',
      shadowColor: '#222222', chromeBar: '#FFFFFF', chromeHairline: '#E7E7E3', chromeIndicator: 'rgba(34,34,34,0.06)', chromeSegment: '#FFFFFF',
      ink: '#222222', onInk: '#FFFFFF', onInkAccent: '#8CCFBE', photoButton: 'rgba(255,255,255,0.96)', placeholder: '#EFEFEC', placeholderInk: '#55554F', highlight: '#17695B',
    }),
    dark: palette({
      dark: true, background: '#101211', backgroundSecondary: '#1A1D1C', backgroundElevated: '#1A1D1C', card: '#1A1D1C', cardBackground: '#1A1D1C',
      surface2: 'rgba(236,238,236,0.07)', text: '#ECEEEC', textSecondary: '#9BA19E', tertiaryLabel: 'rgba(236,238,236,0.30)',
      tint: DARK_REEF_FILL, actionText: DARK_REEF_TEXT, accentSoft: 'rgba(140,207,190,0.10)', accentTint: 'rgba(140,207,190,0.14)',
      border: '#353A38', borderLight: '#2A2E2C', hairline: '#2A2E2C', success: '#6FCF8E', onSuccess: '#101211', warning: '#E8B04A', destructive: '#FF6B5E', error: '#FF7A6E', onError: '#101211',
      chromeBar: '#1A1D1C', chromeHairline: '#2A2E2C', chromeIndicator: 'rgba(236,238,236,0.08)', chromeSegment: '#2A2E2C',
      ink: '#ECEEEC', onInk: '#101211', onInkAccent: '#17695B', photoButton: 'rgba(26,29,28,0.96)', placeholder: '#1F2321', placeholderInk: '#B4BAB7', highlight: DARK_REEF_TEXT,
    }),
  })); },
  fonts: {
    ui: { regular: 'Figtree_400Regular', medium: 'Figtree_500Medium', semibold: 'Figtree_600SemiBold', bold: 'Figtree_700Bold' },
    display: 'Figtree_700Bold', detailTitle: 'Fraunces_500Medium', cardTitle: 'Figtree_600SemiBold', numeral: 'Figtree_600SemiBold',
  },
  radii: { photo: 12, card: 16, button: 12, chip: 10, field: 10, sheet: 20, tile: 12 },
  density: { margin: 20, gridGap: 16, section: 32 },
  shadows: { card: null, float: { shadowColor: '#000000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.10, shadowRadius: 8, elevation: 3 } },
  variants: { tabBar: 'calm', askPill: 'surface', segmented: 'pill', chip: 'outline', card: 'sheet', placeholder: 'quiet',
    hero: 'flush', home: 'continue', startBand: false, cookFocus: 'dimmed' },
  motion: {
    press: { scale: 0.97, inMs: 100, outMs: 160, opacity: 0.85 },
    entrance: { duration: 150, stagger: 30, offset: 0, max: 6 },
    indicator: { duration: 300, dampingRatio: 1 },
    signature: 'cook-crossfade-all-ticked',
  },
};

export const LOOKS: Record<LookId, Look> = { current, cookbook, island, calm };

/** Fonts each look needs beyond the always-loaded Fraunces 600 (loaded on demand in non-production builds). */
export const LOOK_FONT_NAMES: Record<LookId, string[]> = {
  current: [],
  cookbook: ['DMSans_400Regular', 'DMSans_500Medium', 'DMSans_600SemiBold', 'DMSans_700Bold', 'Fraunces_500Medium'],
  island: ['PlusJakartaSans_400Regular', 'PlusJakartaSans_500Medium', 'PlusJakartaSans_600SemiBold', 'PlusJakartaSans_700Bold', 'Fraunces_700Bold'],
  calm: ['Figtree_400Regular', 'Figtree_500Medium', 'Figtree_600SemiBold', 'Figtree_700Bold', 'Fraunces_500Medium'],
};

/** The face for a style that asked for `System` (or nothing) at a given weight. */
export function uiFontFor(fonts: LookFonts | null, weight: unknown): string | undefined {
  if (!fonts?.ui) return undefined;
  const w = String(weight ?? '400');
  if (w === 'bold' || Number(w) >= 700) return fonts.ui.bold;
  if (Number(w) >= 600) return fonts.ui.semibold;
  if (Number(w) >= 500) return fonts.ui.medium;
  return fonts.ui.regular;
}

/** The base display face; other looks swap it for their own display voice. */
export const BASE_DISPLAY_FONT = 'Fraunces_600SemiBold';

/**
 * Map a flattened text style onto a look's faces. Custom font aliases carry one weight each, so the
 * weight moves into the family name and `fontWeight` resets. Explicit look faces pass through.
 */
export function lookTextFont(fonts: LookFonts | null, style: { fontFamily?: string; fontWeight?: unknown } | undefined) {
  if (!fonts) return null;
  const family = style?.fontFamily;
  if (family === BASE_DISPLAY_FONT) return { fontFamily: fonts.display, fontWeight: 'normal' as const };
  if (!family || family === 'System') {
    const ui = uiFontFor(fonts, style?.fontWeight);
    return ui ? { fontFamily: ui, fontWeight: 'normal' as const } : null;
  }
  return null;
}
