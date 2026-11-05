import { describe, expect, it, vi } from "vitest";
vi.mock("expo-router", () => ({ router: { navigate: vi.fn() } }));
import { placeReminder } from "./reminder-open";
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
