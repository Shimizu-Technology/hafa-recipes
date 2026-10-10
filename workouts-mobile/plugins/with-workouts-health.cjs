const fs = require("node:fs/promises");
const path = require("node:path");
const { AndroidConfig, withAndroidManifest, withDangerousMod, withEntitlementsPlist, withInfoPlist } = require("@expo/config-plugins");

const RATIONALE = "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE";
const ACTIVITY = ".HafaHealthRationaleActivity";
const PERMISSIONS = ["android.permission.health.READ_EXERCISE", "android.permission.health.WRITE_EXERCISE"];

function configureManifest(manifest) {
  manifest["uses-permission"] ??= [];
  for (const permission of PERMISSIONS) {
    if (!manifest["uses-permission"].some(entry => entry.$["android:name"] === permission)) manifest["uses-permission"].push({ $: { "android:name": permission } });
  }
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow({ manifest });
  const main = AndroidConfig.Manifest.getMainActivityOrThrow({ manifest });
  // The upstream plugin targets MainActivity, which receives an action rather
  // than a linking URL. Move only that rationale action to our deep-link bridge.
  main["intent-filter"] = (main["intent-filter"] ?? []).flatMap(filter => {
    const actions = (filter.action ?? []).filter(entry => entry.$["android:name"] !== RATIONALE);
    return actions.length ? [{ ...filter, action: actions }] : [];
  });
  application.activity ??= [];
  if (!application.activity.some(entry => entry.$["android:name"] === ACTIVITY)) application.activity.push({ $: { "android:name": ACTIVITY, "android:exported": "true" }, "intent-filter": [{ action: [{ $: { "android:name": RATIONALE } }] }] });
  application["activity-alias"] ??= [];
  const alias = application["activity-alias"].find(entry => entry.$["android:name"] === "ViewPermissionUsageActivity");
  if (alias) alias.$["android:targetActivity"] = ACTIVITY;
  else application["activity-alias"].push({ $: { "android:name": "ViewPermissionUsageActivity", "android:exported": "true", "android:targetActivity": ACTIVITY, "android:permission": "android.permission.START_VIEW_PERMISSION_USAGE" }, "intent-filter": [{ action: [{ $: { "android:name": "android.intent.action.VIEW_PERMISSION_USAGE" } }], category: [{ $: { "android:name": "android.intent.category.HEALTH_PERMISSIONS" } }] }] });
  return manifest;
}

function activitySource(packageName, mainName) {
  const target = mainName.startsWith(".") ? packageName + mainName : mainName;
  return `package ${packageName}

import android.app.Activity
import android.os.Bundle
import android.content.Intent
import android.net.Uri

class HafaHealthRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("hafaworkouts://health-rationale"))
    intent.setClassName(this, "${target}")
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    startActivity(intent)
    finish()
  }
}
`;
}

function withWorkoutsHealth(config) {
  config = withInfoPlist(config, mod => {
    mod.modResults.NSHealthShareUsageDescription = "With your permission, Håfa Workouts reads exercise summaries to show your training history. Uploading and AI use are separate choices.";
    mod.modResults.NSHealthUpdateUsageDescription = "With your permission, Håfa Workouts saves workouts you actually completed to Apple Health.";
    return mod;
  });
  config = withEntitlementsPlist(config, mod => {
    mod.modResults["com.apple.developer.healthkit"] = true;
    // Foreground scope: no background-delivery entitlement or clinical access.
    delete mod.modResults["com.apple.developer.healthkit.background-delivery"];
    return mod;
  });
  config = withAndroidManifest(config, mod => {
    mod.modResults.manifest = configureManifest(mod.modResults.manifest);
    return mod;
  });
  return withDangerousMod(config, ["android", async mod => {
    const packageName = mod.android?.package;
    if (!packageName || !/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(packageName)) throw new Error("Set the independent Workouts Android package before health prebuild.");
    const root = path.join(mod.modRequest.platformProjectRoot, "app/src/main");
    const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(path.join(root, "AndroidManifest.xml"));
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    const folder = path.join(root, "java", ...packageName.split("."));
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "HafaHealthRationaleActivity.kt"), activitySource(packageName, main.$["android:name"]));
    return mod;
  }]);
}
module.exports = withWorkoutsHealth;
module.exports.configureManifest = configureManifest;
module.exports.activitySource = activitySource;
