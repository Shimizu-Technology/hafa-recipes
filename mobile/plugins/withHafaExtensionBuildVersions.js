const { createRunOncePlugin, withXcodeProject } = require('@expo/config-plugins');

const EXTENSION_TARGETS = new Set(['ShareExtension', 'HafaGroceryWidget']);

function synchronizeExtensionBuildVersions(project, { buildNumber, version }) {
  const normalizedBuild = String(buildNumber ?? '').trim();
  const normalizedVersion = String(version ?? '').trim();

  if (!/^\d+$/.test(normalizedBuild)) {
    throw new Error('iOS app extensions require the app’s numeric build number');
  }
  if (!/^\d+(?:\.\d+){0,2}$/.test(normalizedVersion)) {
    throw new Error('iOS app extensions require the app’s marketing version');
  }

  const synchronized = new Set();
  for (const configuration of Object.values(project.pbxXCBuildConfigurationSection())) {
    const settings = configuration?.buildSettings;
    const name = settings?.PRODUCT_NAME?.replaceAll('"', '');
    if (!EXTENSION_TARGETS.has(name)) continue;

    settings.CURRENT_PROJECT_VERSION = `"${normalizedBuild}"`;
    settings.MARKETING_VERSION = `"${normalizedVersion}"`;
    synchronized.add(name);
  }

  for (const target of EXTENSION_TARGETS) {
    if (!synchronized.has(target)) {
      throw new Error(`Expected iOS extension target ${target} before release version synchronization`);
    }
  }
  return synchronized;
}

function withHafaExtensionBuildVersions(config) {
  return withXcodeProject(config, (mod) => {
    synchronizeExtensionBuildVersions(mod.modResults, {
      buildNumber: mod.ios.buildNumber,
      version: mod.version,
    });
    return mod;
  });
}

const plugin = createRunOncePlugin(
  withHafaExtensionBuildVersions,
  'with-hafa-extension-build-versions',
  '1.0.0',
);

plugin._testing = { EXTENSION_TARGETS, synchronizeExtensionBuildVersions };

module.exports = plugin;
