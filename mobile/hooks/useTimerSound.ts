/**
 * Hook for managing timer sound preferences.
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';

const TIMER_SOUND_KEY = '@timer_sound_preference';

export type TimerSoundOption = 'default' | 'bell' | 'chime' | 'alarm' | 'none';

export const TIMER_SOUNDS: { id: TimerSoundOption; label: string; description: string }[] = [
  { id: 'default', label: 'Default', description: 'Pleasant notification sound' },
  { id: 'bell', label: 'Bell', description: 'Simple bell ring' },
  { id: 'chime', label: 'Chime', description: 'Soft wind chime' },
  { id: 'alarm', label: 'Alarm', description: 'More urgent alarm sound' },
  { id: 'none', label: 'None', description: 'Vibration only (no sound)' },
];

// Sound file mappings
const SOUND_FILES: Record<Exclude<TimerSoundOption, 'none'>, any> = {
  default: require('@/assets/sounds/timer-complete.mp3'),
  bell: require('@/assets/sounds/timer-bell.mp3'),
  chime: require('@/assets/sounds/timer-chime.mp3'),
  alarm: require('@/assets/sounds/timer-alarm.mp3'),
};

export function useTimerSoundPreference() {
  const [soundPreference, setSoundPreference] = useState<TimerSoundOption>('default');
  const [isLoading, setIsLoading] = useState(true);

  // Load preference on mount
  useEffect(() => {
    const loadPreference = async () => {
      try {
        const stored = await AsyncStorage.getItem(TIMER_SOUND_KEY);
        if (stored && TIMER_SOUNDS.some(s => s.id === stored)) {
          setSoundPreference(stored as TimerSoundOption);
        }
      } catch (e) {
        console.log('Failed to load timer sound preference');
      } finally {
        setIsLoading(false);
      }
    };
    loadPreference();
  }, []);

  // Save preference
  const setTimerSound = useCallback(async (sound: TimerSoundOption) => {
    setSoundPreference(sound);
    try {
      await AsyncStorage.setItem(TIMER_SOUND_KEY, sound);
    } catch (e) {
      console.log('Failed to save timer sound preference');
    }
  }, []);

  return { soundPreference, setTimerSound, isLoading };
}

/**
 * Get the sound file for a given preference.
 * Returns null if preference is 'none'.
 */
export function getTimerSoundFile(preference: TimerSoundOption) {
  if (preference === 'none') return null;
  return SOUND_FILES[preference];
}

// Track currently playing preview sound so we can stop it
let currentPreviewSound: Audio.Sound | null = null;

/**
 * Play a preview of the timer sound.
 * Stops any currently playing preview before starting the new one.
 */
export async function playTimerSoundPreview(preference: TimerSoundOption): Promise<void> {
  if (preference === 'none') return;
  
  // Stop and unload any currently playing preview
  if (currentPreviewSound) {
    try {
      await currentPreviewSound.stopAsync();
      await currentPreviewSound.unloadAsync();
    } catch (e) {
      // Sound may already be unloaded, that's ok
    }
    currentPreviewSound = null;
  }
  
  try {
    const { sound } = await Audio.Sound.createAsync(
      SOUND_FILES[preference],
      { shouldPlay: true }
    );
    
    currentPreviewSound = sound;
    
    // Unload after playing
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync();
        if (currentPreviewSound === sound) {
          currentPreviewSound = null;
        }
      }
    });
  } catch (e) {
    console.log('Failed to play timer sound preview');
  }
}

