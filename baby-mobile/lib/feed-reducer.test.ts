import { describe, expect, it } from "vitest";
import { orderActions, reduceFeed, retimedActions, runningFeed, runningLimit, withFeedAction } from "./feed-reducer";
import { optimisticRecord, type BabyRecord, type FeedAction } from "./models";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 4, 12, minutes)).toISOString();
const start = (minute = 0, side: "left" | "right" = "left", id = "a-start"): FeedAction => ({ id, action: "start", at: at(minute), side });
const swap = (minute: number, side: "left" | "right", id = `switch-${minute}`): FeedAction => ({ id, action: "switch", at: at(minute), side });
const finish = (minute: number, id = `finish-${minute}`): FeedAction => ({ id, action: "finish", at: at(minute) });
function permutations<T>(items: T[]): T[][] {
  return items.length < 2 ? [items] : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

describe("the reducer gives one result whatever the arrival order", () => {
  it("for a switch that arrives after the finish", () => {
    for (const order of permutations([start(0), swap(5, "right"), finish(9)]))
      expect(reduceFeed(order)).toEqual({ state: "finished", start_side: "left", side: "both", end_at: at(9), duration_minutes: 9, segments: [
        { side: "left", started_at: at(0), ended_at: at(5) }, { side: "right", started_at: at(5), ended_at: at(9) }] });
  });
  it("when two phones finish: the earliest is terminal, and what follows has no effect", () => {
    for (const order of permutations([start(0), finish(9), swap(10, "right"), finish(12)]))
      expect(reduceFeed(order)).toMatchObject({ state: "finished", side: "left", end_at: at(9), duration_minutes: 9 });
  });
  it("breaking timestamp ties by action id", () => {
    const first = finish(5, "a-finish"), second = swap(5, "right", "b-switch");
    for (const order of permutations([start(0), first, second])) expect(reduceFeed(order)).toMatchObject({ state: "finished", side: "left", end_at: at(5) });
    const earlier = swap(5, "right", "a-switch"), later = finish(5, "b-finish");
    for (const order of permutations([start(0), earlier, later])) expect(reduceFeed(order)).toMatchObject({ state: "finished", side: "both", duration_minutes: 5 });
  });
  it("orders by real time, not by the text of a timestamp", () => {
    const zoned: FeedAction = { id: "z", action: "start", at: "2026-11-04T22:00:00+10:00", side: "left" }, utc: FeedAction = { id: "u", action: "finish", at: "2026-11-04T12:30:00Z" };
    expect(orderActions([utc, zoned]).map((a) => a.id)).toEqual(["z", "u"]);
  });
});

it("has no duration until it is finished, and nothing to say without an action", () => {
  expect(reduceFeed([start(0), swap(5, "right")])).toMatchObject({ state: "running", side: "both", start_side: "left" });
  expect(reduceFeed([start(0)])?.duration_minutes).toBeUndefined();
  expect(reduceFeed([start(0)])?.end_at).toBeUndefined();
  expect(reduceFeed(undefined)).toBeUndefined();
  expect(reduceFeed([])).toBeUndefined();
});

describe("matches the API where clocks disagree", () => {
  it("skips a switch to the side already running", () => {
    expect(reduceFeed([start(0), swap(3, "left")])).toMatchObject({ side: "left", segments: [{ side: "left", started_at: at(0) }] });
  });
  it("treats a finish stamped before the start as terminal: the earliest finish ends it", () => {
    expect(reduceFeed([finish(0, "z"), start(5)])).toEqual({ state: "finished", start_side: "left", side: undefined, segments: [], end_at: at(0) });
  });
  it("opens the first segment at a switch stamped before the start, and counts it", () => {
    expect(reduceFeed([swap(0, "right"), start(2, "left"), finish(4)])).toMatchObject({ side: "both", start_side: "left", duration_minutes: 4,
      segments: [{ side: "right", started_at: at(0), ended_at: at(2) }, { side: "left", started_at: at(2), ended_at: at(4) }] });
  });
  it("still derives from a switch or a finish with no start", () => {
    expect(reduceFeed([swap(1, "right")])).toMatchObject({ state: "running", side: "right", start_side: "right" });
    expect(reduceFeed([finish(1)])).toMatchObject({ state: "finished", segments: [] });
  });
  it("gives minutes to two decimals with no minimum, and none past a day", () => {
    const seconds = (s: number) => new Date(Date.UTC(2026, 10, 4, 12, 0, s)).toISOString();
    expect(reduceFeed([start(0), { id: "f", action: "finish", at: seconds(20) }])?.duration_minutes).toBe(0.33);
    const long = { id: "f", action: "finish" as const, at: new Date(Date.UTC(2026, 10, 6, 12, 1)).toISOString() };
    expect(reduceFeed([start(0), long])).toMatchObject({ state: "finished", end_at: long.at });
    expect(reduceFeed([start(0), long])?.duration_minutes).toBeUndefined();
  });
  it("sorts ids as plain text, not by locale", () => {
    const hyphen: FeedAction = { id: "a-b", action: "switch", at: at(1), side: "right" }, letter: FeedAction = { id: "aab", action: "switch", at: at(1), side: "left" };
    // "-" sorts before "a" in code units; a locale compare would ignore it.
    expect(orderActions([letter, hyphen]).map((a) => a.id)).toEqual(["a-b", "aab"]);
  });
  it("moves the start when a time is corrected, and leaves the other taps", () => {
    expect(retimedActions([start(5), swap(7, "right")], at(1)).map((a) => [a.action, a.at])).toEqual([["start", at(1)], ["switch", at(7)]]);
  });
});

it("applies an action once, however many times it is replayed", () => {
  const data = withFeedAction({ method: "breast", side: "left", state: "running", actions: [start(0)] }, finish(4));
  expect(data).toMatchObject({ state: "finished", duration_minutes: 4, end_at: at(4) });
  expect(withFeedAction(data, finish(4))).toBe(data);
});

const feed = (id: string, actions: FeedAction[], child = "baby", extra: Partial<BabyRecord["data"]> = {}): BabyRecord =>
  optimisticRecord({ id, kind: "feeding", title: "Feeding", body: "", child_id: child, occurred_at: actions[0]?.at ?? at(0), data: { method: "breast", actions, ...extra } });
const plain = (id: string, minute: number, method: "breast" | "bottle", side?: "both"): BabyRecord =>
  optimisticRecord({ id, kind: "feeding", title: "Feeding", body: "", child_id: "baby", occurred_at: at(minute), data: { method, ...(side ? { side } : {}) } });
const now = new Date(at(10));

describe("the running feed for a baby", () => {
  it("is the newest start, whichever record arrived first; the older one is no longer running", () => {
    const old = feed("older", [start(0, "left", "1")]), recent = feed("newer", [start(5, "right", "2")]);
    for (const rows of [[old, recent], [recent, old]]) expect(runningFeed(rows, "baby", now)?.record.id).toBe("newer");
  });
  it("breaks a tie by record id", () => {
    const a = feed("aaa", [start(5, "left", "1")]), b = feed("bbb", [start(5, "right", "2")]);
    for (const rows of [[a, b], [b, a]]) expect(runningFeed(rows, "baby", now)?.record.id).toBe("bbb");
  });
  it("is none when the newest start finished, even with an older one left open", () => {
    expect(runningFeed([feed("older", [start(0)]), feed("newer", [start(5), finish(7)])], "baby", now)).toBeUndefined();
  });
  it("is ended by a Both tap, but not by a bottle, which may be a top-up", () => {
    expect(runningFeed([feed("older", [start(0)]), plain("both", 5, "breast", "both")], "baby", now)).toBeUndefined();
    expect(runningFeed([feed("older", [start(0)]), plain("top-up", 5, "bottle")], "baby", now)?.record.id).toBe("older");
  });
  it("comes back when the newer feed is removed: it is derived, not sticky", () => {
    const old = feed("older", [start(0)]);
    expect(runningFeed([old, feed("newer", [start(5)])], "baby", now)?.record.id).toBe("newer");
    expect(runningFeed([old], "baby", now)?.record.id).toBe("older");
  });
  it("keeps to its own baby, and ignores a feed the server marked unknown_end or one past the limit", () => {
    expect(runningFeed([feed("sibling", [start(5)], "other")], "baby", now)).toBeUndefined();
    expect(runningFeed([feed("x", [start(5)], "baby", { state: "unknown_end" })], "baby", now)).toBeUndefined();
    const edge = new Date(new Date(at(0)).getTime() + runningLimit);
    expect(runningFeed([feed("x", [start(0)])], "baby", new Date(edge.getTime() - 1))).toBeDefined();
    expect(runningFeed([feed("x", [start(0)])], "baby", edge)).toBeUndefined();
  });
  it("leaves records from before actions alone", () => {
    expect(runningFeed([optimisticRecord({ id: "plain", kind: "feeding", title: "", body: "", child_id: "baby", occurred_at: at(9), data: { method: "breast", side: "left" } })], "baby", now)).toBeUndefined();
  });
});
