import { useSyncExternalStore, useEffect, useCallback } from 'react';
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

// One preference for every mounted consumer; storage is persistence, not pub/sub.
let preference: TextSizeOption = 'medium';
let loaded = false;
let loading: Promise<void> | undefined;
let revision = 0;
const listeners = new Set<() => void>();
const publish = () => { listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => `${preference}:${loaded}`;

function loadPreference() {
  if (!loading) {
    const startedAt = revision;
    loading = AsyncStorage.getItem(TEXT_SIZE_KEY).then(stored => {
      // A slow storage read must not overwrite a choice made since mount.
      if (startedAt === revision && stored && Object.hasOwn(TEXT_SIZE_SCALES, stored)) {
        preference = stored as TextSizeOption;
      }
    }).catch(error => console.error('Error loading text size preference:', error))
      .finally(() => { loaded = true; publish(); });
  }
  return loading;
}

async function updateTextSize(size: TextSizeOption) {
  revision += 1;
  preference = size;
  publish();
  try {
    await AsyncStorage.setItem(TEXT_SIZE_KEY, size);
  } catch (error) {
    console.error('Error saving text size preference:', error);
  }
}

export function useTextSize() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { void loadPreference(); }, []);
  const textSize = preference;
  const isLoaded = loaded;

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
