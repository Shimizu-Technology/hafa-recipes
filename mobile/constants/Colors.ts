/** Neutral iOS surfaces with one reef accent. Semantic aliases keep existing screens compatible. */

export const brand = {
  cream: '#FFFFFF', bone: '#F2F2F7', parchment: '#F2F2F7', ink: '#000000', charcoal: '#1C1C1E',
  clay: '#1E7F6E', clayLight: 'rgba(118,118,128,0.12)',
  reef: '#1E7F6E', reefMid: '#1E7F6E', reefBright: '#1E7F6E', reefHighlight: '#5DD3B6',
  reefLight: 'rgba(118,118,128,0.12)', herb: '#248A3D', banana: '#8A5A00',
  border: 'rgba(60,60,67,0.29)',
} as const;

export default {
  light: {
    text: '#000000', secondaryLabel: 'rgba(60,60,67,0.60)', textSecondary: '#68686D', textMuted: '#68686D',
    tertiaryLabel: 'rgba(60,60,67,0.30)', background: '#FFFFFF', groupedBackground: '#F2F2F7',
    backgroundSecondary: '#F2F2F7', backgroundElevated: '#FFFFFF', surface2: 'rgba(118,118,128,0.12)',
    tint: '#1E7F6E', onTint: '#FFFFFF', actionText: '#166456', accent: '#176557',
    accentSoft: 'rgba(118,118,128,0.12)', accentTint: 'rgba(30,127,110,0.14)', border: 'rgba(60,60,67,0.29)', borderLight: 'rgba(60,60,67,0.29)',
    tabIconDefault: '#68686D', tabIconSelected: '#1E7F6E', tabLabelSelected: '#1E7F6E',
    card: '#F2F2F7', cardBackground: '#F2F2F7', cardBorder: 'transparent',
    success: '#1F7534', onSuccess: '#FFFFFF', warning: '#8A5A00', destructive: '#FF3B30', error: '#B42318', onError: '#FFFFFF', shadowColor: '#000000',
    chromeBar: '#FFFFFF', chromeHairline: 'rgba(60,60,67,0.18)', chromeIndicator: 'rgba(30,127,110,0.14)',
  },
  dark: {
    text: '#FFFFFF', secondaryLabel: 'rgba(235,235,245,0.60)', textSecondary: 'rgba(235,235,245,0.60)', textMuted: 'rgba(235,235,245,0.60)',
    tertiaryLabel: 'rgba(235,235,245,0.30)', background: '#000000', groupedBackground: '#000000',
    backgroundSecondary: '#1C1C1E', backgroundElevated: '#1C1C1E', surface2: 'rgba(118,118,128,0.24)',
    tint: '#5DD3B6', onTint: '#00261F', actionText: '#5DD3B6', accent: '#5DD3B6',
    accentSoft: 'rgba(118,118,128,0.24)', accentTint: 'rgba(93,211,182,0.2)', border: 'rgba(84,84,88,0.65)', borderLight: 'rgba(84,84,88,0.65)',
    tabIconDefault: 'rgba(235,235,245,0.60)', tabIconSelected: '#5DD3B6', tabLabelSelected: '#5DD3B6',
    card: '#1C1C1E', cardBackground: '#1C1C1E', cardBorder: 'transparent',
    success: '#30D158', onSuccess: '#00261F', warning: '#FFD60A', destructive: '#FF453A', error: '#FF6961', onError: '#00261F', shadowColor: '#000000',
    chromeBar: '#0C0C0C', chromeHairline: 'rgba(84,84,88,0.5)', chromeIndicator: 'rgba(93,211,182,0.22)',
  },
};

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
  xs: 5,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  xxl: 36,
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

// The OS supplies UI/body type; Fraunces is reserved for editorial titles.
const systemFont = 'System';
export const fontFamily = {
  regular: systemFont, medium: systemFont, semibold: systemFont, bold: systemFont,
  display: 'Fraunces_600SemiBold', displaySemibold: 'Fraunces_600SemiBold',
};

export const typography = {
  largeTitle: { fontSize: 32, lineHeight: 38, fontFamily: fontFamily.display },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22 }, callout: { fontSize: 16, lineHeight: 21 },
  subhead: { fontSize: 15, lineHeight: 20 }, footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 }, caption2: { fontSize: 11, lineHeight: 13 },
  cardTitle: { fontSize: 16, lineHeight: 21, fontFamily: fontFamily.display },
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
