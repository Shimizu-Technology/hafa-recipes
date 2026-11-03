/**
 * Calm: white sheets on a barely tinted page, 1pt hairlines, Figtree type and one deep-reef accent.
 * Dark mode uses a tinted ground and a deep reef fill that carries white text (never neon mint).
 */

export const brand = {
  cream: '#F7F7F5', bone: '#FFFFFF', parchment: '#F7F7F5', ink: '#222222', charcoal: '#1A1D1C',
  clay: '#17695B', clayLight: 'rgba(34,34,34,0.05)',
  reef: '#17695B', reefMid: '#17695B', reefBright: '#17695B', reefHighlight: '#8CCFBE',
  reefLight: 'rgba(34,34,34,0.05)', herb: '#2F6B3A', banana: '#8A5A00',
  border: '#DCDCD7',
} as const;

const Colors = {
  light: {
    dark: false,
    text: '#222222', secondaryLabel: '#6A6A66', textSecondary: '#6A6A66', textMuted: '#6A6A66',
    tertiaryLabel: 'rgba(34,34,34,0.30)', background: '#F7F7F5', groupedBackground: '#F7F7F5',
    backgroundSecondary: '#FFFFFF', backgroundElevated: '#FFFFFF', surface2: 'rgba(34,34,34,0.05)',
    tint: '#17695B', onTint: '#FFFFFF', actionText: '#145E52', accent: '#145E52',
    accentSoft: 'rgba(23,105,91,0.08)', accentTint: 'rgba(23,105,91,0.10)', border: '#DCDCD7', borderLight: '#E7E7E3',
    tabIconDefault: '#6A6A66', tabIconSelected: '#222222', tabLabelSelected: '#222222',
    card: '#FFFFFF', cardBackground: '#FFFFFF', cardBorder: 'transparent',
    success: '#2F6B3A', onSuccess: '#FFFFFF', warning: '#8A5A00', destructive: '#C4322A', error: '#B42318', onError: '#FFFFFF', shadowColor: '#222222',
    chromeBar: '#FFFFFF', chromeHairline: '#E7E7E3', chromeIndicator: 'rgba(34,34,34,0.06)', chromeSegment: '#FFFFFF',
    /** 1pt rules between rows and around sheets. */
    hairline: '#E7E7E3',
    /** A filled neutral object (selected chip, user chat bubble) and the text on it. */
    ink: '#222222', onInk: '#FFFFFF',
    /** Solid circle behind header buttons over a photo. */
    photoButton: 'rgba(255,255,255,0.96)',
    /** The no-photo tile and the glyph on it. */
    placeholder: '#EFEFEC', placeholderInk: '#55554F',
    /** Text over a darkened photo. */
    onPhoto: '#FFFFFF',
  },
  dark: {
    dark: true,
    text: '#ECEEEC', secondaryLabel: '#9BA19E', textSecondary: '#9BA19E', textMuted: '#9BA19E',
    tertiaryLabel: 'rgba(236,238,236,0.30)', background: '#101211', groupedBackground: '#101211',
    backgroundSecondary: '#1A1D1C', backgroundElevated: '#1A1D1C', surface2: 'rgba(236,238,236,0.07)',
    tint: '#1B7466', onTint: '#FFFFFF', actionText: '#8CCFBE', accent: '#8CCFBE',
    accentSoft: 'rgba(140,207,190,0.10)', accentTint: 'rgba(140,207,190,0.14)', border: '#353A38', borderLight: '#2A2E2C',
    tabIconDefault: '#9BA19E', tabIconSelected: '#ECEEEC', tabLabelSelected: '#ECEEEC',
    card: '#1A1D1C', cardBackground: '#1A1D1C', cardBorder: 'transparent',
    success: '#6FCF8E', onSuccess: '#101211', warning: '#E8B04A', destructive: '#FF6B5E', error: '#FF7A6E', onError: '#101211', shadowColor: '#000000',
    chromeBar: '#1A1D1C', chromeHairline: '#2A2E2C', chromeIndicator: 'rgba(236,238,236,0.08)', chromeSegment: '#2A2E2C',
    hairline: '#2A2E2C',
    ink: '#ECEEEC', onInk: '#101211',
    photoButton: 'rgba(26,29,28,0.96)',
    placeholder: '#1F2321', placeholderInk: '#B4BAB7',
    onPhoto: '#FFFFFF',
  },
};

