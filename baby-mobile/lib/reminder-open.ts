import { router } from "expo-router";
import type { useBaby } from "./context";
import { ApiError } from "./api";
import type { ReminderPlace, TappedReminder } from "./notification-route";
import { remindersOn } from "./spaces";

type Account = Pick<ReturnType<typeof useBaby>, "commit" | "refresh" | "state">;
const inSpace = (b: Account, space: string) => b.state.bootstrap?.spaces?.some((known) => known.id === space);

/**
 * Gets this phone ready for where a reminder lives: a family it hasn't heard about yet, the right baby selected. False when
 * it can't be. With no spaces listed the API has one space and there's nothing to check.
 */
export async function placeReminder(account: () => Account, item: Pick<TappedReminder, "space_id">, place: ReminderPlace) {
  const space = item.space_id;
  if (space && account().state.bootstrap?.spaces?.length && !inSpace(account(), space)) {
    await account().refresh();
    if (!inSpace(account(), space)) return false;
  }
  const b = account();
  if (place.child && b.state.selectedChild !== place.child && b.state.bootstrap?.children.some((child) => child.id === place.child))
    await b.commit((s) => ({ ...s, selectedChild: place.child! }));
  return true;
}
/** A place with params has somewhere to move even when it's already open, as with Tracker on another day. */
export function openPlace(place: ReminderPlace, pathname: string) {
  if (pathname !== place.path || place.params) router.navigate({ pathname: place.pathname, params: place.params } as Parameters<typeof router.navigate>[0]);
}
/**
 * What a tap was for. An answer means it's gone or isn't hers, and no answer means this phone can't tell yet, which throws.
 * With the API's flag off there's no one to ask, so an old notification is simply gone.
 */
export async function lookUpTap(b: Pick<ReturnType<typeof useBaby>, "api" | "state">, id: string) {
  if (!remindersOn(b.state.bootstrap)) return null;
  try {
    return await b.api.tappedReminder(id);
  } catch (failure) {
    if (failure instanceof ApiError && !failure.local && failure.status !== 0 && failure.status < 500) return null;
    throw failure;
  }
}
