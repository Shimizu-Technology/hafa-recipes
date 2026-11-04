import { describe, expect, it } from "vitest";
import { feedProgress, instant, newestFirst, orderActions, reduceFeed, retimedActions, roundMinutes, runningFeed, runningLimit, withFeedAction, withRecordAction } from "./feed-reducer";
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
      expect(reduceFeed(order)).toEqual({ state: "finished", started_at: at(0), start_side: "left", side: "both", end_at: at(9), duration_minutes: 9, segments: [
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
    expect(reduceFeed([finish(0, "z"), start(5)])).toEqual({ state: "finished", started_at: at(5), start_side: "left", side: undefined, segments: [], end_at: at(0) });
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
  it("keeps to its own baby, and ignores one past the limit", () => {
    expect(runningFeed([feed("sibling", [start(5)], "other")], "baby", now)).toBeUndefined();
    const edge = new Date(new Date(at(0)).getTime() + runningLimit);
    expect(runningFeed([feed("x", [start(0)])], "baby", new Date(edge.getTime() - 1))).toBeDefined();
    expect(runningFeed([feed("x", [start(0)])], "baby", edge)).toBeUndefined();
  });
  it("leaves records from before actions alone", () => {
    expect(runningFeed([optimisticRecord({ id: "plain", kind: "feeding", title: "", body: "", child_id: "baby", occurred_at: at(9), data: { method: "breast", side: "left" } })], "baby", now)).toBeUndefined();
  });
});

describe("matching the API exactly", () => {
  const started = "2026-11-04T12:00:00.000Z", plus = (seconds: number) => new Date(new Date(started).getTime() + seconds * 1000).toISOString();
  it.each([[61.5, 1.02], [7.5, 0.12], [37.5, 0.62], [67.5, 1.12], [22.5, 0.38], [52.5, 0.88], [90, 1.5], [0, 0], [540, 9], [100, 1.67], [3599.4, 59.99]])(
    "rounds %d seconds to the same %d minutes Python's round gives", (seconds, minutes) => {
      expect(reduceFeed([{ ...start(0), at: started }, { id: "end", action: "finish", at: plus(seconds) }])?.duration_minutes).toBe(minutes);
    });
  it("rounds a true tie to the even digit, and anything else by its exact value", () => {
    expect(roundMinutes(0.125)).toBe(0.12);
    expect(roundMinutes(0.375)).toBe(0.38);
    expect(roundMinutes(1.025)).toBe(1.02);
  });
  it("compares microseconds where the API does, whatever the offset", () => {
    expect(instant("2026-11-04T12:00:00.000200Z") - instant("2026-11-04T12:00:00.000100Z")).toBe(100);
    expect(instant("2026-11-04T22:00:00.000100+10:00")).toBe(instant("2026-11-04T12:00:00.0001Z"));
    const first: FeedAction = { id: "z", action: "switch", at: "2026-11-04T12:00:00.000100Z", side: "right" }, second: FeedAction = { id: "a", action: "finish", at: "2026-11-04T12:00:00.000200Z" };
    expect(orderActions([second, first]).map((a) => a.id)).toEqual(["z", "a"]);
  });
  it("orders ids as lowercase text, as stored", () => {
    const upper: FeedAction = { id: "B", action: "switch", at: at(1), side: "right" }, lower: FeedAction = { id: "a", action: "finish", at: at(1) };
    expect(orderActions([upper, lower]).map((a) => a.id)).toEqual(["a", "B"]);
  });
  it("gives a feed finished before its start the start's side, not the side stored before", () => {
    const data = withFeedAction({ method: "breast", side: "right", state: "running", actions: [start(5, "left")] }, finish(0));
    expect(data).toMatchObject({ side: "left", state: "finished" });
  });
  it("keeps the start time apart from the first segment, for the 60-minute limit and the entry's time", () => {
    const early = swap(0, "right"), late = start(50, "left");
    expect(reduceFeed([early, late])?.started_at).toBe(at(50));
    expect(reduceFeed([early, late])?.segments[0].started_at).toBe(at(0));
    expect(runningFeed([feed("x", [early, late])], "baby", new Date(new Date(at(0)).getTime() + runningLimit + 60_000))?.started_at).toBe(at(50));
    expect(withRecordAction(feed("x", [swap(5, "left")]), start(2, "left")).occurred_at).toBe(at(2));
  });
  it("ties on time go to the higher record id, however the times are written", () => {
    const a = { id: "a", occurred_at: "2026-11-04T22:00:00+10:00" }, b = { id: "b", occurred_at: "2026-11-04T12:00:00.000Z" };
    expect([a, b].sort(newestFirst)[0].id).toBe("b");
    expect(runningFeed([feed("a", [start(0)]), feed("b", [start(0)])], "baby", new Date(at(5)))?.record.id).toBe("b");
  });
});

describe("one settlement for every screen", () => {
  const moment = new Date(at(10));
  it("gives the older feed back after Undo, even with a cached unknown_end", () => {
    const old = feed("older", [start(0)], "baby", { state: "unknown_end" });
    expect(runningFeed([old], "baby", moment)?.record.id).toBe("older");
    expect(feedProgress(old, [old], moment)).toBe("running");
  });
  it("never calls an older feed running offline, whatever it has stored", () => {
    const old = feed("older", [start(0)]), newer = feed("newer", [start(5)]);
    expect(feedProgress(old, [old, newer], moment)).toBe("no_end");
    expect(feedProgress(newer, [old, newer], moment)).toBe("running");
    expect(feedProgress(old, [old, plain("both", 5, "breast", "both")], moment)).toBe("no_end");
  });
  it("calls one past the limit no end, one finished finished, and plain entries nothing", () => {
    const old = feed("older", [start(0)]);
    expect(feedProgress(old, [old], new Date(new Date(at(0)).getTime() + runningLimit))).toBe("no_end");
    expect(feedProgress(feed("x", [start(0), finish(3)]), [], moment)).toBe("finished");
    expect(feedProgress(plain("both", 5, "breast", "both"), [], moment)).toBeUndefined();
  });
});
