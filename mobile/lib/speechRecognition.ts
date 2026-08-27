type SpeechRecognitionPackage = typeof import('expo-speech-recognition');

let recognitionModule: SpeechRecognitionPackage['ExpoSpeechRecognitionModule'] | null = null;
let recognitionEventHook = (() => {}) as SpeechRecognitionPackage['useSpeechRecognitionEvent'];

try {
  const nativeSpeech = require('expo-speech-recognition') as SpeechRecognitionPackage;
  recognitionModule = nativeSpeech.ExpoSpeechRecognitionModule;
  recognitionEventHook = nativeSpeech.useSpeechRecognitionEvent;
} catch {
  // Expo Go does not link this native module. The chat UI shows an unavailable state.
}

/** Native recognizer when linked, otherwise null in Expo Go. */
export const chatSpeechRecognitionModule = recognitionModule;
/** Register a native recognition event without breaking Expo Go renders. */
export const useChatSpeechRecognitionEvent = recognitionEventHook;
/** Whether this binary contains the native recognizer module. */
export const isChatSpeechRecognitionAvailable = Boolean(recognitionModule);
