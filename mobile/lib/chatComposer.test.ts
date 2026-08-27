import { describe, expect, it } from 'vitest';

import {
  appendPastedChatText,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_MESSAGE_MAX_CHARS,
  normalizeChatImageAttachment,
  normalizeChatPaste,
} from './chatComposer';

describe('chat composer normalization', () => {
  it('appends normalized pasted text on a new line', () => {
    expect(appendPastedChatText('Use half', '  as much salt\r\nplease\rand pepper  ')).toEqual({
      text: 'Use half\nas much salt\nplease\nand pepper',
      truncated: false,
    });
  });

  it('reports when pasted text is truncated to the API limit', () => {
    const result = appendPastedChatText('A', 'B'.repeat(CHAT_MESSAGE_MAX_CHARS));
    expect(result.text).toHaveLength(CHAT_MESSAGE_MAX_CHARS);
    expect(result.truncated).toBe(true);
  });

  it('strips a clipboard data URL before sending and retains it for preview', () => {
    const data = 'data:image/jpeg;base64,/9j/ZXhhbXBsZQ==';
    expect(normalizeChatPaste({
      type: 'image',
      data,
      size: { width: 10, height: 10 },
    })).toEqual({
      type: 'image',
      base64: '/9j/ZXhhbXBsZQ==',
      uri: data,
    });
  });

  it('rejects image data larger than the server contract', () => {
    const oversized = 'A'.repeat(Math.ceil((CHAT_IMAGE_MAX_BYTES + 1) * 4 / 3));
    expect(() => normalizeChatImageAttachment(oversized, 'file:///large.jpg'))
      .toThrow('larger than the 8 MB');
  });

  it('rejects malformed Base64 image data before delivery', () => {
    expect(() => normalizeChatImageAttachment(
      'data:image/jpeg;base64,not*base64!',
    )).toThrow('not valid Base64');
  });
});
