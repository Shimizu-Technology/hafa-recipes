import { expect, it } from "vitest";
import { sharingURL, shareAvailable } from "./sharing";
import { incomingNativePath } from "./native-intent";
const token = "a".repeat(43);
const share = { app_path: `hafaworkouts://shared/${token}` };
it("only shares unrevoked links strictly before their real expiry", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  const link = { expires_at: new Date(now + 1).toISOString(), revoked_at: null };
  expect(shareAvailable(link, now)).toBe(true);
  expect(shareAvailable(link, now + 1)).toBe(false);
  expect(shareAvailable({ ...link, revoked_at: "2026-10-14T00:00:00Z" }, now)).toBe(false);
  expect(shareAvailable({ ...link, expires_at: "invalid" }, now)).toBe(false);
});
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
