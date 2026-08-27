/**
 * Text-to-Speech hook using OpenAI TTS API.
 * 
 * Provides:
 * - Voice preference persistence
 * - TTS playback for AI chat responses
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/lib/api';
import { isChatAbortError } from '../lib/chatStream';

// Storage key for voice preference
const TTS_VOICE_KEY = 'tts_voice_preference';
export const TTS_TEXT_MAX_CHARS = 4_096;

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
  const soundRef = useRef<AudioPlayer | null>(null);
  const soundSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const playbackGenerationRef = useRef(0);
  const { voice } = useTTSVoice();

  /** Release the current native player and its listener exactly once. */
  const releaseCurrentPlayer = useCallback(() => {
    soundSubscriptionRef.current?.remove();
    soundSubscriptionRef.current = null;
    if (soundRef.current) {
      soundRef.current.pause();
      soundRef.current.remove();
      soundRef.current = null;
    }
  }, []);

  // Clean up sound on unmount
  useEffect(() => {
    return () => {
      playbackGenerationRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      releaseCurrentPlayer();
    };
  }, [releaseCurrentPlayer]);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const generation = playbackGenerationRef.current + 1;
    playbackGenerationRef.current = generation;
    requestControllerRef.current?.abort();
    releaseCurrentPlayer();
    if (text.length > TTS_TEXT_MAX_CHARS) {
      setIsLoading(false);
      setIsPlaying(false);
      setError('This response is too long to read aloud at once. Copy a shorter section and try again.');
      return;
    }

    const controller = new AbortController();
    requestControllerRef.current = controller;
    setIsLoading(true);
    setError(null);
    setIsPlaying(false);

    try {
      // Get audio from TTS API
      const audioBlob = await api.generateTTS(text, voice, controller.signal);
      if (playbackGenerationRef.current !== generation || controller.signal.aborted) return;
      
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
      if (playbackGenerationRef.current !== generation || controller.signal.aborted) return;

      // Load and play audio
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      if (playbackGenerationRef.current !== generation || controller.signal.aborted) return;

      const sound = createAudioPlayer({ uri: base64Uri });
      soundRef.current = sound;
      const subscription = sound.addListener('playbackStatusUpdate', (status) => {
        if (playbackGenerationRef.current !== generation) return;
        if (status.error) {
          setIsPlaying(false);
          setError('Audio playback stopped unexpectedly. Please try again.');
          return;
        }
        if (status.didJustFinish) {
          setIsPlaying(false);
        }
      });
      soundSubscriptionRef.current = subscription;
      sound.play();
      setIsPlaying(true);
    } catch (caught) {
      if (playbackGenerationRef.current === generation) releaseCurrentPlayer();
      if (!isChatAbortError(caught, controller.signal)) {
        setError('The response could not be read aloud. Check your connection and try again.');
      }
    } finally {
      if (playbackGenerationRef.current === generation) {
        if (requestControllerRef.current === controller) requestControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [releaseCurrentPlayer, voice]);

  const stop = useCallback(async () => {
    playbackGenerationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    releaseCurrentPlayer();
    setIsLoading(false);
    setIsPlaying(false);
  }, [releaseCurrentPlayer]);

  const clearError = useCallback(() => setError(null), []);

  return { speak, stop, isPlaying, isLoading, error, clearError };
}
