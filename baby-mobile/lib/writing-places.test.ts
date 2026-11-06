import { describe, expect, it } from "vitest";
import type { Bootstrap } from "./models";
import { canMoveEntry, eventNoteWhere, noteWhere, sharedDetail, writingWhere } from "./writing-places";

const spaces = (role?: "parent" | "caregiver") => ({ spaces: [{ id: "me", kind: "personal", role: "parent" }, ...(role ? [{ id: "fam", kind: "family", role }] : [])], personal_space_id: "me",
  children: [{ id: "mia", name: "Mia", space_id: role ? "fam" : "me" }], generation: 1 }) as unknown as Bootstrap;
const draft = (kind: "journal" | "question" | "event", over = {}) => ({ kind, child_id: null, data: {}, ...over });
const words = (role: "parent" | "caregiver" | undefined, kind: "journal" | "question", over = {}) => writingWhere({ bootstrap: spaces(role) }, draft(kind, over));

describe("where writing goes", () => {
  it("a baby's Note says whose day, and that a family can read it", () => {
    expect(noteWhere({ name: "Mia", space_id: "fam" }, spaces("parent"))).toBe("Goes in Tracker, on Mia’s day. Your family can see it.");
    expect(noteWhere({ name: "Mia", space_id: "me" }, spaces("parent"))).toBe("Goes in Tracker, on Mia’s day.");
    expect(noteWhere({ name: " ", space_id: "me" }, spaces())).toBe("Goes in Tracker, on this baby’s day.");
  });
  it("a journal entry is hers alone without a family, and leaves it to the form's choice with one", () => {
    expect(words(undefined, "journal")).toBe("Goes in your Journal. Only you can see it.");
    expect(words("parent", "journal")).toBe("Goes in your Journal.");
  });
  it("a doctor question names where it is, and only a family's parents hear they can see it", () => {
    expect(words(undefined, "question")).toBe("Goes in your Journal, under Doctor questions. Only you can see it.");
    expect(words("parent", "question")).toBe("Goes in your Journal, under Doctor questions. Parents in your family can see it.");
  });
  it("a caregiver's own line already says who can see it, so this doesn't", () => {
    expect(words("caregiver", "journal")).toBe("Goes in your Journal.");
    expect(words("caregiver", "question")).toBe("Goes in your Journal, under Doctor questions.");
  });
  it("says nothing on an edit, or on anything else", () => {
    expect(words(undefined, "journal", { existing: true })).toBe("");
    expect(writingWhere({ bootstrap: spaces() }, { ...draft("journal"), kind: "routine" })).toBe("");
  });
  it("an event's Note stays with it, and says who reads it only when others can", () => {
    expect(eventNoteWhere({ bootstrap: spaces() }, draft("event"))).toBe("Stays with this event, not in your Journal.");
    expect(eventNoteWhere({ bootstrap: spaces("parent") }, draft("event"))).toBe("Stays with this event, not in your Journal. Anyone who can see the event can read it.");
    expect(eventNoteWhere({ bootstrap: spaces("parent") }, draft("event", { shared: false }))).toBe("Stays with this event, not in your Journal.");
    expect(eventNoteWhere({ bootstrap: spaces("parent") }, draft("event", { existing: true }), { space_id: "me" })).toBe("Stays with this event, not in your Journal.");
    expect(eventNoteWhere({ bootstrap: spaces("parent") }, draft("event", { existing: true }), { space_id: "fam" })).toContain("Anyone who can see the event");
  });
});

describe("sharing, for who's reading", () => {
  it("says only parents read what a caregiver's list leaves out", () => {
    expect(sharedDetail("journal")).toBe("The parents in your family can read it.");
    expect(sharedDetail("source")).toBe("The parents in your family can read it.");
    expect(sharedDetail("event")).toBeUndefined();
  });
  it("leaves a journal entry to its writer, as the API does", () => {
    expect(canMoveEntry({ kind: "journal", created_by: "me" }, "me")).toBe(true);
    expect(canMoveEntry({ kind: "journal" }, "me")).toBe(true);
    expect(canMoveEntry({ kind: "journal", created_by: "them" }, "me")).toBe(false);
    expect(canMoveEntry({ kind: "journal", created_by: null }, "me")).toBe(false);
  });
  it("lets a post made by someone who's left be taken back, as the API does", () => {
    expect(canMoveEntry({ kind: "source", created_by: "them" }, "me")).toBe(false);
    expect(canMoveEntry({ kind: "source", created_by: null }, "me")).toBe(true);
  });
});
