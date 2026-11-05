import { afterEach, describe, expect, it, vi } from "vitest";
import { redirectSystemPath } from "../app/+native-intent";
it("preserves ordinary internal paths while rejecting dangerous incoming links", () => {
  expect(redirectSystemPath({path:"/record/1234-abcd",initial:true})).toBe("/record/1234-abcd");
  for (const path of ["/record/\u0000private", "/" + "x".repeat(8200), "/record?x=%C2%C2%C2", "//example.test/private", "hafababy://oauth-callback?code=fixture"]) {
    expect(redirectSystemPath({path,initial:true})).toBe("/");
  }
});

import { callbackNonce } from "./oauth-callback";
it("distinguishes provider failures from cancellation and rejects unverified callbacks", () => {
  expect(() => callbackNonce("hafababy://oauth-callback?error=access_denied&error_description=private-provider-detail"))
    .toThrow(expect.objectContaining({ code: "oauth_provider_error", message: "The sign-in provider could not complete this request." }));
  expect(() => callbackNonce("hafababy://oauth-callback")).toThrow("could not be verified");
  expect(() => callbackNonce("https://example.test/oauth-callback?rotating_token_nonce=secret")).toThrow("Unexpected");
  expect(callbackNonce("hafababy://oauth-callback?rotating_token_nonce=verified")).toBe("verified");
});

import { hasJoinLink, joinLink, takeJoinLink } from "./join-link";
const familyCode = "hfbi_v1.abcdefghijklmnopqrstuvwxyz012345";
describe("family links", () => {
  afterEach(() => { takeJoinLink(); });
  it.each([
    `https://shimizu-technology.com/join/${familyCode}`, `https://shimizu-technology.com/join/${familyCode}/`, `https://shimizu-technology.com/join/${familyCode}?utm=x`,
    `/join/${familyCode}`, `hafababy://join/${familyCode}`,
  ])("takes the code out of %s, so the router never has it", (path) => {
    for (const initial of [true, false]) {
      expect(redirectSystemPath({ path, initial })).toBe("/join");
      expect(takeJoinLink()).toBe(familyCode);
    }
  });
  it.each([
    "/join/nonsense", "/join/", "/join/hfbi_v1.short", `/join/${familyCode}%20`, `/join/${familyCode}/more`, "/join/%C2%C2", "/join/\u0000", `/join/hfbi_v1.${"a".repeat(200)}`, "/join/" + "x".repeat(9000),
  ])("marks a bad code in %s, rather than dropping it silently", (path) => {
    expect(redirectSystemPath({ path, initial: true })).toBe("/join");
    expect(takeJoinLink()).toBe("");
  });
  it("forgets it once it's taken", () => {
    redirectSystemPath({ path: `/join/${familyCode}`, initial: true });
    expect(hasJoinLink()).toBe(true);
    takeJoinLink();
    expect(hasJoinLink()).toBe(false);
    expect(takeJoinLink()).toBeNull();
  });
  it.each(["/joiners", "/join", "https://example.test/join/" + familyCode, "https://shimizu-technology.com.example.test/join/" + familyCode, "/family"])("leaves %s alone", (path) => {
    expect(joinLink(path)).toBeNull();
    redirectSystemPath({ path, initial: true });
    expect(hasJoinLink()).toBe(false);
  });
  it("never writes the code to the console", () => {
    const seen = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level));
    redirectSystemPath({ path: `https://shimizu-technology.com/join/${familyCode}`, initial: true });
    takeJoinLink();
    for (const spy of seen) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
  });
});
