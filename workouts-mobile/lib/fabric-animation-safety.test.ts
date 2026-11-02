import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// Layout animations can apply to the next unrelated Fabric mount transaction,
// including a tab unmount. Keep them out of application source entirely.
it("does not use React Native layout animations in Workouts source", () => {
  const root = join(import.meta.dirname, "..");
  const forbidden = new RegExp("Layout" + "Animation");
  const violations: string[] = [];
  function scan(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || ["node_modules", "dist", "coverage", "build", "Pods"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(?:[cm]?[jt]sx?|swift|m|mm|h|java|kt)$/.test(entry.name) && path !== import.meta.filename && forbidden.test(readFileSync(path, "utf8"))) violations.push(relative(root, path));
    }
  }
  scan(root);
  expect(violations).toEqual([]);
});
