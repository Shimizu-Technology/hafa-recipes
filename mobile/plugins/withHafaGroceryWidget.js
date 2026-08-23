const fs = require('fs');
const path = require('path');

const {
  createRunOncePlugin,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');

const TARGET_NAME = 'HafaGroceryWidget';
const BUNDLE_SUFFIX = '.grocery-widget';
const APP_GROUP = 'group.com.shimizutechnology.recipeextractor';
const KEYCHAIN_GROUP =
  '$(AppIdentifierPrefix)com.shimizutechnology.recipeextractor.grocery-widget';
const SOURCE_FILES = [
  'HafaGroceryWidgetBundle.swift',
  'HafaGroceryWidget.swift',
  'HafaWidgetPaging.swift',
  'ChangeGroceryWidgetPageIntent.swift',
  'SetGroceryItemCheckedIntent.swift',
  'HafaWidgetShared.swift',
];
const RESOURCE_FILES = ['PrivacyInfo.xcprivacy'];
const CONFIG_FILES = ['Info.plist', 'HafaGroceryWidget.entitlements'];

function mainAppKeychainGroups(bundleIdentifier, existingGroups = []) {
  const defaultKeychainGroup = `$(AppIdentifierPrefix)${bundleIdentifier}`;
  return [
    defaultKeychainGroup,
    ...existingGroups.filter(
      (group) => group !== defaultKeychainGroup && group !== KEYCHAIN_GROUP,
    ),
    KEYCHAIN_GROUP,
  ];
}

function configureEasExtension(config) {
  const bundleIdentifier = `${config.ios.bundleIdentifier}${BUNDLE_SUFFIX}`;
  config.extra ??= {};
  config.extra.eas ??= {};
  config.extra.eas.build ??= {};
  config.extra.eas.build.experimental ??= {};
  config.extra.eas.build.experimental.ios ??= {};
  const extensions =
    (config.extra.eas.build.experimental.ios.appExtensions ??= []);
  const extension = extensions.find((entry) => entry.targetName === TARGET_NAME);
  const declaration = extension ?? { targetName: TARGET_NAME, bundleIdentifier };
  declaration.bundleIdentifier = bundleIdentifier;
  declaration.entitlements = {
    ...(declaration.entitlements ?? {}),
    'com.apple.security.application-groups': [APP_GROUP],
    'keychain-access-groups': [KEYCHAIN_GROUP],
  };
  if (!extension) extensions.push(declaration);
  return config;
}

function withMainAppCapabilities(config) {
  config = withEntitlementsPlist(config, (mod) => {
    // expo-share-intent owns the existing app-group entitlement. This plugin
    // retains the app's private default keychain group first, then adds the
    // narrower shared widget group. This keeps unqualified Clerk/SecureStore
    // items private while allowing only the native bridge to share the widget
    // bearer with the extension.
    mod.modResults['keychain-access-groups'] = mainAppKeychainGroups(
      mod.ios.bundleIdentifier,
      mod.modResults['keychain-access-groups'],
    );
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.HafaWidgetKeychainAccessGroup = KEYCHAIN_GROUP;
    return mod;
  });
}

function findDevelopmentTeam(project) {
  const configurations = project.pbxXCBuildConfigurationSection();
  for (const entry of Object.values(configurations)) {
    const settings = entry?.buildSettings;
    const productName = settings?.PRODUCT_NAME?.replaceAll('"', '');
    if (
      settings?.DEVELOPMENT_TEAM &&
      productName &&
      !productName.includes('Extension') &&
      !productName.includes('Widget')
    ) {
      return settings.DEVELOPMENT_TEAM.replaceAll('"', '');
    }
  }
  return undefined;
}

function addTargetResource(project, group, resourcesPhase, fileName) {
  const objects = project.hash.project.objects;
  const fileReferenceID = project.generateUuid();
  const buildFileID = project.generateUuid();
  objects.PBXFileReference[fileReferenceID] = {
    isa: 'PBXFileReference',
    explicitFileType: undefined,
    fileEncoding: undefined,
    includeInIndex: 0,
    lastKnownFileType: 'unknown',
    name: fileName,
    path: fileName,
    sourceTree: '"<group>"',
  };
  objects.PBXFileReference[`${fileReferenceID}_comment`] = fileName;
  objects.PBXBuildFile[buildFileID] = {
    isa: 'PBXBuildFile',
    fileRef: fileReferenceID,
    fileRef_comment: fileName,
  };
  objects.PBXBuildFile[`${buildFileID}_comment`] = `${fileName} in Resources`;
  group.pbxGroup.children.push({ value: fileReferenceID, comment: fileName });
  resourcesPhase.buildPhase.files.push({
    value: buildFileID,
    comment: `${fileName} in Resources`,
  });
}

async function copyWidgetFiles(projectRoot, platformProjectRoot) {
  const templateRoot = path.join(projectRoot, 'widget', 'ios');
  const sharedSource = path.join(
    projectRoot,
    'modules',
    'hafa-widget-bridge',
    'ios',
    'HafaWidgetShared.swift',
  );
  const destination = path.join(platformProjectRoot, TARGET_NAME);
  await fs.promises.mkdir(destination, { recursive: true });
  for (const file of [...SOURCE_FILES.filter((name) => name !== 'HafaWidgetShared.swift'), ...RESOURCE_FILES, ...CONFIG_FILES]) {
    await fs.promises.copyFile(path.join(templateRoot, file), path.join(destination, file));
  }
  await fs.promises.copyFile(
    sharedSource,
    path.join(destination, 'HafaWidgetShared.swift'),
  );
}

function withWidgetTarget(config) {
  return withXcodeProject(config, async (mod) => {
    const project = mod.modResults;
    if (project.pbxTargetByName(TARGET_NAME)) return mod;

    await copyWidgetFiles(
      mod.modRequest.projectRoot,
      mod.modRequest.platformProjectRoot,
    );

    const allFiles = [...SOURCE_FILES, ...CONFIG_FILES];
    const group = project.addPbxGroup(allFiles, TARGET_NAME, TARGET_NAME);
    const groups = project.hash.project.objects.PBXGroup;
    for (const key of Object.keys(groups)) {
      const candidate = groups[key];
      if (
        typeof candidate === 'object' &&
        candidate &&
        candidate.name === undefined &&
        candidate.path === undefined
      ) {
        project.addToPbxGroup(group.uuid, key);
      }
    }

    const objects = project.hash.project.objects;
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};
    const target = project.addTarget(TARGET_NAME, 'app_extension', TARGET_NAME);
    project.addBuildPhase(
      SOURCE_FILES,
      'PBXSourcesBuildPhase',
      'Sources',
      target.uuid,
    );
    const resourcesPhase = project.addBuildPhase(
      [],
      'PBXResourcesBuildPhase',
      'Resources',
      target.uuid,
    );
    // expo-share-intent also owns a PrivacyInfo.xcprivacy file. Give node-xcode
    // an explicit target-scoped file reference instead of resolving it by
    // basename, which would otherwise reuse the share extension's manifest.
    for (const file of RESOURCE_FILES) {
      addTargetResource(project, group, resourcesPhase, file);
    }
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    const bundleIdentifier = `${mod.ios.bundleIdentifier}${BUNDLE_SUFFIX}`;
    const buildNumber = mod.ios.buildNumber ?? '1';
    const developmentTeam = findDevelopmentTeam(project);
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configurations)) {
      const settings = entry?.buildSettings;
      if (settings?.PRODUCT_NAME !== `"${TARGET_NAME}"`) continue;
      settings.APPLICATION_EXTENSION_API_ONLY = 'YES';
      settings.CLANG_ENABLE_MODULES = 'YES';
      settings.CODE_SIGN_ENTITLEMENTS = `"${TARGET_NAME}/HafaGroceryWidget.entitlements"`;
      settings.CODE_SIGN_STYLE = 'Automatic';
      settings.CURRENT_PROJECT_VERSION = `"${buildNumber}"`;
      settings.GENERATE_INFOPLIST_FILE = 'NO';
      settings.INFOPLIST_FILE = `"${TARGET_NAME}/Info.plist"`;
      settings.IPHONEOS_DEPLOYMENT_TARGET = '17.0';
      settings.MARKETING_VERSION = `"${mod.version}"`;
      settings.PRODUCT_BUNDLE_IDENTIFIER = `"${bundleIdentifier}"`;
      settings.SKIP_INSTALL = 'YES';
      settings.SWIFT_EMIT_LOC_STRINGS = 'YES';
      settings.SWIFT_VERSION = '5.0';
      settings.TARGETED_DEVICE_FAMILY = '"1,2"';
      if (developmentTeam) settings.DEVELOPMENT_TEAM = developmentTeam;
    }
    if (developmentTeam) {
      project.addTargetAttribute('DevelopmentTeam', developmentTeam);
      project.addTargetAttribute('DevelopmentTeam', developmentTeam, target);
    }
    return mod;
  });
}

function withHafaGroceryWidget(config) {
  config = configureEasExtension(config);
  config = withMainAppCapabilities(config);
  return withWidgetTarget(config);
}

const plugin = createRunOncePlugin(
  withHafaGroceryWidget,
  'with-hafa-grocery-widget',
  '1.0.0',
);

plugin._testing = {
  APP_GROUP,
  BUNDLE_SUFFIX,
  KEYCHAIN_GROUP,
  RESOURCE_FILES,
  SOURCE_FILES,
  TARGET_NAME,
  configureEasExtension,
  mainAppKeychainGroups,
};

module.exports = plugin;
