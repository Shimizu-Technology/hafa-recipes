import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { patchShareController, shareFonts, shareInfo } = require("./with-baby-share.cjs");
const upstream = readFileSync(
  join(
    dirname(require.resolve("expo-share-intent/package.json")),
    "plugin/build/ios/ShareExtensionViewController.swift"
  ),
  "utf8"
).replace(/let sharedKey: String = "[^"]+"/, 'let sharedKey: String = "hafababyShareKey"');
const method = (source) =>
  source.slice(source.indexOf("  private func handlePrepocessing("), source.indexOf("  private func handlePkPass("));

describe("generated Safari preprocessing", () => {
  it("replaces the installed upstream handler with the tested guarded decoder", () => {
    const output = patchShareController(upstream),
      body = method(output);
    expect(body).toContain("try await attachment.loadItem");
    expect(body).toContain("try BabySharePreprocessing.decode");
    expect(body).toContain("try JSONEncoder().encode");
    expect(body).toContain("catch {");
    expect(body).toContain("attachments.indices.contains(index)");
    expect(body).not.toMatch(/try!|as!|NSLog|String\(describing:|\.localizedDescription/);
    expect(output).toContain(readFileSync(new URL("./BabySharePreprocessing.swift", import.meta.url), "utf8").trim());
  });
  it("is idempotent including receipt and file protection patches", () => {
    const first = patchShareController(upstream);
    expect(patchShareController(first)).toBe(first);
    expect(first.match(/private let babyCaptureId/g)).toHaveLength(1);
  });
  it("defers provider work until presentation finishes and rejects stale generated lifecycles", () => {
    const output = patchShareController(upstream);
    const start = output.indexOf("  // BEGIN HAFA BABY PRESENTED SHARE v1");
    const end = output.indexOf("  private func handleViewLoad()");
    const lifecycle = output.slice(start, end);
    expect(lifecycle).toContain("_ = prepareBabyShare()");
    expect(lifecycle.slice(0, lifecycle.indexOf("override func viewDidAppear"))).not.toContain(
      "handleViewLoad()"
    );
    expect(lifecycle).toContain("guard !babyShareStarted, babyProducer != nil else { return }");
    expect(lifecycle.indexOf("babyShareStarted = true")).toBeLessThan(lifecycle.indexOf("    handleViewLoad()"));
    expect(patchShareController(output)).toBe(output);
    expect(() => patchShareController(upstream.replace("    if !hideView {", "    if hideView {"))).toThrow(
      "lifecycle changed"
    );
    // Reconstruct the previous valid generated controller, including a valid
    // body checksum and the identical store. It must request clean generation.
    const upstreamLifecycle = upstream.slice(
      upstream.indexOf("  override func viewDidLoad()"),
      upstream.indexOf("  private func handleViewLoad()")
    );
    const marker = "// HAFA BABY SHARED STORE v1 SHA256 ";
    const oldBody = output.split(marker)[0].replace(lifecycle, upstreamLifecycle);
    const oldGenerated = oldBody + marker + createHash("sha256").update(oldBody).digest("hex") + "\n";
    expect(() => patchShareController(oldGenerated)).toThrow("clean prebuild");
  });
  it("accepts the prior capture-receipt insertion in an otherwise unchanged upstream method", () => {
    const legacy = upstream.replaceAll(
      "userDefaults?.synchronize()",
      'userDefaults?.set(self.babyCaptureId, forKey: "babyCaptureId")\nuserDefaults?.synchronize()'
    );
    const output = patchShareController(legacy);
    expect(method(output)).toBe(method(patchShareController(upstream)));
    expect(patchShareController(output)).toBe(output);
  });
  it("fails generation when the upstream handler or a partial applied patch changes", () => {
    expect(() => patchShareController(upstream.replace('results["baseURI"]', 'results["changed"]'))).toThrow(
      "refusing unsafe generation"
    );
    expect(() =>
      patchShareController(upstream.replace("private func handlePrepocessing", "private func renamed"))
    ).toThrow("shape changed");
    const patched = patchShareController(upstream);
    expect(() =>
      patchShareController(patched.replace("static let maxURLBytes = 8_192", "static let maxURLBytes = 999"))
    ).toThrow("partial generation");
    expect(() =>
      patchShareController(patched.replace("try BabySharePreprocessing.decode", "try Other.decode"))
    ).toThrow("partial generation");
  });
  it("joins the image batch once, rejects mixed providers and removes unsafe image operations", () => {
    const output = patchShareController(upstream);
    const body = output.slice(
      output.indexOf("  private func handleImages("),
      output.indexOf("  private func documentDirectoryPath(")
    );
    const entry = output.slice(
      output.indexOf("  private func handleViewLoad()"),
      output.indexOf("  private func handleVCard(")
    );
    expect(body).toContain("try await BabyShareImageBatch.process");
    expect(body).toContain("try await self.loadBabyImage(provider, directory: capture.directory)");
    expect(body).toContain("guard let producer = self.babyProducer");
    expect(body).toContain("try self.publishBabyPayload(encoded)");
    expect(body).toContain("if !published { try? storage.abort(capture) }");
    expect(body).toContain("BabyShareImageNormalization.normalize(fileURL: url)");
    expect(body).toContain("BabyShareImageNormalization.normalize(bytes: bytes)");
    expect(body).toContain("BabyShareImageNormalization.normalize(image: pixels)");
    expect(body).toContain("try normalized.bytes.write");
    expect(body).toContain("try? FileManager.default.removeItem");
    expect(body).not.toContain("pngData()");
    expect(body).not.toMatch(
      /Task\.detached|try!|as!|NSLog|Self\.copyFile|self\.saveScreenshot|self\.getFileSize|containerURL[^;]*!\n/
    );
    expect(entry).toContain("attachments.count <= 4 && attachments.allSatisfy");
    expect(entry).toContain(
      "await handleImages(content: content, attachment: attachment, index: index)\n          return"
    );
    expect(output).toContain(readFileSync(new URL("./BabyShareImageBatch.swift", import.meta.url), "utf8").trim());
    expect(output).toContain(
      readFileSync(new URL("./BabyShareImageNormalization.swift", import.meta.url), "utf8").trim()
    );
    expect(() =>
      patchShareController(output.replace("static let maxOutputBytes = 8", "static let maxOutputBytes = 9"))
    ).toThrow("partial generation");
    expect(() =>
      patchShareController(upstream.replace("let copied = Self.copyFile", "let copied = Changed.copyFile"))
    ).toThrow("image share method changed");
    expect(() =>
      patchShareController(upstream.replace("for (index, attachment)", "for (changed, attachment)"))
    ).toThrow("image share entry changed");
    expect(() => patchShareController(output.replace("guard (1...4)", "guard (1...5)"))).toThrow("partial generation");
  });
  it("coordinates every generated publisher through the same immutable capture store", () => {
    const output = patchShareController(upstream);
    const store = readFileSync(
      new URL("../modules/hafa-baby-share/ios/BabyShareStore.swift", import.meta.url),
      "utf8"
    ).trim();
    expect(output).toContain(store);
    expect(output.match(/guard self.publishBabyShare\(/g)).toHaveLength(4);
    expect(method(output)).toContain("try publishBabyPayload(encoded)");
    const entry = output.slice(
      output.indexOf("  private func handleViewLoad()"),
      output.indexOf("  private func handleVCard(")
    );
    expect(entry).toContain("guard prepareBabyShare() else { return }");
    expect(entry.indexOf("guard prepareBabyShare()")).toBeLessThan(entry.indexOf("Task {"));
    expect(output.match(/storage.begin\(id: self.babyCaptureId\)/g)).toHaveLength(1);
    expect(output).toContain("try producer.storage.publish(payload, capture: producer.capture)");
    expect(output).not.toContain("publish(raw, id: self.babyCaptureId)");
    expect(output).not.toContain("publish(encoded, id: self.babyCaptureId)");
    // Retained SDK video, file and screenshot writes use the pre-await namespace;
    // thumbnails stay alongside their staged video, including metadata failures.
    expect(output.match(/let newPath = directory.appendingPathComponent\(newName\)/g)).toHaveLength(2);
    expect(output).toContain('let path = url.deletingLastPathComponent().appendingPathComponent("\\(fileName).jpg")');
    expect(output).toContain("guard let containerURL = self.babyProducer?.capture.directory");
    expect(output.match(/guard copied else/g)).toHaveLength(2);
    expect(output).not.toContain('NSLog("Cannot copy item at');
    expect(output.match(/forSecurityApplicationGroupIdentifier: self.hostAppGroupIdentifier/g)).toHaveLength(1);
    expect(() =>
      patchShareController(upstream.replace("let path = FileManager.default", "let changedPath = FileManager.default"))
    ).toThrow("thumbnail staging changed");
    expect(output).not.toMatch(/userDefaults\??\.set\([^\n]+forKey: self\.sharedKey\)/);
    expect(() =>
      patchShareController(output.replace("publishBabyShare(self.sharedText)", "publishBabyShare([])"))
    ).toThrow("partial generation");
  });
  it("keeps link and caption together and confirms inside the originating app", () => {
    const output = patchShareController(upstream);
    expect(output).toContain("await self.handleBabyLinks(attachments, content: content)");
    expect(output).toContain("try await provider.loadItem(forTypeIdentifier: textContentType)");
    expect(output).toContain("BabySharePayload.merging(raw, caption: caption)");
    expect(output).toContain("attributedContentText?.string");
    expect(output).toContain('"Saved on this phone"');
    expect(output).toContain('"You’re not signed in"');
    expect(output).toContain('"Done"');
    // No more false promise that a family's capture is private, and none of the old words.
    for (const gone of ["Private to your Baby account", "Import started", "Saving your source", "when you are online"])
      expect(output).not.toContain(gone);
    expect(output).toContain("BabyShareSession.enqueue(producer.capture.id");
    expect(output).not.toContain("application.open(url)");
    expect(output).not.toContain("hideView {");
    const confirmation = output.slice(output.indexOf("  private func redirectToHostApp("), output.indexOf("  enum RedirectType"));
    expect(confirmation).not.toContain("extensionContext!.completeRequest");
    expect(output).toContain('"com.shimizutechnology.hafababy.share.v1"');
    expect(output).toContain('"auto_process_epoch": automaticEpoch');
    expect(output).toContain("storage.bind(scope, automaticEpoch: automaticEpoch)");
    expect(output).toContain("request.httpBody = try BabySharePayload.requestBody(capture)");
    expect(output).toContain('"automatic_epoch": saved.automaticEpoch');
    expect(output).toContain('"capture_id", "occurred_at", "url", "text", "automatic_epoch"');
    expect(output).toContain("scope: original.scope");
    expect(output).toContain("automaticEpoch: capture.automaticEpoch");
    expect(output).not.toContain('"hfws_v1."');
  });
  it("never shows the library's alert or its text, and never logs what was shared", () => {
    const output = patchShareController(upstream);
    expect(output).not.toMatch(/UIAlertController|Error loading application|NSLog\(/);
    expect(() => patchShareController(upstream.replace('title: "Error"', 'title: "Oops"'))).toThrow("share alert changed");
    expect(output).not.toContain('dismissWithError(message: "content type');
    expect(output).toContain("showBabyProblem(.unsupported)");
  });
  it("refuses a file by its size and type before copying it, and again after if the size wasn't known", () => {
    const output = patchShareController(upstream);
    const video = output.slice(output.indexOf("  private func handleVideos("), output.indexOf("  private func handlePdf("));
    const file = output.slice(output.indexOf("  private func handleFileURL("), output.indexOf("  private func dismissWithError("));
    for (const body of [video, file]) {
      const before = body.indexOf("self.babyFileFits(name: fileName, mimeType: mimeType, size: fileSize)"),
        copy = body.indexOf("Self.copyFile(at: url, to: newPath)"),
        after = body.indexOf("size: self.getFileSize(from: newPath)"),
        publish = body.indexOf("publishBabyShare(");
      expect(before).toBeGreaterThan(-1);
      expect(before).toBeLessThan(copy);
      expect(copy).toBeLessThan(after);
      expect(after).toBeLessThan(publish);
    }
  });
  it("takes the same files as the app, so nothing the app refuses gets into the queue", () => {
    const rule = readFileSync(new URL("./BabyShareSheetState.swift", import.meta.url), "utf8"),
      app = readFileSync(new URL("../lib/file-type.ts", import.meta.url), "utf8"),
      list = app.slice(app.indexOf("return ({ jpg"), app.indexOf("} as Record<string, string>)[extension"));
    const appExtensions = [...list.matchAll(/["']?([a-z0-9]+)["']?: "[a-z]+\/[^"]+"/g)].map((match) => match[1]);
    expect(appExtensions.length).toBeGreaterThan(10);
    for (const extension of appExtensions) expect(rule).toContain(`"${extension}"`);
    expect(readFileSync(new URL("../lib/files.ts", import.meta.url), "utf8")).toContain("25 * 1024 * 1024");
    expect(rule).toContain("25 * 1024 * 1024");
  });
  it("paints Baby Soft at load, with the app's real tokens and no blank or clear view", () => {
    const output = patchShareController(upstream);
    const lifecycle = output.slice(output.indexOf("  // BEGIN HAFA BABY PRESENTED SHARE v1"), output.indexOf("  private func handleViewLoad()"));
    expect(lifecycle).not.toContain(".clear");
    expect(lifecycle.indexOf("showBabySheet(.saving)")).toBeLessThan(lifecycle.indexOf("_ = prepareBabyShare()"));
    expect(output).not.toContain("preferredContentSize");
    const theme = readFileSync(new URL("./BabyShareTheme.swift", import.meta.url), "utf8");
    const ui = readFileSync(new URL("../components/ui.tsx", import.meta.url), "utf8");
    const palette = (name) => {
      const block = ui.slice(ui.indexOf(`const ${name}`), ui.indexOf("};", ui.indexOf(`const ${name}`)));
      return (token) => block.match(new RegExp(`\\b${token}: "#([0-9A-Fa-f]{6})"`))?.[1].toUpperCase();
    };
    const light = palette("light"), dark = palette("dark");
    const tokens = { background: "background", title: "text", detail: "muted", action: "action", onAction: "onAction", tile: "hero", glyph: "accentText", problemTile: "errorBg", problemGlyph: "error" };
    for (const [role, token] of Object.entries(tokens)) {
      expect(light(token), token).toBeTruthy();
      expect(theme).toContain(`${role}: colour(0x${light(token)}, 0x${dark(token)})`);
    }
    // The view is meant to be carried to the other apps, so it says nothing about this one.
    const view = readFileSync(new URL("./HafaShareSheetView.swift", import.meta.url), "utf8");
    expect(view).not.toMatch(/Baby|BabyShareStore|BabyShareSession|"Done"|"Stop"/);
  });
  it("bounds a provider that never answers, and closes through one path that keeps nothing unpublished", () => {
    const output = patchShareController(upstream);
    const lifecycle = output.slice(output.indexOf("  // BEGIN HAFA BABY PRESENTED SHARE v1"), output.indexOf("  // END HAFA BABY PRESENTED SHARE v1"));
    expect(lifecycle.indexOf("babyWatchProvider()")).toBeLessThan(lifecycle.indexOf("    handleViewLoad()"));
    expect(lifecycle).toContain("abortBabyShare()\n    extensionContext?.completeRequest");
    expect(output.match(/completeRequest\(/g)).toHaveLength(1);
  });
  it("names the share row Håfa Baby and lists the fonts it copies", () => {
    const info = shareInfo({ CFBundleDisplayName: "Håfa Baby - Share Extension", NSExtension: 1 });
    expect(info.CFBundleDisplayName).toBe("Håfa Baby");
    expect(info.NSExtension).toBe(1);
    expect(info.UIAppFonts).toEqual(["Newsreader_500Medium.ttf", "DMSans_400Regular.ttf", "DMSans_600SemiBold.ttf"]);
    for (const font of shareFonts) expect(readFileSync(require.resolve(font)).length).toBeGreaterThan(1000);
  });
  it.skipIf(process.platform !== "darwin")(
    "typechecks the whole generated extension against the iOS SDK, which parsing alone wouldn't",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "Håfa share typecheck "));
      try {
        const generated = join(directory, "ShareViewController.swift");
        writeFileSync(generated, patchShareController(upstream).replace("<GROUPIDENTIFIER>", "group.test").replace("<SCHEME>", "test").replace("<HIDEVIEW>", "true"));
        const sdk = execFileSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], { encoding: "utf8" }).trim();
        execFileSync("xcrun", ["swiftc", "-typecheck", "-swift-version", "5", "-sdk", sdk, "-target", "arm64-apple-ios17.0-simulator", generated], { timeout: 110_000, stdio: "pipe" });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    120_000
  );
  it.skipIf(process.platform !== "darwin")(
    "executes the exact embedded Foundation decoder against valid and malformed native values",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "Håfa share swift ")),
        executable = join(directory, "decoder-tests");
      try {
        const generated = join(directory, "ShareViewController.swift");
        writeFileSync(generated, patchShareController(upstream));
        execFileSync("swiftc", ["-frontend", "-parse", generated], { timeout: 30_000 });
        execFileSync(
          "swiftc",
          [
            fileURLToPath(new URL("./BabySharePreprocessing.swift", import.meta.url)),
            fileURLToPath(new URL("./__tests__/BabySharePreprocessingTests.swift", import.meta.url)),
            "-o",
            executable,
          ],
          { timeout: 60_000 }
        );
        expect(execFileSync(executable, { encoding: "utf8", timeout: 10_000 })).toContain(
          "native Foundation cases passed"
        );
        execFileSync(
          "swiftc",
          [
            fileURLToPath(new URL("./BabyShareImageBatch.swift", import.meta.url)),
            fileURLToPath(new URL("./__tests__/BabyShareImageBatchTests.swift", import.meta.url)),
            "-o",
            executable,
          ],
          { timeout: 60_000 }
        );
        expect(execFileSync(executable, { encoding: "utf8", timeout: 10_000 })).toContain(
          "native asynchronous cases passed"
        );
        execFileSync(
          "swiftc",
          [
            fileURLToPath(new URL("./BabyShareImageNormalization.swift", import.meta.url)),
            fileURLToPath(new URL("./__tests__/BabyShareImageNormalizationTests.swift", import.meta.url)),
            "-o",
            executable,
          ],
          { timeout: 60_000 }
        );
        expect(execFileSync(executable, { encoding: "utf8", timeout: 30_000 })).toContain(
          "native ImageIO cases passed"
        );
        execFileSync(
          "swiftc",
          [
            fileURLToPath(new URL("../modules/hafa-baby-share/ios/BabyShareStore.swift", import.meta.url)),
            fileURLToPath(new URL("../modules/hafa-baby-share/ios/BabySharePayload.swift", import.meta.url)),
            fileURLToPath(new URL("./__tests__/BabyShareStoreTests.swift", import.meta.url)),
            "-o",
            executable,
          ],
          { timeout: 60_000 }
        );
        expect(execFileSync(executable, { encoding: "utf8", timeout: 30_000 })).toContain(
          "native capture store cases passed"
        );
        execFileSync(
          "swiftc",
          [
            fileURLToPath(new URL("./BabyShareSheetState.swift", import.meta.url)),
            fileURLToPath(new URL("./__tests__/BabyShareSheetStateTests.swift", import.meta.url)),
            "-o",
            executable,
          ],
          { timeout: 60_000 }
        );
        expect(execFileSync(executable, { encoding: "utf8", timeout: 10_000 })).toContain(
          "native sheet state cases passed"
        );
        const output = patchShareController(upstream);
        const lifecycle = output.slice(
          output.indexOf("  // BEGIN HAFA BABY PRESENTED SHARE v1"),
          output.indexOf("  private func handleViewLoad()")
        );
        const preparation = output.slice(
          output.indexOf("  private func prepareBabyShare()"),
          output.indexOf("  private func publishBabyPayload(")
        );
        const lifecycleTest = join(directory, "GeneratedLifecycleTests.swift");
        writeFileSync(
          lifecycleTest,
          readFileSync(new URL("./__tests__/BabyShareLifecycleTests.swift", import.meta.url), "utf8")
            .replace("/* GENERATED_PREPARATION */", preparation)
            .replace("/* GENERATED_LIFECYCLE */", lifecycle.replaceAll("  private ", "  "))
        );
        execFileSync(
          "swiftc",
          [
            fileURLToPath(new URL("../modules/hafa-baby-share/ios/BabyShareStore.swift", import.meta.url)),
            lifecycleTest,
            "-o",
            executable,
          ],
          { timeout: 60_000 }
        );
        expect(execFileSync(executable, { encoding: "utf8", timeout: 10_000 })).toContain(
          "native generated lifecycle cases passed"
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    70_000
  );
});
