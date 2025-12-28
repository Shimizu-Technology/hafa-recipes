/**
 * Clean, minimal color palette for Recipe Extractor
 */

// Accent color - a warm, appetizing orange
const tintColorLight = '#FF6B35';
const tintColorDark = '#FF8F5C';

export default {
  light: {
    // Base colors
    text: '#1A1A1A',
    textSecondary: '#6B6B6B',
    textMuted: '#999999',
    background: '#FFFFFF',
    backgroundSecondary: '#F8F8F8',
    
    // UI elements
    tint: tintColorLight,
    accent: tintColorLight, // Alias for tint
    border: '#E8E8E8',
    borderLight: '#F0F0F0',
    
    // Tab bar
    tabIconDefault: '#B0B0B0',
    tabIconSelected: tintColorLight,
    
    // Cards and surfaces
    card: '#FFFFFF',
    cardBackground: '#FFFFFF', // Alias for card
    cardBorder: '#F0F0F0',
    
    // Status colors
    success: '#34C759',
    warning: '#FF9500',
    error: '#FF3B30',
    
    // Shadows
    shadowColor: '#000',
  },
  dark: {
    // Base colors
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    textMuted: '#6B6B6B',
    background: '#000000',
    backgroundSecondary: '#1C1C1E',
    
    // UI elements
    tint: tintColorDark,
    accent: tintColorDark, // Alias for tint
    border: '#2C2C2E',
    borderLight: '#1C1C1E',
    
    // Tab bar
    tabIconDefault: '#6B6B6B',
    tabIconSelected: tintColorDark,
    
    // Cards and surfaces
    card: '#1C1C1E',
    cardBackground: '#1C1C1E', // Alias for card
    cardBorder: '#2C2C2E',
    
    // Status colors
    success: '#30D158',
    warning: '#FF9F0A',
    error: '#FF453A',
    
    // Shadows
    shadowColor: '#000',
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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
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
  xxxl: 34,
};

// Font weights
export const fontWeight = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

// Font family (Inter)
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

// Shadow presets for cards and elevated surfaces
export const shadows = {
  // Subtle shadow for cards
  card: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  // Medium shadow for modals, floating buttons
  medium: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  // Strong shadow for popovers, dropdowns
  strong: {
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 12,
  },
};
