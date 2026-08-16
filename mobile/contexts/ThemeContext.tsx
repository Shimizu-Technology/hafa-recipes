/**
 * Theme Context for manual dark/light mode override.
 * 
 * By default, follows system preference.
 * User can override to always-dark or always-light in Settings.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme as useSystemColorScheme, ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_STORAGE_KEY = '@theme_preference';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeContextType {
  /** The preference set by user: 'system', 'light', or 'dark' */
  themePreference: ThemePreference;
  /** The actual color scheme to use (resolved from preference + system) */
  colorScheme: 'light' | 'dark';
  /** Update the theme preference */
  setThemePreference: (preference: ThemePreference) => void;
  /** Whether the theme is still loading from storage */
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useSystemColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [isLoading, setIsLoading] = useState(true);

  // Load saved preference on mount
  useEffect(() => {
    loadThemePreference();
  }, []);

  const loadThemePreference = async () => {
    try {
      const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (saved && (saved === 'system' || saved === 'light' || saved === 'dark')) {
        setThemePreferenceState(saved);
      }
    } catch (error) {
      console.warn('Failed to load theme preference:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const setThemePreference = async (preference: ThemePreference) => {
    setThemePreferenceState(preference);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch (error) {
      console.warn('Failed to save theme preference:', error);
    }
  };

  // Resolve the actual color scheme
  const colorScheme: 'light' | 'dark' = 
    themePreference === 'system' 
      ? (systemColorScheme ?? 'light')
      : themePreference;

  return (
    <ThemeContext.Provider 
      value={{ 
        themePreference, 
        colorScheme, 
        setThemePreference,
        isLoading,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * Drop-in replacement for react-native's useColorScheme.
 * Uses our ThemeContext to support manual override.
 */
export function useColorScheme(): ColorSchemeName {
  const context = useContext(ThemeContext);
  // Fallback to system if not wrapped in provider (shouldn't happen)
  const systemScheme = useSystemColorScheme();
  
  if (context === undefined) {
    return systemScheme;
  }
  
  return context.colorScheme;
}
