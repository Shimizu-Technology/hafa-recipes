const fs = require("node:fs/promises");
const path = require("node:path");
const plist = require("@expo/plist").default;
const { withBaseMod, withInfoPlist } = require("@expo/config-plugins");
const keychain = "$(AppIdentifierPrefix)com.shimizutechnology.hafaworkouts.share";
function transformController(source, confirmation, store, loader) {
  if (!source.includes('let sharedKey: String = "<SCHEME>ShareKey"') && !source.includes('let sharedKey: String = "hafaworkoutsShareKey"'))
    throw Error("Workouts share capture requires the verified expo-share-intent 8.0.1 template.");
  source = source.replace(/let sharedKey: String = "[^"\n]+"/, 'let sharedKey: String = "hafaworkoutsShareKey.\\(UUID().uuidString)"');
  const loadingStart = source.indexOf("  private func handleViewLoad() {");
  const loadingEnd = source.indexOf("  private func dismissWithError", loadingStart);
  if (loadingStart < 0 || loadingEnd < 0 || !loader)
    throw Error("Workouts share attachment template changed; refusing partial capture generation.");
  source = source.slice(0, loadingStart) + loader + "\n" + source.slice(loadingEnd);
  const start = source.indexOf("  private func redirectToHostApp(type: RedirectType) {");
  const end = source.indexOf("  enum RedirectType", start);
  if (start < 0 || end < 0) throw Error("Workouts share redirect template changed; refusing to generate a host-app redirect.");
  return source.slice(0, start) + confirmation + "\n" + source.slice(end) + "\n" + store;
}
module.exports = function withWorkoutsShare(config) {
  const extensions = config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  for (const extension of extensions) if (extension.targetName === "ShareExtension")
    extension.entitlements = { ...extension.entitlements, "keychain-access-groups": [keychain] };
  config = withBaseMod(config, { platform: "ios", mod: "entitlements", isProvider: false, isIntrospective: true, action: async mod => {
    mod = await mod.modRequest.nextMod(mod);
    const groups = mod.modResults["com.apple.security.application-groups"];
    if (groups) mod.modResults["com.apple.security.application-groups"] = [...new Set(groups)];
    mod.modResults["keychain-access-groups"] = [...new Set([...(mod.modResults["keychain-access-groups"] ?? []), keychain])];
    return mod;
  } });
  config = withInfoPlist(config, mod => { mod.modResults.WorkoutsShareKeychainGroup = keychain; return mod; });
  // expo-share-intent writes its files in the Xcode mod, after dangerous mods.
  // Run that existing chain first, then transform its freshly written controller.
  return withBaseMod(config, { platform: "ios", mod: "xcodeproj", isProvider: false, action: async mod => {
    mod = await mod.modRequest.nextMod(mod);
    const extension = path.join(mod.modRequest.platformProjectRoot, "ShareExtension");
    const native = path.join(mod.modRequest.projectRoot, "modules/hafa-workouts-share/ios");
    const controller = path.join(extension, "ShareViewController.swift");
    const source = await fs.readFile(controller, "utf8");
    await fs.writeFile(controller, transformController(source,
      await fs.readFile(path.join(native, "CaptureConfirmation.swift"), "utf8"),
      await fs.readFile(path.join(native, "HafaWorkoutsShareStore.swift"), "utf8"),
      await fs.readFile(path.join(native, "CaptureProviderLoader.swift"), "utf8")));
    const fonts = [
      ["@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf", "DMSans_400Regular.ttf"],
      ["@expo-google-fonts/dm-sans/600SemiBold/DMSans_600SemiBold.ttf", "DMSans_600SemiBold.ttf"],
      ["@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf", "Fraunces_600SemiBold.ttf"],
    ];
    const target = mod.modResults.findTargetKey("ShareExtension") ?? mod.modResults.findTargetKey('"ShareExtension"');
    const group = mod.modResults.findPBXGroupKey({ name: "ShareExtension" });
    if (!target || !group) throw Error("Workouts share target/group missing; refusing unstyled extension.");
    for (const [module, name] of fonts) {
      await fs.copyFile(require.resolve(module, { paths: [mod.modRequest.projectRoot] }), path.join(extension, name));
      mod.modResults.addResourceFile(name, { target }, group);
    }
    for (const [name, update] of [
      ["ShareExtension.entitlements", value => { value["keychain-access-groups"] = [keychain]; }],
      ["ShareExtension-Info.plist", value => { value.WorkoutsShareKeychainGroup = keychain; value.UIAppFonts = fonts.map(([, name]) => name); }],
    ]) {
      const file = path.join(extension, name); const value = plist.parse(await fs.readFile(file, "utf8"));
      update(value); await fs.writeFile(file, plist.build(value));
    }
    return mod;
  } });
};
module.exports.transformController = transformController;
