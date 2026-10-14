import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
const clearSession = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/modules/hafa-workouts-share/src", () => ({ clearSession }));
import { revokeNativeSharing, serializeShare } from "./native-share-session";
const require = createRequire(import.meta.url);
const plugin = require("../plugins/with-workouts-share.cjs");
const native = (file: string) => readFileSync(new URL(`../modules/hafa-workouts-share/ios/${file}`, import.meta.url), "utf8");
const transform = (source: string) => plugin.transformController(source, native("CaptureConfirmation.swift"),
  native("HafaWorkoutsShareStore.swift"), native("CaptureProviderLoader.swift"));

describe("Workouts native share generation", () => {
  it("replaces upstream concurrent parsing and host-app redirects with ordered durable confirmation", () => {
    const stock = require("expo-share-intent/plugin/build/ios/writeIosShareExtensionFiles.js")
      .getShareExtensionViewControllerContent("hafaworkouts", "group.com.shimizutechnology.hafaworkouts", true);
    const source = transform(stock);
    expect(source).toContain('"hafaworkoutsShareKey.\\(UUID().uuidString)"');
    expect(source).toContain("private func handleText");
    expect(source).toContain("private func handleImages");
    expect(source).not.toContain("application.open(url)");
    expect(source).toContain('"api/v1/workouts/share/imports"');
    expect(source).toContain("completeRequest(returningItems: []");
    expect(source).not.toContain("recipeextractor");
    expect(source).not.toContain("api/share/imports");
    expect(source).toContain('capture["generation"]');
    expect(source).toContain('receipt["capture_id"] as? String == capture');
  });
  it("bounds dismissal after durable promotion without blocking the main actor on enqueue or privacy reads", () => {
    const confirmation = native("CaptureConfirmation.swift");
    const promotion = native("HafaWorkoutsShareStore.swift").split("static func promoteStage")[1].split("static func discardOwner")[0];
    expect(confirmation).toContain("guard let isPublic = WorkoutsShareStore.promoteStage");
    expect(promotion).toContain('return capture["isPublic"] as? Bool ?? false');
    expect(confirmation).not.toContain("WorkoutsShareStore.locked");
    expect(confirmation.indexOf("WorkoutsShareStore.promoteStage")).toBeLessThan(confirmation.indexOf("DispatchQueue.main.asyncAfter"));
    expect(confirmation).toContain("DispatchQueue.main.asyncAfter(deadline: .now() + 8)");
    expect(confirmation.indexOf("DispatchQueue.global(qos: .utility).async")).toBeLessThan(confirmation.indexOf("WorkoutsShareStore.enqueue(key)"));
    expect(confirmation).toContain("guard !captureConfirmationFinished else { return }");
    expect(confirmation).toContain("finished: true, isPublic: isPublic");
  });
  it("fails closed if the pinned upstream redirect template changes", () => {
    expect(() => transform("new upstream implementation")).toThrow(/verified/);
  });
  it("refuses generation when the upstream attachment region changes", () => {
    const stock = require("expo-share-intent/plugin/build/ios/writeIosShareExtensionFiles.js")
      .getShareExtensionViewControllerContent("hafaworkouts", "group.com.shimizutechnology.hafaworkouts", true);
    expect(() => transform(stock.replace("  private func handleViewLoad() {", "  private func changedLoader() {")))
      .toThrow(/attachment template/);
  });
  it("publishes once after sequential provider completion, and rolls back canceled or failed copies", () => {
    const stock = require("expo-share-intent/plugin/build/ios/writeIosShareExtensionFiles.js")
      .getShareExtensionViewControllerContent("hafaworkouts", "group.com.shimizutechnology.hafaworkouts", true);
    const source = transform(stock);
    expect(source).not.toContain("Task.detached");
    expect(source).not.toContain("if index ==");
    expect(source).not.toContain("try! await attachment.loadItem");
    expect(source.indexOf("beginStage(sharedKey)")).toBeLessThan(source.indexOf("try await loadCaptureAttachment(attachment)"));
    expect(source.indexOf("try await loadCaptureAttachment(attachment)")).toBeLessThan(source.indexOf("redirectToHostApp(type: .media)"));
    expect(source).toContain("captureLoadingTask?.cancel()");
    expect(source).toContain("try Task.checkCancellation()");
    expect(source).toContain("WorkoutsShareStore.abortStage(sharedKey)");
    expect(source).toContain("WorkoutsShareStore.copyStagedFile(sharedKey, source: source, destination: destination)");
    expect(source).toContain("throw captureError(\"Could not save the shared file.");
    expect(source).toContain("guard !sharedMedia.isEmpty || !sharedWebUrl.isEmpty");
  });
  it("binds original account and privacy before provider awaits without reading a replacement session at promotion", () => {
    const loader = native("CaptureProviderLoader.swift");
    const confirmation = native("CaptureConfirmation.swift");
    const store = native("HafaWorkoutsShareStore.swift");
    const beginning = store.slice(store.indexOf("static func beginStage"), store.indexOf("static func copyStagedFile"));
    const promotion = store.slice(store.indexOf("static func promoteStage"), store.indexOf("static func discardOwner"));
    expect(loader.indexOf("beginStage(sharedKey)")).toBeLessThan(loader.indexOf("try await loadCaptureAttachment"));
    expect(beginning).toContain('stage["ownerId"] = session?["ownerId"]');
    expect(beginning).toContain('"isPublic": session?["isPublic"] as? Bool ?? false');
    expect(confirmation).not.toContain("sessionKey");
    expect(promotion).not.toContain("sessionKey");
    expect(promotion).toContain('capture["ownerId"] = stage["ownerId"]');
    expect(promotion).toContain('capture["accountScopeId"] = stage["accountScopeId"]');
  });
  it("flushes exact file receipts before copy and preserves completed sources across interrupted promotion", () => {
    const store = native("HafaWorkoutsShareStore.swift");
    const copying = store.slice(store.indexOf("static func copyStagedFile"), store.indexOf("static func promoteStage"));
    const promotion = store.slice(store.indexOf("static func promoteStage"), store.indexOf("static func discardOwner"));
    const cleanup = store.slice(store.indexOf("static func abortStage"), store.indexOf("static func beginStage"));
    expect(copying).toContain("guard try locked");
    expect(copying.indexOf('d.set(stage, forKey: key + ".stage")')).toBeLessThan(copying.indexOf("guard d.synchronize()"));
    expect(copying.indexOf("guard d.synchronize()")).toBeLessThan(copying.indexOf("try FileManager.default.copyItem"));
    expect(promotion.indexOf('d.set(capture, forKey: key + ".capture")')).toBeLessThan(promotion.indexOf("guard d.synchronize()"));
    expect(promotion.indexOf("guard d.synchronize()")).toBeLessThan(promotion.indexOf('d.removeObject(forKey: key + ".stage")'));
    expect(cleanup.indexOf('if let capture = d.dictionary(forKey: key + ".capture")')).toBeLessThan(cleanup.indexOf("else if !removeFiles(paths)"));
    expect(cleanup).toContain("Set(capturedPaths) == Set(paths)");
    expect(cleanup).toContain("24 * 60 * 60");
    expect(store).not.toContain("contentsOfDirectory");
    expect(native("HafaWorkoutsShareModule.swift")).toContain("WorkoutsShareStore.discardOwner(owner)");
    expect(native("HafaWorkoutsShareModule.swift")).toContain("WorkoutsShareStore.reconcileStages(d)");
  });
  it("stages image and PDF data temporarily and prefers a URL over its preview", () => {
    const source = native("CaptureProviderLoader.swift");
    expect(source).not.toContain("saveScreenshot");
    expect(source.match(/temporaryDirectory/g)).toHaveLength(2);
    expect(source.match(/defer \{ try\? FileManager.default.removeItem\(at: staging\) \}/g)).toHaveLength(2);
    expect(source.indexOf("hasItemConformingToTypeIdentifier(urlContentType)")).toBeLessThan(source.indexOf("} else if attachment.hasItemConformingToTypeIdentifier(imageContentType)"));
    expect(source).toContain("!attachment.hasItemConformingToTypeIdentifier(fileURLType)");
    expect(source.indexOf("hasItemConformingToTypeIdentifier(pdfContentType)")).toBeLessThan(source.indexOf("hasItemConformingToTypeIdentifier(propertyListType)"));
    expect(source).toContain('extensionOverride: identifier == pdfContentType ? "pdf" : nil');
    expect(source).toContain("if url.isFileURL { try copyCaptureFile");
  });
  it("declares matching extension Keychain entitlements before prebuild/signing", () => {
    const config = plugin({ name: "Workouts", slug: "workouts", ios: { bundleIdentifier: "com.shimizutechnology.hafaworkouts" },
      extra: { eas: { build: { experimental: { ios: { appExtensions: [{ targetName: "ShareExtension" }] } } } } } });
    expect(config.extra.eas.build.experimental.ios.appExtensions[0].entitlements["keychain-access-groups"])
      .toEqual(["$(AppIdentifierPrefix)com.shimizutechnology.hafaworkouts.share"]);
  });
  it("keeps App Group and Keychain entries unique across repeated prebuilds", async () => {
    const group = "group.com.shimizutechnology.hafaworkouts";
    const keychain = "$(AppIdentifierPrefix)com.shimizutechnology.hafaworkouts.share";
    const upstream = require("expo-share-intent/plugin/build/ios/withIosAppEntitlements.js").withAppEntitlements;
    const config = plugin(upstream({ name: "Workouts", slug: "workouts", ios: { bundleIdentifier: "com.shimizutechnology.hafaworkouts" } },
      { iosAppGroupIdentifier: group }));
    const result = await config.mods.ios.entitlements({ ...config, modResults: {
      "com.apple.security.application-groups": [group, group],
      "keychain-access-groups": [keychain, keychain],
    }, modRequest: {} });
    expect(result.modResults["com.apple.security.application-groups"]).toEqual([group]);
    expect(result.modResults["keychain-access-groups"]).toEqual([keychain]);
    const repeated = await config.mods.ios.entitlements({ ...result, modRequest: {} });
    expect(repeated.modResults["com.apple.security.application-groups"]).toEqual([group]);
    expect(repeated.modResults["keychain-access-groups"]).toEqual([keychain]);
  });
  it("waits for the stock Xcode mod to create extension files before transforming them", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hafa-share-mod-"));
    const extension = join(directory, "ShareExtension");
    const stock = require("expo-share-intent/plugin/build/ios/writeIosShareExtensionFiles.js")
      .getShareExtensionViewControllerContent("hafaworkouts", "group.com.shimizutechnology.hafaworkouts", true);
    const plist = require("@expo/plist").default;
    const predecessor = async (config: unknown) => {
      mkdirSync(extension);
      writeFileSync(join(extension, "ShareViewController.swift"), stock);
      for (const file of ["ShareExtension.entitlements", "ShareExtension-Info.plist"])
        writeFileSync(join(extension, file), plist.build({}));
      return config;
    };
    try {
      const config = plugin({ name: "Workouts", slug: "workouts", mods: { ios: { xcodeproj: predecessor } } });
      expect(existsSync(extension)).toBe(false);
      await config.mods.ios.xcodeproj({ ...config, modResults: {}, modRequest: {
        platformProjectRoot: directory, projectRoot: new URL("..", import.meta.url).pathname,
      } });
      expect(readFileSync(join(extension, "ShareViewController.swift"), "utf8")).toContain("completeRequest(returningItems: []");
      expect(plist.parse(readFileSync(join(extension, "ShareExtension.entitlements"), "utf8"))["keychain-access-groups"])
        .toEqual(["$(AppIdentifierPrefix)com.shimizutechnology.hafaworkouts.share"]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
describe("native account changes", () => {
  it("serializes revocation after an outstanding configuration and before a new account write", async () => {
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const beginning = new Promise<void>(resolve => { started = resolve; });
    const events: string[] = [];
    clearSession.mockImplementationOnce(async () => { events.push("revoke"); });
    const first = serializeShare(async () => { events.push("old"); started(); await waiting; });
    const revoke = revokeNativeSharing();
    const second = serializeShare(async () => { events.push("new"); });
    await beginning; expect(events).toEqual(["old"]);
    release(); await Promise.all([first, revoke, second]);
    expect(events).toEqual(["old", "revoke", "new"]);
  });
  it("continues cleanup after an earlier native operation failed", async () => {
    await expect(serializeShare(async () => { throw Error("native failure"); })).rejects.toThrow("native failure");
    await revokeNativeSharing(); expect(clearSession).toHaveBeenCalled();
  });
});

// Extend the existing native share tests; Linux CI skips the Apple compiler.
it.skipIf(process.platform !== "darwin")("executes durable journal migration, recovery and failure fixtures", () => {
  const directory = mkdtempSync(join(tmpdir(), "hafa-workouts-journal-"));
  try {
    writeFileSync(join(directory, "main.swift"), String.raw`import Foundation
// Reproduce the pre-provider failure with a preference flush that reports
// failure. The journal must commit the receipt before reporting success,
// independently of cfprefsd's cache, and survive a separate reader/restart.
final class FailedFlushDefaults: UserDefaults {
    override func synchronize() -> Bool { false }
}
let workoutSuite = "hafa-workout-journal-tests.\(UUID().uuidString)"
let failedFlush = FailedFlushDefaults(suiteName: workoutSuite)!
let container = FileManager.default.temporaryDirectory.appendingPathComponent(workoutSuite)
try FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)
defer {
    failedFlush.removePersistentDomain(forName: workoutSuite)
    try? FileManager.default.removeItem(at: container)
}
let workoutA = "hafaworkoutsShareKey.\(UUID().uuidString)"
let workoutB = "hafaworkoutsShareKey.\(UUID().uuidString)"
let malformed = "hafaworkoutsShareKey.\(UUID().uuidString)"
let expired = "hafaworkoutsShareKey.\(UUID().uuidString)"
let sessionA: [String: Any] = ["ownerId": "owner-a", "generation": 2,
    "accountScopeId": "scope-a", "isPublic": false]
let captureA: [String: Any] = ["captureId": "capture-a", "url": "https://example.com/a",
    "ownerId": "owner-a", "generation": 2, "isPublic": false, "files": [[String: Any]]()]
failedFlush.set([workoutA], forKey: WorkoutsShareStore.pending)
failedFlush.set(captureA, forKey: workoutA + ".capture")
failedFlush.set(sessionA, forKey: WorkoutsShareStore.sessionKey)
failedFlush.set("original-installation", forKey: WorkoutsShareStore.installationKey)
failedFlush.set([malformed, expired], forKey: WorkoutsShareStore.staging)
failedFlush.set(["paths": ["file:///unrelated/must-remain"], "ownerId": "owner-a"], forKey: malformed + ".stage")
failedFlush.set(["createdAt": 0.0, "paths": ["file:///unrelated/must-remain"], "ownerId": "owner-a"], forKey: expired + ".stage")
failedFlush.set("never-migrate-a-token", forKey: "unrelated-secret")
assert(failedFlush.synchronize() == false) // build 11's beginStage returned this.
let journal = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
assert(WorkoutsShareStore.beginStage(workoutB, journal))
let reopened = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
assert(reopened.dictionary(forKey: workoutA + ".capture")?["captureId"] as? String == "capture-a")
assert(reopened.stringArray(forKey: WorkoutsShareStore.pending) == [workoutA])
assert(reopened.string(forKey: WorkoutsShareStore.installationKey) == "original-installation")
assert(reopened.dictionary(forKey: workoutB + ".stage")?["ownerId"] as? String == "owner-a")
assert(reopened.dictionary(forKey: workoutB + ".stage")?["generation"] as? Int == 2)
assert(reopened.dictionary(forKey: workoutB + ".stage")?["isPublic"] as? Bool == false)
assert(reopened.dictionary(forKey: malformed + ".stage") != nil)
assert(reopened.dictionary(forKey: expired + ".stage") != nil)
assert(failedFlush.dictionary(forKey: workoutA + ".capture") != nil) // migration preserves originals
let journalURL = container.appendingPathComponent(WorkoutsShareDefaults.journalName)
let persisted = try Data(contentsOf: journalURL)
let plist = try PropertyListSerialization.propertyList(from: persisted, format: nil) as! [String: Any]
assert((plist["receipts"] as! [String: Any])["unrelated-secret"] == nil)
let journalAttributes = try FileManager.default.attributesOfItem(atPath: journalURL.path)
assert(journalAttributes[.posixPermissions] as? Int == 0o600)
// Account B affects only later captures; A's receipt/privacy never changes.
reopened.set(["ownerId": "owner-b", "generation": 4, "accountScopeId": "scope-b", "isPublic": true], forKey: WorkoutsShareStore.sessionKey)
assert(reopened.synchronize())
let workoutC = "hafaworkoutsShareKey.\(UUID().uuidString)"
assert(WorkoutsShareStore.beginStage(workoutC, reopened))
let rotated = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
assert(rotated.dictionary(forKey: workoutB + ".stage")?["ownerId"] as? String == "owner-a")
assert(rotated.dictionary(forKey: workoutC + ".stage")?["ownerId"] as? String == "owner-b")
// Exercise the same journal operation boundary used under the native flock.
// A rejected operation must never publish dirty scope or receipt state.
enum Rejected: Error { case operation }
do {
    _ = try WorkoutsShareStore.withJournal(failedFlush, container) { state -> Bool in
        state.set(["ownerId": "rejected-owner"], forKey: WorkoutsShareStore.sessionKey)
        throw Rejected.operation
    }
    assertionFailure("The rejected operation must throw")
} catch Rejected.operation {}
let rejectedKey = "hafaworkoutsShareKey.\(UUID().uuidString)"
assert(WorkoutsShareStore.withJournal(failedFlush, container) { state in
    state.set(["paths": [String]()], forKey: rejectedKey + ".stage")
    return false
} == false)
let afterRejection = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
assert(afterRejection.dictionary(forKey: WorkoutsShareStore.sessionKey)?["ownerId"] as? String == "owner-b")
assert(afterRejection.dictionary(forKey: rejectedKey + ".stage") == nil)
assert(WorkoutsShareStore.acknowledge(workoutA, rotated))
let acknowledged = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
assert(acknowledged.dictionary(forKey: workoutA + ".capture") == nil)
assert(acknowledged.dictionary(forKey: workoutB + ".stage") != nil)
assert(acknowledged.dictionary(forKey: workoutC + ".stage") != nil)
// A failed actual file commit must never become a "saved" confirmation.
let savedURL = container.appendingPathComponent("saved.plist")
try FileManager.default.moveItem(at: journalURL, to: savedURL)
try FileManager.default.createDirectory(at: journalURL, withIntermediateDirectories: false)
let refused = "hafaworkoutsShareKey.\(UUID().uuidString)"
assert(!WorkoutsShareStore.beginStage(refused, acknowledged))
let savedBeforeFailure = try Data(contentsOf: savedURL)
assert(savedBeforeFailure != persisted) // contains the exact acknowledgement/account rotation
try FileManager.default.removeItem(at: journalURL)
try FileManager.default.moveItem(at: savedURL, to: journalURL)
let retry = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
assert(retry.dictionary(forKey: refused + ".stage") == nil)
assert(WorkoutsShareStore.beginStage(refused, retry))
// Existing unreadable/corrupt journals fail closed instead of overwriting
// queued sources with stale preferences or a new account.
let beforeCorruption = try Data(contentsOf: journalURL)
try Data("corrupt".utf8).write(to: journalURL)
do {
    _ = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
    assertionFailure("A corrupt journal must not be replaced")
} catch {}
let corruptData = try Data(contentsOf: journalURL)
assert(corruptData == Data("corrupt".utf8))
try beforeCorruption.write(to: journalURL)
print("Workouts native journal fixtures passed: failed preference flush, migration, recovery, account isolation, exact ack and failed write")
`);
    const binary = join(directory, "test");
    execFileSync("xcrun", ["swiftc", new URL("../modules/hafa-workouts-share/ios/HafaWorkoutsShareStore.swift", import.meta.url).pathname, join(directory, "main.swift"), "-o", binary], { timeout: 60000 });
    expect(execFileSync(binary, { encoding: "utf8", timeout: 10000 })).toContain("Workouts native journal fixtures passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
