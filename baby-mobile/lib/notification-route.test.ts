import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createReminderTapController,
  notificationResponseKey,
  reminderDestination,
  reminderGoneMessage,
  reminderOfflineMessage,
  reminderTapDecision,
  reminderNotificationData,
  reminderNavigationReady,
  type ReminderTapEnvironment,
  type ReminderTapSession,
} from "./notification-route";
const id = "378b714d-a2b5-444a-a3bc-c7c9ec7708bd",
  other = "49cf55e1-f49c-42b9-9207-a66dfe1c563e",
  action = "default-tap";
function response(data: unknown = { babyOwner: "owner", generation: 4, recordId: id }, date = 100) {
  return {
    actionIdentifier: action,
    notification: { date, request: { identifier: "repeating-reminder", content: { data } } },
  };
}
const fixtureSession: ReminderTapSession = {
  owner: "owner",
  generation: 4,
  active: true,
  ready: true,
  navigationReady: true,
  lease: 1,
};
function fixture() {
  let session: ReminderTapSession | null = fixtureSession;
  let destination = "/";
  const cache = new Map<string, { id: string; kind: string }>(),
    deleted = new Set<string>();
  const env: ReminderTapEnvironment = {
    session: () => session,
    current: () => true,
    destination: () => destination,
    cached: (id) => cache.get(id),
    deleted: (id) => deleted.has(id),
    fetch: vi.fn(async (id) => ({ id, kind: "routine" })),
    open: vi.fn((id) => {
      destination = "/record/" + id;
    }),
    fallback: vi.fn(() => {
      destination = "/routines";
    }),
    retry: vi.fn(),
    acknowledge: vi.fn(),
    lookup: vi.fn(async (id) => ({ id, kind: "feed_interval", space_id: "space", data: { child_id: "baby" } })),
    place: vi.fn(async () => true),
    openReminder: vi.fn((place) => {
      destination = place.path;
    }),
    today: vi.fn(() => {
      destination = "/";
    }),
  };
  return {
    env,
    destination: (path: string) => {
      destination = path;
    },
    cache,
    deleted,
    set: (value: ReminderTapSession | null) => {
      session = value;
    },
    session: () => session!,
    controller: createReminderTapController(env, action, 1000),
  };
}
afterEach(() => vi.useRealTimers());
describe("notification route privacy and recovery", () => {
  it("defers cold state until identity, bootstrap, and navigation are ready, then opens cached routine offline", async () => {
    const f = fixture();
    f.set(null);
    await f.controller.offer(response());
    expect(f.env.fetch).not.toHaveBeenCalled();
    f.set({ owner: "owner", generation: 4, active: true, ready: true, navigationReady: false, lease: 1 });
    await f.controller.resume();
    expect(f.env.open).not.toHaveBeenCalled();
    f.cache.set(id, { id, kind: "routine" });
    f.set({ ...f.session(), navigationReady: true });
    await f.controller.resume();
    expect(f.env.open).toHaveBeenCalledExactlyOnceWith(id);
    expect(f.env.fetch).not.toHaveBeenCalled();
    expect(f.env.acknowledge).toHaveBeenCalledWith(notificationResponseKey(response()));
  });
  it.each([
    { babyOwner: "another", generation: 4, recordId: id },
    { babyOwner: "owner", generation: 3, recordId: id },
    { babyOwner: "owner", generation: "4", recordId: id },
    { babyOwner: "owner", recordId: id },
  ])("rejects foreign, stale and unversioned response data", async (data) => {
    const f = fixture();
    await f.controller.offer(response(data));
    expect(f.env.open).not.toHaveBeenCalled();
    expect(f.env.fetch).not.toHaveBeenCalled();
    expect(f.env.fallback).not.toHaveBeenCalled();
    expect(f.env.acknowledge).toHaveBeenCalled();
  });
  it("ignores a deleted product even before navigation mounts", async () => {
    const f = fixture();
    f.set({ ...f.session(), active: false, navigationReady: false });
    await f.controller.offer(response());
    expect(f.env.open).not.toHaveBeenCalled();
    expect(f.env.fetch).not.toHaveBeenCalled();
    expect(f.env.acknowledge).toHaveBeenCalledOnce();
  });
  it("never follows an arbitrary URL or reads a malformed ID", async () => {
    const f = fixture();
    await f.controller.offer(response({ babyOwner: "owner", generation: 4, recordId: "https://example.com/private" }));
    expect(f.env.fetch).not.toHaveBeenCalled();
    expect(f.env.open).not.toHaveBeenCalled();
    expect(f.env.fallback).toHaveBeenCalledOnce();
  });
  it("recovers a wrong-kind or locally deleted record in Routines", async () => {
    const f = fixture();
    f.cache.set(id, { id, kind: "journal" });
    await f.controller.offer(response());
    expect(f.env.open).not.toHaveBeenCalled();
    expect(f.env.fallback).toHaveBeenCalledOnce();
    f.deleted.add(other);
    await f.controller.offer(response({ babyOwner: "owner", generation: 4, recordId: other }, 200));
    expect(f.env.fetch).not.toHaveBeenCalled();
    expect(f.env.fallback).toHaveBeenCalledTimes(2);
  });
  it("deduplicates simultaneous cold/hot delivery but allows tomorrow’s repeating reminder", async () => {
    const f = fixture();
    let resolve!: (value: { id: string; kind: string }) => void;
    f.env.fetch = vi.fn(
      () =>
        new Promise<{ id: string; kind: string }>((done) => {
          resolve = done;
        })
    );
    const first = f.controller.offer(response());
    await Promise.resolve();
    await f.controller.offer(response());
    resolve({ id, kind: "routine" });
    await first;
    await f.controller.offer(response());
    expect(f.env.open).toHaveBeenCalledOnce();
    f.cache.set(id, { id, kind: "routine" });
    await f.controller.offer(response(undefined, 200));
    expect(f.env.open).toHaveBeenCalledTimes(2);
  });
  it.each(["owner", "generation"] as const)("fences an in-flight lookup if %s changes", async (field) => {
    const f = fixture();
    let resolve!: (value: { id: string; kind: string }) => void;
    f.env.fetch = vi.fn(
      () =>
        new Promise<{ id: string; kind: string }>((done) => {
          resolve = done;
        })
    );
    const pending = f.controller.offer(response());
    await Promise.resolve();
    f.set({ ...f.session(), [field]: field === "owner" ? "other" : 9 });
    resolve({ id, kind: "routine" });
    await pending;
    expect(f.env.open).not.toHaveBeenCalled();
    expect(f.env.fallback).not.toHaveBeenCalled();
    expect(f.env.acknowledge).toHaveBeenCalledOnce();
  });
  it("lets a newer tap win over an older lookup and acknowledges only the newer response", async () => {
    const f = fixture();
    let resolve!: (value: { id: string; kind: string }) => void;
    f.env.fetch = vi.fn(
      () =>
        new Promise<{ id: string; kind: string }>((done) => {
          resolve = done;
        })
    );
    const pending = f.controller.offer(response());
    await Promise.resolve();
    f.cache.set(other, { id: other, kind: "routine" });
    await f.controller.offer(response({ babyOwner: "owner", generation: 4, recordId: other }, 200));
    resolve({ id, kind: "routine" });
    await pending;
    expect(f.env.open).toHaveBeenCalledExactlyOnceWith(other);
    expect(f.env.acknowledge).toHaveBeenCalledTimes(1);
  });
  it("bounds a stuck lookup and recovers in Routines", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.env.fetch = vi.fn(() => new Promise<{ id: string; kind: string }>(() => {}));
    const pending = f.controller.offer(response());
    await vi.advanceTimersByTimeAsync(1001);
    await pending;
    expect(f.env.fallback).toHaveBeenCalledOnce();
    expect(f.env.acknowledge).toHaveBeenCalledOnce();
  });
  it("disposes timers and never navigates after unmount", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.env.fetch = vi.fn(() => new Promise<{ id: string; kind: string }>(() => {}));
    const pending = f.controller.offer(response());
    f.controller.dispose();
    await pending;
    expect(f.env.open).not.toHaveBeenCalled();
    expect(f.env.fallback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps a navigation failure retryable instead of acknowledging lost navigation", async () => {
    const f = fixture();
    f.cache.set(id, { id, kind: "routine" });
    f.env.open = vi.fn(() => {
      throw Error("navigation unavailable");
    });
    await f.controller.offer(response());
    expect(f.env.acknowledge).not.toHaveBeenCalled();
    f.env.open = vi.fn((value) => f.destination("/record/" + value));
    await f.controller.offer(response());
    expect(f.env.open).toHaveBeenCalledWith(id);
    expect(f.env.acknowledge).toHaveBeenCalledOnce();
  });
  it("ignores unsupported actions and malformed envelopes safely", () => {
    const f = fixture();
    expect(reminderTapDecision({ ...response(), actionIdentifier: "dismiss" }, f.session(), action)).toEqual({
      kind: "ignore",
    });
    expect(notificationResponseKey({ notification: null })).toBeNull();
  });
});

