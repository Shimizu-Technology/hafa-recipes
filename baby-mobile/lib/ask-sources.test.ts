import { expect, it } from "vitest";
import { SUGGESTED_ROUTINE_NOTE, answeredCalmly, reminderOffLine, unavailablePlaceholder } from "./ask-sources";

it("says what's urgent in words that fit the question box, even at large text", () => {
  for (const scale of [1, 1.5, 2]) {
    const words = unavailablePlaceholder(scale);
    expect(words).toMatch(/urgent/i);
    expect(words).toMatch(/help/i);
    expect(words.length).toBeLessThanOrEqual(scale >= 1.5 ? 17 : 29);
  }
});
it("doesn't add the note about sources under an urgent reply", () => {
  expect(answeredCalmly([{ role: "user" }])).toBe(false);
  expect(answeredCalmly([{ role: "user" }, { role: "assistant" }])).toBe(true);
  expect(answeredCalmly([{ role: "user" }, { role: "assistant", help: "baby_unwell" }])).toBe(false);
});
it("never tells her to edit what Ask suggested into a reminder", () => {
  expect(reminderOffLine({})).toMatch(/Edit this routine/);
  expect(reminderOffLine({ ai_origin: true })).toBe(SUGGESTED_ROUTINE_NOTE);
  expect(SUGGESTED_ROUTINE_NOTE).not.toMatch(/Edit/);
});
