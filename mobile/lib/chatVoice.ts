import { CHAT_MESSAGE_MAX_CHARS } from './chatComposer';

export type ChatVoiceError = {
  title: string;
  message: string;
  canOpenSettings?: boolean;
};

/** Replace the current recognition segment without duplicating interim results. */
export function applyVoiceTranscript(
  baseText: string,
  transcript: string,
  maxChars = CHAT_MESSAGE_MAX_CHARS,
): string {
  const spokenText = transcript.trim();
  if (!spokenText) return baseText.slice(0, maxChars);
  const separator = baseText && !/\s$/.test(baseText) ? ' ' : '';
  return `${baseText}${separator}${spokenText}`.slice(0, maxChars);
}

/** Convert native recognizer failures into concise, actionable user guidance. */
export function chatVoiceError(code: string): ChatVoiceError | null {
  if (code === 'aborted') return null;
  if (code === 'not-allowed') {
    return {
      title: 'Allow Voice Input',
      message: 'Enable microphone and speech recognition access in Settings, then try again.',
      canOpenSettings: true,
    };
  }
  if (code === 'no-speech' || code === 'speech-timeout') {
    return {
      title: 'Nothing Heard',
      message: 'Try again and speak after the microphone turns green.',
    };
  }
  if (code === 'network') {
    return {
      title: 'Voice Connection Issue',
      message: 'Speech recognition could not connect. Check your connection and try again.',
    };
  }
  if (code === 'audio-capture') {
    return {
      title: 'Microphone Unavailable',
      message: 'Another app may be using the microphone. Close it and try again.',
    };
  }
  if (code === 'busy') {
    return {
      title: 'Voice Input Is Busy',
      message: 'Wait a moment for the current voice session to finish, then try again.',
    };
  }
  if (code === 'interrupted') {
    return {
      title: 'Voice Input Interrupted',
      message: 'A call, alarm, or another audio session interrupted dictation. You can try again.',
    };
  }
  if (code === 'language-not-supported' || code === 'service-not-allowed') {
    return {
      title: 'Voice Input Unavailable',
      message: 'Speech recognition is not available for this device or language.',
    };
  }
  return {
    title: 'Voice Input Failed',
    message: 'Voice input could not start. You can try again or type your message.',
  };
}
