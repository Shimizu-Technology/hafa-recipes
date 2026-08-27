import type { ChatRequest, ChatResponse } from '@/types/recipe';

type ExpoFetch = typeof import('expo/fetch')['fetch'];

export const CHAT_STREAM_RESPONSE_MAX_CHARS = 16_000;

export type ChatDeltaHandler = (delta: string, response: string) => void;

export class ChatStreamUnavailableError extends Error {
  constructor() {
    super('Streaming chat is unavailable on this server.');
    this.name = 'ChatStreamUnavailableError';
  }
}

export class ChatStreamBodyUnreadableError extends Error {
  constructor() {
    super('The assistant response could not be read on this device.');
    this.name = 'ChatStreamBodyUnreadableError';
  }
}

export class ChatStreamHttpError extends Error {
  readonly code?: string;
  readonly response: { status: number; data: { detail: string } };

  constructor(status: number, detail: string, code?: string) {
    super(detail);
    this.name = 'ChatStreamHttpError';
    this.code = code;
    this.response = { status, data: { detail } };
  }
}

type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; status: number; code?: string; message: string };

/** Parse and validate one untrusted NDJSON event from the API. */
export function parseChatStreamEvent(line: string): ChatStreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('The assistant returned an unreadable streaming response.');
  }
  if (!value || typeof value !== 'object' || !('type' in value)) {
    throw new Error('The assistant returned an invalid streaming response.');
  }
  const event = value as Record<string, unknown>;
  if (event.type === 'delta' && typeof event.text === 'string' && event.text) {
    return { type: 'delta', text: event.text };
  }
  if (event.type === 'done') return { type: 'done' };
  if (
    event.type === 'error'
    && typeof event.status === 'number'
    && typeof event.message === 'string'
  ) {
    return {
      type: 'error',
      status: event.status,
      code: typeof event.code === 'string' ? event.code : undefined,
      message: event.message,
    };
  }
  throw new Error('The assistant returned an invalid streaming response.');
}

interface StreamChatRequestOptions {
  url: string;
  token: string | null;
  payload: ChatRequest;
  signal?: AbortSignal;
  onDelta?: ChatDeltaHandler;
  fetchImpl?: ExpoFetch;
}

/** Read one authenticated NDJSON response and surface progressive text safely. */
export async function streamChatRequest({
  url,
  token,
  payload,
  signal,
  onDelta,
  fetchImpl,
}: StreamChatRequestOptions): Promise<ChatResponse> {
  let response: Awaited<ReturnType<ExpoFetch>>;
  try {
    const requestFetch = fetchImpl ?? (await import('expo/fetch')).fetch;
    response = await requestFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', cause: error });
  }

  if ([404, 405, 501].includes(response.status)) {
    if (response.body) await response.body.cancel().catch(() => undefined);
    throw new ChatStreamUnavailableError();
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { detail?: unknown };
    const detail = typeof data.detail === 'string'
      ? data.detail
      : 'The cooking assistant could not process this request.';
    throw new ChatStreamHttpError(response.status, detail);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new ChatStreamBodyUnreadableError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';
  let completed = false;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = parseChatStreamEvent(line);
    if (event.type === 'error') {
      throw new ChatStreamHttpError(event.status, event.message, event.code);
    }
    if (event.type === 'done') {
      completed = true;
      return;
    }
    if (completed) throw new Error('The assistant returned data after completion.');
    if (fullResponse.length + event.text.length > CHAT_STREAM_RESPONSE_MAX_CHARS) {
      throw new Error('The assistant response exceeded the supported length.');
    }
    fullResponse += event.text;
    onDelta?.(event.text, fullResponse);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(consumeLine);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!completed || !fullResponse) {
    throw new Error('The assistant response ended before it was complete.');
  }
  return { response: fullResponse };
}

export function isChatAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted)
    || (error instanceof Error && error.name === 'AbortError');
}
