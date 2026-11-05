import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("expo-router", () => ({ router: { navigate: vi.fn() } }));
import { router } from "expo-router";
import { ApiError } from "./api";
import { reminderDestination } from "./notification-route";
import { lookUpTap, openPlace, placeReminder } from "./reminder-open";
import { emptyState, type DeviceState } from "./models";

const family = { id: "family", kind: "family", role: "parent", generation: 1, access_version: 1 };
function account(spaces?: unknown[], selected: string | null = null, afterRefresh?: unknown[]) {
  const b: any = {
    state: { ...emptyState(), selectedChild: selected, bootstrap: { generation: 1, spaces, children: [{ id: "baby", name: "A" }, { id: "other", name: "B" }] } } as unknown as DeviceState,
    refresh: vi.fn(async () => { if (afterRefresh) b.state = { ...b.state, bootstrap: { ...b.state.bootstrap, spaces: afterRefresh } }; }),
    commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { b.state = change(b.state); }),
  };
  return b;
}
const today = { path: "/", pathname: "/(tabs)/(today)" };

describe("getting ready for where a reminder lives", () => {
  it("with the family flag off there's one space and nothing to check", async () => {
    const b = account();
    expect(await placeReminder(() => b, { space_id: "personal" }, today)).toBe(true);
    expect(b.refresh).not.toHaveBeenCalled();
  });
  it("a family this phone knows opens straight away", async () => {
    const b = account([family]);
    expect(await placeReminder(() => b, { space_id: "family" }, today)).toBe(true);
    expect(b.refresh).not.toHaveBeenCalled();
  });
  it("a family it hasn't heard about yet: it reads its spaces first", async () => {
    const b = account([{ ...family, id: "personal" }], null, [{ ...family, id: "personal" }, family]);
    expect(await placeReminder(() => b, { space_id: "family" }, today)).toBe(true);
    expect(b.refresh).toHaveBeenCalledOnce();
  });
  it("one she's lost access to has no place here", async () => {
    const b = account([{ ...family, id: "personal" }]);
    expect(await placeReminder(() => b, { space_id: "family" }, today)).toBe(false);
  });
  it("selects the baby it's about, and leaves the choice alone otherwise", async () => {
    const b = account(undefined, "other");
    await placeReminder(() => b, {}, { ...today, child: "baby" });
    expect(b.state.selectedChild).toBe("baby");
    const c = account(undefined, "other");
    await placeReminder(() => c, {}, { ...today, child: "someone-removed" });
    expect(c.state.selectedChild).toBe("other");
    await placeReminder(() => c, {}, today);
    expect(c.commit).not.toHaveBeenCalled();
  });
});

describe("opening a place", () => {
  beforeEach(() => vi.mocked(router.navigate).mockClear());
  it("Tracker already open still moves to the reminder's day", () => {
    const place = reminderDestination({ kind: "visit_prep", data: { date: "2026-11-20" } })!;
    openPlace(place, "/tracker");
    expect(router.navigate).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/tracker", params: expect.objectContaining({ day: "2026-11-20" }) }));
  });
  it("Today already open has nothing to move to", () => {
    openPlace({ path: "/", pathname: "/(tabs)/(today)" }, "/");
    expect(router.navigate).not.toHaveBeenCalled();
  });
  it("somewhere else goes there", () => {
    openPlace({ path: "/", pathname: "/(tabs)/(today)" }, "/settings");
    expect(router.navigate).toHaveBeenCalledOnce();
  });
});

describe("looking up a tap", () => {
  const item = { id: "r", kind: "event", data: {} };
  const account = (reminders: { push: boolean } | undefined, tappedReminder: () => Promise<unknown>) =>
    ({ state: { bootstrap: { reminders } }, api: { tappedReminder } }) as any;
  it("with the flag off it asks nothing and finds nothing", async () => {
    const ask = vi.fn();
    await expect(lookUpTap(account(undefined, ask), "r")).resolves.toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
  it("finds what the API has", async () => {
    await expect(lookUpTap(account({ push: true }, async () => item), "r")).resolves.toEqual(item);
  });
  it.each([[404], [403], [409]])("an answer of %i means gone", async (status) => {
    await expect(lookUpTap(account({ push: true }, async () => { throw new ApiError("no", status); }), "r")).resolves.toBeNull();
  });
  it.each([[0], [503]])("no real answer (%i) is offline, not gone", async (status) => {
    await expect(lookUpTap(account({ push: true }, async () => { throw new ApiError("no", status); }), "r")).rejects.toBeInstanceOf(ApiError);
  });
});
