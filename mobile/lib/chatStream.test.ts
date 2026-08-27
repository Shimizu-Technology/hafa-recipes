import { describe, expect, it, vi } from 'vitest';

vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));

import {
  ChatStreamHttpError,
  ChatStreamUnavailableError,
  isChatAbortError,
  parseChatStreamEvent,
  streamChatRequest,
} from './chatStream';

function streamingResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), {
    status,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

describe('chat streaming transport', () => {
  it('parses split NDJSON chunks and reports progressive response text', async () => {
    const onDelta = vi.fn();
    const fetchImpl = vi.fn(async () => streamingResponse([
      '{"type":"delta","text":"Use low',
      ' heat."}\n{"type":"delta","text":" Stir often."}\n',
      '{"type":"done"}\n',
    ]));

    await expect(streamChatRequest({
      url: 'https://api.example.test/api/chat/cooking/stream',
      token: 'session-token',
      payload: { message: 'How should I heat this?' },
      onDelta,
      fetchImpl: fetchImpl as never,
    })).resolves.toEqual({ response: 'Use low heat. Stir often.' });
    expect(onDelta).toHaveBeenNthCalledWith(1, 'Use low heat.', 'Use low heat.');
    expect(onDelta).toHaveBeenNthCalledWith(
      2,
      ' Stir often.',
      'Use low heat. Stir often.',
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/stream'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
      }),
    );
  });

  it('converts streamed API failures to the existing HTTP error shape', async () => {
    const fetchImpl = vi.fn(async () => streamingResponse([
      '{"type":"error","status":429,"code":"rate_limit","message":"Wait briefly."}\n',
    ]));
    const error = await streamChatRequest({
      url: 'https://api.example.test/api/chat/cooking/stream',
      token: null,
      payload: { message: 'Hello' },
      fetchImpl: fetchImpl as never,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ChatStreamHttpError);
    expect(error.response).toEqual({ status: 429, data: { detail: 'Wait briefly.' } });
  });

  it('uses a distinct error only when the server has no streaming route', async () => {
    const fetchImpl = vi.fn(async () => streamingResponse(['Not found'], 404));
    await expect(streamChatRequest({
      url: 'https://api.example.test/api/chat/cooking/stream',
      token: null,
      payload: { message: 'Hello' },
      fetchImpl: fetchImpl as never,
    })).rejects.toBeInstanceOf(ChatStreamUnavailableError);
  });

  it('rejects malformed events and recognizes explicit cancellation', () => {
    expect(() => parseChatStreamEvent('{"type":"delta","text":4}')).toThrow(
      'invalid streaming response',
    );
    const controller = new AbortController();
    controller.abort();
    expect(isChatAbortError(new Error('request failed'), controller.signal)).toBe(true);
  });
});
