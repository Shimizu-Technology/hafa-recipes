import type { BabyApi } from "./api";
import { ApiError } from "./api";
import type { DeviceState, DueReminder } from "./models";
import { remindersOn, spacesLive } from "./spaces";

type Commit = (change: (s: DeviceState) => DeviceState) => Promise<void>;
type Account = { commit: Commit; sync: () => Promise<void> };

/** A log waiting on this phone has already answered these, though the API can't know yet. */
function answeredHere(state: Pick<DeviceState, "outbox">, item: DueReminder) {
  if (item.kind === "feed_interval")
    return state.outbox.some((m) => m.type === "save" && m.record.kind === "feeding" && m.record.child_id === (item.data.child_id ?? null));
  if (item.kind === "running_timer")
    return state.outbox.some((m) => (m.type === "feed_action" || m.type === "session_action") && m.record_id === item.data.record_id);
  return false;
}

/** What a caregiver hears, as on the API. Everything else is for parents. */
const caregiverHears = new Set(["event", "running_timer"]);
/** This phone's list is only as old as its last fetch, and a fetch can fail. What it shows goes by the access it has now. */
function stillHers(bootstrap: DeviceState["bootstrap"], item: DueReminder) {
  if (bootstrap?.active === false) return false;
  if (!spacesLive(bootstrap)) return true;
  const space = bootstrap!.spaces!.find((known) => known.id === (item.space_id ?? bootstrap!.personal_space_id));
  return !!space && (space.role !== "caregiver" || caregiverHears.has(item.kind));
}
/** Today's list: from the API, whatever delivery did. Nothing shows with its flag off, whatever this phone kept. */
export function shownDue(state: Pick<DeviceState, "bootstrap" | "dueReminders" | "dismissing" | "outbox">): DueReminder[] {
  if (!remindersOn(state.bootstrap)) return [];
  const dismissing = new Set(state.dismissing ?? []);
  return (state.dueReminders ?? []).filter((item) => stillHers(state.bootstrap, item) && !dismissing.has(item.id) && !answeredHere(state, item));
}

/** Quiet whichever way it goes: without an answer Today keeps what it was last told. */
export async function refreshDue(api: Pick<BabyApi, "dueReminders">, commit: Commit) {
  let answer: Awaited<ReturnType<BabyApi["dueReminders"]>>;
  try {
    answer = await api.dueReminders();
  } catch {
    return;
  }
  await commit((s) => (JSON.stringify(s.dueReminders ?? []) === JSON.stringify(answer.items) ? s : { ...s, dueReminders: answer.items })).catch(() => undefined);
}

export async function dismissReminder(b: Account, id: string) {
  await b.commit((s) => ({ ...s, dismissing: [...new Set([...(s.dismissing ?? []), id])] }));
  void b.sync();
}

/** Repeating one changes nothing on the API, so it just waits here until it's been heard. */
export async function sendDismissals(api: Pick<BabyApi, "dismissReminder">, commit: Commit, state: () => DeviceState) {
  for (const id of state().dismissing ?? []) {
    try {
      await api.dismissReminder(id);
    } catch (failure) {
      if (failure instanceof ApiError && !failure.local && failure.status !== 0 && failure.status < 500 && failure.status !== 401 && failure.status !== 429) {
        /* Refused, as with the flag off: nothing would change by asking again. */
      } else return;
    }
    await commit((s) => ({ ...s, dismissing: (s.dismissing ?? []).filter((held) => held !== id), dueReminders: (s.dueReminders ?? []).filter((item) => item.id !== id) }));
  }
}
