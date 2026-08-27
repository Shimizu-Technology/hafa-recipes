import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  generateTTS: vi.fn(),
  createAudioPlayer: vi.fn(),
  setAudioModeAsync: vi.fn(async () => undefined),
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => undefined),
}));

vi.mock('@/lib/api', () => ({ api: { generateTTS: mocks.generateTTS } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: mocks.getItem, setItem: mocks.setItem },
}));
vi.mock('expo-audio', () => ({
  createAudioPlayer: mocks.createAudioPlayer,
  setAudioModeAsync: mocks.setAudioModeAsync,
}));

class FakeFileReader {
  result: string | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  /** Complete the browser-style conversion on the next microtask. */
  readAsDataURL() {
    this.result = 'data:audio/mpeg;base64,YXVkaW8=';
    queueMicrotask(() => this.onloadend?.());
  }
}

import { TTS_TEXT_MAX_CHARS, useTTS } from './useTTS';

type TTSState = ReturnType<typeof useTTS>;
let currentState: TTSState;

/** Expose the latest hook value to each isolated renderer test. */
function Harness() {
  currentState = useTTS();
  return null;
}

/** Create a manually settled promise for cancellation tests. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useTTS', () => {
  beforeEach(() => {
    vi.stubGlobal('FileReader', FakeFileReader);
    mocks.generateTTS.mockReset();
    mocks.createAudioPlayer.mockReset();
    mocks.setAudioModeAsync.mockClear();
    mocks.getItem.mockReset();
    mocks.getItem.mockResolvedValue(null);
    mocks.setItem.mockClear();
  });

  it('aborts pending generation when playback is stopped', async () => {
    const generation = deferred<Blob>();
    mocks.generateTTS.mockReturnValue(generation.promise);
    const renderer = createRoot();

    try {
      await act(async () => renderer.render(React.createElement(Harness)));
      let speaking!: Promise<void>;
      await act(async () => {
        speaking = currentState.speak('Read this response');
        await Promise.resolve();
      });
      const signal = mocks.generateTTS.mock.calls[0][2] as AbortSignal;
      expect(signal.aborted).toBe(false);

      await act(async () => currentState.stop());
      expect(signal.aborted).toBe(true);
      await act(async () => generation.resolve(new Blob(['audio'])));
      await act(async () => speaking);
      expect(mocks.createAudioPlayer).not.toHaveBeenCalled();
      expect(currentState.isPlaying).toBe(false);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('plays generated audio and surfaces native playback errors', async () => {
    let statusListener: ((status: { error: string | null; didJustFinish: boolean }) => void)
      | undefined;
    const subscription = { remove: vi.fn() };
    const player = {
      addListener: vi.fn((_event: string, listener: typeof statusListener) => {
        statusListener = listener;
        return subscription;
      }),
      pause: vi.fn(),
      play: vi.fn(),
      remove: vi.fn(),
    };
    mocks.generateTTS.mockResolvedValue(new Blob(['audio']));
    mocks.createAudioPlayer.mockReturnValue(player);
    const renderer = createRoot();

    try {
      await act(async () => renderer.render(React.createElement(Harness)));
      await act(async () => currentState.speak('Read this response'));
      expect(player.play).toHaveBeenCalledOnce();
      expect(currentState.isPlaying).toBe(true);

      await act(async () => statusListener?.({ error: 'decoder failed', didJustFinish: false }));
      expect(currentState.isPlaying).toBe(false);
      expect(currentState.error).toContain('playback stopped');
      expect(player.pause).toHaveBeenCalledOnce();
      expect(player.remove).toHaveBeenCalledOnce();
      expect(subscription.remove).toHaveBeenCalledOnce();
      await act(async () => currentState.clearError());
      expect(currentState.error).toBeNull();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('releases native audio after playback finishes', async () => {
    let statusListener: ((status: { error: string | null; didJustFinish: boolean }) => void)
      | undefined;
    const subscription = { remove: vi.fn() };
    const player = {
      addListener: vi.fn((_event: string, listener: typeof statusListener) => {
        statusListener = listener;
        return subscription;
      }),
      pause: vi.fn(),
      play: vi.fn(),
      remove: vi.fn(),
    };
    mocks.generateTTS.mockResolvedValue(new Blob(['audio']));
    mocks.createAudioPlayer.mockReturnValue(player);
    const renderer = createRoot();

    try {
      await act(async () => renderer.render(React.createElement(Harness)));
      await act(async () => currentState.speak('Read this response'));
      await act(async () => statusListener?.({ error: null, didJustFinish: true }));

      expect(currentState.isPlaying).toBe(false);
      expect(player.pause).toHaveBeenCalledOnce();
      expect(player.remove).toHaveBeenCalledOnce();
      expect(subscription.remove).toHaveBeenCalledOnce();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it('rejects overlong responses before requesting speech audio', async () => {
    const renderer = createRoot();

    try {
      await act(async () => renderer.render(React.createElement(Harness)));
      await act(async () => currentState.speak('x'.repeat(TTS_TEXT_MAX_CHARS + 1)));
      expect(mocks.generateTTS).not.toHaveBeenCalled();
      expect(currentState.error).toContain('too long');
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});
