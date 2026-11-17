import { expect, it } from "vitest";
import { bagAddLabel, bagIntro, bagSectionTitle, careTeamLine, deliveryRowTitle, doctorNoteLabel } from "./voice-words";
import { doctorNoteTitle } from "./contractions";

const kami = { name: "Kami" };
it("keeps her own words on her phone, and the saved title never changes", () => {
  expect(doctorNoteLabel("mine")).toBe(doctorNoteTitle);
  expect(doctorNoteLabel()).toBe("What my doctor told me");
  expect(careTeamLine()).toBe("This timer records contractions. Your care team tells you when to call or go in.");
  expect(bagSectionTitle("mom", "For you", "mine")).toBe("For you");
  expect(bagSectionTitle("partner", "For your partner", "mine")).toBe("For your partner");
  expect(deliveryRowTitle("mine")).toBe("Add where you plan to deliver");
});
it("uses her name on her partner's phone, and \"you\" for him", () => {
  expect(doctorNoteLabel(kami)).toBe("What Kami’s doctor said");
  expect(careTeamLine(kami)).toBe("This timer records contractions. Kami’s care team says when to call or go in.");
  expect(bagSectionTitle("mom", "For you", kami)).toBe("For Kami");
  expect(bagSectionTitle("partner", "For your partner", kami)).toBe("For you");
  expect(bagAddLabel("mom", "Add something for you", kami)).toBe("Add something for Kami");
  expect(bagAddLabel("partner", "Add something for your partner", kami)).toBe("Add something for you");
  expect(bagSectionTitle("baby", "For baby", kami)).toBe("For baby");
  expect(bagAddLabel("papers", "Add a paper or something else to bring", kami)).toBe("Add a paper or something else to bring");
  expect(deliveryRowTitle(kami)).toBe("Add where Kami plans to deliver");
  expect(bagIntro(kami)).toContain("things for Kami, for baby, for you");
});
it("uses everyday words, with no name or pronoun, until it's settled", () => {
  const all = [doctorNoteLabel("neutral"), careTeamLine("neutral"), bagSectionTitle("mom", "For you", "neutral"), bagSectionTitle("partner", "x", "neutral"),
    bagAddLabel("mom", "x", "neutral"), deliveryRowTitle("neutral"), bagIntro("neutral")].join(" | ");
  expect(all).not.toMatch(/\byou(r)?\b|\bmy\b|\bshe\b|\bher\b/i);
  expect(bagSectionTitle("partner", "x", "neutral")).toBe("For their partner");
});
