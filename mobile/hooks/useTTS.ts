/**
 * Text-to-Speech hook using OpenAI TTS API.
 * 
 * Provides:
 * - Voice preference persistence
 * - TTS playback for AI chat responses
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/lib/api';

// Storage key for voice preference
const TTS_VOICE_KEY = 'tts_voice_preference';

// Available TTS voices
export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export interface TTSVoiceOption {
  id: TTSVoice;
  name: string;
  description: string;
}

export const TTS_VOICES: TTSVoiceOption[] = [
  { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced' },
  { id: 'echo', name: 'Echo', description: 'Soft, gentle' },
  { id: 'fable', name: 'Fable', description: 'Expressive, storytelling' },
  { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative' },
  { id: 'nova', name: 'Nova', description: 'Warm, natural' },
  { id: 'shimmer', name: 'Shimmer', description: 'Clear, bright' },
];

/**
 * Hook for managing TTS voice preference.
 */
export function useTTSVoice() {
  const [voice, setVoiceState] = useState<TTSVoice>('nova');
  const [isLoading, setIsLoading] = useState(true);

  // Load preference on mount
  useEffect(() => {
    loadVoicePreference();
  }, []);

  const loadVoicePreference = async () => {
    try {
      const stored = await AsyncStorage.getItem(TTS_VOICE_KEY);
      if (stored && TTS_VOICES.some(v => v.id === stored)) {
        setVoiceState(stored as TTSVoice);
      }
    } catch {
      // Non-critical - use default
    } finally {
      setIsLoading(false);
    }
  };

  const setVoice = async (newVoice: TTSVoice) => {
    setVoiceState(newVoice);
    try {
      await AsyncStorage.setItem(TTS_VOICE_KEY, newVoice);
    } catch {
      // Non-critical
    }
  };

  return { voice, setVoice, isLoading };
}

/**
 * Hook for TTS playback.
 */
export function useTTS() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const { voice } = useTTSVoice();

  // Clean up sound on unmount
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // Stop any currently playing audio
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }

    setIsLoading(true);
    setError(null);
    setIsPlaying(false);

    try {
      // Get audio from TTS API
      const audioBlob = await api.generateTTS(text, voice);
      
      // Create audio URI from blob
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const base64 = reader.result as string;
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(audioBlob);
      const base64Uri = await base64Promise;

      // Load and play audio
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: base64Uri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
          }
        }
      );

      soundRef.current = sound;
      setIsPlaying(true);
    } catch (e) {
      console.log('TTS error:', e);
      setError(e instanceof Error ? e.message : 'Failed to generate speech');
    } finally {
      setIsLoading(false);
    }
  }, [voice]);

  const stop = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
      setIsPlaying(false);
    }
  }, []);

  return { speak, stop, isPlaying, isLoading, error };
}