it("includes generation in both scheduled routing data and replacement signature", () => {
  const record = {
    id,
    revision: 3,
    data: { enabled: true, reminder_at: "2026-10-20T01:00:00Z", repeat: "daily" as const },
  };
  const before = reminderNotificationData("owner", 4, record),
    after = reminderNotificationData("owner", 5, record);
  expect(after).toMatchObject({ babyOwner: "owner", generation: 5, recordId: id });
  expect(after.signature).not.toBe(before.signature);
  expect(() => reminderNotificationData("owner", NaN, record)).toThrow("Open your Baby account");
});

it("normalizes a valid UUID without interpreting it as a path", () => {
  const f = fixture();
  expect(
    reminderTapDecision(
      response({ babyOwner: "owner", generation: 4, recordId: id.toUpperCase() }),
      f.session(),
      action
    )
  ).toEqual({ kind: "routine", id });
});

describe("cold-start dispatch and observed navigation", () => {
  it("distinguishes root index from Today even though both pathnames are slash", () => {
    expect(reminderNavigationReady(true, "/", [])).toBe(false);
    expect(reminderNavigationReady(true, "/", ["(tabs)"])).toBe(true);
    expect(reminderNavigationReady(true, "/sign-in", ["sign-in"])).toBe(false);
  });
  it("defers the cold response until the index redirect settles in Today", async () => {
    const f = fixture();
    f.cache.set(id, { id, kind: "routine" });
    f.set({ ...f.session(), navigationReady: reminderNavigationReady(true, "/", []) });
    await f.controller.offer(response());
    expect(f.env.open).not.toHaveBeenCalled();
    expect(f.env.acknowledge).not.toHaveBeenCalled();
    f.set({ ...f.session(), navigationReady: reminderNavigationReady(true, "/", ["(tabs)"]) });
    await f.controller.resume();
    expect(f.env.open).toHaveBeenCalledExactlyOnceWith(id);
    expect(f.env.acknowledge).toHaveBeenCalledOnce();
  });
  it("does not acknowledge router.push being queued before its destination is observed", async () => {
    const f = fixture();
    f.cache.set(id, { id, kind: "routine" });
    f.env.open = vi.fn();
    const opening = f.controller.offer(response());
    await Promise.resolve();
    await Promise.resolve();
    expect(f.env.open).toHaveBeenCalledWith(id);
    expect(f.env.acknowledge).not.toHaveBeenCalled();
    f.destination("/");
    await f.controller.resume();
    expect(f.env.acknowledge).not.toHaveBeenCalled();
    f.destination("/record/" + id);
    await f.controller.resume();
    await opening;
    expect(f.env.acknowledge).toHaveBeenCalledOnce();
  });
  it("also waits for the Routines fallback to be observed", async () => {
    const f = fixture();
    f.cache.set(id, { id, kind: "journal" });
    f.env.fallback = vi.fn();
    const opening = f.controller.offer(response());
    await Promise.resolve();
    await Promise.resolve();
    expect(f.env.fallback).toHaveBeenCalledOnce();
    expect(f.env.acknowledge).not.toHaveBeenCalled();
    f.destination("/routines");
    await f.controller.resume();
    await opening;
    expect(f.env.acknowledge).toHaveBeenCalledOnce();
  });
  it("retains lease-zero cold response and routes only the fresh lease-one lookup", async () => {
    const f = fixture();
    f.set({ ...f.session(), lease: 0 });
    let stale!: (value: { id: string; kind: string }) => void, fresh!: (value: { id: string; kind: string }) => void;
    f.env.fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ id: string; kind: string }>((r) => {
            stale = r;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ id: string; kind: string }>((r) => {
            fresh = r;
          })
      );
    const first = f.controller.offer(response());
    await Promise.resolve();
    f.set({ ...f.session(), lease: 1 });
    void f.controller.resume();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    expect(f.env.fetch).toHaveBeenCalledTimes(2);
    expect(f.env.open).not.toHaveBeenCalled();
    expect(f.env.acknowledge).not.toHaveBeenCalled();
    stale({ id, kind: "routine" });
    await Promise.resolve();
    expect(f.env.open).not.toHaveBeenCalled();
    fresh({ id, kind: "routine" });
    await vi.waitFor(() => expect(f.env.acknowledge).toHaveBeenCalledOnce());
    expect(f.env.open).toHaveBeenCalledExactlyOnceWith(id);
  });
  it("retries pending navigation under a new lease without acknowledging the old queued route", async () => {
    const f = fixture();
    f.cache.set(id, { id, kind: "routine" });
    f.env.open = vi.fn();
    const first = f.controller.offer(response());
    await Promise.resolve();
    await Promise.resolve();
    f.set({ ...f.session(), lease: 2 });
    void f.controller.resume();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    expect(f.env.open).toHaveBeenCalledTimes(2);
    expect(f.env.acknowledge).not.toHaveBeenCalled();
    f.destination("/record/" + id);
    await f.controller.resume();
    await vi.waitFor(() => expect(f.env.acknowledge).toHaveBeenCalledOnce());
  });
  it("keeps the response retryable if both queued destinations fail to appear", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.cache.set(id, { id, kind: "routine" });
    f.env.open = vi.fn();
    f.env.fallback = vi.fn();
    const opening = f.controller.offer(response());
    await vi.advanceTimersByTimeAsync(10001);
    await opening;
    expect(f.env.fallback).toHaveBeenCalledOnce();
    expect(f.env.retry).toHaveBeenCalledOnce();
    expect(f.env.acknowledge).not.toHaveBeenCalled();
    f.env.open = vi.fn((value) => f.destination("/record/" + value));
    await f.controller.resume();
    expect(f.env.acknowledge).toHaveBeenCalledOnce();
  });
  it("cancels navigation confirmation timers on unmount", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.cache.set(id, { id, kind: "routine" });
    f.env.open = vi.fn();
    const opening = f.controller.offer(response());
    await Promise.resolve();
    await Promise.resolve();
    f.controller.dispose();
    await opening;
    expect(f.env.acknowledge).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("does not confirm an older queued route after a newer notification tap takes over", async () => {
  const f = fixture();
  f.cache.set(id, { id, kind: "routine" });
  f.cache.set(other, { id: other, kind: "routine" });
  f.env.open = vi.fn();
  const old = f.controller.offer(response());
  await Promise.resolve();
  await Promise.resolve();
  const newerResponse = response({ babyOwner: "owner", generation: 4, recordId: other }, 200),
    newer = f.controller.offer(newerResponse);
  await Promise.resolve();
  await Promise.resolve();
  f.destination("/record/" + id);
  await f.controller.resume();
  expect(f.env.acknowledge).not.toHaveBeenCalled();
  f.destination("/record/" + other);
  await f.controller.resume();
  await Promise.all([old, newer]);
  expect(f.env.open).toHaveBeenCalledTimes(2);
  expect(f.env.acknowledge).toHaveBeenCalledExactlyOnceWith(notificationResponseKey(newerResponse));
});

it("does not acknowledge a late destination after its account generation has been retired", async () => {
  const f = fixture();
  f.cache.set(id, { id, kind: "routine" });
  f.env.open = vi.fn();
  const opening = f.controller.offer(response());
  await Promise.resolve();
  await Promise.resolve();
  f.set({ ...f.session(), ready: false, generation: 5, lease: 2 });
  f.destination("/record/" + id);
  await f.controller.resume();
  await opening;
  expect(f.env.open).toHaveBeenCalledTimes(1);
  expect(f.env.acknowledge).not.toHaveBeenCalled();
  f.set({ ...f.session(), ready: true });
  await f.controller.resume();
  expect(f.env.open).toHaveBeenCalledTimes(1);
  expect(f.env.acknowledge).toHaveBeenCalledOnce();
});

it("keeps the notification fallback on the pushed routines route", async () => {
  const { reminderRoutes } = await import("./notification-route");
  expect(reminderRoutes.routines).toBe("/routines");
});

describe("a tap on a server reminder", () => {
  const server = (id = other) => response({ notification_id: id, space_id: "space", identity: "abc" });
  it("a payload with no type looks it up, and opens where that kind lives", async () => {
    const f = fixture();
    f.destination("/settings");
    await f.controller.offer(server());
    expect(f.env.lookup).toHaveBeenCalledWith(other);
    expect(f.env.place).toHaveBeenCalledOnce();
    expect(f.env.openReminder).toHaveBeenCalledWith(expect.objectContaining({ path: "/" }));
    expect(f.env.today).not.toHaveBeenCalled();
    expect(f.env.acknowledge).toHaveBeenCalledOnce();
    expect(f.env.fetch).not.toHaveBeenCalled();
  });
  it("needs no owner or generation in the payload: the lookup is the check", () => {
    const f = fixture();
    expect(reminderTapDecision(server(), f.session(), action)).toEqual({ kind: "reminder", id: other });
  });
  it("waits for the account and navigation, like any other tap", async () => {
    const f = fixture();
    f.set(null);
    await f.controller.offer(server());
    expect(f.env.lookup).not.toHaveBeenCalled();
    f.set({ ...fixtureSession, navigationReady: false });
    await f.controller.resume();
    expect(f.env.lookup).not.toHaveBeenCalled();
    f.set(fixtureSession);
    await f.controller.resume();
    expect(f.env.lookup).toHaveBeenCalledOnce();
  });
  it("a silent refresh or a malformed id is no tap at all", async () => {
    const f = fixture();
    await f.controller.offer(response({ refresh: true }));
    await f.controller.offer(response({ notification_id: "../../evil" }));
    expect(f.env.lookup).not.toHaveBeenCalled();
    expect(f.env.today).not.toHaveBeenCalled();
  });
  it("gone, or she's lost access: Today, with a plain word", async () => {
    const f = fixture();
    f.destination("/settings");
    f.env.lookup = vi.fn(async () => null);
    await f.controller.offer(server());
    expect(f.env.today).toHaveBeenCalledWith(reminderGoneMessage);
    expect(f.env.openReminder).not.toHaveBeenCalled();
    expect(f.env.acknowledge).toHaveBeenCalledOnce();
  });
  it("offline: Today, saying why, never a blank screen", async () => {
    const f = fixture();
    f.destination("/settings");
    f.env.lookup = vi.fn(async () => { throw Error("offline"); });
    await f.controller.offer(server());
    expect(f.env.today).toHaveBeenCalledWith(reminderOfflineMessage);
    expect(f.env.acknowledge).toHaveBeenCalledOnce();
  });
  it("a lookup that hangs ends at Today too", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.destination("/settings");
      f.env.lookup = vi.fn(() => new Promise<never>(() => {}));
      const tap = f.controller.offer(server());
      await vi.advanceTimersByTimeAsync(1001);
      await tap;
      expect(f.env.today).toHaveBeenCalledWith(reminderOfflineMessage);
    } finally { vi.useRealTimers(); }
  });
  it("a reminder for somewhere this phone can't place goes to Today", async () => {
    const f = fixture();
    f.destination("/settings");
    f.env.place = vi.fn(async () => false);
    await f.controller.offer(server());
    expect(f.env.today).toHaveBeenCalledWith(reminderGoneMessage);
    expect(f.env.openReminder).not.toHaveBeenCalled();
  });
  it("a kind this build doesn't know goes to Today rather than nowhere", async () => {
    const f = fixture();
    f.destination("/settings");
    f.env.lookup = vi.fn(async (id) => ({ id, kind: "from_the_future", data: {} }));
    await f.controller.offer(server());
    expect(f.env.today).toHaveBeenCalledWith(reminderGoneMessage);
  });
  it("a different account's session mid-lookup keeps the tap rather than opening anything", async () => {
    const f = fixture();
    let finish!: (value: null) => void;
    f.env.lookup = vi.fn(() => new Promise<null>((resolve) => { finish = resolve; }));
    const tap = f.controller.offer(server());
    await Promise.resolve();
    await Promise.resolve();
    f.set({ ...fixtureSession, owner: "someone-else" });
    finish(null);
    await tap;
    expect(f.env.today).not.toHaveBeenCalled();
    expect(f.env.acknowledge).not.toHaveBeenCalled();
  });
  it("the same delivery tapped twice is handled once", async () => {
    const f = fixture();
    await f.controller.offer(server());
    await f.controller.offer(server());
    expect(f.env.lookup).toHaveBeenCalledOnce();
  });
  it("an old local routine notification still opens the old way", async () => {
    const f = fixture();
    f.destination("/settings");
    await f.controller.offer(response());
    expect(f.env.lookup).not.toHaveBeenCalled();
    expect(f.env.open).toHaveBeenCalledWith(id);
  });
});

