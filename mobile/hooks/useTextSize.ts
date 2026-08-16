import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TEXT_SIZE_KEY = '@text_size_preference';

export type TextSizeOption = 'small' | 'medium' | 'large' | 'extra-large';

export const TEXT_SIZE_SCALES: Record<TextSizeOption, number> = {
  'small': 0.85,
  'medium': 1.0,
  'large': 1.15,
  'extra-large': 1.3,
};

export const TEXT_SIZE_LABELS: Record<TextSizeOption, string> = {
  'small': 'Small',
  'medium': 'Medium',
  'large': 'Large',
  'extra-large': 'Extra Large',
};

export function useTextSize() {
  const [textSize, setTextSize] = useState<TextSizeOption>('medium');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preference on mount
  useEffect(() => {
    const loadPreference = async () => {
      try {
        const stored = await AsyncStorage.getItem(TEXT_SIZE_KEY);
        if (stored && (stored in TEXT_SIZE_SCALES)) {
          setTextSize(stored as TextSizeOption);
        }
      } catch (error) {
        console.error('Error loading text size preference:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    loadPreference();
  }, []);

  // Save preference when changed
  const updateTextSize = useCallback(async (size: TextSizeOption) => {
    setTextSize(size);
    try {
      await AsyncStorage.setItem(TEXT_SIZE_KEY, size);
    } catch (error) {
      console.error('Error saving text size preference:', error);
    }
  }, []);

  // Get the scale multiplier
  const scale = TEXT_SIZE_SCALES[textSize];

  // Helper to scale a font size
  const scaleFontSize = useCallback((baseSize: number) => {
    return Math.round(baseSize * scale);
  }, [scale]);

  return {
    textSize,
    setTextSize: updateTextSize,
    scale,
    scaleFontSize,
    isLoaded,
  };
}
