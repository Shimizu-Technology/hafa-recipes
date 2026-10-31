import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ lock: null as Buffer | null, sources: [1244013, 1244012], packageNames: ["glob", "minimatch"] }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) =>
    fixture.lock && String(args[0]).endsWith("/package-lock.json") ? fixture.lock : Reflect.apply(actual.readFileSync, actual, args) };
});
vi.mock("node:child_process", () => ({ spawnSync: () => ({ status: 1, stdout: JSON.stringify({
  metadata: { vulnerabilities: { total: fixture.sources.length, critical: 0 } },
  vulnerabilities: Object.fromEntries(fixture.sources.map((source, i) => [fixture.packageNames[i], { via: [{ source, severity: "moderate", title: "fixture" }] }])),
}) }) }));
const lock = readFileSync(new URL("../package-lock.json", import.meta.url));
async function audit() {
  vi.resetModules();
  await import("../scripts/audit-runtime.mjs");
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); fixture.lock = null; fixture.sources = [1244013, 1244012]; fixture.packageNames = ["glob", "minimatch"]; });
describe("exact-lock dependency review", () => {
  function clock(date = "2026-10-31T00:00:00Z") { vi.useFakeTimers(); vi.setSystemTime(new Date(date)); vi.spyOn(console, "log").mockImplementation(() => {}); }
  it("accepts the new build-only advisories in the exact reviewed tree", async () => { clock(); await expect(audit()).resolves.toBeUndefined(); });
  it.each(["2026-10-23T23:59:59Z", "2026-11-17T00:00:00Z"])("rejects outside the review window: %s", async (date) => { clock(date); await expect(audit()).rejects.toThrow("review changed or expired"); });
  it.each(["version", "integrity", "parent", "duplicate"])("rejects changed %s provenance", async (field) => {
    clock(); const changed = JSON.parse(lock.toString());
    if (field === "parent") changed.packages[""].dependencies.glob = "^13.0.0";
    else if (field === "duplicate") changed.packages["node_modules/new/node_modules/glob"] = changed.packages["node_modules/glob"];
    else changed.packages["node_modules/glob"][field] += "-changed";
    fixture.lock = Buffer.from(JSON.stringify(changed)); await expect(audit()).rejects.toThrow("review changed or expired");
  });
  it("rejects unknown advisory IDs", async () => { clock(); fixture.sources = [9999999]; await expect(audit()).rejects.toThrow("Unexpected dependency advisories"); });
  it("removes the obsolete Forge exception", async () => { clock(); fixture.sources = [1240912]; fixture.packageNames = ["node-forge"]; await expect(audit()).rejects.toThrow("Unexpected dependency advisories"); });
});
