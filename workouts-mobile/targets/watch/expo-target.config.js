/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
// Single-target watchOS app embedded in the Workouts iOS bundle. Leon's Ultra 1
// runs watchOS 11, so nothing here may need a later OS.
module.exports = () => ({
  type: "watch",
  name: "HafaWatch",
  displayName: "Håfa Workouts",
  bundleIdentifier: ".watchkitapp",
  deploymentTarget: "11.0",
  icon: "../../assets/icon.png",
  frameworks: ["HealthKit"],
  entitlements: { "com.apple.developer.healthkit": true },
  colors: { $accent: "#FF7A50" },
});
