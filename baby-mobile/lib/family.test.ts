import { describe, expect, it } from "vitest";
import { codeFrom, inviteMessage, whatBecomesShared, canBeJustMe } from "./family";
import { optimisticRecord, type BabyRecord, type Kind, type RecordData } from "./models";

const row = (kind: Kind, data: RecordData = {}, child_id: string | null = null): BabyRecord => ({ ...optimisticRecord({ id: kind + JSON.stringify(data) + Math.random(), kind, title: kind, body: "", child_id, occurred_at: "2026-11-05T00:00:00.000Z", data }), revision: 1 });

describe("reading a code", () => {
  const code = "hfbi_v1.abcdefghijklmnopqrstuvwxyz012345";
  it("finds it in the whole message they pasted", () => {
    expect(codeFrom(inviteMessage(code))).toBe(code);
    expect(codeFrom(`  ${code}\n`)).toBe(code);
  });
  it("gives back whatever else, for the API to refuse", () => {
    expect(codeFrom("  not a code ")).toBe("not a code");
  });
});

describe("what Create family will share", () => {
  it("lists babies, care, events, saved posts and categories", () => {
    expect(whatBecomesShared([row("diaper"), row("feeding"), row("event"), row("source"), row("source"), row("collection"), row("question"), row("routine")], ["Mia"])).toEqual([
      "Mia’s profile", "2 care logs", "1 calendar event", "2 saved posts", "1 category", "1 doctor question", "1 list",
    ]);
  });
  it("leaves out journal entries, her own logs and anything chosen as Just me", () => {
    expect(whatBecomesShared([row("journal"), row("custom", { label: "Blood pressure" }), row("source", { just_me: true }), row("collection", { just_me: true })], [])).toEqual([]);
  });
  it("counts a baby's own log, and a kick session or contraction, as care", () => {
    expect(whatBecomesShared([row("custom", { label: "Note" }, "baby"), row("kick_session"), row("contraction")], [])).toEqual(["3 care logs"]);
  });
});

describe("what can be Just me", () => {
  it("is saved posts, categories and journal entries, which is what the API moves", () => {
    expect((["source", "collection", "journal", "diaper", "event"] as Kind[]).filter(canBeJustMe)).toEqual(["source", "collection", "journal"]);
  });
});
