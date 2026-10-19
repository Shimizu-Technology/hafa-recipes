const { withBaseMod } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");
const plist = require("@expo/plist").default;
const { createHash } = require("node:crypto");
const helper = fs.readFileSync(path.join(__dirname, "BabySharePreprocessing.swift"), "utf8").trim();
const helperStart = "// BEGIN HAFA BABY SAFARI DECODER v1";
const helperEnd = "// END HAFA BABY SAFARI DECODER v1";
const handler = `  private func handlePrepocessing(content: NSExtensionItem, attachment: NSItemProvider, index: Int)
    async
  {
    // HAFA BABY VALIDATED SAFARI PREPROCESSING v1
    do {
      let item = try await attachment.loadItem(forTypeIdentifier: self.propertyListType, options: nil)
      let page = try BabySharePreprocessing.decode(item, resultsKey: NSExtensionJavaScriptPreprocessingResultsKey)
      guard let attachments = content.attachments, attachments.indices.contains(index)
      else { throw BabySharePreprocessing.InvalidPage.invalid }
      self.sharedWebUrl.append(WebUrl(url: page.url, meta: page.metadata))
      if index == attachments.count - 1 {
        guard let userDefaults = UserDefaults(suiteName: self.hostAppGroupIdentifier)
        else { throw BabySharePreprocessing.InvalidPage.invalid }
        let encoded = try JSONEncoder().encode(self.sharedWebUrl)
        userDefaults.set(encoded, forKey: self.sharedKey)
        userDefaults.set(self.babyCaptureId, forKey: "babyCaptureId")
        userDefaults.synchronize()
        self.redirectToHostApp(type: .weburl)
      }
    } catch {
      // Provider failures and malformed input must never log private page data.
      self.dismissWithError(message: "Could not read this shared page. Try sharing its link again.")
    }
  }

`;

const imageHelper = fs.readFileSync(path.join(__dirname, "BabyShareImageBatch.swift"), "utf8").trim();
const imageHandler =
  "  " + fs.readFileSync(path.join(__dirname, "BabyShareImageHandler.swift"), "utf8").trim() + "\n\n";
