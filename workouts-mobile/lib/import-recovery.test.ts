import { expect, it } from "vitest";
import { recoverySource, importSourceLabel } from "./import-recovery";

it("strips server saving metadata and retains source instructions for a private retry", () => {
  const source = { kind: "url" as const, source_url: "https://example.test/reel", text: "10 squats", ai_consent: true,
    _save: { is_public: true, display_name: "Original contributor" } };
  const retry = recoverySource(source, null, "Repeat for 20 minutes");
  expect(retry.text).toBe("10 squats\n\nRepeat for 20 minutes");
  expect(retry).not.toHaveProperty("_save");
  expect(source.text).toBe("10 squats");
});

it("can recover from pasted caption alone when the temporary source has expired", () => {
  expect(recoverySource(null, null, "10 squats")).toMatchObject({ kind: "text", text: "10 squats", ai_consent: true });
  expect(() => recoverySource(null, null, "")).toThrow("no longer available");
  expect(() => recoverySource(null, null, "a".repeat(30001))).toThrow("30,000");
});

it("removes tracking query strings from inbox source labels", () => {
  expect(importSourceLabel("https://www.instagram.com/reel/abc/?token=private")).toBe("instagram.com/reel/abc");
});
