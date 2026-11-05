import type { BabyRecord } from "./models";
export const reminderRoutes = { routines: "/routines" as const };
/** Notification data is a routing hint, never authorization or a server URL. */
export interface ReminderTapSession {
  owner: string;
  generation: number;
  active: boolean;
  ready: boolean;
  navigationReady: boolean;
  lease: number;
}
export interface RoutineTarget {
  id: string;
  kind: string;
}
/** What `/reminders/{id}/tap` answers. A push carries no type, so this is where a tap learns what it was. */
export interface TappedReminder {
  id: string;
  kind: string;
  space_id?: string;
  text?: string;
  data: Record<string, unknown>;
}
export interface ReminderPlace {
  /** The pathname she's on once it's open. */
  path: string;
  pathname: string;
  params?: Record<string, string>;
  /** On Today, whose it is: a tap on the second baby's reminder shouldn't show the first. */
  child?: string;
}
export const reminderGoneMessage = "That reminder isn’t here any more.";
export const reminderOfflineMessage = "Couldn’t open that reminder without a connection. Here’s Today.";
interface ResponseShape {
  actionIdentifier: string;
  notification: { date: number; request: { identifier: string; content: { data?: unknown } } };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function responseShape(value: unknown): ResponseShape | null {
  if (!value || typeof value !== "object") return null;
  const response = value as ResponseShape;
  if (
    typeof response.actionIdentifier !== "string" ||
    !response.actionIdentifier ||
    response.actionIdentifier.length > 200 ||
    !Number.isFinite(response.notification?.date) ||
    response.notification.date < 0 ||
    typeof response.notification?.request?.identifier !== "string" ||
    !response.notification.request.identifier ||
    response.notification.request.identifier.length > 500 ||
    !response.notification.request.content
  )
    return null;
  return response;
}
/** The delivery date distinguishes separate deliveries of a repeating request. */
export function notificationResponseKey(response: unknown): string | null {
  const value = responseShape(response);
  return value
    ? JSON.stringify([value.notification.request.identifier, value.notification.date, value.actionIdentifier])
    : null;
}
export type ReminderTapDecision =
  | { kind: "defer" }
  | { kind: "ignore" }
  | { kind: "fallback" }
  | { kind: "routine"; id: string }
  | { kind: "reminder"; id: string };
export function reminderTapDecision(
  response: unknown,
  session: ReminderTapSession | null,
  defaultAction: string
): ReminderTapDecision {
  const value = responseShape(response);
  if (!value) return { kind: "ignore" };
  if (!session?.ready || !session.owner || !Number.isSafeInteger(session.generation) || session.generation < 0)
    return { kind: "defer" };
  const raw = value.notification.request.content.data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "ignore" };
  const data = raw as Record<string, unknown>;
  // The API's own: nothing in it is trusted, and the lookup answers only for whoever is signed in.
  if ("notification_id" in data) {
    if (value.actionIdentifier !== defaultAction || !session.active || typeof data.notification_id !== "string" || !uuid.test(data.notification_id)) return { kind: "ignore" };
    return session.navigationReady ? { kind: "reminder", id: data.notification_id.toLowerCase() } : { kind: "defer" };
  }
  if (
    value.actionIdentifier !== defaultAction ||
    !session.active ||
    data.babyOwner !== session.owner ||
    !Number.isSafeInteger(data.generation) ||
    data.generation !== session.generation
  )
    return { kind: "ignore" };
  if (!session.navigationReady) return { kind: "defer" };
  if (typeof data.recordId !== "string" || !uuid.test(data.recordId)) return { kind: "fallback" };
  return { kind: "routine", id: data.recordId.toLowerCase() };
}
/** Where a reminder opens. Nothing but a known kind and a well-formed id gets past this, or it's Today. */
export function reminderDestination(item: Pick<TappedReminder, "kind" | "data">): ReminderPlace | null {
  const { kind, data } = item, today = (child: unknown): ReminderPlace => ({ path: "/", pathname: "/(tabs)/(today)", ...(typeof child === "string" ? { child } : {}) });
  const id = (value: unknown) => (typeof value === "string" && uuid.test(value) ? value.toLowerCase() : null);
  if (kind === "event") {
    const event = id(data.event_id);
    return event ? { path: `/event/${event}`, pathname: "/event/[id]", params: { id: event, ...(typeof data.original_start === "string" ? { at: data.original_start } : {}) } } : null;
  }
  if (kind === "import" || kind === "routine") {
    const record = id(data.record_id);
    return record ? { path: `/record/${record}`, pathname: "/record/[id]", params: { id: record } } : null;
  }
  if (kind === "visit_prep") return typeof data.date === "string" ? { path: "/tracker", pathname: "/tracker", params: { day: data.date, at: String(Date.now()) } } : null;
  if (kind === "feed_interval" || kind === "running_timer" || kind === "pregnancy_week") return today(data.child_id);
  if (kind === "milestone_window") return { path: "/milestones", pathname: "/milestones" };
  if (kind === "well_visit") return { path: "/well-visits", pathname: "/well-visits" };
  return null;
}
/** The root index and Today both have pathname "/"; segments distinguish them. */
export function reminderNavigationReady(ready: boolean, pathname: string, segments: readonly string[]) {
  return ready && pathname !== "/sign-in" && !(pathname === "/" && segments.length === 0);
}
export interface ReminderTapEnvironment {
  session(): ReminderTapSession | null;
  current(): boolean;
  destination(): string;
  cached(id: string): RoutineTarget | undefined;
  deleted(id: string): boolean;
  fetch(id: string): Promise<RoutineTarget>;
  open(id: string): void;
  fallback(): void;
  retry?(): void;
  /** The reminder as the API has it now, null when it's gone or isn't hers. A failure to reach the API throws. */
  lookup(id: string): Promise<TappedReminder | null>;
  /** Gets this phone ready for where it lives: the right baby selected, a family it hasn't heard about yet. False when it can't be. */
  place(item: TappedReminder, destination: ReminderPlace): Promise<boolean>;
  openReminder(destination: ReminderPlace): void;
  /** Today, always somewhere to land, with one plain sentence. */
  today(message: string): void;
  /** Clear only when the native last response still has this delivery key. */
  acknowledge(key: string): void;
}
/** Router calls enqueue navigation. A receipt is handled only after the target
 * pathname is observed, never merely because router.push returned. */
