/** Unlisted-link requests give up after 15 seconds rather than spinning on a dead connection. */
export const LINK_REQUEST_TIMEOUT_MS = 15_000;

/**
 * An AbortSignal that fires after `ms` or when any given signal aborts. React Native's AbortSignal
 * has no `timeout()`/`any()`, so this composes them by hand. Call `done()` when the request settles.
 */
export function timeoutSignal(ms: number, ...signals: (AbortSignal | undefined)[]): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  const sources = signals.filter((source): source is AbortSignal => !!source);
  for (const source of sources) {
    if (source.aborted) abort();
    else source.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    done: () => { clearTimeout(timer); for (const source of sources) source.removeEventListener('abort', abort); },
  };
}
