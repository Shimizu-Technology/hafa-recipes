import type { Storage } from "./drafts";
export interface ReminderSettings {
  rest_enabled: boolean;
  weekly_enabled: boolean;
  days: number[];
  hour: number;
  minute: number;
}
export interface TimerCheckpoint {
  session_id: string;
  until: number;
}
export interface NotificationIntent {
  id: string;
  owner_scope: string;
  kind: "rest" | "routine";
  fingerprint: string;
  until?: number;
  session_id?: string;
  weekday?: number;
  hour?: number;
  minute?: number;
}
export interface LocalNotifications {
  permission(request: boolean): Promise<"granted" | "denied" | "unavailable" | "unknown">;
  list(): Promise<NotificationIntent[]>;
  schedule(intent: NotificationIntent): Promise<void>;
  cancel(id: string): Promise<void>;
  openSettings(): Promise<void>;
}
export interface ReminderState {
  settings: ReminderSettings;
  timer: TimerCheckpoint | null;
  permission: "granted" | "denied" | "unavailable" | "unknown";
  ready: boolean;
  error: string;
}
export const defaultReminderSettings = (): ReminderSettings => ({
  rest_enabled: false,
  weekly_enabled: false,
  days: [],
  hour: 18,
  minute: 0,
});
export function reminderErrors(settings: ReminderSettings) {
  const errors: string[] = [];
  if (
    !Number.isInteger(settings.hour) ||
    settings.hour < 0 ||
    settings.hour > 23 ||
    !Number.isInteger(settings.minute) ||
    settings.minute < 0 ||
    settings.minute > 59
  )
    errors.push("Choose a time from 00:00 to 23:59.");
  if (
    new Set(settings.days).size !== settings.days.length ||
    settings.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  )
    errors.push("Choose valid reminder days.");
  if (settings.weekly_enabled && !settings.days.length) errors.push("Choose at least one day for weekly reminders.");
  return errors;
}
export function notificationIntents(
  scope: string,
  settings: ReminderSettings,
  timer: TimerCheckpoint | null,
  now: number,
  timezone=Intl.DateTimeFormat().resolvedOptions().timeZone
) {
  const intents: NotificationIntent[] = [];
  const prefix = `hafa-workouts:v1:${encodeURIComponent(scope)}:`;
  if (settings.rest_enabled && timer && Number.isFinite(timer.until) && timer.until > now)
    intents.push({
      id: `${prefix}rest`,
      owner_scope: scope,
      kind: "rest",
      session_id: timer.session_id,
      until: timer.until,
      fingerprint: `rest:${timer.session_id}:${timer.until}`,
    });
  if (settings.weekly_enabled)
    for (const day of settings.days) {
      const weekday = ((day + 1) % 7) + 1;
      intents.push({
        id: `${prefix}routine:${day}`,
        owner_scope: scope,
        kind: "routine",
        weekday,
        hour: settings.hour,
        minute: settings.minute,
        fingerprint: `routine:${weekday}:${settings.hour}:${settings.minute}:device-local:${timezone}`,
      });
    }
  return intents;
}
export function createReminders(deps: {
  storage: Storage;
  adapter: LocalNotifications;
  owner_scope: string;
  currentOwnerScope(): string | null;
  now?(): number;
}) {
  const { storage, adapter, owner_scope: scope } = deps;
  const key = `hafa-workouts:reminders:v1:${encodeURIComponent(scope)}`;
  const now = deps.now ?? Date.now;
  let state: ReminderState = {
    settings: defaultReminderSettings(),
    timer: null,
    permission: "unknown",
    ready: false,
    error: "",
  };
  let queue = Promise.resolve();
  const listeners = new Set<() => void>();
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  function guard() {
    if (deps.currentOwnerScope() !== scope)
      throw Error("The signed-in account changed. This reminder action was stopped.");
  }
  function publish(patch: Partial<ReminderState>) {
    state = { ...state, ...patch };
    for (const notify of listeners) notify();
  }
  function ordered(work: () => Promise<void>) {
    const next = queue.catch(() => undefined).then(work);
    queue = next;
    return next;
  }
  async function persist(settings = state.settings, timer = state.timer) {
    guard();
    if (!state.ready) throw Error("Wait for saved reminder choices to load before changing them.");
    await storage.setItem(key, JSON.stringify({ settings, timer }));
    guard();
    publish({ settings: clone(settings), timer: clone(timer) });
  }
  async function reconcile(request = false) {
    guard();
    const permission = await adapter.permission(request);
    guard();
    publish({ permission });
    const existing = await adapter.list();
    guard();
    const desired = permission === "granted" ? notificationIntents(scope, state.settings, state.timer, now()) : [];
    const byId = new Map(desired.map((intent) => [intent.id, intent]));
    for (const intent of existing) {
      guard();
      if (
        intent.id.startsWith("hafa-workouts:v1:") &&
        (intent.owner_scope !== scope || byId.get(intent.id)?.fingerprint !== intent.fingerprint)
      )
        await adapter.cancel(intent.id);
    }
    for (const intent of desired) {
      guard();
      if (
        existing.some(
          (saved) => saved.id === intent.id && saved.owner_scope === scope && saved.fingerprint === intent.fingerprint
        )
      )
        continue;
      await adapter.schedule(intent);
      if (deps.currentOwnerScope() !== scope) {
        await adapter.cancel(intent.id);
        throw Error("The account changed before this reminder was scheduled.");
      }
    }
    publish({ error: "" });
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load() {
      return ordered(async () => {
        guard();
        const raw = await storage.getItem(key);
        guard();
        if (raw) {
          const value = JSON.parse(raw) as { settings: ReminderSettings; timer: TimerCheckpoint | null };
          const errors = reminderErrors(value.settings);
          if (errors.length) throw Error("Reminder preferences need recovery. They have not been overwritten.");
          publish({ settings: value.settings, timer: value.timer });
        }
        publish({ ready: true });
        await reconcile();
      });
    },
    save(settings: ReminderSettings) {
      return ordered(async () => {
        const errors = reminderErrors(settings);
        if (errors.length) throw Error(errors.join(" "));
        await persist(settings);
        await reconcile(settings.rest_enabled || settings.weekly_enabled);
      });
    },
    timer(timer: TimerCheckpoint | null) {
      return ordered(async () => {
        await persist(state.settings, timer);
        await reconcile();
      });
    },
    resume() {
      return ordered(async () => {
        await reconcile();
      });
    },
    openSettings: () => adapter.openSettings(),
    async cleanupOwned() {
      await queue.catch(() => undefined);
      const scheduled = await adapter.list();
      for (const intent of scheduled)
        if (intent.owner_scope === scope && intent.id.startsWith(`hafa-workouts:v1:${encodeURIComponent(scope)}:`))
          await adapter.cancel(intent.id);
    },
    report(error: unknown) {
      publish({ error: error instanceof Error ? error.message : "Could not update optional reminders." });
    },
  };
}
export type RemindersController = ReturnType<typeof createReminders>;