export default Colors;

export type ThemeColors = typeof Colors.light;
/** Colour tokens only (excludes the `dark` flag). */
export type ColorToken = { [K in keyof ThemeColors]: ThemeColors[K] extends string ? K : never }[keyof ThemeColors];

/** Page margin and grid gap on Calm's 8pt rhythm. */
export const layout = { margin: 20, gridGap: 16, section: 32 } as const;

// Spacing scale (for consistent spacing)
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
};

// Border radius scale
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  full: 9999,
};

// Font sizes
export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
  xxxl: 32,
};

// Font weights
export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

// Figtree for all UI. Fraunces 500 appears once per screen: the recipe title on detail and in Cook mode.
// Each weight is its own family; the shared Text resolves `fontWeight` to the matching face.
export const fontFamily = {
  regular: 'Figtree_400Regular', medium: 'Figtree_500Medium', semibold: 'Figtree_600SemiBold', bold: 'Figtree_700Bold',
  display: 'Figtree_700Bold', displaySemibold: 'Figtree_700Bold',
  recipeTitle: 'Fraunces_500Medium',
};

const FIGTREE_BY_WEIGHT = { 400: fontFamily.regular, 500: fontFamily.medium, 600: fontFamily.semibold, 700: fontFamily.bold } as const;

/**
 * The Figtree face for a style's family and weight. Custom faces carry one weight each, so the weight
 * moves into the family name and `fontWeight` resets. Other families (Fraunces, monospace) pass through.
 */
export function resolveFont(style: { fontFamily?: string; fontWeight?: unknown } | undefined): { fontFamily: string; fontWeight: 'normal' } | null {
  const family = style?.fontFamily;
  if (family && family !== 'System' && !family.startsWith('Figtree_')) {
    return family.startsWith('Fraunces_') && style?.fontWeight !== undefined ? { fontFamily: family, fontWeight: 'normal' } : null;
  }
  const raw = style?.fontWeight;
  if (raw === undefined) return family?.startsWith('Figtree_') ? null : { fontFamily: fontFamily.regular, fontWeight: 'normal' };
  // A named Figtree face is a floor: `display` with weight 600 stays bold, `regular` with 600 becomes semibold.
  const named = (Object.entries(FIGTREE_BY_WEIGHT).find(([, face]) => face === family)?.[0]) ?? 400;
  const weight = Math.max(Number(named), raw === 'bold' ? 700 : raw === 'normal' ? 400 : Number(raw) || 400);
  const face = weight >= 700 ? FIGTREE_BY_WEIGHT[700] : weight >= 600 ? FIGTREE_BY_WEIGHT[600] : weight >= 500 ? FIGTREE_BY_WEIGHT[500] : FIGTREE_BY_WEIGHT[400];
  return { fontFamily: face, fontWeight: 'normal' };
}

export const typography = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontFamily: fontFamily.display },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22 }, callout: { fontSize: 16, lineHeight: 21 },
  subhead: { fontSize: 15, lineHeight: 20 }, footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 }, caption2: { fontSize: 11, lineHeight: 13 },
  cardTitle: { fontSize: 15, lineHeight: 20, fontFamily: fontFamily.semibold },
} as const;

/** Supply leading for older screens that only specify a point size. */
export function lineHeightForSize(size: number): number {
  const leading: Record<number, number> = { 11: 13, 12: 16, 13: 18, 15: 20, 16: 21, 17: 22, 20: 25, 22: 28, 28: 34, 32: 38, 34: 41 };
  return leading[size] ?? Math.ceil(size * 1.3);
}

// Shadow presets for cards and elevated surfaces
export const shadows = {
  card: { shadowOpacity: 0, elevation: 0 },
  medium: {
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
  strong: {
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 34,
    elevation: 14,
  },
};
