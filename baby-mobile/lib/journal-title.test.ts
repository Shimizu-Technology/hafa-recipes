import { expect, it } from "vitest";
import { firstWords, journalPreview, repeatsBody, writtenTitle } from "./journal-title";

const journal = (title: string, body: string) => ({ kind: "journal" as const, title, body });
/** What builds before this one saved for an entry with no title. */
const olderCut = (body: string) => {
  const line = [...body.trim().split("\n")[0].trim()];
  return line.length > 60 ? line.slice(0, 59).join("").trimEnd() + "…" : line.join("");
};

it("keeps a short first line whole", () => {
  expect(firstWords("First day felt good\nThen more")).toBe("First day felt good");
  expect(firstWords("  \n  First day   felt good  ")).toBe("First day felt good");
  expect(firstWords("")).toBe("");
});
it("shortens at a word boundary and leaves nothing dangling", () => {
  const long = "We went for a walk this morning, and the whole neighbourhood stopped to say hello";
  expect(firstWords(long)).toBe("We went for a walk this morning, and the whole…");
  expect([...firstWords(long)].length).toBeLessThanOrEqual(60);
  expect(firstWords("We went for a walk this morning and everyone said hello, — and then we")).toBe("We went for a walk this morning and everyone said hello…");
});
it("cuts one long unbroken run where it must, and never through an emoji", () => {
  expect(firstWords("x".repeat(200))).toBe("x".repeat(59) + "…");
  expect(firstWords("👶🏽".repeat(40)).endsWith("…")).toBe(true);
  expect(firstWords("a".repeat(58) + "👨‍👩‍👧 b")).not.toMatch(/[‍️]…$/);
  expect(firstWords("👶".repeat(70))).toBe("👶".repeat(59) + "…");
});
it("reads a title that only repeats the first line as no title at all", () => {
  expect(writtenTitle(journal("First day felt good", "First day felt good"))).toBe("");
  expect(writtenTitle(journal("first day felt good", "First day felt good."))).toBe("");
  expect(writtenTitle(journal("First day felt good", "First day felt good\nand the second line"))).toBe("");
  expect(writtenTitle(journal("  First  day felt good ", "First day felt good"))).toBe("");
});
it("recognises what older builds saved, and what this one saves", () => {
  const body = "We went for a walk this morning, and the whole neighbourhood stopped to say hello\nThen home";
  expect(olderCut(body).endsWith("…")).toBe(true);
  expect(writtenTitle(journal(olderCut(body), body))).toBe("");
  expect(writtenTitle(journal(firstWords(body), body))).toBe("");
  const emoji = "🌺".repeat(70);
  expect(repeatsBody(olderCut(emoji), emoji)).toBe(true);
});
it("treats the kind's own name as no title, so a photo-only entry opens blank", () => {
  expect(writtenTitle(journal("Journal entry", ""))).toBe("");
});
it("keeps what she really wrote", () => {
  expect(writtenTitle(journal("First kick", "Felt it after dinner"))).toBe("First kick");
  expect(writtenTitle(journal("First day", "First day felt good"))).toBe("First day");
  expect(writtenTitle(journal("First…", "First day felt good"))).toBe("First…");
  expect(writtenTitle(journal("Just a title", ""))).toBe("Just a title");
  expect(writtenTitle(journal("What my doctor told me", "Rest and fluids"))).toBe("What my doctor told me");
  expect(writtenTitle(journal("Later that night", "Later that week we went home"))).toBe("Later that night");
  expect(writtenTitle(journal("Our first Christmas", "Our first Christmas was quiet"))).toBe("Our first Christmas");
  // Nothing cuts a line this short, so the ellipsis is hers.
  expect(writtenTitle(journal("Our first Christmas together…", "Our first Christmas together was quiet"))).toBe("Our first Christmas together…");
});
it("gives every entry a preview that doesn't say the title again", () => {
  expect(journalPreview(journal("First kick", "Felt it after dinner"))).toBe("Felt it after dinner");
  expect(journalPreview(journal("First day felt good", "First day felt good"))).toBe("");
  expect(journalPreview(journal("First day felt good", "First day felt good.\nThen we went home."))).toBe("Then we went home.");
  const body = "We went for a walk this morning, and the whole neighbourhood stopped to say hello";
  expect(journalPreview(journal(firstWords(body), body))).toBe("neighbourhood stopped to say hello");
  expect(journalPreview(journal("Journal entry", ""))).toBe("");
  expect(journalPreview(journal("Journal entry", "A note"))).toBe("A note");
  // A title she chose can open the same way as the body, and a title can carry its own punctuation.
  expect(journalPreview(journal("Our first Christmas", "Our first Christmas was quiet"))).toBe("was quiet");
  expect(journalPreview(journal("Good!", "Good. Then home"))).toBe("Then home");
  expect(journalPreview(journal("Walk", "Walked to the park with Mia"))).toBe("Walked to the park with Mia");
  // What older builds cut through an emoji leaves nothing stray at the start of the preview.
  expect(journalPreview(journal("👶🏽".repeat(29) + "👶…", "👶🏽".repeat(40)))).toBe("👶🏽".repeat(10));
  expect([...journalPreview(journal("Title", "word ".repeat(100)))].length).toBeLessThanOrEqual(90);
});
