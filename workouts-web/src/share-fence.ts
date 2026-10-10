/** Retire requests synchronously when a bearer link changes, including A→B→A. */
export function createShareFence(readToken: () => string | null) {
  let revision = 0;
  let active: AbortController | null = null;
  function invalidate() {
    revision++;
    active?.abort();
    active = null;
  }
  function capture(token: string) {
    const captured = revision;
    return () => revision === captured && readToken() === token;
  }
  return {
    invalidate,
    capture,
    begin(token: string) {
      invalidate();
      const controller = new AbortController();
      active = controller;
      const live = capture(token);
      return {
        controller,
        current: () => live() && !controller.signal.aborted,
        dispose() {
          controller.abort();
          if (active === controller) invalidate();
        },
      };
    },
  };
}
