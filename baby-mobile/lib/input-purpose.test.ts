import { expect, it } from "vitest";
import { inputTraits } from "./input-purpose";

it("leaves a family code exactly as it's typed", () => {
  expect(inputTraits("code", "ios")).toMatchObject({ autoCorrect: false, spellCheck: false, keyboardType: "default", textContentType: "none" });
});
