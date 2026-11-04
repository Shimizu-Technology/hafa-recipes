import { describe, expect, it } from "vitest";
import { orderActions, reduceFeed, runningFeed, runningLimit, withFeedAction } from "./feed-reducer";
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

it("has no duration until it is finished, and no result without a start", () => {
  expect(reduceFeed([start(0), swap(5, "right")])).toMatchObject({ state: "running", side: "both" });
  expect(reduceFeed([start(0)])?.duration_minutes).toBeUndefined();
  expect(reduceFeed([start(0)])?.end_at).toBeUndefined();
  expect(reduceFeed([finish(5)])).toBeUndefined();
  expect(reduceFeed(undefined)).toBeUndefined();
});

it("ignores a switch to the side already running, and a finish stamped before the start", () => {
  expect(reduceFeed([start(0), swap(3, "left")])).toMatchObject({ side: "left", segments: [{ side: "left", started_at: at(0) }] });
  expect(reduceFeed([finish(0, "z"), start(5)])).toMatchObject({ state: "running" });
});

it("applies an action once, however many times it is replayed", () => {
  const data = withFeedAction({ method: "breast", side: "left", state: "running", actions: [start(0)] }, finish(4));
  expect(data).toMatchObject({ state: "finished", duration_minutes: 4, end_at: at(4) });
  expect(withFeedAction(data, finish(4))).toBe(data);
});

const feed = (id: string, actions: FeedAction[], child = "baby", extra: Partial<BabyRecord["data"]> = {}): BabyRecord =>
  optimisticRecord({ id, kind: "feeding", title: "Feeding", body: "", child_id: child, occurred_at: actions[0]?.at ?? at(0), data: { method: "breast", actions, ...extra } });
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
