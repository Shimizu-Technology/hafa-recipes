import { router } from "expo-router";
import type { useBaby } from "./context";
import type { ReminderPlace, TappedReminder } from "./notification-route";

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
export function openPlace(place: ReminderPlace, pathname: string) {
  if (pathname !== place.path) router.navigate({ pathname: place.pathname, params: place.params } as Parameters<typeof router.navigate>[0]);
}
