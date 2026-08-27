import { describe, expect, it } from 'vitest';

import { applyVoiceTranscript, chatVoiceError } from './chatVoice';

describe('chat voice helpers', () => {
  it('replaces interim transcript text against a stable draft baseline', () => {
    expect(applyVoiceTranscript('Can I use', 'coconut')).toBe('Can I use coconut');
    expect(applyVoiceTranscript('Can I use', 'coconut milk')).toBe('Can I use coconut milk');
  });

  it('preserves existing whitespace and enforces the composer limit', () => {
    expect(applyVoiceTranscript('Question: ', '  use less salt  ')).toBe(
      'Question: use less salt',
    );
    expect(applyVoiceTranscript('1234', '5678', 6)).toBe('1234 5');
  });

  it('suppresses deliberate aborts and maps actionable recognizer failures', () => {
    expect(chatVoiceError('aborted')).toBeNull();
    expect(chatVoiceError('not-allowed')).toMatchObject({
      title: 'Allow Voice Input',
      canOpenSettings: true,
    });
    expect(chatVoiceError('no-speech')?.title).toBe('Nothing Heard');
    expect(chatVoiceError('network')?.title).toBe('Voice Connection Issue');
    expect(chatVoiceError('unexpected')?.title).toBe('Voice Input Failed');
  });
});
