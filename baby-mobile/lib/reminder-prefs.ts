import * as Crypto from "expo-crypto";
import type { Bootstrap, Child, DeviceState, KindPref, PrefsPatch, QuietHours, ReminderKind, ReminderPrefs } from "./models";
import { addMutation } from "./outbox";
import { isCaregiver } from "./spaces";

type Account = { state: DeviceState; commit: (change: (s: DeviceState) => DeviceState) => Promise<void>; sync: () => Promise<void> };

export { remindersOn } from "./spaces";

const unset: KindPref = { enabled: false, break_through: false, hours: null, feed_hours: null, sleep_hours: null };

function merged(a: PrefsPatch, b: PrefsPatch): PrefsPatch {
  const kinds = { ...a.kinds };
  for (const [kind, patch] of Object.entries(b.kinds ?? {})) kinds[kind as ReminderKind] = { ...kinds[kind as ReminderKind], ...patch };
  return { ...a, ...b, ...(Object.keys(kinds).length ? { kinds } : {}) };
}

/** The API's copy with anything still queued on top, so a switch stays where she put it through every refresh. */
export function shownPrefs(state: Pick<DeviceState, "reminderPrefs" | "outbox">): ReminderPrefs {
  const server = state.reminderPrefs ?? { quiet_hours: null, kinds: {} };
  const patch = state.outbox.reduce<PrefsPatch>((all, m) => (m.type === "reminder_prefs" && !m.error ? merged(all, m.patch) : all), {});
  const kinds = { ...server.kinds };
  for (const [kind, change] of Object.entries(patch.kinds ?? {})) kinds[kind as ReminderKind] = { ...unset, ...kinds[kind as ReminderKind], ...change };
  return { quiet_hours: patch.quiet_hours !== undefined ? patch.quiet_hours : server.quiet_hours, kinds };
}

/** Waits on this phone with no signal, the way a What shows switch does. Quick changes travel as one. */
export async function savePrefs(b: Account, patch: PrefsPatch) {
  await b.commit((state) => {
    // One already on its way can't take more: it leaves the queue when it lands.
    const waiting = state.outbox.find((m) => m.type === "reminder_prefs" && !m.sent && !m.error);
    if (waiting?.type === "reminder_prefs") return { ...state, outbox: state.outbox.map((m) => (m.id === waiting.id ? { ...waiting, patch: merged(waiting.patch, patch) } : m)) };
    return addMutation(state, { id: Crypto.randomUUID(), generation: state.bootstrap!.generation, type: "reminder_prefs", patch });
  });
  void b.sync();
}

export type PermissionAnswer = "granted" | "denied" | "later";

/** Asks first, because "Not now" should leave the switch where it was. Refused at the phone, it still saves: Today shows it anyway. */
export async function turnOn(b: Account, kind: ReminderKind, details: Partial<KindPref>, ask: (kind: ReminderKind) => Promise<PermissionAnswer>, register: () => unknown) {
  const answer = await ask(kind);
  if (answer === "later") return answer;
  await savePrefs(b, { kinds: { [kind]: { ...details, enabled: true } } });
  if (answer === "granted") void register();
  return answer;
}

const expecting = (children: Child[]) => children.some((child) => child.due_date && !child.birth_date);
/** Only what can actually reach this person. The API has no milestone or well-visit reminders yet, so they aren't listed. */
export function kindsFor(bootstrap: Pick<Bootstrap, "spaces"> | null | undefined, children: Child[]): ReminderKind[] {
  if (isCaregiver(bootstrap)) return ["event", "running_timer"];
  return ["feed_interval", "event", "running_timer", ...(expecting(children) ? (["pregnancy_week"] as const) : []), "visit_prep", "import"];
}

const nextHour = (clock: string) => `${String((Number(clock.slice(0, 2)) + 1) % 24).padStart(2, "0")}${clock.slice(2)}`;
/** The API refuses a window that starts where it ends, so the end moves out of the way. The zone is always the phone's own. */
export function quietWindow(held: QuietHours | null | undefined, timezone: string, change: Partial<Pick<QuietHours, "start" | "end">> = {}): QuietHours {
  const start = change.start ?? held?.start ?? "22:00", end = change.end ?? held?.end ?? "07:00";
  return { start, end: start === end ? nextHour(start) : end, timezone };
}
