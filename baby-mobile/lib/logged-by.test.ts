import { describe, expect, it } from "vitest";
import { duplicateOf, duplicateHint, loggedByName } from "./logged-by";
import { optimisticRecord, type BabyRecord, type Bootstrap, type RecordData } from "./models";

const family = "f", personal = "p";
const boot = (): Bootstrap => ({ generation: 1, ai_available: false, children: [], profile: { display_name: "", timezone: "UTC", ai_consent: false }, personal_space_id: personal, people: { me: "Kami", them: "Leon", quiet: "" },
  spaces: [{ id: personal, kind: "personal", role: "parent", generation: 1, access_version: 1 }, { id: family, kind: "family", role: "parent", generation: 1, access_version: 1 }] });
const row = (id: string, created_by: string | null | undefined, over: Partial<BabyRecord> = {}, data: RecordData = { type: "wet" }): BabyRecord => ({ ...optimisticRecord({ id, kind: "diaper", title: "", body: "", child_id: "baby", occurred_at: "2026-11-05T02:00:00.000Z", data }), revision: 1, space_id: family, ...(created_by === undefined ? {} : { created_by }), ...over });
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 5, 2, minutes)).toISOString();

describe("who logged it", () => {
  it("names the other parent", () => expect(loggedByName(row("a", "them"), boot(), "me")).toBe("Leon"));
  it("says you for your own, and for what's still queued on this phone", () => {
    expect(loggedByName(row("a", "me"), boot(), "me")).toBe("you");
    expect(loggedByName(row("a", undefined), boot(), "me")).toBe("you");
  });
  it("says former member once the account's gone", () => {
    expect(loggedByName(row("a", null), boot(), "me")).toBe("a former member");
    expect(loggedByName(row("a", "unknown-id"), boot(), "me")).toBe("a former member");
  });
  it("has a fallback for someone with no name", () => expect(loggedByName(row("a", "quiet"), boot(), "me")).toBe("a family member"));
  it("says nothing about her own space, or with the flag off", () => {
    expect(loggedByName(row("a", "me", { space_id: personal }), boot(), "me")).toBe("");
    expect(loggedByName(row("a", "them"), { ...boot(), spaces: undefined }, "me")).toBe("");
  });
});

describe("the same thing logged twice", () => {
  const mine = row("mine", "me"), theirs = (minutes: number, over: Partial<BabyRecord> = {}, data?: RecordData) => row("theirs", "them", { occurred_at: at(minutes), ...over }, data);
  it("finds the other parent's within ten minutes, either side", () => {
    expect(duplicateOf(mine, [mine, theirs(7)])?.id).toBe("theirs");
    expect(duplicateOf({ ...mine, occurred_at: at(9) }, [theirs(0)])?.id).toBe("theirs");
  });
  it("leaves two logged further apart alone", () => expect(duplicateOf(mine, [mine, theirs(11)])).toBeUndefined());
  it("leaves two by the same person alone: that's a second diaper", () => expect(duplicateOf(mine, [mine, row("again", "me", { occurred_at: at(1) })])).toBeUndefined());
  it("leaves another baby's alone", () => expect(duplicateOf(mine, [theirs(1, { child_id: "other" })])).toBeUndefined());
  it("leaves another kind alone", () => expect(duplicateOf(mine, [theirs(1, { kind: "sleep" })])).toBeUndefined());
  it("tells a bottle from a breastfeed, and one custom log from another", () => {
    const feed = row("f", "me", { kind: "feeding" }, { method: "breast" });
    expect(duplicateOf(feed, [row("g", "them", { kind: "feeding", occurred_at: at(1) }, { method: "bottle" })])).toBeUndefined();
    expect(duplicateOf(feed, [row("g", "them", { kind: "feeding", occurred_at: at(1) }, { method: "breast" })])).toBeDefined();
    const dose = row("d", "me", { kind: "medicine" }, { label: "A" } as RecordData);
    expect(duplicateOf(dose, [row("e", "them", { kind: "medicine", occurred_at: at(1) }, { label: "B" } as RecordData)])).toBeUndefined();
  });
  it("tells a dry diaper from a dirty one", () => {
    expect(duplicateOf(mine, [theirs(1, {}, { type: "dirty" })])).toBeUndefined();
  });
  it("has nothing to say outside the family", () => {
    expect(duplicateOf({ ...mine, space_id: personal }, [theirs(1, { space_id: personal })], new Set([family]))).toBeUndefined();
    expect(duplicateOf(mine, [theirs(1)], new Set([family]))).toBeDefined();
  });
  it("doesn't count a kick session, event or note, where two at once are two", () => {
    for (const kind of ["kick_session", "event", "journal", "source"] as const) expect(duplicateOf(row("a", "me", { kind }), [row("b", "them", { kind, occurred_at: at(1) })])).toBeUndefined();
  });
  it("asks rather than says, and says nothing about what's normal", () => {
    expect(duplicateHint(theirs(3), boot(), "me")).toBe("Leon logged one too, at about the same time. If it’s the same one, you can delete this one.");
  });
});
