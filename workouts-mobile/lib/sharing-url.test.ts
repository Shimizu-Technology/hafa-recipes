import { expect, it } from "vitest";
import { sharingURL } from "./sharing";
import { incomingNativePath } from "./native-intent";
const token = "a".repeat(43);
const share = { app_path: `hafaworkouts://shared/${token}` };
it("opens the native fallback without duplicating its scheme", () => {
  const url = sharingURL(share);
  expect(url).toBe(share.app_path);
  expect(incomingNativePath(url)).toBe(`/shared/${token}`);
});
it("uses fragment website links and accepts them only for the configured origin", () => {
  const url = sharingURL(share, "https://workouts.example.test/");
  expect(url).toBe(`https://workouts.example.test/shared#${token}`);
  expect(incomingNativePath(url, { websiteOrigin: "https://workouts.example.test" })).toBe(`/shared/${token}`);
  expect(incomingNativePath(url, { websiteOrigin: "https://other.example.test" })).toBe("/invalid-link");
  expect(incomingNativePath(url + "?invalid", { websiteOrigin: "https://workouts.example.test" })).toBe("/invalid-link");
});
it.each(["http://example.test", "https://user:password@example.test", "https://example.test/path", "invalid"])(
  "retains a working native link with invalid website configuration %s", (website) => {
    expect(sharingURL(share, website)).toBe(share.app_path);
  }
);
it("rejects an invalid owner link rather than sharing another destination", () => {
  expect(() => sharingURL({ app_path: "https://other.example.test/shared" })).toThrow("invalid");
});
