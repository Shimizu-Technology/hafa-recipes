import { describe, expect, it } from "vitest";
import { reduceSession, withSessionAction } from "./session-actions";
import { optimisticRecord, type SessionAction } from "./models";

const at = (minute: number) => `2026-11-05T02:${String(minute).padStart(2, "0")}:00.000Z`,
  action = (id: string, kind: SessionAction["action"], minute: number, target?: string): SessionAction => ({ id, action: kind, at: at(minute), ...(target ? { target } : {}) }),
  kick = optimisticRecord({ id: "k", kind: "kick_session", title: "Kick count", body: "", child_id: "baby", occurred_at: at(0), data: { count: 1, session_actions: [action("first", "tap", 0)] } });

function permutations<T>(list: T[]): T[][] {
  return list.length < 2 ? [list] : list.flatMap((item, index) => permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [item, ...rest]));
}

describe("a session's taps and stops", () => {
  it("gives one result whatever order they arrive in, as the API's reduce_session does", () => {
    const all = [action("a", "tap", 1), action("b", "tap", 2), action("u", "undo", 3, "a"), action("s", "finish", 9), action("e", "finish", 5)];
    for (const order of permutations(all)) expect(reduceSession(order)).toMatchObject({ count: 1, end_at: at(5) });
  });
  it("adds up taps from two phones, where a count on each would both say two", () => {
    const mine = withSessionAction(kick, action("mine", "tap", 1)), both = withSessionAction(mine, action("theirs", "tap", 1));
    expect(both.data.count).toBe(3);
  });
  it("applies a retried action once", () => {
    const once = withSessionAction(kick, action("mine", "tap", 1));
    expect(withSessionAction(once, action("mine", "tap", 1))).toBe(once);
  });
  it("opens a stopped session again when its stop is taken back, and leaves another phone's stop", () => {
    const stopped = withSessionAction(kick, action("stop", "finish", 5));
    expect(stopped.data.end_at).toBe(at(5));
    expect(withSessionAction(stopped, action("back", "undo", 6, "stop")).data.end_at).toBeUndefined();
    const both = withSessionAction(stopped, action("theirs", "finish", 7));
    expect(withSessionAction(both, action("back", "undo", 8, "stop")).data.end_at).toBe(at(7));
  });
  it("won't end before it began, when a phone's clock runs behind", () => {
    const started = { ...kick, occurred_at: at(9) };
    expect(withSessionAction(started, action("stop", "finish", 5)).data.end_at).toBe(at(9));
  });
  it("names the tap to take back: the newest still standing", () => {
    const { taps } = reduceSession([action("b", "tap", 2), action("a", "tap", 1), action("c", "tap", 3), action("u", "undo", 4, "c")]);
    expect(taps.map((tap) => tap.id)).toEqual(["a", "b"]);
  });
});
