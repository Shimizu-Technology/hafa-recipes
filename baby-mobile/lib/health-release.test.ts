import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const { assertHealthRelease, review } = createRequire(import.meta.url)("./health-release.cjs");
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("private family agent review is not public permission", () => {
  it("lets the family build use agent-reviewed content", () => {
    expect(review.agentReview).toBe("2026-11-07");
    expect(review.clinicianReview).toBe("");
    expect(review.whoChartPermission).toBe("");
    expect(() => assertHealthRelease("private-family")).not.toThrow();
  });
  it.each(["public", "paid", "unknown"])("holds %s without both records", (audience) => {
    expect(() => assertHealthRelease(audience)).toThrow(/clinician review AND WHO chart permission/);
    expect(() => assertHealthRelease(audience, { clinicianReview: "dated review", whoChartPermission: "" })).toThrow();
    expect(() => assertHealthRelease(audience, { clinicianReview: "", whoChartPermission: "dated permission" })).toThrow();
  });
  it.each(["public", "paid"])("requires both records for %s", (audience) => {
    expect(() => assertHealthRelease(audience, { clinicianReview: "dated review", whoChartPermission: "dated permission" })).not.toThrow();
  });
  it("enforces the gate in the actual production Expo configuration", async () => {
    vi.stubEnv("EAS_BUILD_PROFILE", "production");
    vi.stubEnv("EXPO_PUBLIC_BABY_RELEASE_AUDIENCE", "public");
    await expect(import("../app.config")).rejects.toThrow(/release blocked/);
  });
  it("fails closed for direct builds and OTA updates with no audience or EAS profile", async () => {
    vi.stubEnv("EAS_BUILD_PROFILE", undefined);
    vi.stubEnv("EXPO_PUBLIC_BABY_RELEASE_AUDIENCE", undefined);
    await expect(import("../app.config")).rejects.toThrow(/release blocked/);
  });
  it("records the explicit private-family audience in the actual Expo configuration", async () => {
    vi.stubEnv("EAS_BUILD_PROFILE", "family");
    vi.stubEnv("EXPO_PUBLIC_BABY_RELEASE_AUDIENCE", "private-family");
    expect((await import("../app.config")).default.extra?.healthAudience).toBe("private-family");
  });
});
