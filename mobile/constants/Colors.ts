/**
 * Håfa Recipes brand system.
 *
 * Direction: island-modern pantry — deep reef-green confidence, warm food
 * neutrals, a restrained clay accent, and no pure black/white surfaces.
 */

export const brand = {
  cream: '#FFF7EC',
  bone: '#F8EFE3',
  parchment: '#F3E4D2',
  ink: '#17120E',
  charcoal: '#27211B',

  clay: '#B94722',
  clayLight: '#FBE8DE',

  reef: '#155C52',
  reefMid: '#347D73',
  reefBright: '#2F8F83',
  reefHighlight: '#69C8BA',
  reefLight: '#DDF5F1',

  herb: '#4F7A41',
  banana: '#F2B84B',

  border: '#E8D8C8',
} as const;

const tintColorLight = brand.reef;
const tintColorDark = brand.reefMid;

export default {
  light: {
    // Base colors
    text: brand.ink,
    textSecondary: '#6D5D50',
    textMuted: '#756659',
    background: brand.cream,
    backgroundSecondary: brand.bone,
    backgroundElevated: '#FFFCF7',

    // UI elements
    tint: tintColorLight,
    accent: brand.clay,
    accentSoft: brand.clayLight,
    border: brand.border,
    borderLight: '#F1E4D7',

    // Tab bar
    tabIconDefault: '#756659',
    tabIconSelected: tintColorLight,

    // Cards and surfaces
    card: '#FFFCF7',
    cardBackground: '#FFFCF7',
    cardBorder: '#EAD9C7',

    // Status colors
    success: brand.herb,
    warning: '#8A5A00',
    error: '#C43C2E',

    // Shadows
    shadowColor: '#0B3E38',
  },
  dark: {
    // Base colors
    text: '#F8F0E7',
    textSecondary: '#B8AEA2',
    textMuted: '#A79D92',
    background: '#101411',
    backgroundSecondary: '#171D1A',
    backgroundElevated: '#202820',

    // UI elements
    tint: tintColorDark,
    accent: '#E58A68',
    accentSoft: 'rgba(229, 138, 104, 0.16)',
    border: '#2D352F',
    borderLight: '#222A25',

    // Tab bar
    tabIconDefault: '#A79D92',
    tabIconSelected: tintColorDark,

    // Cards and surfaces
    card: '#1E2520',
    cardBackground: '#1E2520',
    cardBorder: '#2D352F',

    // Status colors
    success: '#86B875',
    warning: '#F2B84B',
    error: '#F07167',

    // Shadows
    shadowColor: '#000000',
  },
};

// Spacing scale (for consistent spacing)
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
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
  xxl: 30,
  xxxl: 38,
};

// Font weights
export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

// Font families
export const fontFamily = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold: 'DMSans_700Bold',
  display: 'Fraunces_700Bold',
  displaySemibold: 'Fraunces_600SemiBold',
};

// Shadow presets for cards and elevated surfaces
export const shadows = {
  card: {
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
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
