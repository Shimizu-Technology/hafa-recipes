import { expect, it } from "vitest";
import { redirectSystemPath } from "../app/+native-intent";
it("preserves ordinary internal paths while rejecting dangerous incoming links", () => {
  expect(redirectSystemPath({path:"/record/1234-abcd",initial:true})).toBe("/record/1234-abcd");
  for (const path of ["/record/\u0000private", "/" + "x".repeat(8200), "/record?x=%C2%C2%C2", "//example.test/private", "hafababy://oauth-callback?code=fixture"]) {
    expect(redirectSystemPath({path,initial:true})).toBe("/");
  }
});
