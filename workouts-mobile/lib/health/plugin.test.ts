/// <reference types="node" />
import { createRequire } from "node:module";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { configureManifest, activitySource } = require("../../plugins/with-workouts-health.cjs");

it("health manifest is minimal, idempotent and sends rationale to a real bridge activity", () => {
  const manifest: any = {
    application: [
      {
        $: { "android:name": ".MainApplication" },
        activity: [
          {
            $: { "android:name": ".MainActivity" },
            "intent-filter": [
              {
                action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
                category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }],
              },
              { action: [{ $: { "android:name": "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" } }] },
            ],
          },
        ],
        "activity-alias": [
          { $: { "android:name": "ViewPermissionUsageActivity", "android:targetActivity": ".MainActivity" } },
        ],
      },
    ],
  };
  configureManifest(manifest);
  const once = JSON.stringify(manifest);
  configureManifest(manifest);
  expect(JSON.stringify(manifest)).toBe(once);
  expect(
    manifest["uses-permission"].map((permission: { $: Record<string, string> }) => permission.$["android:name"])
  ).toEqual(["android.permission.health.READ_EXERCISE", "android.permission.health.WRITE_EXERCISE"]);
  expect(manifest.application[0]["activity-alias"][0].$["android:targetActivity"]).toBe(".HafaHealthRationaleActivity");
  expect(once).not.toContain("READ_WEIGHT");
  expect(once).not.toContain("READ_HEART_RATE");
  expect(activitySource("com.example.workouts", ".MainActivity")).toContain(
    'Uri.parse("hafaworkouts://health-rationale")'
  );
  expect(activitySource("com.example.workouts", ".MainActivity")).toContain(
    'intent.setClassName(this, "com.example.workouts.MainActivity")'
  );
});
