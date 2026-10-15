import type { SessionRequest, TrainingSession } from "./models";
import type { TrainingStore } from "./training";

/** Foreground recovery shares the store's idempotent sync pass with manual saves. */
export function createTrainingSync(options: {
  store: TrainingStore;
  send(request: SessionRequest, generation: number): Promise<TrainingSession>;
  current(): boolean;
  onSaved(): void | Promise<unknown>;
  foreground: boolean;
  online: boolean;
}) {
  let disposed = false, running = false, foreground = options.foreground, online = options.online;
  let timer: ReturnType<typeof setTimeout> | null = null, delay = 15000, refreshPending = false;
  const queued = () => options.store.snapshot().history.filter((item) => item.state === "queued")
    .map((item) => item.request.client_session_id);
  let observed = queued().join("\n");
  const canSend = () => !disposed && foreground && online && options.current();
  function clear() { if (timer != null) clearTimeout(timer); timer = null; }
  function schedule(wait: number) {
    clear();
    if (canSend() && (queued().length || refreshPending)) timer = setTimeout(() => { timer = null; void drain(); }, wait);
  }
  async function drain() {
    if (running || !canSend() || (!queued().length && !refreshPending)) return;
    clear(); running = true;
    const initial = new Set(queued());
    let saved = false;
    try {
      await options.store.sync(async (request, generation) => {
        if (!canSend()) throw Object.assign(Error("Sync is paused. Your result stays saved on this device."), { local: true });
        const result = await options.send(request, generation);
        if (disposed || !options.current())
          throw Object.assign(Error("This account changed. Its original result stays queued for review."), { local: true });
        saved = true;
        return result;
      });
      refreshPending ||= saved;
      if (refreshPending && canSend()) { refreshPending = false; await options.onSaved(); }
    } catch {
      // The durable queue and its problem remain the source of recovery UI.
      // A retired device must never write its result into another account.
    } finally {
      running = false;
      const remaining = queued();
      if (!remaining.length) delay = 15000;
      else {
        schedule(remaining.some((id) => !initial.has(id)) ? 0 : delay);
        delay = Math.min(delay * 2, 120000);
      }
    }
  }
  const unsubscribe = options.store.subscribe(() => {
    const next = queued().join("\n");
    if (next !== observed) {
      observed = next;
      if (!running) schedule(0);
    }
  });
  schedule(0);
  return {
    foreground(value: boolean) { foreground = value; if (value) { delay = 15000; schedule(0); } else clear(); },
    online(value: boolean) { online = value; if (value) { delay = 15000; schedule(0); } else clear(); },
    dispose() { disposed = true; clear(); unsubscribe(); },
  };
}
