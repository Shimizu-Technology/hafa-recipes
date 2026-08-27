import type { PasteEventPayload } from 'expo-clipboard';

export const CHAT_MESSAGE_MAX_CHARS = 4_000;
export const CHAT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export interface ChatImageAttachment {
  base64: string;
  uri: string;
}

/** Append pasted text without silently exceeding the API's message contract. */
export function appendPastedChatText(current: string, pasted: string): {
  text: string;
  truncated: boolean;
} {
  const normalized = pasted.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return { text: current, truncated: false };
  const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  const combined = `${current}${separator}${normalized}`;
  return {
    text: combined.slice(0, CHAT_MESSAGE_MAX_CHARS),
    truncated: combined.length > CHAT_MESSAGE_MAX_CHARS,
  };
}

/** Normalize picker or clipboard image data to the bare base64 required by the API. */
export function normalizeChatImageAttachment(
  encoded: string,
  previewUri?: string,
): ChatImageAttachment {
  const match = encoded.match(/^data:image\/(?:jpeg|jpg|png|gif|webp);base64,(.+)$/is);
  const base64 = (match?.[1] ?? encoded).replace(/\s/g, '');
  if (!base64) throw new Error('That image is empty.');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const estimatedBytes = Math.floor((base64.length * 3) / 4) - padding;
  if (estimatedBytes > CHAT_IMAGE_MAX_BYTES) {
    throw new Error('That image is larger than the 8 MB chat limit.');
  }
  const contentLength = base64.length - padding;
  let hasOnlyBase64Characters = true;
  for (let index = 0; index < contentLength; index += 1) {
    const code = base64.charCodeAt(index);
    const isBase64Character = (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || code === 43
      || code === 47;
    if (!isBase64Character) {
      hasOnlyBase64Characters = false;
      break;
    }
  }
  const isValidBase64 = base64.length % 4 === 0
    && hasOnlyBase64Characters
    && !base64.slice(0, contentLength).includes('=');
  if (!isValidBase64) throw new Error('That image is not valid Base64 data.');

  return {
    base64,
    uri: previewUri ?? encoded,
  };
}

/** Convert the native paste control payload into one composer operation. */
export function normalizeChatPaste(payload: PasteEventPayload):
  | { type: 'text'; text: string }
  | ({ type: 'image' } & ChatImageAttachment) {
  if (payload.type === 'text') return { type: 'text', text: payload.text };
  return { type: 'image', ...normalizeChatImageAttachment(payload.data) };
}