export function createReminderTapController(
  env: ReminderTapEnvironment,
  defaultAction: string,
  timeoutMs = 10000,
  navigationTimeoutMs = 5000
) {
  let pending: unknown = null,
    epoch = 0,
    disposed = false;
  const handled = new Set<string>(),
    inFlight = new Map<string, Promise<void>>(),
    cancellations = new Set<() => void>(),
    changes = new Set<() => void>();
  const same = (session: ReminderTapSession) => {
    const live = env.session();
    return (
      !disposed &&
      env.current() &&
      live?.ready === true &&
      live.active &&
      live.navigationReady &&
      live.owner === session.owner &&
      live.generation === session.generation &&
      live.lease === session.lease
    );
  };
  const current = (session: ReminderTapSession, token: number) => token === epoch && same(session);
  function changed() {
    for (const check of [...changes]) check();
  }
  function cancelWork() {
    for (const cancel of [...cancellations]) cancel();
  }
  function finish(key: string) {
    handled.add(key);
    if (handled.size > 100) handled.delete(handled.values().next().value!);
    env.acknowledge(key);
  }
  async function bounded(id: string, session: ReminderTapSession, token: number): Promise<RoutineTarget | null> {
    let cancel = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (!current(session, token)) cancel();
    };
    const limit = new Promise<null>((resolve) => {
      cancel = () => resolve(null);
      cancellations.add(cancel);
      changes.add(check);
      timer = setTimeout(cancel, timeoutMs);
    });
    try {
      return await Promise.race([env.fetch(id).catch(() => null), limit]);
    } finally {
      if (timer) clearTimeout(timer);
      cancellations.delete(cancel);
      changes.delete(check);
    }
  }
  /** The reminder, null when the API says it's gone, undefined when the API couldn't be reached in time. */
  async function lookedUp(id: string, session: ReminderTapSession, token: number): Promise<TappedReminder | null | undefined> {
    let cancel = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (!current(session, token)) cancel();
    };
    const limit = new Promise<undefined>((resolve) => {
      cancel = () => resolve(undefined);
      cancellations.add(cancel);
      changes.add(check);
      timer = setTimeout(cancel, timeoutMs);
    });
    try {
      return await Promise.race([env.lookup(id).catch(() => undefined), limit]);
    } finally {
      if (timer) clearTimeout(timer);
      cancellations.delete(cancel);
      changes.delete(check);
    }
  }
  async function confirmed(path: string, session: ReminderTapSession, token: number): Promise<boolean> {
    if (!current(session, token)) return false;
    if (env.destination() === path) return true;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (ok: boolean) => {
        if (timer) clearTimeout(timer);
        changes.delete(check);
        cancellations.delete(cancel);
        resolve(ok);
      };
      const cancel = () => done(false);
      const check = () => {
        if (!current(session, token)) done(false);
        else if (env.destination() === path) done(true);
      };
      changes.add(check);
      cancellations.add(cancel);
      timer = setTimeout(cancel, navigationTimeoutMs);
      check();
    });
  }
  async function resume(): Promise<void> {
    changed();
    if (disposed || !env.current() || pending === null) return;
    const response = pending,
      key = notificationResponseKey(response),
      session = env.session(),
      decision = reminderTapDecision(response, session, defaultAction);
    if (decision.kind === "defer") return;
    pending = null;
    if (!key) return;
    if (handled.has(key)) {
      env.acknowledge(key);
      return;
    }
    if (inFlight.has(key)) return inFlight.get(key);
    const token = epoch;
    if (decision.kind === "ignore") {
      finish(key);
      return;
    }
    if (!session || !same(session)) {
      pending = response;
      return;
    }
    let retryTransition = false;
    const retain = () => {
      if (token !== epoch || disposed) return;
      pending = response;
      retryTransition = !same(session);
    };
    const work = Promise.resolve().then(async () => {
      try {
        if (!current(session, token)) {
          retain();
          return;
        }
        if (decision.kind === "reminder") {
          const found = await lookedUp(decision.id, session, token);
          if (!current(session, token)) {
            retain();
            return;
          }
          let message = found === undefined ? reminderOfflineMessage : reminderGoneMessage;
          const place = found ? reminderDestination(found) : null;
          if (found && place) {
            const ready = await env.place(found, place).catch(() => false);
            if (!current(session, token)) {
              retain();
              return;
            }
            if (ready) {
              env.openReminder(place);
              if (await confirmed(place.path, session, token)) {
                if (current(session, token)) finish(key);
                else retain();
                return;
              }
              if (!current(session, token)) {
                retain();
                return;
              }
              message = reminderGoneMessage;
            }
          }
          env.today(message);
          if (await confirmed("/", session, token)) {
            if (current(session, token)) finish(key);
            else retain();
            return;
          }
          retain();
          if (current(session, token)) env.retry?.();
          return;
        }
        if (decision.kind === "routine") {
          const cached = env.cached(decision.id),
            record = env.deleted(decision.id) ? null : (cached ?? (await bounded(decision.id, session, token)));
          if (!current(session, token)) {
            retain();
            return;
          }
          if (record?.id === decision.id && record.kind === "routine" && !env.deleted(decision.id)) {
            env.open(decision.id);
            if (await confirmed("/record/" + decision.id, session, token)) {
              if (current(session, token)) finish(key);
              else retain();
              return;
            }
            if (!current(session, token)) {
              retain();
              return;
            }
          }
        }
        env.fallback();
        if (await confirmed(reminderRoutes.routines, session, token)) {
          if (current(session, token)) finish(key);
          else retain();
          return;
        }
        retain();
        if (current(session, token)) env.retry?.();
      } catch {
        retain();
        if (current(session, token)) env.retry?.();
      } finally {
        inFlight.delete(key);
        // A bootstrap lease update is not a lost tap: revalidate with the new
        // session and retry. A navigation timeout waits for a real later event.
        if (retryTransition && token === epoch && !disposed && pending === response) void resume();
      }
    });
    inFlight.set(key, work);
    return work;
  }
  return {
    offer(response: unknown) {
      const key = notificationResponseKey(response);
      if (key && inFlight.has(key)) return Promise.resolve();
      epoch++;
      cancelWork();
      pending = response;
      return resume();
    },
    resume,
    dispose() {
      disposed = true;
      epoch++;
      pending = null;
      cancelWork();
      changes.clear();
    },
  };
}

/** A changed product generation must replace old scheduled reminder payloads. */
export function reminderNotificationData(
  owner: string,
  generation: number,
  record: Pick<BabyRecord, "id" | "revision" | "data">
) {
  if (!Number.isSafeInteger(generation) || generation < 0)
    throw Error("Open your Baby account before activating reminders.");
  const data = record.data;
  return {
    babyOwner: owner,
    generation,
    recordId: record.id,
    signature: JSON.stringify([
      generation,
      record.revision,
      data.reminder_at,
      data.repeat,
      data.timezone,
      data.enabled,
      data.items,
    ]),
  };
}
