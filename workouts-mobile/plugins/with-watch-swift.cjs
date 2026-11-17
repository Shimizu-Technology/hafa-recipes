const { withXcodeProjectBeta } = require("@bacons/apple-targets/build/with-bacons-xcode");

// Register before apple-targets: Expo runs mods in reverse registration order.
// Apply after it creates the watch target,
// without changing the companion, share extension, or Pods language mode.
module.exports = config => withXcodeProjectBeta(config, mod => {
  for (const target of mod.modResults.rootObject.props.targets) {
    if (target.props.name !== "HafaWatch") continue;
    for (const configuration of target.props.buildConfigurationList.props.buildConfigurations) {
      configuration.props.buildSettings.SWIFT_VERSION = "6.0";
      configuration.props.buildSettings.SWIFT_STRICT_CONCURRENCY = "complete";
    }
  }
  return mod;
});
