import { useSyncExternalStore } from 'react';

type PromptId = symbol;
type Listener = () => void;

const promptHeights = new Map<PromptId, number>();
const listeners = new Set<Listener>();
let currentHeight = 0;

/** Publish the tallest active prompt only when its measurement changes. */
function publishHeight() {
  const nextHeight = promptHeights.size > 0 ? Math.max(...promptHeights.values()) : 0;
  if (nextHeight === currentHeight) return;

  currentHeight = nextHeight;
  listeners.forEach((listener) => listener());
}

/** Record the rendered height for one mounted guest prompt. */
export function setGuestPromptHeight(id: PromptId, height: number) {
  if (!Number.isFinite(height) || height < 0) return;
  promptHeights.set(id, height);
  publishHeight();
}

/** Remove a guest prompt from the shared layout measurement. */
export function clearGuestPromptHeight(id: PromptId) {
  promptHeights.delete(id);
  publishHeight();
}

/** Read the tallest mounted guest prompt. */
export function getGuestPromptHeight() {
  return currentHeight;
}

/** Subscribe to guest-prompt layout changes for floating controls. */
export function useGuestPromptHeight() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getGuestPromptHeight,
    getGuestPromptHeight,
  );
}