describe("where each kind opens", () => {
  const item = (kind: string, data: Record<string, unknown>) => ({ id: other, kind, data });
  it.each([
    ["event", { event_id: id, original_start: "2026-11-20T10:00:00+00:00" }, { path: `/event/${id}`, pathname: "/event/[id]", params: { id, at: "2026-11-20T10:00:00+00:00" } }],
    ["visit_prep", { date: "2026-11-20" }, { path: "/tracker", pathname: "/tracker", params: { day: "2026-11-20" } }],
    ["import", { record_id: id }, { path: `/record/${id}`, pathname: "/record/[id]", params: { id } }],
    ["routine", { record_id: id }, { path: `/record/${id}`, pathname: "/record/[id]", params: { id } }],
    ["feed_interval", { record_id: id, child_id: "baby" }, { path: "/", pathname: "/(tabs)/(today)", child: "baby" }],
    ["running_timer", { record_id: id, child_id: "baby" }, { path: "/", pathname: "/(tabs)/(today)", child: "baby" }],
    ["pregnancy_week", { child_id: "baby", week: 37 }, { path: "/", pathname: "/(tabs)/(today)", child: "baby" }],
    ["milestone_window", {}, { path: "/milestones", pathname: "/milestones" }],
    ["well_visit", {}, { path: "/well-visits", pathname: "/well-visits" }],
  ])("%s", (kind, data, place) => {
    expect(reminderDestination(item(kind, data))).toMatchObject(place);
  });
  it("a kind with what it needs missing has nowhere to open", () => {
    expect(reminderDestination(item("event", {}))).toBeNull();
    expect(reminderDestination(item("import", {}))).toBeNull();
    expect(reminderDestination(item("nonsense", {}))).toBeNull();
    expect(reminderDestination(item("event", { event_id: "../settings" }))).toBeNull();
  });
});