const imageBatchGuard = `      // HAFA BABY HOMOGENEOUS SHARE INPUTS v1
      guard !attachments.isEmpty,
        attachments.count == 1 || (attachments.count <= 4 && attachments.allSatisfy({
          $0.hasItemConformingToTypeIdentifier(self.imageContentType)
        }))
      else {
        dismissWithError(message: "Share up to four images together, or share one other item.")
        return
      }
`;
function normalizedMethod(text) {
  return text
    .replace(/^[ \t]*userDefaults\?\.set\(self\.babyCaptureId, forKey: "babyCaptureId"\)\r?\n/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
function replaceKnownMethod(text, start, end, expectedHash, replacement) {
  if (text.split(start).length !== 2 || text.split(end).length !== 2)
    throw Error("Håfa Baby image share method shape changed; refusing unsafe generation.");
  const first = text.indexOf(start),
    last = text.indexOf(end);
  if (last <= first) throw Error("Håfa Baby image share method order changed.");
  const original = text.slice(first, last);
  if (original === replacement) return text;
  if (
    ![expectedHash, "789420d21f7eacd5f083ca79a291d8e75474ba2746c7f76854cacc252650c3ff"].includes(
      createHash("sha256").update(normalizedMethod(original)).digest("hex")
    )
  )
    throw Error("Håfa Baby image share method changed; refusing unsafe generation.");
  return text.slice(0, first) + replacement + text.slice(last);
}
function patchImageSharing(text) {
  const start = "  private func handleViewLoad()",
    end = "  private func handleVCard(";
  if (text.split(start).length !== 2 || text.split(end).length !== 2)
    throw Error("Håfa Baby image share entry changed; refusing unsafe generation.");
  const first = text.indexOf(start),
    last = text.indexOf(end);
  if (last <= first) throw Error("Håfa Baby image share entry order changed.");
  const loop = text.slice(first, last),
    call = "          await handleImages(content: content, attachment: attachment, index: index)\n";
  const original = loop.replace(imageBatchGuard, "").replace(call + "          return\n", call);
  if (
    createHash("sha256").update(normalizedMethod(original)).digest("hex") !==
    "749ec09c2ac24ba82e2c4c642414fa2f22de591d86089bcdb91ff9e6a8fded9b"
  )
    throw Error("Håfa Baby image share entry changed; refusing unsafe generation.");
  const joined = original
    .replace("      for (index, attachment)", imageBatchGuard + "      for (index, attachment)")
    .replace(call, call + "          return\n");
  text = text.slice(0, first) + joined + text.slice(last);
  text = replaceKnownMethod(
    text,
    "  private func handleImages(",
    "  private func documentDirectoryPath(",
    "545ae0b66e71370b74d3dcad46e728b357c577e5ff76ec2f649491f0bbcc0f8d",
    imageHandler
  );
  const begin = "// BEGIN HAFA BABY IMAGE BATCH v1",
    finish = "// END HAFA BABY IMAGE BATCH v1";
  const block = `${begin}\n${imageHelper}\n${finish}`;
  if (text.includes(begin) || text.includes(finish)) {
    if (text.split(begin).length !== 2 || text.split(finish).length !== 2 || !text.includes(block))
      throw Error("Håfa Baby image share helper changed; refusing partial generation.");
  } else text = text.trimEnd() + "\n\n" + block + "\n";
  const normalization = fs.readFileSync(path.join(__dirname, "BabyShareImageNormalization.swift"), "utf8").trim();
  const normalizationStart = "// BEGIN HAFA BABY IMAGE NORMALIZATION v1";
  const normalizationEnd = "// END HAFA BABY IMAGE NORMALIZATION v1";
  const normalizationBlock = `${normalizationStart}\n${normalization}\n${normalizationEnd}`;
  if (text.includes(normalizationStart) || text.includes(normalizationEnd)) {
    if (
      text.split(normalizationStart).length !== 2 ||
      text.split(normalizationEnd).length !== 2 ||
      !text.includes(normalizationBlock)
    )
      throw Error("Håfa Baby image normalization changed; refusing partial generation.");
  } else text = text.trimEnd() + "\n\n" + normalizationBlock + "\n";
  for (const dependency of ["ImageIO", "UniformTypeIdentifiers"])
    if (!text.includes(`import ${dependency}\n`))
      text = text.replace("import MobileCoreServices\n", `import MobileCoreServices\nimport ${dependency}\n`);
  return text;
}

function patchShareController(text) {
  const start = "  private func handlePrepocessing(";
  const end = "  private func handlePkPass(";
  if (text.split(start).length !== 2 || text.split(end).length !== 2)
    throw Error("Håfa Baby Safari share handler shape changed; review expo-share-intent before generating.");
  const first = text.indexOf(start),
    last = text.indexOf(end);
  if (last <= first) throw Error("Håfa Baby Safari share handler order changed.");
  const original = text.slice(first, last);
  if (original !== handler) {
    // Ignore our older capture-receipt insertion and whitespace, but pin all
    // actual upstream statements so an SDK change cannot silently skip this fix.
    const normalized = original
      .replace(/^[ \t]*userDefaults\?\.set\(self\.babyCaptureId, forKey: "babyCaptureId"\)\r?\n/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    const hash = createHash("sha256").update(normalized).digest("hex");
    if (hash !== "fedc89cfcec83c0ad18164e90bb89aa8f44db773721f32221fad88ebf9f1715e")
      throw Error("Håfa Baby Safari share handler changed; refusing unsafe generation.");
    text = text.slice(0, first) + handler + text.slice(last);
  }
  const block = `${helperStart}\n${helper}\n${helperEnd}`;
  if (text.includes(helperStart) || text.includes(helperEnd)) {
    if (text.split(helperStart).length !== 2 || text.split(helperEnd).length !== 2 || !text.includes(block))
      throw Error("Håfa Baby Safari decoder changed; refusing partial generation.");
  } else text = text.trimEnd() + "\n\n" + block + "\n";

  const receipt = "  private let babyCaptureId = UUID().uuidString";
  if (!text.includes(receipt)) {
    const key = 'let sharedKey: String = "hafababyShareKey"';
    if (text.split(key).length !== 2) throw Error("Håfa Baby share key changed.");
    text = text.replace(key, key + "\n" + receipt);
  }
  text = text.replace(
    /(?:[ \t]*userDefaults\?\.set\(self\.babyCaptureId, forKey: "babyCaptureId"\)\n)?([ \t]*)userDefaults\?\.synchronize\(\)/g,
    (_, indent) =>
      `${indent}userDefaults?.set(self.babyCaptureId, forKey: "babyCaptureId")\n${indent}userDefaults?.synchronize()`
  );
  const protection =
    "try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: dstURL.path)";
  if (!text.includes(protection))
    text = text.replace(
      "try FileManager.default.copyItem(at: srcURL, to: dstURL)",
      "try FileManager.default.copyItem(at: srcURL, to: dstURL)\n      " + protection
    );
  return patchImageSharing(text);
}
module.exports = (config) => {
  for (const extension of config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [])
    if (extension.targetName === "ShareExtension")
      extension.entitlements = {
        ...extension.entitlements,
        "com.apple.developer.default-data-protection": "NSFileProtectionComplete",
      };
  return withBaseMod(config, {
    platform: "ios",
    mod: "xcodeproj",
    isProvider: false,
    action: async (mod) => {
      mod = await mod.modRequest.nextMod(mod);
      const root = mod.modRequest.platformProjectRoot;
      const source = path.join(root, "ShareExtension", "ShareViewController.swift");
      if (!fs.existsSync(source))
        throw Error("Håfa Baby share extension was not generated. Keep this plugin after expo-share-intent.");
      const text = patchShareController(fs.readFileSync(source, "utf8"));
      fs.writeFileSync(source, text);
      const entitlements = path.join(root, "ShareExtension", "ShareExtension.entitlements");
      const values = plist.parse(fs.readFileSync(entitlements, "utf8"));
      values["com.apple.developer.default-data-protection"] = "NSFileProtectionComplete";
      fs.writeFileSync(entitlements, plist.build(values));
      return mod;
    },
  });
};

module.exports.patchShareController = patchShareController;
